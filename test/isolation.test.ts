import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DB, get, migrate, openDb, run } from "../src/db";
import { startServer } from "../src/index";
import { FOCUS } from "../src/techniques";
import * as timer from "../src/timer";
import { tempDbPath } from "./helpers";

const NOW = 1_000_000_000_000;
const MIN = 60_000;
const oneFocusCycle = [{ type: FOCUS, minutes: 25 }];

describe("follower session isolation (db layer)", () => {
  let db: DB;
  let ownerId: number;
  let friendId: number;

  beforeAll(() => {
    db = openDb(tempDbPath());
    migrate(db);
    run(db, "INSERT INTO users (handle, created_at) VALUES ('owner', ?)", NOW);
    run(db, "INSERT INTO users (handle, created_at) VALUES ('friend', ?)", NOW);
    ownerId = get<{ id: number }>(db, "SELECT id FROM users WHERE handle = 'owner'")!.id;
    friendId = get<{ id: number }>(db, "SELECT id FROM users WHERE handle = 'friend'")!.id;
  });
  afterAll(() => db.close());

  const newSession = () => timer.createSession(db, ownerId, "Pomodoro", oneFocusCycle, NOW);
  const names = (sessionId: string) =>
    timer
      .getFollowers(db, sessionId)
      .map((f) => f.username)
      .sort();

  test("one username can follow two sessions at once; leaving one keeps the other", () => {
    const a = newSession();
    const b = newSession();
    // the same guest display name in two different rooms
    timer.addFollower(db, a, "Sam", null);
    timer.addFollower(db, b, "Sam", null);
    expect(names(a)).toEqual(["Sam"]);
    expect(names(b)).toEqual(["Sam"]);
    timer.removeFollower(db, a, null, "Sam");
    expect(names(a)).toEqual([]);
    expect(names(b)).toEqual(["Sam"]);
    // the same authenticated user in both rooms
    timer.addFollower(db, a, "Alex", friendId);
    timer.addFollower(db, b, "Alex", friendId);
    timer.removeFollower(db, a, friendId, null);
    expect(names(a)).toEqual([]);
    expect(names(b)).toEqual(["Alex", "Sam"]);
  });

  test("a taken name conflicts only inside its own session", () => {
    const a = newSession();
    const b = newSession();
    timer.addFollower(db, a, "Sam", null);
    // same session, different identity: taken
    expect(() => timer.addFollower(db, a, "Sam", friendId)).toThrow("already in this session");
    // the same name is free in another session
    timer.addFollower(db, b, "Sam", friendId);
    // now it is taken in b, by that session's own follower
    expect(() => timer.addFollower(db, b, "Sam", ownerId)).toThrow("already in this session");
    // rejoining your own name is not a conflict
    timer.addFollower(db, b, "Sam", friendId);
    expect(names(a)).toEqual(["Sam"]);
    expect(names(b)).toEqual(["Sam"]);
  });

  test("removeFollower without a user id deletes only the given session's row", () => {
    const a = newSession();
    const b = newSession();
    const c = newSession();
    // the same ambiguous guest name in three rooms
    timer.addFollower(db, a, "Sam", null);
    timer.addFollower(db, b, "Sam", null);
    timer.addFollower(db, c, "Sam", null);
    timer.removeFollower(db, b, null, "Sam");
    expect(names(a)).toEqual(["Sam"]);
    expect(names(b)).toEqual([]);
    expect(names(c)).toEqual(["Sam"]);
  });
});

