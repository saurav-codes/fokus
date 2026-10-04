import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DB = Database;

export function openDb(file: string): DB {
  mkdirSync(join(file, ".."), { recursive: true });
  const db = new Database(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

const MIGRATIONS_DIR = join(import.meta.dir, "../migrations");

export function migrate(db: DB): void {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const names = existsSync(MIGRATIONS_DIR) ? [...new Bun.Glob("*.sql").scanSync({ cwd: MIGRATIONS_DIR })].sort() : [];
  const applied = new Set((db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name));
  db.transaction(() => {
    for (const name of names) {
      if (applied.has(name)) continue;
      db.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(name, Date.now());
    }
  })();
}

export function all<T>(db: DB, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(db: DB, sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(db: DB, sql: string, ...params: unknown[]): void {
  db.prepare(sql).run(...params);
}
