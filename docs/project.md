# Focus Timer Project

## What It Does

Focus Timer is a Django + Channels app for creating shareable live focus sessions.

- Public landing page at `/`
- Authenticated session builder at `/main-session/`
- Live focus room at `/session/<session_id>/`
- WebSocket room at `/ws/focus_session/<session_id>/`

## Runtime Components

- Django serves HTTP pages, auth, HTMX partials, and admin.
- Daphne runs the ASGI app for HTTP and WebSockets.
- Redis has two jobs:
  - Channels layer for WebSocket group fanout.
  - Sorted-set scheduler queue for backend cycle changes.
- SQLite stores users, sessions, cycles, focus periods, and followers.
- Nginx terminates HTTPS and proxies to Daphne.

This project does not use Celery. The background process is the Redis scheduler command.

## Timer Flow

1. User creates a session through `FocusSessionForm`.
2. `focus_cycles_and_session_create_view` creates:
   - `FocusSession`
   - ordered `FocusCycle` rows
   - first `FocusPeriod`
3. Browser opens the live session page and connects to the WebSocket.
4. `FocusSessionConsumer.connect()` sends timer state and schedules the current cycle in Redis.
5. The scheduler stores due cycle changes in Redis sorted set:
   - key: `scheduled_cycle_changes`
   - member: session UUID
   - score: Unix timestamp when the current cycle should end
6. `manage.py redis_scheduler` loops over due zset items with `ZRANGEBYSCORE`.
7. For each due session, the scheduler:
   - loads the session
   - calls `AsyncTimerService.change_cycle_if_needed`
   - removes the old zset entry
   - schedules the next cycle if the session is still running
8. WebSocket clients request fresh timer state and receive group updates through Django Channels.

## Key Files

- `src/settings.py`: Django settings, Redis config, logging, Channels config.
- `src/asgi.py`: ASGI routing for HTTP and WebSockets.
- `apps/realtime_timer/models.py`: user, session, cycle, period, follower models.
- `apps/realtime_timer/forms.py`: session builder form.
- `apps/realtime_timer/htmx_views.py`: HTMX cycle generation and session creation.
- `apps/realtime_timer/views.py`: page views.
- `apps/realtime_timer/consumers.py`: live WebSocket session behavior.
- `apps/realtime_timer/business_logic/techniques.py`: focus-cycle generation algorithms.
- `apps/realtime_timer/business_logic/services.py`: timer state mutation and Redis scheduling helpers.
- `apps/realtime_timer/business_logic/selectors.py`: read/query helpers.
- `apps/realtime_timer/management/commands/redis_scheduler.py`: Redis zset scheduler loop.
- `assets/js/focus_session.js`: browser timer UI and WebSocket client.
- `templates/realtime_timer/`: landing, builder, and live session templates.

## Data Model

- `User`: Django user with timezone.
- `FocusSession`: one live timer session owned by a user.
- `FocusCycle`: ordered focus/break cycle for a session.
- `FocusPeriod`: actual persisted focus duration for a session/cycle.
- `SessionFollower`: users watching or joining a shared session.

## Logging

Logs write to:

```bash
logs/focus-timer.log
```

The same log file receives Django app logs, timer service logs, WebSocket logs, and Redis scheduler logs.