describe("focus stats attribution (db layer)", () => {
  let db: DB;
  let ownerId: number;
  let friendId: number;

  beforeAll(() => {
    db = openDb(tempDbPath());
    migrate(db);
    run(db, "INSERT INTO users (handle, created_at) VALUES ('owner', ?)", NOW);
    run(db, "INSERT INTO users (handle, created_at) VALUES ('friend', ?)", NOW);
    ownerId = get<{ id: number }>(db, "SELECT id FROM users WHERE handle = 'owner'")!.id;
    friendId = get<{ id: number }>(db, "SELECT id FROM users WHERE handle = 'friend'")!.id;
  });
  afterAll(() => db.close());

  test("a session counts once for its owner and once for each joiner, with its focus time", () => {
    const owned = timer.createSession(db, ownerId, "Pomodoro", oneFocusCycle, NOW);
    const joined = timer.createSession(db, friendId, "Pomodoro", oneFocusCycle, NOW);
    // the owner joins both rooms: their own session must not count twice
    const join = (sessionId: string, name: string, userId: number) => {
      timer.addFollower(db, sessionId, name, userId);
      timer.addMembership(db, sessionId, userId);
    };
    join(owned, "Owner", ownerId);
    join(joined, "Owner", ownerId);
    timer.stop(db, joined, NOW + 10 * MIN); // 10 focus minutes banked in the joined session

    expect(timer.userStats(db, ownerId)).toEqual({ sessions: 2, focusMs: 10 * MIN, avgSessionMs: 5 * MIN });
    expect(timer.userStats(db, friendId)).toEqual({ sessions: 1, focusMs: 10 * MIN, avgSessionMs: 10 * MIN });
  });
});

describe("joined attribution outlives presence (db layer)", () => {
  let db: DB;
  let ownerId: number;
  let friendId: number;

  beforeAll(() => {
    db = openDb(tempDbPath());
    migrate(db);
    run(db, "INSERT INTO users (handle, created_at) VALUES ('owner', ?)", NOW);
    run(db, "INSERT INTO users (handle, created_at) VALUES ('friend', ?)", NOW);
    ownerId = get<{ id: number }>(db, "SELECT id FROM users WHERE handle = 'owner'")!.id;
    friendId = get<{ id: number }>(db, "SELECT id FROM users WHERE handle = 'friend'")!.id;
  });
  afterAll(() => db.close());

  test("closing the tab keeps the joined session's stats and leaves no ghost participant", () => {
    const joined = timer.createSession(db, friendId, "Pomodoro", oneFocusCycle, NOW);
    timer.addFollower(db, joined, "Owner", ownerId);
    timer.addMembership(db, joined, ownerId);
    timer.stop(db, joined, NOW + MIN);

    // the joiner's socket closes: the presence row goes, the membership stays
    timer.removeFollower(db, joined, ownerId, "Owner");
    expect(timer.getFollowers(db, joined)).toEqual([]);
    expect(timer.userStats(db, ownerId)).toEqual({ sessions: 1, focusMs: MIN, avgSessionMs: MIN });
  });
});

