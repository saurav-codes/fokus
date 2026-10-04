// One-shot importer for the legacy Django SQLite database (old table names:
// realtime_timer_user, realtime_timer_focussession, realtime_timer_focuscycle,
// realtime_timer_focusperiod, realtime_timer_sessionfollower).
//
// usage: DATABASE_PATH=/data/db.sqlite3 bun scripts/import-legacy-django-db.ts <legacy.sqlite3>
//
// Passwordless: legacy Django password hashes are not carried. Legacy users
// become anonymous identities whose `handle` is their old username. Old
// sessions still carry their stats; nobody logs in as them.

import { Database } from "bun:sqlite";
import { makeAuth } from "../src/auth";
import { get, migrate, openDb, run } from "../src/db";
import { env } from "../src/env";

const legacyPath = process.argv[2];
if (!legacyPath) {
  console.error("usage: bun scripts/import-legacy-django-db.ts <legacy.sqlite3>");
  process.exit(1);
}

const legacy = new Database(legacyPath, { readonly: true });
const legacyAll = <T>(sql: string, ...params: unknown[]): T[] => legacy.prepare(sql).all(...params) as T[];

const db = openDb(env.databasePath);
migrate(db);
const auth = makeAuth(db, env.sessionSecret);

const dt = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(`${value.replace(" ", "T")}Z`) || 0;
  return 0;
};
const usToMs = (value: unknown): number => Math.trunc(Number(value ?? 0) / 1000);
const legacyState = (value: string): "running" | "paused" | "completed" =>
  value === "running" || value === "paused" ? value : "completed";

const counts = { users: 0, sessions: 0, cycles: 0, followers: 0 };
const userIdMap = new Map<number, number>();
const handles = new Map<number, string>();

console.log("== importing users ==");
for (const u of legacyAll<{ id: number; username: string }>("SELECT id, username FROM realtime_timer_user")) {
  handles.set(u.id, u.username);
  const existing = auth.getUserByHandle(u.username);
  if (existing) {
    userIdMap.set(u.id, existing.id);
    console.log(`user ${u.username}: already exists, linked`);
    continue;
  }
  run(db, "INSERT INTO users (handle, created_at) VALUES (?, ?)", u.username, Date.now());
  const created = auth.getUserByHandle(u.username);
  if (!created) throw new Error(`could not import user ${u.username}`);
  userIdMap.set(u.id, created.id);
  counts.users += 1;
  console.log(`user ${u.username}: imported`);
}

console.log("== importing sessions ==");
for (const s of legacyAll<Record<string, any>>("SELECT * FROM realtime_timer_focussession")) {
  const id = String(s.session_id);
  if (get(db, "SELECT id FROM sessions WHERE id = ?", id)) {
    console.log(`session ${id}: already exists, skipped`);
    continue;
  }
  const ownerId = userIdMap.get(s.owner_id);
  if (!ownerId) {
    console.warn(`session ${id}: owner ${s.owner_id} not imported, skipped`);
    continue;
  }
  const legacyCycles = legacyAll<Record<string, any>>(
    'SELECT * FROM realtime_timer_focuscycle WHERE session_id = ? ORDER BY "order"',
    id,
  );
  if (legacyCycles.length === 0) {
    console.warn(`session ${id}: no cycles, skipped`);
    continue;
  }
  const current = legacyCycles.find((c) => c.id === s.current_cycle_id);
  const currentOrder = Number(current?.order ?? legacyCycles[0].order);
  const state = legacyState(String(s.timer_state));

  // owner periods: user rows for the owner, plus NULL-user rows the legacy code treated as owner rows
  const periods = legacyAll<Record<string, any>>("SELECT * FROM realtime_timer_focusperiod WHERE session_id = ?", id);
  const ownerPeriods = periods.filter((p) => p.user_id === null || p.user_id === s.owner_id);
  const openPeriod = ownerPeriods.find((p) => !p.ended_at);
  const clockStartedAt = state === "running" ? (openPeriod ? dt(openPeriod.started_at) : Date.now()) : null;
  const lastEndedAt = ownerPeriods.reduce((acc, p) => (p.ended_at ? Math.max(acc, dt(p.ended_at)) : acc), 0);

  db.transaction(() => {
    run(
      db,
      `INSERT INTO sessions (id, owner_id, technique, state, current_cycle_order, cycle_clock_started_at, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      ownerId,
      String(s.technique),
      state,
      currentOrder,
      clockStartedAt,
      dt(s.created_at) || Date.now(),
      state === "completed" ? lastEndedAt || Date.now() : null,
    );
    for (const c of legacyCycles) {
      const durationMs = usToMs(c.duration);
      const order = Number(c.order);
      const cyclePeriods = ownerPeriods.filter((p) => p.cycle_id === c.id);
      let bankedMs = cyclePeriods.reduce((acc, p) => acc + (p.ended_at ? usToMs(p.duration) : 0), 0);
      if (state === "running" && order === currentOrder && openPeriod && openPeriod.cycle_id === c.id) {
        bankedMs += Math.max(Date.now() - dt(openPeriod.started_at), 0);
      }
      run(
        db,
        `INSERT INTO cycles (session_id, cycle_order, type, duration_ms, elapsed_ms, completed) VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        order,
        String(c.cycle_type) === "BREAK" ? "BREAK" : "FOCUS",
        durationMs,
        Math.min(bankedMs, durationMs),
        c.is_completed ? 1 : 0,
      );
      counts.cycles += 1;
    }
  })();
  counts.sessions += 1;
  console.log(`session ${id}: ${state}, ${legacyCycles.length} cycles, current cycle ${currentOrder}`);
}

console.log("== importing followers ==");
for (const f of legacyAll<Record<string, any>>("SELECT * FROM realtime_timer_sessionfollower")) {
  const sessionId = String(f.session_id);
  if (!get(db, "SELECT id FROM sessions WHERE id = ?", sessionId)) {
    console.warn(`follower for ${sessionId}: session not imported, skipped`);
    continue;
  }
  const name = String(f.username || handles.get(f.follower_id) || "");
  if (!name) {
    console.warn(`follower for ${sessionId}: no name, skipped`);
    continue;
  }
  run(
    db,
    `INSERT OR IGNORE INTO followers (session_id, username, user_id, joined_at) VALUES (?, ?, ?, ?)`,
    sessionId,
    name,
    f.follower_id ? (userIdMap.get(f.follower_id) ?? null) : null,
    dt(f.joined_at) || Date.now(),
  );
  counts.followers += 1;
}

console.log("== done ==");
console.log(
  `imported: ${counts.users} users, ${counts.sessions} sessions, ${counts.cycles} cycles, ${counts.followers} followers`,
);
