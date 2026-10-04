import { describe, expect, test } from "bun:test";
import { computeRemainingMs, formatCountdown, formatFocusTime } from "../web/src/clock";

const makePayload = (endsAtMs: number | null, remainingMs = 3_000_000, state = "running" as const) =>
  ({
    state,
    serverNowMs: 1_000_000_000_000,
    currentCycle: { endsAtMs, remainingMs },
  }) as import("../web/src/clock").SyncedPayload;

describe("client clock (never ticks, derives from server timestamps)", () => {
  const now = 1_000_000_000_000;

  test("running cycle derives remaining from endsAtMs minus client clock", () => {
    // offset 500ms behind server time
    const payload = makePayload(now + 600_000, 600_000);
    expect(computeRemainingMs(payload, 500, now)).toBe(599_500);
    expect(computeRemainingMs(payload, 500, now + 100_000)).toBe(499_500);
    // after the end, it clamps to zero
    expect(computeRemainingMs(payload, 500, now + 700_000)).toBe(0);
  });

  test("paused cycle uses the frozen remainingMs value", () => {
    const payload = makePayload(null, 45_000, "paused");
    expect(computeRemainingMs(payload, 500, now + 999_000)).toBe(45_000);
  });

  test("completed and missing cycles return zero", () => {
    const completed = { ...makePayload(0, 0, "completed"), currentCycle: null };
    expect(computeRemainingMs(completed, 0, now)).toBe(0);
    expect(computeRemainingMs(null, 0, now)).toBe(0);
  });

  test("countdown formatting", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(59_000)).toBe("0:59");
    expect(formatCountdown(61_000)).toBe("1:01");
    expect(formatCountdown(3_734_000)).toBe("1:02:14");
  });

  test("focus time formatting", () => {
    expect(formatFocusTime(45_000)).toBe("0m");
    expect(formatFocusTime(9_000_000)).toBe("2h 30m");
  });
});