describe("websocket room isolation", () => {
  let base: string;
  let wsBase: string;
  let app: ReturnType<typeof startServer>;

  beforeAll(() => {
    app = startServer({ port: 0, databasePath: tempDbPath(), sessionSecret: "test-secret" });
    base = `http://127.0.0.1:${app.server.port}`;
    wsBase = `ws://127.0.0.1:${app.server.port}`;
  });
  afterAll(() => app.stop());

  async function newSession() {
    const res = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ technique: "Pomodoro", cycles: oneFocusCycle }),
    });
    const body = (await res.json()) as { id: string };
    // a cookieless create mints a fresh anonymous identity and returns its cookie
    return { id: body.id, cookie: res.headers.getSetCookie()[0].split(";")[0] };
  }

  type Client = ReturnType<typeof connect>;

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
      /**
       * The server sends a room's broadcast inside the message handler that
       * caused it, so by the time an awaited message above resolved, any
       * wrongly addressed send would already sit in this queue. A short
       * quiet window therefore proves the socket is in no other room.
       */
      async silent(ms = 150): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms));
        if (queue.length > 0) throw new Error(`expected no message, got: ${JSON.stringify(queue)}`);
      },
    };
  }

  const usernames = (msg: Record<string, any>) => (msg.followers ?? []).map((f: any) => f.username);

  async function openFollowers(client: Client): Promise<string[]> {
    expect((await client.nextMessage()).type).toBe("timer_update");
    const msg = await client.nextMessage();
    expect(msg.type).toBe("followers_update");
    return usernames(msg);
  }

  async function nextFollowers(client: Client): Promise<string[]> {
    const msg = await client.nextMessage();
    expect(msg.type).toBe("followers_update");
    return usernames(msg);
  }

  const join = (client: Client, name: string) =>
    client.ws.send(JSON.stringify({ action: "join_session", guest_name: name }));

  test("sockets only receive the followers updates of their own session", async () => {
    const a = await newSession();
    const b = await newSession();
    const a1 = connect(`/ws/session/${a.id}`);
    const a2 = connect(`/ws/session/${a.id}`); // a second member of room a
    const b1 = connect(`/ws/session/${b.id}`); // a member of room b only
    await a1.opened();
    await a2.opened();
    await b1.opened();
    expect(await openFollowers(a1)).toEqual([]);
    expect(await openFollowers(a2)).toEqual([]);
    expect(await openFollowers(b1)).toEqual([]);

    // a guest joins room a: both room a sockets are told, room b hears nothing
    join(a1, "Ana");
    expect(await nextFollowers(a1)).toEqual(["Ana"]);
    expect(await nextFollowers(a2)).toEqual(["Ana"]);
    await b1.silent();

    // the same name is free in room b, and b's list shows only b's own followers
    join(b1, "Ben");
    expect(await nextFollowers(b1)).toEqual(["Ben"]);
    await a1.silent();
    await a2.silent();

    // leaving room a tells room a only; a2's update proves the server finished the close
    a1.ws.close();
    expect(await nextFollowers(a2)).toEqual([]);
    await b1.silent();

    // a fresh socket in b still sees b's follower: a's join and leave never touched it
    const b2 = connect(`/ws/session/${b.id}`);
    await b2.opened();
    expect(await openFollowers(b2)).toEqual(["Ben"]);

    // b leaves: b2 confirms the server finished that close too
    b1.ws.close();
    expect(await nextFollowers(b2)).toEqual([]);
    await a2.silent();

    // the remaining sockets never joined, so their close handlers touch no database
    b2.ws.close();
    a2.ws.close();
  });

  test("a cookie identity follows two sessions; leaving one keeps the other", async () => {
    const x = await newSession(); // mints an identity that owns session x
    const y = await newSession(); // mints a second identity that owns session y
    const inX = connect(`/ws/session/${x.id}`, { Cookie: x.cookie });
    const x2 = connect(`/ws/session/${x.id}`); // an anonymous observer in room x
    const inY = connect(`/ws/session/${y.id}`, { Cookie: x.cookie }); // the same user follows y too
    const y2 = connect(`/ws/session/${y.id}`); // an anonymous observer in room y
    await inX.opened();
    await x2.opened();
    await inY.opened();
    await y2.opened();
    expect(await openFollowers(inX)).toEqual([]);
    expect(await openFollowers(x2)).toEqual([]);
    expect(await openFollowers(inY)).toEqual([]);
    expect(await openFollowers(y2)).toEqual([]);

    // the same user joins both rooms under the same name
    join(inX, "Pat");
    expect(await nextFollowers(inX)).toEqual(["Pat"]);
    expect(await nextFollowers(x2)).toEqual(["Pat"]);
    await inY.silent();
    await y2.silent();
    join(inY, "Pat");
    expect(await nextFollowers(inY)).toEqual(["Pat"]);
    expect(await nextFollowers(y2)).toEqual(["Pat"]);
    await inX.silent();
    await x2.silent();

    // leaving x removes only x's row, scoped by the session and the user id;
    // x2's update proves the server finished the close
    inX.ws.close();
    expect(await nextFollowers(x2)).toEqual([]);
    await inY.silent();
    await y2.silent();

    // fresh sockets confirm the database state of both rooms
    const recheckX = connect(`/ws/session/${x.id}`);
    await recheckX.opened();
    expect(await openFollowers(recheckX)).toEqual([]); // x's pat is gone
    const recheckY = connect(`/ws/session/${y.id}`);
    await recheckY.opened();
    expect(await openFollowers(recheckY)).toEqual(["Pat"]); // y's pat survived

    // the final joined departure, confirmed by the room it leaves
    inY.ws.close();
    expect(await nextFollowers(recheckY)).toEqual([]);
    await x2.silent();

    // the rest never joined, so their close handlers touch no database
    recheckX.ws.close();
    recheckY.ws.close();
    x2.ws.close();
    y2.ws.close();
  });
});
