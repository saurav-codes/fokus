import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer } from "../src/index";
import { tempDbPath } from "./helpers";

let base: string;
let app: ReturnType<typeof startServer>;

beforeAll(() => {
  app = startServer({ port: 0, databasePath: tempDbPath(), sessionSecret: "test-secret" });
  base = `http://127.0.0.1:${app.server.port}`;
});
afterAll(() => app.stop());

async function api(path: string, init: { method?: string; json?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
  });
  return { res, body: (await res.json().catch(() => null)) as Record<string, any> };
}

async function mintIdentity(): Promise<string> {
  const res = await api("/api/sessions", {
    method: "POST",
    json: { technique: "Custom Technique", cycles: [{ type: "FOCUS", minutes: 25 }] },
  });
  return res.res.headers.getSetCookie()[0].split(";")[0];
}

describe("http api (passwordless)", () => {
  test("healthz", async () => {
    expect((await api("/healthz")).body).toEqual({ ok: true });
  });

  test("identity is minted by the first session you create", async () => {
    const { res } = await api("/api/sessions", {
      method: "POST",
      json: { technique: "Custom Technique", cycles: [{ type: "FOCUS", minutes: 25 }] },
    });
    expect(res.status).toBe(201);
    expect(res.headers.getSetCookie()[0]).toContain("fokus_session=");
    const cookie = res.headers.getSetCookie()[0].split(";")[0];
    const me = await api("/api/me", { headers: { cookie } });
    expect(me.body.user.id).toBe(1);
    expect(me.body.stats.sessions).toBe(1);
  });

  test("/api/me without an identity returns zeros, not an error", async () => {
    const me = await api("/api/me");
    expect(me.res.status).toBe(200);
    expect(me.body.user).toBe(null);
    expect(me.body.stats).toEqual({ sessions: 0, focusMs: 0, avgSessionMs: 0 });
    expect(me.body.sessions).toEqual([]);
  });

  test("owner control requires the minted identity", async () => {
    const cookie = await mintIdentity();
    const created = await api("/api/sessions", {
      method: "POST",
      headers: { cookie },
      json: {
        technique: "Pomodoro",
        cycles: [
          { type: "FOCUS", minutes: 25 },
          { type: "BREAK", minutes: 5 },
        ],
      },
    });
    const id = created.body.id as string;

    // no identity at all
    expect((await api(`/api/sessions/${id}/toggle`, { method: "POST" })).res.status).toBe(401);
    // a different identity
    const strangerCookie = await mintIdentity();
    expect(
      (await api(`/api/sessions/${id}/toggle`, { method: "POST", headers: { cookie: strangerCookie } })).res.status,
    ).toBe(403);

    const paused = await api(`/api/sessions/${id}/toggle`, { method: "POST", headers: { cookie } });
    expect(paused.body.state).toBe("paused");
    const skipped = await api(`/api/sessions/${id}/next`, { method: "POST", headers: { cookie } });
    expect(skipped.body.currentCycle.order).toBe(2);
    const stopped = await api(`/api/sessions/${id}/stop`, { method: "POST", headers: { cookie } });
    expect(stopped.body.state).toBe("completed");

    const me = await api("/api/me", { headers: { cookie } });
    expect(me.body.stats.sessions).toBe(2);
    expect(me.body.sessions).toHaveLength(2);
    expect(me.body.sessions.map((s: any) => s.id)).toContain(id);
  });

  test("preview works without an identity", async () => {
    const { res, body } = await api("/api/techniques/preview", {
      method: "POST",
      json: { technique: "Camel", totalMinutes: 180 },
    });
    expect(res.status).toBe(200);
    expect(body.cycles.reduce((a: number, c: any) => a + c.minutes, 0)).toBe(180);
  });

  test("session create validation", async () => {
    const post = (json: unknown) => api("/api/sessions", { method: "POST", json });
    expect((await post({ technique: "Pomodoro", cycles: [] })).res.status).toBe(400);
    expect((await post({ technique: "Pomodoro", cycles: [{ type: "FOCUS", minutes: 0 }] })).res.status).toBe(400);
    expect((await post({ technique: "Pomodoro", cycles: [{ type: "FOCUS", minutes: 601 }] })).res.status).toBe(400);
    expect((await post({ technique: "Nope", cycles: [{ type: "FOCUS", minutes: 25 }] })).res.status).toBe(400);
    expect(
      (
        await post({
          technique: "Pomodoro",
          cycles: Array.from({ length: 251 }, () => ({ type: "FOCUS", minutes: 1 })),
        })
      ).res.status,
    ).toBe(400);
  });
});
