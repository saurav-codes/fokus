import { all, type DB, get, run } from "./db";
import { BREAK, type CycleInput, FOCUS } from "./techniques";

export type SessionState = "running" | "paused" | "completed";

export type SessionRow = {
  id: string;
  owner_id: number;
  technique: string;
  state: SessionState;
  current_cycle_order: number;
  cycle_clock_started_at: number | null;
  created_at: number;
  completed_at: number | null;
};

export type CycleRow = {
  session_id: string;
  cycle_order: number;
  type: typeof FOCUS | typeof BREAK;
  duration_ms: number;
  elapsed_ms: number;
  completed: 0 | 1;
};

export const LIMITS = {
  minCycleMinutes: 1,
  maxCycleMinutes: 600,
  maxCycles: 250,
  maxTotalMinutes: 17 * 60 + 59,
};

export class InvalidInput extends Error {
  constructor(
    readonly message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

export function getSession(db: DB, id: string): SessionRow | undefined {
  return get<SessionRow>(db, "SELECT * FROM sessions WHERE id = ?", id);
}

export function getCycles(db: DB, sessionId: string): CycleRow[] {
  return all<CycleRow>(db, "SELECT * FROM cycles WHERE session_id = ? ORDER BY cycle_order", sessionId);
}

export function getCycle(db: DB, sessionId: string, order: number): CycleRow | undefined {
  return get<CycleRow>(db, "SELECT * FROM cycles WHERE session_id = ? AND cycle_order = ?", sessionId, order);
}

/**
 * remaining_ms = duration_ms - elapsed_ms - (running ? now - cycle_clock_started_at : 0)
 * The timer never ticks: everything is derived from these stored values.
 */
export function remainingMs(session: SessionRow, cycle: CycleRow, now: number = Date.now()): number {
  const live =
    session.state === "running" && session.cycle_clock_started_at !== null
      ? Math.max(now - session.cycle_clock_started_at, 0)
      : 0;
  return Math.max(cycle.duration_ms - cycle.elapsed_ms - live, 0);
}

export function createSession(
  db: DB,
  ownerId: number,
  technique: string,
  cycles: CycleInput[],
  now: number = Date.now(),
): string {
  if (cycles.length < 1 || cycles.length > LIMITS.maxCycles) {
    throw new InvalidInput(`a session needs 1 to ${LIMITS.maxCycles} cycles`);
  }
  let totalMinutes = 0;
  for (const cycle of cycles) {
    if (cycle.type !== FOCUS && cycle.type !== BREAK) {
      throw new InvalidInput("cycle type must be FOCUS or BREAK");
    }
    const minutes = Math.trunc(cycle.minutes);
    if (!(minutes >= LIMITS.minCycleMinutes && minutes <= LIMITS.maxCycleMinutes)) {
      throw new InvalidInput(`cycle minutes must be ${LIMITS.minCycleMinutes} to ${LIMITS.maxCycleMinutes}`);
    }
    totalMinutes += minutes;
  }
  if (totalMinutes > LIMITS.maxTotalMinutes) {
    throw new InvalidInput(`total session time must be at most ${LIMITS.maxTotalMinutes} minutes`);
  }
  const id = crypto.randomUUID();
  run(
    db,
    "INSERT INTO sessions (id, owner_id, technique, state, current_cycle_order, cycle_clock_started_at, created_at) VALUES (?, ?, ?, 'running', 1, ?, ?)",
    id,
    ownerId,
    technique,
    now,
    now,
  );
  for (const [index, cycle] of cycles.entries()) {
    run(
      db,
      "INSERT INTO cycles (session_id, cycle_order, type, duration_ms, elapsed_ms, completed) VALUES (?, ?, ?, ?, 0, 0)",
      id,
      index + 1,
      cycle.type,
      Math.trunc(cycle.minutes) * 60_000,
    );
  }
  return id;
}

/**
 * Lazily advance a running session past every cycle whose time is up.
 * Overshoot past a boundary is inherited by the next cycle, so one call
 * catches up across any number of missed boundaries.
 * Returns true when anything changed (the caller should broadcast).
 */
export function advance(db: DB, sessionId: string, now: number = Date.now()): boolean {
  let session = getSession(db, sessionId);
  if (session?.state !== "running") return false;
  let changed = false;
  for (;;) {
    const cycle = getCycle(db, session.id, session.current_cycle_order);
    if (!cycle) return changed;
    const consumed =
      cycle.elapsed_ms +
      (session.cycle_clock_started_at !== null ? Math.max(now - session.cycle_clock_started_at, 0) : 0);
    if (consumed < cycle.duration_ms) return changed;
    const overshootMs = consumed - cycle.duration_ms;
    run(
      db,
      "UPDATE cycles SET completed = 1, elapsed_ms = ? WHERE session_id = ? AND cycle_order = ?",
      cycle.duration_ms,
      session.id,
      cycle.cycle_order,
    );
    const next = getCycle(db, session.id, cycle.cycle_order + 1);
    if (!next) {
      run(
        db,
        "UPDATE sessions SET state = 'completed', completed_at = ?, cycle_clock_started_at = NULL WHERE id = ?",
        now,
        session.id,
      );
      return true;
    }
    // the next cycle started when the previous one ended, `overshootMs` ago
    const clockStartedAt = now - overshootMs;
    run(
      db,
      "UPDATE sessions SET current_cycle_order = ?, cycle_clock_started_at = ? WHERE id = ?",
      next.cycle_order,
      clockStartedAt,
      session.id,
    );
    session = { ...session, current_cycle_order: next.cycle_order, cycle_clock_started_at: clockStartedAt };
    changed = true;
  }
}

export function pause(db: DB, sessionId: string, now: number = Date.now()): SessionState {
  const session = getSession(db, sessionId);
  if (!session) throw new InvalidInput("session not found", 404);
  if (session.state !== "running") return session.state;
  const cycle = getCycle(db, session.id, session.current_cycle_order);
  if (cycle && session.cycle_clock_started_at !== null) {
    run(
      db,
      "UPDATE cycles SET elapsed_ms = elapsed_ms + ? WHERE session_id = ? AND cycle_order = ?",
      Math.max(now - session.cycle_clock_started_at, 0),
      session.id,
      cycle.cycle_order,
    );
  }
  run(db, "UPDATE sessions SET state = 'paused', cycle_clock_started_at = NULL WHERE id = ?", session.id);
  return "paused";
}

export function resume(db: DB, sessionId: string, now: number = Date.now()): SessionState {
  const session = getSession(db, sessionId);
  if (!session) throw new InvalidInput("session not found", 404);
  if (session.state !== "paused") return session.state;
  run(db, "UPDATE sessions SET state = 'running', cycle_clock_started_at = ? WHERE id = ?", now, session.id);
  return "running";
}

export function toggle(db: DB, sessionId: string, now: number = Date.now()): SessionState {
  const session = getSession(db, sessionId);
  if (!session) throw new InvalidInput("session not found", 404);
  return session.state === "running" ? pause(db, sessionId, now) : resume(db, sessionId, now);
}

export function stop(db: DB, sessionId: string, now: number = Date.now()): SessionState {
  const session = getSession(db, sessionId);
  if (!session) throw new InvalidInput("session not found", 404);
  if (session.state !== "completed") {
    if (session.state === "running") pause(db, sessionId, now);
    run(
      db,
      "UPDATE sessions SET state = 'completed', completed_at = ?, cycle_clock_started_at = NULL WHERE id = ?",
      now,
      session.id,
    );
  }
  return "completed";
}

/**
 * The owner skips the current cycle early: it is marked completed with the
 * partial elapsed time banked, and the next cycle becomes current.
 */
export function nextCycle(db: DB, sessionId: string, now: number = Date.now()): boolean {
  const session = getSession(db, sessionId);
  if (!session || session.state === "completed") return false;
  const cycle = getCycle(db, session.id, session.current_cycle_order);
  if (!cycle) return false;
  const live =
    session.state === "running" && session.cycle_clock_started_at !== null
      ? Math.max(now - session.cycle_clock_started_at, 0)
      : 0;
  run(
    db,
    "UPDATE cycles SET elapsed_ms = elapsed_ms + ?, completed = 1 WHERE session_id = ? AND cycle_order = ?",
    live,
    session.id,
    cycle.cycle_order,
  );
  const next = getCycle(db, session.id, cycle.cycle_order + 1);
  if (!next) {
    run(
      db,
      "UPDATE sessions SET state = 'completed', completed_at = ?, cycle_clock_started_at = NULL WHERE id = ?",
      now,
      session.id,
    );
    return true;
  }
  const clock = session.state === "running" ? now : null;
  run(
    db,
    "UPDATE sessions SET current_cycle_order = ?, cycle_clock_started_at = ? WHERE id = ?",
    next.cycle_order,
    clock,
    session.id,
  );
  return true;
}

export type Follower = { username: string; joinedAtMs: number };

export function getFollowers(db: DB, sessionId: string): Follower[] {
  return all<{ username: string; joined_at: number }>(
    db,
    "SELECT username, joined_at FROM followers WHERE session_id = ? ORDER BY joined_at, username",
    sessionId,
  ).map((row) => ({ username: row.username, joinedAtMs: row.joined_at }));
}

export function addFollower(db: DB, sessionId: string, username: string, userId: number | null): void {
  const existing = get<{ user_id: number | null }>(
    db,
    "SELECT user_id FROM followers WHERE session_id = ? AND username = ?",
    sessionId,
    username,
  );
  if (existing && existing.user_id !== userId) {
    throw new InvalidInput("that name is already in this session");
  }
  run(
    db,
    `INSERT INTO followers (session_id, username, user_id, joined_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id, username) DO UPDATE SET user_id = excluded.user_id`,
    sessionId,
    username,
    userId,
    Date.now(),
  );
}

export function removeFollower(db: DB, sessionId: string, userId: number | null, username: string | null): void {
  if (userId !== null) {
    run(db, "DELETE FROM followers WHERE session_id = ? AND user_id = ?", sessionId, userId);
  } else if (username) {
    run(db, "DELETE FROM followers WHERE session_id = ? AND username = ?", sessionId, username);
  }
}

export type SessionStateView = {
  id: string;
  technique: string;
  state: SessionState;
  serverNowMs: number;
  currentCycle: {
    order: number;
    type: string;
    durationMs: number;
    remainingMs: number;
    endsAtMs: number | null;
  } | null;
  cycles: { order: number; type: string; durationMs: number; completed: boolean }[];
  willFinishAtMs: number | null;
};

export function sessionState(db: DB, sessionId: string, now: number = Date.now()): SessionStateView | null {
  advance(db, sessionId, now);
  const session = getSession(db, sessionId);
  if (!session) return null;
  const cycles = getCycles(db, sessionId);
  const current = cycles.find((c) => c.cycle_order === session.current_cycle_order) ?? null;
  const remaining = current ? remainingMs(session, current, now) : 0;
  const laterMs = current
    ? cycles.filter((c) => c.cycle_order > current.cycle_order).reduce((a, c) => a + c.duration_ms, 0)
    : 0;
  return {
    id: session.id,
    technique: session.technique,
    state: session.state,
    serverNowMs: now,
    currentCycle: current
      ? {
          order: current.cycle_order,
          type: current.type,
          durationMs: current.duration_ms,
          remainingMs: remaining,
          endsAtMs: session.state === "running" ? now + remaining : null,
        }
      : null,
    cycles: cycles.map((c) => ({
      order: c.cycle_order,
      type: c.type,
      durationMs: c.duration_ms,
      completed: c.completed === 1,
    })),
    willFinishAtMs: session.state === "completed" ? null : now + remaining + laterMs,
  };
}

export function userStats(db: DB, userId: number): { sessions: number; focusMs: number; avgSessionMs: number } {
  const sessions = get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM sessions WHERE owner_id = ?", userId)?.n ?? 0;
  const focusMs =
    get<{ t: number }>(
      db,
      `SELECT COALESCE(SUM(c.elapsed_ms), 0) AS t FROM cycles c
       JOIN sessions s ON s.id = c.session_id WHERE s.owner_id = ? AND c.type = 'FOCUS'`,
      userId,
    )?.t ?? 0;
  return { sessions, focusMs, avgSessionMs: sessions > 0 ? Math.round(focusMs / sessions) : 0 };
}
