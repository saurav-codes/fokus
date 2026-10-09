# fokus operations

## Production

- URL: `https://fokus.lazyplanner.app`
- Platform: [ox](https://deploywithox.com) (systemd and Caddy on a VPS), no Docker
- Repository: `saurav-codes/fokus`, branch `main`

Ox deploys the repository's `ox.toml`. The process is one Bun process:
`bun src/index.ts` serving API, WebSockets, and the SPA from `web/dist`.
SQLite lives in `./data/db.sqlite3` on the ox storage area. Schema
migrations and the sweeper run in that one process at boot.

## Configuration

Required:

```env
SESSION_SECRET=<long random string>
```

Ox sets `PORT` and the app reads it; local `.env` carries `PORT`,
`DATABASE_PATH`, `SESSION_SECRET`.

## Local verification

```bash
cp .env.sample .env
bun install
bun test
bun run lint
bun run build:web
bun src/index.ts            # http://127.0.0.1:8010/healthz
```

## Deployment

Push a tested commit to `main`. Ox auto-deploys from GitHub: it runs
`bun install --frozen-lockfile`, builds the SPA with
`bun run --cwd web build` (`bun --cwd web run build` prints help and builds
nothing), and starts `bun src/index.ts`. A successful release is one process
where `GET /healthz` returns `{"ok":true}` and a WebSocket upgrade to
`/ws/session/<uuid>` connects.

## SQLite backup and restore

ox's S3 backup target is not configured for this project. Until it is,
make an application-consistent copy with the standard library:

```bash
python3 - <<'PY'
import sqlite3

source = sqlite3.connect("/data/db.sqlite3")
backup = sqlite3.connect("/data/db.sqlite3.backup")
with backup:
    source.backup(backup)
assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
source.close()
backup.close()
PY
```

## 2026-10 rewrite: Django to Bun, passwordless

From Django + Channels + Redis + Daphne + scheduler + nginx + Docker
compose to one Bun process. Auth is passwordless: an anonymous cookie
identity (`fokus_session`) is minted when a visitor creates a session
(making them its owner) or opens a room link. Joining a room writes a
durable `memberships` row, so the session counts toward the joiner's
stats even after they leave; the participant list (`followers`) stays
live presence. The web SPA is Vue 3 in `web/`, built at deploy
time, served from the same process. Design language is taken from the ox
landing page (https://deploywithox.com).

### Migrating the legacy Django database

The legacy production database uses Django tables. Import it with:

```bash
DATABASE_PATH=/data/db.sqlite3 SESSION_SECRET=<prod secret> \
  bun scripts/import-legacy-django-db.ts /path/to/legacy.sqlite3
```

The importer is idempotent, maps users (their old username becomes the
`handle`), sessions, cycles (with best-effort elapsed from legacy focus
periods), and followers. There is no password migration: identities are
now anonymous cookies, so nobody needs to recover access.

### Historical: 2026-07-31 VPS migration

Pre-rewrite VPS archive for reference: `focus_timer_20260731T045136Z.sqlite3`,
SHA-256 `242e52d277a3afa6e4b1c07c0bcacfa12e20be2213a2e9b51b758d42ca9d7826`,
integrity `ok`, rows: 1 user, 4 sessions, 12 cycles, 12 periods, 0 followers.
