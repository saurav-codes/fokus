<template>
  <div class="ring" :class="[`is-${state}`, { urgent }]">
    <svg :viewBox="`0 0 ${SIZE} ${SIZE}`" role="img" :aria-label="ariaLabel">
      <circle class="track" :cx="C" :cy="C" :r="R" />
      <circle
        class="bar"
        :cx="C"
        :cy="C"
        :r="R"
        :stroke-dasharray="CIRC"
        :stroke-dashoffset="dashOffset"
      />
    </svg>
    <div class="mid">
      <span class="phase">{{ phase }}</span>
      <span class="time">{{ text }}</span>
      <span class="sub" v-if="sub">{{ sub }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  /** elapsed fraction of the current cycle, 0..1 */
  progress: number;
  /** formatted countdown, e.g. "0:59" */
  text: string;
  /** current cycle kind, shown in caps above the time */
  phase: "FOCUS" | "BREAK";
  /** cycle total, e.g. "5 minutes" */
  sub?: string;
  state: "running" | "paused" | "completed";
  /** ms left in the cycle; drives the last-15s red highlight */
  remainingMs?: number;
}>();

const URGENT_MS = 15000;
const urgent = computed(
  () =>
    props.state === "running" &&
    props.remainingMs !== undefined &&
    props.remainingMs > 0 &&
    props.remainingMs <= URGENT_MS,
);

const SIZE = 320;
const STROKE = 10;
const C = SIZE / 2;
const R = C - STROKE / 2 - 6;
const CIRC = 2 * Math.PI * R;

const dashOffset = computed(() => CIRC * (1 - Math.min(Math.max(props.progress, 0), 1)));
const ariaLabel = computed(
  () => `${props.phase.toLowerCase()}, ${props.text} remaining, ${props.state}`,
);
</script>

<style scoped>
.ring {
  position: relative;
  width: min(340px, 68vw);
  margin-inline: auto;
}
.ring svg {
  display: block;
  width: 100%;
  height: auto;
  transform: rotate(-90deg);
}
.track,
.bar {
  fill: none;
  stroke-width: 10;
  stroke-linecap: round;
}
.track {
  stroke: var(--track, #ececea);
}
.bar {
  stroke: var(--accent, #22c55e);
  transition: stroke-dashoffset 240ms linear, stroke 400ms ease, opacity 200ms ease;
}
.is-paused .bar {
  opacity: 0.35;
}
.urgent .bar {
  stroke: var(--bad, #ef4444);
}
.mid {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  text-align: center;
}
.phase {
  font: 500 13px/1 var(--sans, ui-sans-serif, system-ui, sans-serif);
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--muted, #757570);
}
.time {
  font: 400 clamp(56px, 12vw, 76px) / 1 var(--mono, ui-monospace, "SF Mono", Menlo, monospace);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  color: var(--ink, #111111);
  transition: color 400ms ease;
}
.urgent .time {
  color: var(--bad, #ef4444);
}
.sub {
  font: 400 13.5px/1.4 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--muted, #757570);
}
@media (prefers-reduced-motion: reduce) {
  .bar {
    transition: none;
  }
}
</style>
