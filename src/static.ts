import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Serves the built Vue SPA from web/dist. Skips API and websocket paths.
 * With no build present, returns undefined so the JSON routes still answer.
 */
const DIST = resolve(import.meta.dir, "../web/dist");
const INDEX = join(DIST, "index.html");

export function serveStatic(req: Request): Response | undefined {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);
  if (path.startsWith("/api") || path.startsWith("/ws") || path === "/healthz") return undefined;
  if (!existsSync(INDEX)) return undefined;

  // resolve inside DIST only; traversal falls back to the SPA index
  const resolved = resolve(DIST, path === "/" ? "index.html" : path.slice(1));
  const target = resolved.startsWith(DIST) && existsSync(resolved) && statSync(resolved).isFile() ? resolved : INDEX;
  // vite version-hashes every file it emits into /assets/, so it can be cached forever
  const isHashedAsset = path.startsWith("/assets/");
  return new Response(Bun.file(target), {
    headers: { "cache-control": isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache" },
  });
}
