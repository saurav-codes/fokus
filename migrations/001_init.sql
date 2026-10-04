CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  technique TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'running',
  current_cycle_order INTEGER NOT NULL DEFAULT 1,
  cycle_clock_started_at INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE cycles (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  cycle_order INTEGER NOT NULL,
  type TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, cycle_order)
);

CREATE TABLE followers (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, username)
);
