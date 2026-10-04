import type { Auth, UserRow } from "./auth";
import type { DB } from "./db";
import * as timer from "./timer";
import { InvalidInput } from "./timer";

type SocketData = { sessionId: string; user: UserRow | null };
type SocketMeta = { joined: boolean; guestName: string | null };

export type Realtime = ReturnType<typeof makeRealtime>;

export function makeRealtime(db: DB, auth: Auth) {
  const rooms = new Map<string, Set<WebSocket>>();
  const meta = new WeakMap<WebSocket, SocketMeta>();

  function room(sessionId: string): Set<WebSocket> {
    let set = rooms.get(sessionId);
    if (!set) {
      set = new Set();
      rooms.set(sessionId, set);
    }
    return set;
  }

  function broadcast(sessionId: string, msg: unknown): void {
    for (const ws of room(sessionId)) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        // a dying socket is removed by close(); ignore send failures here
      }
    }
  }

  function timerMessage(sessionId: string, now: number = Date.now(), extra: Record<string, unknown> = {}): string {
    return JSON.stringify({ type: "timer_update", ...timer.sessionState(db, sessionId, now), ...extra });
  }

  function broadcastTimer(sessionId: string): void {
    if (timer.getSession(db, sessionId)) broadcast(sessionId, JSON.parse(timerMessage(sessionId)));
  }

  function broadcastFollowers(sessionId: string): void {
    broadcast(sessionId, { type: "followers_update", followers: timer.getFollowers(db, sessionId) });
  }

  function sendError(ws: WebSocket, message: string): void {
    try {
      ws.send(JSON.stringify({ type: "error", message }));
    } catch {
      // ignore
    }
  }

  function handleUpgrade(req: Request, server: Bun.Server): Response | undefined {
    const match = /^\/ws\/session\/([0-9a-f-]{36})$/.exec(new URL(req.url).pathname);
    if (!match) return undefined;
    const user = auth.userFromCookieHeader(req.headers.get("cookie"));
    const ok = server.upgrade(req, { data: { sessionId: match[1], user } satisfies SocketData });
    return ok ? undefined : new Response("websocket upgrade failed", { status: 400 });
  }

  const websocket: Bun.WebSocketHandler<SocketData> = {
    open(ws) {
      const { sessionId, user } = ws.data;
      room(sessionId).add(ws);
      meta.set(ws, { joined: false, guestName: null });
      const session = timer.getSession(db, sessionId);
      if (!session) {
        sendError(ws, "session not found");
        ws.close();
        return;
      }
      const isOwner = user !== null && user.id === session.owner_id;
      try {
        ws.send(timerMessage(sessionId, Date.now(), { isOwner }));
        ws.send(JSON.stringify({ type: "followers_update", followers: timer.getFollowers(db, sessionId) }));
      } catch {
        // ignore
      }
    },

    message(ws, text) {
      const { sessionId, user } = ws.data;
      const socketMeta = meta.get(ws) ?? { joined: false, guestName: null };
      let msg: { action?: string; guest_name?: string } | null = null;
      try {
        msg = JSON.parse(String(text)) as { action?: string; guest_name?: string };
      } catch {
        sendError(ws, "invalid websocket message");
        return;
      }
      const session = timer.getSession(db, sessionId);
      if (!session) {
        sendError(ws, "session not found");
        return;
      }
      const action = msg?.action;
      if (action === "join_session") {
        const name = String(msg?.guest_name ?? "")
          .trim()
          .slice(0, 150);
        if (!name) {
          sendError(ws, "a display name is required to join");
          return;
        }
        try {
          timer.addFollower(db, sessionId, name, user?.id ?? null);
        } catch (err) {
          sendError(ws, err instanceof InvalidInput ? err.message : "could not join session");
          return;
        }
        // the join stays attributed to the joiner's stats after they leave; followers is only live presence
        if (user) timer.addMembership(db, sessionId, user.id);
        socketMeta.joined = true;
        socketMeta.guestName = name;
        broadcastFollowers(sessionId);
      } else if (action === "toggle_timer" || action === "stop_timer" || action === "transition_to_next_cycle") {
        if (!user || user.id !== session.owner_id) {
          sendError(ws, "only the session owner can do that");
          return;
        }
        timer.advance(db, sessionId);
        if (action === "toggle_timer") timer.toggle(db, sessionId);
        else if (action === "stop_timer") timer.stop(db, sessionId);
        else timer.nextCycle(db, sessionId);
        broadcastTimer(sessionId);
      } else if (action === "sync_inactive_timer") {
        try {
          ws.send(timerMessage(sessionId));
        } catch {
          // ignore
        }
      } else {
        sendError(ws, "unknown websocket action");
      }
    },

    close(ws) {
      const { sessionId, user } = ws.data;
      const set = rooms.get(sessionId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) rooms.delete(sessionId);
      }
      const socketMeta = meta.get(ws);
      if (socketMeta?.joined) {
        timer.removeFollower(db, sessionId, user?.id ?? null, socketMeta.guestName);
        broadcastFollowers(sessionId);
      }
    },
  };

  return {
    handleUpgrade,
    websocket,
    /** moves every running session forward past due cycles and broadcasts changes */
    sweep(): void {
      for (const { id } of db.prepare("SELECT id FROM sessions WHERE state = 'running'").all() as {
        id: string;
      }[]) {
        if (timer.advance(db, id)) broadcastTimer(id);
      }
    },
  };
}
