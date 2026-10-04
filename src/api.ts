import { type Context, Hono } from "hono";
import type { Auth, UserRow } from "./auth";
import { all, type DB } from "./db";
import { type CycleInput, generateCycleData, isTechnique, TECHNIQUES } from "./techniques";
import * as timer from "./timer";
import { InvalidInput, LIMITS, type SessionRow } from "./timer";

export function buildApp(db: DB, auth: Auth) {
  const app = new Hono<{ Variables: { user: UserRow | null } }>();

  app.use("*", async (c, next) => {
    c.set("user", auth.userFromCookieHeader(c.req.header("cookie")));
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof InvalidInput) {
      const status = err.status as 400;
      return c.json({ error: err.message }, status);
    }
    console.error("unhandled error:", err);
    return c.json({ error: "internal error" }, 500);
  });

  async function body(c: Context): Promise<Record<string, unknown>> {
    try {
      return (await c.req.json()) as Record<string, unknown>;
    } catch {
      throw new InvalidInput("invalid JSON body");
    }
  }

  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const int = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isInteger(value) ? value : undefined;

  function requireUser(c: Context): UserRow {
    const user = c.get("user");
    if (!user) throw new InvalidInput("identity missing: recreate the session to become its owner", 401);
    return user;
  }

  function loadSession(c: Context): SessionRow {
    const session = timer.getSession(db, c.req.param("id"));
    if (!session) throw new InvalidInput("session not found", 404);
    return session;
  }

  function requireOwner(c: Context, session: SessionRow): void {
    const user = requireUser(c);
    if (session.owner_id !== user.id) throw new InvalidInput("only the session owner can do that", 403);
  }

  /** passwordless: mint an anonymous identity and set its cookie when the caller has none */
  function mintUser(c: Context): UserRow {
    let user = c.get("user") as UserRow | null;
    if (!user) {
      user = auth.createUser();
      c.set("user", user);
      c.header("set-cookie", auth.cookieHeader(user.id));
    }
    return user;
  }

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.post("/api/techniques/preview", async (c) => {
    const b = await body(c);
    const technique = str(b.technique);
    if (!isTechnique(technique)) {
      throw new InvalidInput(`technique must be one of: ${TECHNIQUES.join(", ")}`);
    }
    const totalMinutes = int(b.totalMinutes);
    if (totalMinutes === undefined || totalMinutes < 1 || totalMinutes > LIMITS.maxTotalMinutes) {
      throw new InvalidInput(`totalMinutes must be 1 to ${LIMITS.maxTotalMinutes}`);
    }
    const result = generateCycleData(technique, totalMinutes, {
      distributeLong: b.distributeLong === true,
      distributeShort: b.distributeShort === true,
      distributeLast: b.distributeLast === true,
    });
    return c.json({ technique, totalMinutes, ...result });
  });

  app.get("/api/me", (c) => {
    const user = c.get("user") as UserRow | null;
    // the dashboard lists sessions the user owns or joined, newest first
    const sessions = user
      ? all<{ id: string; technique: string; state: timer.SessionState; created_at: number; joined: 0 | 1 }>(
          db,
          `SELECT s.id, s.technique, s.state, s.created_at,
             EXISTS(SELECT 1 FROM memberships m WHERE m.session_id = s.id AND m.user_id = ?) AS joined
           FROM sessions s
           WHERE s.owner_id = ? OR s.id IN (SELECT session_id FROM memberships WHERE user_id = ?)
           ORDER BY s.created_at DESC LIMIT 20`,
          user.id,
          user.id,
          user.id,
        ).map((s) => ({
          id: s.id,
          technique: s.technique,
          state: s.state,
          createdAtMs: s.created_at,
          joined: s.joined === 1,
        }))
      : [];
    return c.json({
      user: user ? { id: user.id } : null,
      stats: user ? timer.userStats(db, user.id) : { sessions: 0, focusMs: 0, avgSessionMs: 0 },
      sessions,
    });
  });

  app.post("/api/sessions", async (c) => {
    // passwordless: the first session you create mints your anonymous identity
    const user = mintUser(c);
    const b = await body(c);
    const technique = str(b.technique);
    if (!isTechnique(technique)) {
      throw new InvalidInput(`technique must be one of: ${TECHNIQUES.join(", ")}`);
    }
    if (!Array.isArray(b.cycles)) throw new InvalidInput("cycles must be an array of {type, minutes}");
    const cycles: CycleInput[] = (b.cycles as unknown[]).map((raw) => {
      if (typeof raw !== "object" || raw === null) throw new InvalidInput("cycle must be an object");
      const cycle = raw as Record<string, unknown>;
      return { type: str(cycle.type), minutes: cycle.minutes as number };
    });
    const id = timer.createSession(db, user.id, technique, cycles);
    return c.json({ id }, 201);
  });

  app.get("/api/sessions/:id", (c) => {
    const session = loadSession(c);
    // the room page always loads this view: a cookieless joiner becomes attributable here
    const user = mintUser(c);
    const view = timer.sessionState(db, session.id) as timer.SessionStateView & { isOwner?: boolean };
    if (view) view.isOwner = user.id === session.owner_id;
    return c.json(view);
  });

  for (const action of ["toggle", "stop", "next"] as const) {
    const mutate = {
      toggle: timer.toggle,
      stop: timer.stop,
      next: timer.nextCycle,
    }[action];
    app.post(`/api/sessions/:id/${action}`, (c) => {
      const session = loadSession(c);
      requireOwner(c, session);
      timer.advance(db, session.id);
      mutate(db, session.id);
      return c.json(timer.sessionState(db, session.id));
    });
  }

  return app;
}
