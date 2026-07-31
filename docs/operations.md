# Focus Timer Operations

## Production

- URL: `https://focus.lazyplanner.app`
- Platform: self-hosted OpenShip
- DigitalOcean droplet: `ubuntu-c-4-sfo3` (`209.38.69.226`)
- OpenShip project: `proj_fnIvW87_-LiNqvv5`
- Repository: `saurav-codes/focus-timer-v`, branch `main`

OpenShip deploys the repository's `docker-compose.yml`. The stack contains:

- `redis`: Channels fanout and the timer scheduler queue
- `migrate`: one-shot Django migrations and static collection
- `web`: Daphne ASGI server
- `scheduler`: the `redis_scheduler` management command
- `nginx`: static files and HTTP/WebSocket proxying

The SQLite database, logs, Redis state, and collected static files live in
named Docker volumes. Production SQLite data is mounted at
`/data/db.sqlite3`; it is not stored in the image or Git checkout.

## Configuration

Copy `.env.sample` for local use. Production variables are managed in
OpenShip and must not be committed.

Required variables:

```env
SECRET_KEY=<django-secret>
DEBUG=False
ALLOWED_HOSTS=focus.lazyplanner.app
CSRF_TRUSTED_ORIGINS=https://focus.lazyplanner.app
```

Compose sets these container-only values:

```env
DATABASE_PATH=/data/db.sqlite3
LOG_DIR=/data/logs
REDIS_URL=redis://redis:6379/0
```

## Local Verification

```bash
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
uv run ruff check .
uv run pytest
```

The nginx health check exercises Django through the same forwarded-host and
forwarded-protocol headers used by OpenShip.

## Deployment

Push a tested commit to `main`. OpenShip auto-deploys the Compose project from
GitHub. A successful release has:

- `redis`, `web`, `scheduler`, and `nginx` running;
- `migrate` exited with status 0;
- `web`, `redis`, and `nginx` healthy;
- exactly one scheduler container.

Check both HTTP and WebSocket behavior after every production deployment.

## SQLite Backup And Restore

OpenShip-managed S3 backups are intentionally not configured yet. Until an S3
backup resource is attached, create an application-consistent SQLite copy
with Python's standard library:

```bash
python - <<'PY'
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

Stop `web` and `scheduler` before replacing `/data/db.sqlite3`. Verify the
backup checksum and `PRAGMA integrity_check`, copy it into the `app_data`
volume, then start `migrate`, `web`, `scheduler`, and `nginx`.

## 2026-07-31 VPS Migration

The final VPS database was copied after stopping the legacy web and scheduler:

- archive: `focus_timer_20260731T045136Z.sqlite3`
- SHA-256:
  `242e52d277a3afa6e4b1c07c0bcacfa12e20be2213a2e9b51b758d42ca9d7826`
- integrity check: `ok`
- OpenShip deployment: `dep_lQ-bLL3Jk2H3SdeE`

Source row counts:

| Relation | Rows |
| --- | ---: |
| Users | 1 |
| Focus sessions | 4 |
| Focus cycles | 12 |
| Focus periods | 12 |
| Session followers | 0 |

The destination counts matched every source count. The Compose migration
service exited successfully; Redis, web, and nginx were healthy; and the
scheduler had exactly one running instance. Both direct-origin and Cloudflare
HTTPS returned 200, and the landing and login pages rendered successfully in
Brave.

The legacy systemd, host nginx, host Redis, and SQLite deployment was removed
only after these OpenShip counts and production acceptance checks matched.
The audited `lazyplanner-do` droplet (`574573666`, `168.144.84.148`) was
deleted on 2026-07-31. Temporary migration archives were then removed from the
OpenShip host; verified local copies are retained until the planned S3 backup
resource is available.
