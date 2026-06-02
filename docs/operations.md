# Focus Timer Operations

## Infrastructure

- Public URL: `https://focus.lazyplanner.app`
- Droplet: `lazyplanner-do`
- IP: `168.144.84.148`
- App user: `focususer`
- App path: `/home/focususer/focus-timer-v`
- App service: `focus-timer-v-web.service`
- Scheduler service: `focus-timer-v-redis-scheduler.service`
- App port: `127.0.0.1:8010`
- Web server: `nginx`
- TLS: Let's Encrypt via `certbot`
- Redis: `redis-server` on `127.0.0.1:6379`
- Database: SQLite at `/home/focususer/focus-timer-v/db.sqlite3`

## SSH

Direct local SSH may be blocked by the VPS firewall/fail2ban state. The known working path is through the landing-auditor droplet:

```bash
ssh -J root@147.182.201.157 focususer@168.144.84.148
```

## Logs

App log file:

```bash
tail -f /home/focususer/focus-timer-v/logs/focus-timer.log
```

Systemd service logs:

```bash
journalctl -u focus-timer-v-web.service -n 100 --no-pager
journalctl -u focus-timer-v-web.service -f
```

Nginx logs:

```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

Redis status:

```bash
systemctl status redis-server --no-pager
redis-cli ping
redis-cli zrange scheduled_cycle_changes 0 -1 withscores
```

Scheduler logs:

```bash
journalctl -u focus-timer-v-redis-scheduler.service -n 100 --no-pager
journalctl -u focus-timer-v-redis-scheduler.service -f
```

## Health Checks

```bash
systemctl is-active focus-timer-v-web.service
systemctl is-active focus-timer-v-redis-scheduler.service
redis-cli ping
redis-cli zcard scheduled_cycle_changes
curl -I -H "Host: focus.lazyplanner.app" http://127.0.0.1:8010/
curl -k -I -H "Host: focus.lazyplanner.app" https://127.0.0.1/accounts/login/
curl -I https://focus.lazyplanner.app/accounts/login/
```

Expected public login response: `HTTP/2 200`.
Expected root response: public landing page `HTTP/2 200`.
The root landing page intentionally has no shared app header; login/signup CTAs live in the hero.

## Nginx

Config:

```bash
sudo sed -n '1,220p' /etc/nginx/sites-available/focus-lazyplanner
sudo nginx -t
sudo systemctl reload nginx
```

The app is served by the `focus-lazyplanner` nginx site and proxied to `127.0.0.1:8010`.

## Redis Scheduler

This is the old backend cycle-change worker restored from git history. It is not Celery.

- Command: `uv run python manage.py redis_scheduler`
- Redis key: `scheduled_cycle_changes`
- Redis type: sorted set
- Member: focus session UUID
- Score: Unix timestamp for the next cycle change

The WebSocket consumer schedules the current cycle in Redis when a session connects or resumes. The scheduler loops over due sorted-set entries and calls the timer service to change cycles.

Systemd unit:

```ini
[Unit]
Description=Focus Timer Redis scheduler
After=network.target redis-server.service focus-timer-v-web.service
Wants=redis-server.service

[Service]
Type=simple
User=focususer
Group=www-data
WorkingDirectory=/home/focususer/focus-timer-v
EnvironmentFile=/home/focususer/focus-timer-v/.env
ExecStart=/home/focususer/.local/bin/uv run python manage.py redis_scheduler
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## Deploy

Push local changes first:

```bash
git push origin main
```

On VPS:

```bash
cd /home/focususer/focus-timer-v
git status
git pull origin main
uv sync --frozen
uv run python manage.py check
uv run python manage.py migrate --noinput
uv run python manage.py collectstatic --noinput
sudo systemctl restart focus-timer-v-web.service
sudo systemctl restart focus-timer-v-redis-scheduler.service
sudo nginx -t
sudo systemctl reload nginx
```

## Rollback

Checkout the previous commit and restart:

```bash
git checkout <previous-commit>
uv sync --frozen
uv run python manage.py collectstatic --noinput
sudo systemctl restart focus-timer-v-web.service
sudo systemctl restart focus-timer-v-redis-scheduler.service
```
