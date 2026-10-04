export const FOCUS = "FOCUS" as const;
export const BREAK = "BREAK" as const;

export const TECHNIQUES = [
  "Camel",
  "Pomodoro",
  "52/17 Method",
  "90-Minute Focus Sessions",
  "2-Hour Focus Blocks",
  "Flowtime Technique",
  "Custom Technique",
] as const;
export type Technique = (typeof TECHNIQUES)[number];
export const CAMEL: Technique = "Camel";

export type CycleInput = { type: typeof FOCUS | typeof BREAK; minutes: number };

export function isTechnique(value: string): value is Technique {
  return (TECHNIQUES as readonly string[]).includes(value);
}

// Ported verbatim from the legacy Python implementation, quirks included.
// Parity is pinned by test/fixtures/techniques-golden.json.
const FIXED_INTERVALS: Record<string, readonly [number, number]> = {
  Pomodoro: [25, 5],
  "52/17 Method": [52, 17],
  "90-Minute Focus Sessions": [90, 20],
  "2-Hour Focus Blocks": [120, 30],
};

function possibleLongFocusBlocks(total: number): number[][] {
  const blocks: number[][] = [];
  while (total >= 90) {
    for (const duration of [50, 60, 70, 80, 90]) {
      if (total >= duration + 10 + 25 + 5) {
        blocks.push([duration, 10, 25, 5]);
        total -= duration + 10 + 25 + 5;
      }
    }
  }
  return blocks.sort((a, b) => b[0] - a[0]);
}

function distributeToLongCycles(cycles: number[], budget: number): number {
  let distributed = 0;
  for (let i = 0; i < cycles.length; i++) {
    if (cycles[i] < 50) continue;
    if (distributed < budget) {
      cycles[i] += 1;
      distributed += 1;
    } else {
      break;
    }
  }
  return distributed;
}

function distributeToShortCycles(cycles: number[], budget: number): number {
  let added = 0;
  for (let i = 0; i < cycles.length - 4; i++) {
    if (cycles[i] >= 25 && cycles[i] < 28) {
      if (added < budget) {
        cycles[i] += 1;
        added += 1;
      }
      if (added === budget) break;
    }
  }
  return added;
}

function distributeToLast25Cycles(cycles: number[], budget: number): number {
  let added = 0;
  for (const position of [-4, -2]) {
    const index = cycles.length + position; // python negative index: IndexError iff index < 0
    if (index >= 0) {
      if (added < budget && cycles[index] < 28) {
        cycles[index] += 1;
        added += 1;
      }
    }
    if (added === budget) break;
  }
  if (cycles.length < 4) {
    for (let i = 0; i < cycles.length; i++) {
      if (added < budget) {
        cycles[i] += 1;
        added += 1;
      }
    }
  }
  return added;
}

type Distributor = (cycles: number[], budget: number) => number;

export type DistributeFlags = {
  distributeLong?: boolean;
  distributeShort?: boolean;
  distributeLast?: boolean;
};

export function generateCamelCycles(
  totalMinutes: number,
  flags: DistributeFlags,
): { cycles: number[]; remaining: number } {
  const { distributeLong = false, distributeShort = false, distributeLast = false } = flags;

  if (totalMinutes < 30) {
    return { cycles: [totalMinutes], remaining: 0 };
  }

  const cycles: number[] = [];
  let reserved = false;
  let remaining = totalMinutes;
  if (totalMinutes > 120) {
    remaining -= 60;
    reserved = true;
  }
  for (const block of possibleLongFocusBlocks(remaining)) {
    cycles.push(...block);
  }
  remaining -= cycles.reduce((a, m) => a + m, 0);

  while (remaining >= 30) {
    cycles.push(25, 5);
    remaining -= 30;
  }
  if (reserved) {
    cycles.push(25, 5, 25, 5);
  }

  const distributors: Distributor[] = [];
  if (distributeLong) distributors.push(distributeToLongCycles);
  if (distributeShort) distributors.push(distributeToShortCycles);
  if (distributeLast) distributors.push(distributeToLast25Cycles);

  // replicates the legacy python loop that removes distributors from the list
  // while iterating it (removing the element at i makes i land past the next)
  while (remaining > 0 && distributors.length > 0) {
    const budget = Math.floor(remaining / distributors.length);
    for (let i = 0; i < distributors.length; i++) {
      if (remaining > 0) {
        const distributed = distributors[i](cycles, budget);
        remaining -= distributed;
        if (distributed === 0) distributors.splice(i, 1);
      }
    }
  }
  return { cycles, remaining };
}

export function toCycleInputs(cycles: number[]): CycleInput[] {
  return cycles.map((minutes, index) => ({ type: index % 2 === 0 ? FOCUS : BREAK, minutes }));
}

function fixedIntervalCycles(total: number, focus: number, breakMinutes: number): number[] {
  if (total < focus) return [total];
  const cycles: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    const focusCycle = Math.min(focus, remaining);
    cycles.push(focusCycle);
    remaining -= focusCycle;
    if (remaining <= 0) break;
    const breakCycle = Math.min(breakMinutes, remaining);
    cycles.push(breakCycle);
    remaining -= breakCycle;
  }
  return cycles;
}

export function generateCycleData(
  technique: string,
  totalMinutes: number,
  flags: DistributeFlags = {},
): { cycles: CycleInput[]; remainingMinutes: number } {
  if (technique === CAMEL) {
    const { cycles, remaining } = generateCamelCycles(totalMinutes, flags);
    return { cycles: toCycleInputs(cycles), remainingMinutes: remaining };
  }
  const fixed = FIXED_INTERVALS[technique];
  if (fixed) {
    const cycles = fixedIntervalCycles(totalMinutes, fixed[0], fixed[1]);
    return { cycles: toCycleInputs(cycles), remainingMinutes: 0 };
  }
  if (technique === "Flowtime Technique" || technique === "Custom Technique") {
    return { cycles: toCycleInputs([totalMinutes]), remainingMinutes: 0 };
  }
  throw new Error(`unsupported technique: ${technique}`);
}
