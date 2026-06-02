# Focus Timer Operations

## Infrastructure

- Public URL: `https://focus.lazyplanner.app`
- Droplet: `lazyplanner-do`
- IP: `168.144.84.148`
- App user: `focususer`
- App path: `/home/focususer/focus-timer-v`
- App service: `focus-timer-v-web.service`
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
```

## Health Checks

```bash
systemctl is-active focus-timer-v-web.service
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

## Deploy

From local repo:

```bash
tar --exclude=.git --exclude=.venv --exclude=venv --exclude=venv_focus_timer --exclude=db.sqlite3 --exclude=production_static_files -czf /tmp/focus-timer-v-deploy.tar.gz .
scp -o ProxyJump=root@147.182.201.157 /tmp/focus-timer-v-deploy.tar.gz focususer@168.144.84.148:/home/focususer/focus-timer-v-deploy.tar.gz
```

On VPS:

```bash
cd /home/focususer/focus-timer-v
tar -xzf /home/focususer/focus-timer-v-deploy.tar.gz -C /home/focususer/focus-timer-v
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python manage.py check
.venv/bin/python manage.py migrate --noinput
.venv/bin/python manage.py collectstatic --noinput
sudo systemctl restart focus-timer-v-web.service
sudo nginx -t
sudo systemctl reload nginx
rm -f /home/focususer/focus-timer-v-deploy.tar.gz
```

## Rollback

There is no formal release directory yet. For now, redeploy the previous git commit and restart:

```bash
git checkout <previous-commit>
# run Deploy steps
```
