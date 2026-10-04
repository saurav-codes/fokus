import { type CycleInput, generateCycleData, TECHNIQUES } from "../src/techniques";
import fixture from "./fixtures/techniques-golden.json";

type GoldenEntry = {
  technique: string;
  totalMinutes: number;
  flags: { long: boolean; short: boolean; last: boolean };
  cycles: { type: string; minutes: number }[];
  remainingMinutes: number;
};

const _golden = fixture as unknown as GoldenEntry[];

describe("technique generation (golden parity with the legacy python)", () => {
  for (const entry of fixture) {
    test(`${entry.technique} ${entry.totalMinutes}min long=${entry.flags.long} short=${entry.flags.short} last=${entry.flags.last}`, () => {
      const result = generateCycleData(entry.technique, entry.totalMinutes, {
        distributeLong: entry.flags.long,
        distributeShort: entry.flags.short,
        distributeLast: entry.flags.last,
      });
      expect(result.cycles).toEqual(entry.cycles);
      expect(result.remainingMinutes).toBe(entry.remainingMinutes);
    });
  }
});

describe("technique generation invariants", () => {
  test("every technique fills exactly 180 minutes", () => {
    for (const technique of TECHNIQUES) {
      const { cycles } = generateCycleData(technique, 180, {});
      expect(cycles.reduce((sum: number, cycle: CycleInput) => sum + cycle.minutes, 0)).toBe(180);
    }
  });

  test("flowtime and custom generate a single focus cycle", () => {
    for (const technique of ["Flowtime Technique", "Custom Technique"] as const) {
      expect(generateCycleData(technique, 45, {}).cycles).toEqual([{ type: "FOCUS", minutes: 45 }]);
    }
  });

  test("camel under 30 minutes is a single focus cycle", () => {
    expect(generateCycleData("Camel", 20, {}).cycles).toEqual([{ type: "FOCUS", minutes: 20 }]);
  });

  test("unknown technique throws", () => {
    expect(() => generateCycleData("Nope", 60, {})).toThrow();
  });
});
