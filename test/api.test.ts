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
        const timeout = setTimeout(() => reject(new Error("timeout waiting for websocket open")), 5000);
        ws.addEventListener(
          "open",
          () => {
            clearTimeout(timeout);
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
        const timeout = setTimeout(() => reject(new Error("timeout waiting for websocket message")), 5000);
        pending.push((msg) => {
          clearTimeout(timeout);
          resolve(msg);
        });
      }),
  };
}

async function mintIdentity(): Promise<string> {
  const res = await api("/api/sessions", {
    method: "POST",
    json: { technique: "Custom Technique", cycles: [{ type: "FOCUS", minutes: 25 }] },
  });
  return res.res.headers.getSetCookie()[0].split(";")[0];
}

describe("http api (passwordless)", () => {
  test("healthz", async () => {
    expect((await api("/healthz")).body).toEqual({ ok: true });
  });

  test("identity is minted by the first session you create", async () => {
    const { res } = await api("/api/sessions", {
      method: "POST",
      json: { technique: "Custom Technique", cycles: [{ type: "FOCUS", minutes: 25 }] },
    });
    expect(res.status).toBe(201);
    expect(res.headers.getSetCookie()[0]).toContain("fokus_session=");
    const cookie = res.headers.getSetCookie()[0].split(";")[0];
    const me = await api("/api/me", { headers: { cookie } });
    expect(me.body.user.id).toBe(1);
    expect(me.body.stats.sessions).toBe(1);
  });

  test("/api/me without an identity returns zeros, not an error", async () => {
    const me = await api("/api/me");
    expect(me.res.status).toBe(200);
    expect(me.body.user).toBe(null);
    expect(me.body.stats).toEqual({ sessions: 0, focusMs: 0, avgSessionMs: 0 });
    expect(me.body.sessions).toEqual([]);
  });

  test("owner control requires the minted identity", async () => {
    const cookie = await mintIdentity();
    const created = await api("/api/sessions", {
      method: "POST",
      headers: { cookie },
      json: {
        technique: "Pomodoro",
        cycles: [
          { type: "FOCUS", minutes: 25 },
          { type: "BREAK", minutes: 5 },
        ],
      },
    });
    const id = created.body.id as string;

    // no identity at all
    expect((await api(`/api/sessions/${id}/toggle`, { method: "POST" })).res.status).toBe(401);
    // a different identity
    const strangerCookie = await mintIdentity();
    expect(
      (await api(`/api/sessions/${id}/toggle`, { method: "POST", headers: { cookie: strangerCookie } })).res.status,
    ).toBe(403);

    const paused = await api(`/api/sessions/${id}/toggle`, { method: "POST", headers: { cookie } });
    expect(paused.body.state).toBe("paused");
    const skipped = await api(`/api/sessions/${id}/next`, { method: "POST", headers: { cookie } });
    expect(skipped.body.currentCycle.order).toBe(2);
    const stopped = await api(`/api/sessions/${id}/stop`, { method: "POST", headers: { cookie } });
    expect(stopped.body.state).toBe("completed");

    const me = await api("/api/me", { headers: { cookie } });
    expect(me.body.stats.sessions).toBe(2);
    expect(me.body.sessions).toHaveLength(2);
    expect(me.body.sessions.map((s: any) => s.id)).toContain(id);
    expect(me.body.sessions.every((s: any) => s.joined === false)).toBe(true);
  });

  test("the room view mints an identity for a cookieless visitor", async () => {
    const ownerCookie = await mintIdentity();
    const created = await api("/api/sessions", {
      method: "POST",
      headers: { cookie: ownerCookie },
      json: { technique: "Pomodoro", cycles: [{ type: "FOCUS", minutes: 25 }] },
    });
    const id = created.body.id as string;

    // no cookie: an identity is minted, with the same signed cookie as on create
    const room = await api(`/api/sessions/${id}`);
    expect(room.res.status).toBe(200);
    const cookie = room.res.headers.getSetCookie()[0];
    expect(cookie).toContain("fokus_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=2592000");
    expect(room.body.isOwner).toBe(false);

    // an invalid cookie is as good as none
    const bad = await api(`/api/sessions/${id}`, { headers: { cookie: "fokus_session=1.9999999999.nope" } });
    expect(bad.res.headers.getSetCookie()).toHaveLength(1);

    // a valid cookie is left alone, and its owner keeps the room
    const again = await api(`/api/sessions/${id}`, { headers: { cookie: cookie.split(";")[0] } });
    expect(again.res.headers.getSetCookie()).toEqual([]);
    expect(again.body.isOwner).toBe(false);
    const own = await api(`/api/sessions/${id}`, { headers: { cookie: ownerCookie } });
    expect(own.res.headers.getSetCookie()).toEqual([]);
    expect(own.body.isOwner).toBe(true);

    // a missing session mints nothing
    const missing = await api(`/api/sessions/${crypto.randomUUID()}`);
    expect(missing.res.status).toBe(404);
    expect(missing.res.headers.getSetCookie()).toEqual([]);
  });

  test("joined sessions count towards the joiner's dashboard", async () => {
    const ownerCookie = await mintIdentity();
    const created = await api("/api/sessions", {
      method: "POST",
      headers: { cookie: ownerCookie },
      json: {
        technique: "Pomodoro",
        cycles: [
          { type: "FOCUS", minutes: 25 },
          { type: "BREAK", minutes: 5 },
        ],
      },
    });
    const id = created.body.id as string;

    // the room page mints the joiner's identity
    const room = await api(`/api/sessions/${id}`);
    const joinerCookie = room.res.headers.getSetCookie()[0].split(";")[0];

    // the joiner joins over the websocket under that identity
    const joiner = connect(`/ws/session/${id}`, { Cookie: joinerCookie });
    await joiner.opened();
    expect((await joiner.nextMessage()).type).toBe("timer_update");
    expect((await joiner.nextMessage()).type).toBe("followers_update");
    joiner.ws.send(JSON.stringify({ action: "join_session", guest_name: "Sam" }));
    expect((await joiner.nextMessage()).followers.map((f: any) => f.username)).toEqual(["Sam"]);

    // the owner stops mid-focus: the elapsed focus time is banked
    await new Promise((resolve) => setTimeout(resolve, 50));
    const stopped = await api(`/api/sessions/${id}/stop`, { method: "POST", headers: { cookie: ownerCookie } });
    expect(stopped.body.state).toBe("completed");

    // the joiner closes their tab: presence leaves the room, attribution must not
    const watcher = connect(`/ws/session/${id}`);
    await watcher.opened();
    expect((await watcher.nextMessage()).type).toBe("timer_update");
    expect((await watcher.nextMessage()).followers.map((f: any) => f.username)).toEqual(["Sam"]);
    joiner.ws.close();
    expect((await watcher.nextMessage()).followers).toEqual([]); // the server finished the close
    watcher.ws.close();

    // a fresh socket reads the room from the database: no ghost participant remains
    const latecomer = connect(`/ws/session/${id}`);
    await latecomer.opened();
    expect((await latecomer.nextMessage()).type).toBe("timer_update");
    expect((await latecomer.nextMessage()).followers).toEqual([]);
    latecomer.ws.close();

    // the joiner's dashboard still counts the session they joined, focus time included
    const me = await api("/api/me", { headers: { cookie: joinerCookie } });
    expect(me.body.stats.sessions).toBe(1);
    expect(me.body.stats.focusMs).toBeGreaterThanOrEqual(40);
    expect(me.body.stats.avgSessionMs).toBe(me.body.stats.focusMs);
    expect(me.body.sessions).toHaveLength(1);
    expect(me.body.sessions[0].id).toBe(id);
    expect(me.body.sessions[0].joined).toBe(true);

    // the owner sees the same session flagged as their own, not joined
    const ownerMe = await api("/api/me", { headers: { cookie: ownerCookie } });
    expect(ownerMe.body.sessions.find((s: any) => s.id === id).joined).toBe(false);
  });

  test("preview works without an identity", async () => {
    const { res, body } = await api("/api/techniques/preview", {
      method: "POST",
      json: { technique: "Camel", totalMinutes: 180 },
    });
    expect(res.status).toBe(200);
    expect(body.cycles.reduce((a: number, c: any) => a + c.minutes, 0)).toBe(180);
  });

  test("session create validation", async () => {
    const post = (json: unknown) => api("/api/sessions", { method: "POST", json });
    expect((await post({ technique: "Pomodoro", cycles: [] })).res.status).toBe(400);
    expect((await post({ technique: "Pomodoro", cycles: [{ type: "FOCUS", minutes: 0 }] })).res.status).toBe(400);
    expect((await post({ technique: "Pomodoro", cycles: [{ type: "FOCUS", minutes: 601 }] })).res.status).toBe(400);
    expect((await post({ technique: "Nope", cycles: [{ type: "FOCUS", minutes: 25 }] })).res.status).toBe(400);
    expect(
      (
        await post({
          technique: "Pomodoro",
          cycles: Array.from({ length: 251 }, () => ({ type: "FOCUS", minutes: 1 })),
        })
      ).res.status,
    ).toBe(400);
  });
});
