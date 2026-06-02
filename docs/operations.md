# Focus Timer Operations

## Current Infra

- Public URL: `https://focus.lazyplanner.app`
- DNS: Cloudflare `A` record for `focus.lazyplanner.app` -> `168.144.84.148`
- Droplet: DigitalOcean VPS `lazyplanner-do`
- OS: Ubuntu 24.04 LTS
- Public IP: `168.144.84.148`
- App user: `focususer`
- App path: `/home/focususer/focus-timer-v`
- Git remote on VPS: `git@github.com:saurav-codes/focus-timer-v.git`
- Runtime: `uv`, Python 3.14, Django ASGI, Daphne
- Web service: `focus-timer-v-web.service`
- Scheduler service: `focus-timer-v-redis-scheduler.service`
- App bind address: `127.0.0.1:8010`
- Web server: `nginx`
- TLS: Let's Encrypt via `certbot`
- Redis: `redis-server` on `127.0.0.1:6379`
- Database: SQLite at `/home/focususer/focus-timer-v/db.sqlite3`
- Static files: `/home/focususer/focus-timer-v/production_static_files`
- App log file: `/home/focususer/focus-timer-v/logs/focus-timer.log`

This is not DigitalOcean App Platform. The deployment is a normal VPS deployment: git pull, uv sync, Django migrations/static collection, then systemd restarts.

## SSH

Known working SSH path:

```bash
ssh -J root@147.182.201.157 focususer@168.144.84.148
```

If the direct route works:

```bash
ssh focususer@168.144.84.148
```

## Hosting Flow

```text
Cloudflare DNS
  -> 168.144.84.148:443
  -> nginx /etc/nginx/sites-available/focus-lazyplanner
  -> Daphne on 127.0.0.1:8010
  -> Django ASGI app
  -> SQLite + Redis + Channels
```

Static files are served directly by nginx from `production_static_files`.
WebSockets are proxied by nginx under `/ws/` with upgrade headers and long timeouts.

## Environment

Production env file:

```bash
/home/focususer/focus-timer-v/.env
```

Required keys:

```env
SECRET_KEY=<django-secret>
DEBUG=False
ALLOWED_HOSTS=focus.lazyplanner.app,168.144.84.148,localhost,127.0.0.1
CSRF_TRUSTED_ORIGINS=https://focus.lazyplanner.app
```

