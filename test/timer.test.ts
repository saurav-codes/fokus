import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DB, get, migrate, openDb, run } from "../src/db";
import { BREAK, FOCUS } from "../src/techniques";
import * as timer from "../src/timer";
import { tempDbPath } from "./helpers";

const MIN = 60_000;
const NOW = 1_000_000_000_000;

let db: DB;
let ownerId: number;
let friendId: number;
const dbPath = tempDbPath();
beforeAll(() => {
  db = openDb(dbPath);
  migrate(db);
  run(db, "INSERT INTO users (handle, created_at) VALUES ('tester', ?)", NOW);
  run(db, "INSERT INTO users (handle, created_at) VALUES ('friend', ?)", NOW);
  ownerId = get<{ id: number }>(db, "SELECT id FROM users WHERE handle = 'tester'")?.id;
  friendId = get<{ id: number }>(db, "SELECT id FROM users WHERE handle = 'friend'")?.id;
});
afterAll(() => db.close());

const cycles = (...minutes: number[]) => minutes.map((minutes, i) => ({ type: i % 2 === 0 ? FOCUS : BREAK, minutes }));

describe("timer engine", () => {
  test("create starts a running session on cycle 1", () => {
    const id = timer.createSession(db, ownerId, "Custom Technique", cycles(25, 5, 25), NOW);
    const session = timer.getSession(db, id)!;
    expect(session.state).toBe("running");
    expect(session.current_cycle_order).toBe(1);
    expect(session.cycle_clock_started_at).toBe(NOW);
    expect(timer.remainingMs(session, timer.getCycle(db, id, 1)!, NOW)).toBe(25 * MIN);
    expect(timer.sessionState(db, id, NOW)?.cycles).toHaveLength(3);
  });

  test("advance is a no-op until the cycle is over, then moves to the next", () => {
    const id = timer.createSession(db, ownerId, "Custom Technique", cycles(25, 5), NOW);
    expect(timer.advance(db, id, NOW + 24 * MIN)).toBe(false);
    expect(timer.advance(db, id, NOW + 25 * MIN)).toBe(true);
    const first = timer.getCycle(db, id, 1)!;
    expect(first.completed).toBe(1);
    expect(first.elapsed_ms).toBe(25 * MIN);
    const session = timer.getSession(db, id)!;
    expect(session.current_cycle_order).toBe(2);
    expect(timer.remainingMs(session, timer.getCycle(db, id, 2)!, NOW + 25 * MIN)).toBe(5 * MIN);
    expect(timer.advance(db, id, NOW + 25 * MIN + 5 * MIN)).toBe(true);
    const done = timer.getSession(db, id)!;
    expect(done.state).toBe("completed");
    expect(done.completed_at).toBe(NOW + 30 * MIN);
    expect(timer.getCycle(db, id, 2)?.elapsed_ms).toBe(5 * MIN);
  });

  test("pause banks elapsed time, resume restarts the clock", () => {
    const id = timer.createSession(db, ownerId, "Custom Technique", cycles(10), NOW);
    expect(timer.pause(db, id, NOW + 4 * MIN)).toBe("paused");
    const cycle = timer.getCycle(db, id, 1)!;
    expect(cycle.elapsed_ms).toBe(4 * MIN);
    const paused = timer.getSession(db, id)!;
    expect(paused.cycle_clock_started_at).toBe(null);
    // frozen while paused, no matter how much wall time passes
    expect(timer.remainingMs(paused, cycle, NOW + 99 * MIN)).toBe(6 * MIN);
    expect(timer.resume(db, id, NOW + 100 * MIN)).toBe("running");
    const resumed = timer.getSession(db, id)!;
    expect(timer.remainingMs(resumed, cycle, NOW + 102 * MIN)).toBe(4 * MIN);
  });

  test("toggle runs pause and resume", () => {
    const id = timer.createSession(db, ownerId, "Custom Technique", cycles(10), NOW);
    expect(timer.toggle(db, id, NOW + MIN)).toBe("paused");
    expect(timer.toggle(db, id, NOW + 2 * MIN)).toBe("running");
  });

  test("manual next mid-cycle banks the partial and moves on", () => {
    const id = timer.createSession(db, ownerId, "Custom Technique", cycles(25, 5), NOW);
    expect(timer.nextCycle(db, id, NOW + 7 * MIN)).toBe(true);
    const first = timer.getCycle(db, id, 1)!;
    expect(first.completed).toBe(1);
    expect(first.elapsed_ms).toBe(7 * MIN);
    const session = timer.getSession(db, id)!;
    expect(session.current_cycle_order).toBe(2);
    expect(session.state).toBe("running");
    expect(timer.remainingMs(session, timer.getCycle(db, id, 2)!, NOW + 7 * MIN)).toBe(5 * MIN);
  });

  test("stop mid-cycle completes the session with partial focus time", () => {
    const id = timer.createSession(db, ownerId, "Custom Technique", cycles(25), NOW);
    expect(timer.stop(db, id, NOW + 9 * MIN)).toBe("completed");
    const cycle = timer.getCycle(db, id, 1)!;
    expect(cycle.completed).toBe(0);
    expect(cycle.elapsed_ms).toBe(9 * MIN);
    const session = timer.getSession(db, id)!;
    expect(session.state).toBe("completed");
    expect(session.completed_at).toBe(NOW + 9 * MIN);
    const stats = timer.userStats(db, ownerId);
    expect(stats.focusMs).toBeGreaterThanOrEqual(9 * MIN);
  });

  test("mutations on completed sessions are no-ops", () => {
    const id = timer.createSession(db, ownerId, "Custom Technique", cycles(25), NOW);
    timer.stop(db, id, NOW + MIN);
    expect(timer.toggle(db, id, NOW + 2 * MIN)).toBe("completed");
    expect(timer.nextCycle(db, id, NOW + 3 * MIN)).toBe(false);
    expect(timer.advance(db, id, NOW + 999 * MIN)).toBe(false);
  });

  test("createSession rejects invalid input", () => {
    expect(() => timer.createSession(db, ownerId, "Custom Technique", [], NOW)).toThrow();
    expect(() => timer.createSession(db, ownerId, "Custom Technique", [{ type: "NOPE", minutes: 5 }], NOW)).toThrow();
    expect(() => timer.createSession(db, ownerId, "Custom Technique", [{ type: FOCUS, minutes: 601 }], NOW)).toThrow();
    expect(() => timer.createSession(db, ownerId, "Custom Technique", [{ type: FOCUS, minutes: 0 }], NOW)).toThrow();
    expect(() =>
      timer.createSession(
        db,
        ownerId,
        "Custom Technique",
        Array.from({ length: 251 }, () => ({ type: FOCUS, minutes: 1 })),
        NOW,
      ),
    ).toThrow();
    expect(() =>
      timer.createSession(
        db,
        ownerId,
        "Custom Technique",
        [
          { type: FOCUS, minutes: 600 },
          { type: BREAK, minutes: 480 },
        ],
        NOW,
      ),
    ).toThrow();
  });

  test("followers: guest join, rejoin, name collision, authenticated follower, leave", () => {
    const id = timer.createSession(db, ownerId, "Custom Technique", cycles(25), NOW);
    timer.addFollower(db, id, "Sam", null);
    timer.addFollower(db, id, "Sam", null); // same guest rejoining is an upsert
    timer.addFollower(db, id, "Alex", friendId);
    expect(() => timer.addFollower(db, id, "Alex", null)).toThrow("already"); // taken by a cookie identity
    expect(
      timer
        .getFollowers(db, id)
        .map((f) => f.username)
        .sort(),
    ).toEqual(["Alex", "Sam"]);
    timer.removeFollower(db, id, null, "Sam");
    expect(timer.getFollowers(db, id).map((f) => f.username)).toEqual(["Alex"]);
    timer.removeFollower(db, id, friendId, null);
    expect(timer.getFollowers(db, id)).toEqual([]);
  });

  test("sessionState view is derived, not accumulated", () => {
    const id = timer.createSession(db, ownerId, "Camel", cycles(50, 10, 25, 5, 25, 5), NOW);
    const state = timer.sessionState(db, id, NOW + 20 * MIN)!;
    expect(state.serverNowMs).toBe(NOW + 20 * MIN);
    expect(state.currentCycle?.remainingMs).toBe(30 * MIN);
    expect(state.currentCycle?.endsAtMs).toBe(NOW + 50 * MIN);
    expect(state.willFinishAtMs).toBe(NOW + 120 * MIN);
    // far in the future: everything advanced lazily by the read itself
    const late = timer.sessionState(db, id, NOW + 500 * MIN)!;
    expect(late.state).toBe("completed");
    expect(late.currentCycle?.remainingMs).toBe(0);
  });
});
