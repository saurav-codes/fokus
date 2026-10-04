import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer } from "../src/index";
import { tempDbPath } from "./helpers";

let base: string;
let wsBase: string;
let app: ReturnType<typeof startServer>;

beforeAll(() => {
  app = startServer({ port: 0, databasePath: tempDbPath(), sessionSecret: "test-secret" });
  base = `http://127.0.0.1:${app.server.port}`;
  wsBase = `ws://127.0.0.1:${app.server.port}`;
});
afterAll(() => app.stop());

async function api(path: string, init: { method?: string; json?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  return { res, body: (await res.json().catch(() => null)) as Record<string, any> };
}

/** a websocket client that buffers every message from creation, so no event is ever missed */
function connect(path: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(`${wsBase}${path}`, { headers });
  const queue: Record<string, any>[] = [];
  const pending: ((msg: Record<string, any>) => void)[] = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data)) as Record<string, any>;
    const resolve = pending.shift();
    if (resolve) resolve(msg);
    else queue.push(msg);
  });
  return {
    ws,
    opened: () =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout waiting for websocket open")), 5000);
        ws.addEventListener(
          "open",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      }),
    nextMessage: () =>
      new Promise<Record<string, any>>((resolve, reject) => {
        const buffered = queue.shift();
        if (buffered) {
          resolve(buffered);
          return;
        }
        const timer = setTimeout(() => reject(new Error("timeout waiting for websocket message")), 5000);
        pending.push((msg) => {
          clearTimeout(timer);
          resolve(msg);
        });
      }),
  };
}

async function ownerWithSession() {
  const created = await api("/api/sessions", {
    method: "POST",
    json: {
      technique: "Pomodoro",
      cycles: [
        { type: "FOCUS", minutes: 25 },
        { type: "BREAK", minutes: 5 },
      ],
    },
  });
  const cookie = created.res.headers.getSetCookie()[0].split(";")[0];
  return { cookie, sessionId: created.body.id as string };
}

describe("websocket room", () => {
  test("connect, guest join, owner control, followers, errors", async () => {
    const { cookie, sessionId } = await ownerWithSession();
    const owner = connect(`/ws/session/${sessionId}`, { Cookie: cookie });
    const guest = connect(`/ws/session/${sessionId}`);
    await owner.opened();
    await guest.opened();

    // both sockets: timer_update then followers_update on open
    expect((await owner.nextMessage()).type).toBe("timer_update");
    expect((await owner.nextMessage()).type).toBe("followers_update");
    expect((await guest.nextMessage()).type).toBe("timer_update");
    expect((await guest.nextMessage()).type).toBe("followers_update");

    // guest joins with a name; both sockets see the followers list grow
    guest.ws.send(JSON.stringify({ action: "join_session", guest_name: "Sam" }));
    expect((await guest.nextMessage()).followers.map((f: any) => f.username)).toEqual(["Sam"]);
    expect((await owner.nextMessage()).followers.map((f: any) => f.username)).toEqual(["Sam"]);

    // guest cannot control the timer
    guest.ws.send(JSON.stringify({ action: "toggle_timer" }));
    const denied = await guest.nextMessage();
    expect(denied.type).toBe("error");
    expect(denied.message).toContain("owner");

    // owner pauses; both sockets get the paused state
    owner.ws.send(JSON.stringify({ action: "toggle_timer" }));
    const ownerPaused = await owner.nextMessage();
    expect(ownerPaused.type).toBe("timer_update");
    expect(ownerPaused.state).toBe("paused");
    const guestPaused = await guest.nextMessage();
    expect(guestPaused.state).toBe("paused");

    // owner resumes and skips to the next cycle
    owner.ws.send(JSON.stringify({ action: "toggle_timer" }));
    expect((await owner.nextMessage()).state).toBe("running");
    await guest.nextMessage();
    owner.ws.send(JSON.stringify({ action: "transition_to_next_cycle" }));
    const skipped = await owner.nextMessage();
    expect(skipped.currentCycle.order).toBe(2);
    await guest.nextMessage();

    // sync and unknown actions
    owner.ws.send(JSON.stringify({ action: "sync_inactive_timer" }));
    expect((await owner.nextMessage()).type).toBe("timer_update");
    owner.ws.send(JSON.stringify({ action: "wat" }));
    expect((await owner.nextMessage()).type).toBe("error");

    // guest disconnects: the follower list is broadcast back to the room
    guest.ws.close();
    const afterLeave = await owner.nextMessage();
    expect(afterLeave.type).toBe("followers_update");
    expect(afterLeave.followers).toEqual([]);

    // owner stops the session
    owner.ws.send(JSON.stringify({ action: "stop_timer" }));
    const stopped = await owner.nextMessage();
    expect(stopped.state).toBe("completed");
    owner.ws.close();
  });

  test("guest join without a name is rejected", async () => {
    const { sessionId } = await ownerWithSession();
    const ws = connect(`/ws/session/${sessionId}`);
    await ws.opened();
    expect((await ws.nextMessage()).type).toBe("timer_update");
    expect((await ws.nextMessage()).type).toBe("followers_update");
    ws.ws.send(JSON.stringify({ action: "join_session" }));
    const error = await ws.nextMessage();
    expect(error.type).toBe("error");
    expect(error.message).toContain("display name");
    ws.ws.close();
  });

  test("unknown session is refused", async () => {
    const ws = connect(`/ws/session/${crypto.randomUUID()}`);
    expect((await ws.nextMessage()).type).toBe("error");
    ws.ws.close();
  });
});
