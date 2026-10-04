import { buildApp } from "./api";
import { makeAuth } from "./auth";
import { migrate, openDb } from "./db";
import { env } from "./env";
import { serveStatic } from "./static";
import { makeRealtime } from "./ws";

export function startServer(opts: { port?: number; databasePath?: string; sessionSecret?: string } = {}) {
  const db = openDb(opts.databasePath ?? env.databasePath);
  migrate(db);
  const auth = makeAuth(db, opts.sessionSecret ?? env.sessionSecret);
  const app = buildApp(db, auth);
  const realtime = makeRealtime(db, auth);
  const sweeper = setInterval(() => realtime.sweep(), 1000);
  const server = Bun.serve({
    port: opts.port ?? env.port,
    fetch(req, srv) {
      return realtime.handleUpgrade(req, srv) ?? serveStatic(req) ?? app.fetch(req);
    },
    websocket: realtime.websocket,
  });
  return {
    server,
    db,
    stop() {
      clearInterval(sweeper);
      server.stop();
      db.close();
    },
  };
}

if (import.meta.main) {
  const { server } = startServer();
  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  console.log(`fokus listening on http://127.0.0.1:${server.port}`);
}
