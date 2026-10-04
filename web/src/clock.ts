export type SyncedPayload = {
  state: "running" | "paused" | "completed";
  serverNowMs: number;
  currentCycle: { remainingMs: number; endsAtMs: number | null } | null;
};

/**
 * The client clock never ticks: remaining is derived from the server's
 * endsAtMs plus a fixed offset measured at the last push.
 */
export function computeRemainingMs(payload: SyncedPayload | null, offsetMs: number, now: number): number {
  if (!payload || payload.state === "completed" || !payload.currentCycle) return 0;
  if (payload.currentCycle.endsAtMs === null) return payload.currentCycle.remainingMs;
  return Math.max(payload.currentCycle.endsAtMs - (now + offsetMs), 0);
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function formatFocusTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

export function clockOffsetMs(serverNowMs: number, now: number): number {
  return serverNowMs - now;
}