Optional keys:

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_URL=redis://127.0.0.1:6379/0
LOG_DIR=/home/focususer/focus-timer-v/logs
LOG_LEVEL=INFO
STATICFILES_STORAGE_BACKEND=django.contrib.staticfiles.storage.StaticFilesStorage
```

Do not commit `.env`, `db.sqlite3`, `logs/`, or `production_static_files/`.

## Logs

App log file:

```bash
tail -n 100 /home/focususer/focus-timer-v/logs/focus-timer.log
tail -f /home/focususer/focus-timer-v/logs/focus-timer.log
```

Web service logs:

```bash
journalctl -u focus-timer-v-web.service -n 100 --no-pager
journalctl -u focus-timer-v-web.service -f
```

Redis scheduler logs:

```bash
journalctl -u focus-timer-v-redis-scheduler.service -n 100 --no-pager
journalctl -u focus-timer-v-redis-scheduler.service -f
```

Nginx logs:

```bash
sudo tail -n 100 /var/log/nginx/access.log
sudo tail -n 100 /var/log/nginx/error.log
sudo tail -f /var/log/nginx/error.log
```

Redis:

```bash
systemctl status redis-server --no-pager
redis-cli ping
redis-cli zcard scheduled_cycle_changes
redis-cli zrange scheduled_cycle_changes 0 -1 withscores
```

TLS:

```bash
sudo certbot certificates
sudo journalctl -u certbot.timer -n 50 --no-pager
```

## Health Checks

Run on the VPS:

```bash
cd /home/focususer/focus-timer-v
git rev-parse --short HEAD
systemctl is-active focus-timer-v-web.service
systemctl is-active focus-timer-v-redis-scheduler.service
systemctl is-active redis-server
systemctl is-active nginx
redis-cli ping
redis-cli zcard scheduled_cycle_changes
curl -I -H "Host: focus.lazyplanner.app" http://127.0.0.1:8010/
curl -I https://focus.lazyplanner.app/
curl -I https://focus.lazyplanner.app/accounts/login/
```

Expected:

- Services: `active`
- Redis: `PONG`
- Public URLs: `HTTP/2 200`

## Systemd

Web service:

```ini
[Unit]
Description=Focus Timer V ASGI web service
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=focususer
Group=www-data
WorkingDirectory=/home/focususer/focus-timer-v
EnvironmentFile=/home/focususer/focus-timer-v/.env
ExecStart=/home/focususer/focus-timer-v/.venv/bin/daphne -b 127.0.0.1 -p 8010 src.asgi:application
Restart=on-failure
RestartSec=5
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Scheduler service:

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
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Useful commands:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now focus-timer-v-web.service
sudo systemctl enable --now focus-timer-v-redis-scheduler.service
sudo systemctl restart focus-timer-v-web.service
sudo systemctl restart focus-timer-v-redis-scheduler.service
```

## Nginx

Site file:

```bash
/etc/nginx/sites-available/focus-lazyplanner
```

Current shape:

```nginx
server {
  listen 443 ssl http2;
  server_name focus.lazyplanner.app;

  ssl_certificate /etc/letsencrypt/live/focus.lazyplanner.app/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/focus.lazyplanner.app/privkey.pem;

  client_max_body_size 10M;

  location /static/ {
    alias /home/focususer/focus-timer-v/production_static_files/;
  }

  location /ws/ {
    proxy_pass http://127.0.0.1:8010;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
  }

  location / {
    proxy_pass http://127.0.0.1:8010;
    include proxy_params;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 80;
  server_name focus.lazyplanner.app;
  return 301 https://$host$request_uri;
}
```

Commands:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo sed -n '1,220p' /etc/nginx/sites-available/focus-lazyplanner
```

## Redis Scheduler

The timer backend uses the old Redis zset scheduler. It is not Celery.

- Command: `uv run python manage.py redis_scheduler`
- Redis key: `scheduled_cycle_changes`
- Redis type: sorted set
- Member: focus session UUID
- Score: Unix timestamp for the next cycle change

Flow:

```text
Browser connects over WebSocket
  -> Django Channels consumer starts/resumes timer
  -> session UUID is written to Redis zset with next-change timestamp
  -> redis_scheduler polls due entries with ZRANGEBYSCORE
  -> scheduler changes the cycle
  -> Channels broadcasts timer state back to connected clients
```

Check pending cycle changes:

```bash
redis-cli zrange scheduled_cycle_changes 0 -1 withscores
```

Clear stale scheduled entries only if needed:

```bash
redis-cli del scheduled_cycle_changes
sudo systemctl restart focus-timer-v-redis-scheduler.service
```

## Deploy

Push local changes first:

```bash
git push origin main
```

Deploy on VPS:

```bash
ssh -J root@147.182.201.157 focususer@168.144.84.148
cd /home/focususer/focus-timer-v
git status
git pull origin main
export PATH="$HOME/.local/bin:$PATH"
uv sync --frozen
uv run python manage.py check
uv run python manage.py migrate --noinput
uv run python manage.py collectstatic --noinput
sudo systemctl restart focus-timer-v-web.service
sudo systemctl restart focus-timer-v-redis-scheduler.service
sudo nginx -t
sudo systemctl reload nginx
```

Verify after deploy:

```bash
systemctl is-active focus-timer-v-web.service
systemctl is-active focus-timer-v-redis-scheduler.service
curl -I https://focus.lazyplanner.app/
```

`STATICFILES_STORAGE_BACKEND` defaults to Django `StaticFilesStorage`. Do not switch production to manifest static storage until `django-allauth-ui` static post-processing is verified.

## Rollback

Use git history:

```bash
cd /home/focususer/focus-timer-v
git log --oneline -n 10
git checkout <previous-commit>
export PATH="$HOME/.local/bin:$PATH"
uv sync --frozen
uv run python manage.py migrate --noinput
uv run python manage.py collectstatic --noinput
sudo systemctl restart focus-timer-v-web.service
sudo systemctl restart focus-timer-v-redis-scheduler.service
```

To return to latest main:

```bash
git checkout main
git pull origin main
sudo systemctl restart focus-timer-v-web.service
sudo systemctl restart focus-timer-v-redis-scheduler.service
```

## Database Backup

SQLite backup:

```bash
cd /home/focususer/focus-timer-v
sqlite3 db.sqlite3 ".backup db_backup_$(date +%Y%m%d_%H%M%S).sqlite3"
ls -lh db_backup_*.sqlite3
```

Copy backup to local machine:

```bash
scp -J root@147.182.201.157 focususer@168.144.84.148:/home/focususer/focus-timer-v/db_backup_YYYYMMDD_HHMMSS.sqlite3 .
```

Restore:

```bash
cd /home/focususer/focus-timer-v
sudo systemctl stop focus-timer-v-web.service focus-timer-v-redis-scheduler.service
cp db.sqlite3 db.sqlite3.before_restore
cp db_backup_YYYYMMDD_HHMMSS.sqlite3 db.sqlite3
sudo systemctl start focus-timer-v-web.service focus-timer-v-redis-scheduler.service
```

## Fresh VPS Setup

1. Create the droplet.

Use Ubuntu 24.04 LTS. Current VPS is `lazyplanner-do` at `168.144.84.148`.

2. Add DNS.

In Cloudflare, create:

```text
A focus.lazyplanner.app -> <new-vps-ip>
```

Use Cloudflare SSL mode `Full` or `Full (strict)` after certbot succeeds.

3. Create the app user.

```bash
adduser focususer
usermod -aG sudo,www-data focususer
```

4. Install system packages.

```bash
sudo apt update
sudo apt install -y git curl nginx redis-server certbot python3-certbot-nginx sqlite3
sudo systemctl enable --now nginx redis-server
```

5. Install uv as `focususer`.

```bash
su - focususer
curl -LsSf https://astral.sh/uv/install.sh | sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile
export PATH="$HOME/.local/bin:$PATH"
uv python install 3.14
```

6. Configure GitHub deploy key.

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keygen -t ed25519 -C focus-timer-v-deploy -f ~/.ssh/focus-timer-v-deploy -N ""
cat ~/.ssh/focus-timer-v-deploy.pub
```

Add that public key as a read-only deploy key to `saurav-codes/focus-timer-v`.

```bash
ssh-keyscan github.com >> ~/.ssh/known_hosts
git clone git@github.com:saurav-codes/focus-timer-v.git /home/focususer/focus-timer-v
cd /home/focususer/focus-timer-v
git config core.sshCommand "ssh -i /home/focususer/.ssh/focus-timer-v-deploy -o IdentitiesOnly=yes"
```

7. Create `.env`.

```bash
cd /home/focususer/focus-timer-v
nano .env
chmod 600 .env
mkdir -p logs production_static_files
```

Minimum `.env`:

```env
SECRET_KEY=<django-secret>
DEBUG=False
ALLOWED_HOSTS=focus.lazyplanner.app,<new-vps-ip>,localhost,127.0.0.1
CSRF_TRUSTED_ORIGINS=https://focus.lazyplanner.app
```

8. Install app dependencies and initialize Django.

```bash
export PATH="$HOME/.local/bin:$PATH"
cd /home/focususer/focus-timer-v
uv sync --frozen
uv run python manage.py check
uv run python manage.py migrate --noinput
uv run python manage.py collectstatic --noinput
```

9. Add systemd units.

Create:

```bash
sudo nano /etc/systemd/system/focus-timer-v-web.service
sudo nano /etc/systemd/system/focus-timer-v-redis-scheduler.service
```

Use the unit contents from the Systemd section above, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now focus-timer-v-web.service
sudo systemctl enable --now focus-timer-v-redis-scheduler.service
```

10. Configure nginx.

Create:

```bash
sudo nano /etc/nginx/sites-available/focus-lazyplanner
```

Use an HTTP-only config first so certbot can issue the certificate:

```nginx
server {
  listen 80;
  server_name focus.lazyplanner.app;

  location /static/ {
    alias /home/focususer/focus-timer-v/production_static_files/;
  }

  location /ws/ {
    proxy_pass http://127.0.0.1:8010;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
  }

  location / {
    proxy_pass http://127.0.0.1:8010;
    include proxy_params;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/focus-lazyplanner /etc/nginx/sites-enabled/focus-lazyplanner
sudo nginx -t
sudo systemctl reload nginx
```

11. Issue TLS certificate.

After Cloudflare DNS points to the VPS:

```bash
sudo certbot --nginx -d focus.lazyplanner.app
sudo certbot certificates
sudo systemctl reload nginx
```

After certbot succeeds, nginx should look like the Nginx section above with HTTPS on port 443 and HTTP redirecting to HTTPS.

12. Verify.

```bash
systemctl is-active focus-timer-v-web.service
systemctl is-active focus-timer-v-redis-scheduler.service
redis-cli ping
curl -I https://focus.lazyplanner.app/
```

## Troubleshooting

Public URL down:

```bash
curl -I https://focus.lazyplanner.app/
sudo nginx -t
systemctl is-active nginx
systemctl is-active focus-timer-v-web.service
journalctl -u focus-timer-v-web.service -n 100 --no-pager
sudo tail -n 100 /var/log/nginx/error.log
```

Cloudflare 521 or connection refused:

```bash
sudo ss -ltnp | grep -E ':80|:443|:8010'
systemctl is-active nginx
systemctl is-active focus-timer-v-web.service
```

WebSocket/timer UI broken:

```bash
sudo sed -n '1,220p' /etc/nginx/sites-available/focus-lazyplanner
journalctl -u focus-timer-v-web.service -n 100 --no-pager
```

Cycle does not change:

```bash
systemctl is-active focus-timer-v-redis-scheduler.service
journalctl -u focus-timer-v-redis-scheduler.service -n 100 --no-pager
redis-cli zrange scheduled_cycle_changes 0 -1 withscores
```

Deploy fails during static collection:

```bash
grep STATICFILES_STORAGE_BACKEND .env
uv run python manage.py collectstatic --noinput
```

Git pull fails on VPS:

```bash
cd /home/focususer/focus-timer-v
git remote -v
git config core.sshCommand
ssh -i /home/focususer/.ssh/focus-timer-v-deploy -o IdentitiesOnly=yes -T git@github.com
```

Service unit changed:

```bash
sudo systemctl daemon-reload
sudo systemctl restart focus-timer-v-web.service
sudo systemctl restart focus-timer-v-redis-scheduler.service
```
