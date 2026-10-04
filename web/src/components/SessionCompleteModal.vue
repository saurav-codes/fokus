<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card sc-card" role="dialog" aria-modal="true" aria-labelledby="sc-title">
      <div class="sc-head">
        <img class="sc-logo" src="/mark.png" alt="fokus" />
        <button class="modal-close sc-close-x" type="button" @click="emit('close')" aria-label="Close">
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div class="sc-badge" aria-hidden="true">
        <span class="cf" />
        <span class="cf" />
        <span class="cf" />
        <span class="cf" />
        <span class="cf" />
        <span class="cf" />
        <span class="cf" />
        <span class="cf" />
        <div class="sc-badge-inner">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="10.5" cy="1.4" r="1" />
            <circle cx="15" cy="1.2" r="1" />
            <circle cx="17.2" cy="4" r="1" />
            <path d="M10.5 4.5l6.6 1.5L4.5 20Z" />
          </svg>
        </div>
      </div>

      <h2 id="sc-title">Session complete</h2>
      <p class="sc-sub">Great work! You finished your session.</p>

      <div class="sc-stats">
        <div class="sc-stat">
          <span class="sc-value">{{ stats.cycles }}</span>
          <span class="sc-label">Cycles</span>
        </div>
        <div class="sc-stat">
          <span class="sc-value">{{ stats.focused }}</span>
          <span class="sc-label">Focused</span>
        </div>
        <div class="sc-stat">
          <span class="sc-value">{{ stats.breaks }}</span>
          <span class="sc-label">Breaks</span>
        </div>
        <div class="sc-stat">
          <span class="sc-value">{{ stats.total }}</span>
          <span class="sc-label">Total</span>
        </div>
      </div>

      <div class="sc-actions">
        <button class="btn btn-dark sc-btn" type="button" @click="router.push('/')">Start another session</button>
        <button class="btn btn-ghost sc-btn" type="button" @click="router.push('/dashboard')">Back to dashboard</button>
      </div>

      <a class="sc-promo" href="https://lazyplanner.app" target="_blank" rel="noopener">
        <img class="sc-promo-logo" src="/lazy-logo.png" alt="" />
        <span class="sc-promo-text">
          <strong>Lazy Planner</strong>
          <span>Keep the momentum. Organize your next tasks with Lazy Planner.</span>
        </span>
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7 17L17 7M9.5 7H17v7.5" />
        </svg>
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useRouter } from "vue-router";
import { formatFocusTime } from "../clock";

type Cycle = { order: number; type: "FOCUS" | "BREAK"; durationMs: number; completed: boolean };

const props = defineProps<{ cycles: Cycle[] }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();

function sumByType(type: Cycle["type"]) {
  return props.cycles.filter((cycle) => cycle.type === type).reduce((total, cycle) => total + cycle.durationMs, 0);
}
function minutesPlain(ms: number) {
  return `${Math.round(ms / 60000)} min`;
}

const stats = computed(() => {
  const focusMs = sumByType("FOCUS");
  const breakMs = sumByType("BREAK");
  return {
    cycles: props.cycles.length,
    focused: minutesPlain(focusMs),
    breaks: minutesPlain(breakMs),
    total: formatFocusTime(focusMs + breakMs),
  };
});

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
</script>

<style scoped>
.sc-card {
  width: min(560px, 100%);
  padding: 16px 28px 24px;
}
.sc-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sc-logo {
  width: 24px;
  height: 24px;
  border-radius: 6px;
}
.sc-close-x {
  position: static;
  margin-right: -8px;
}

.sc-badge {
  position: relative;
  width: 96px;
  height: 96px;
  margin-top: 4px;
}
.sc-badge-inner {
  position: absolute;
  inset: 12px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent-strong);
}
[data-theme="dark"] .sc-badge-inner {
  color: var(--accent);
}
.sc-badge-inner svg {
  width: 32px;
  height: 32px;
}
.cf {
  position: absolute;
  background: var(--accent-soft);
  border-radius: 50%;
  width: 5px;
  height: 5px;
}
.cf:nth-of-type(even) {
  border-radius: 1px;
  width: 9px;
  height: 2.5px;
}
.cf:nth-of-type(1) { top: 4px; left: 14px; background: var(--accent); }
.cf:nth-of-type(2) { top: 0; left: 46px; transform: rotate(24deg); background: #86EFAC; }
.cf:nth-of-type(3) { top: 8px; right: 12px; background: #4ADE80; }
.cf:nth-of-type(4) { top: 42px; right: 0; transform: rotate(-30deg); background: var(--accent); }
.cf:nth-of-type(5) { bottom: 10px; right: 10px; background: #BBF7D0; }
.cf:nth-of-type(6) { bottom: 0; left: 30px; transform: rotate(40deg); background: #4ADE80; }
.cf:nth-of-type(7) { bottom: 12px; left: 6px; background: var(--accent); }
.cf:nth-of-type(8) { top: 40px; left: 0; transform: rotate(-16deg); background: #86EFAC; }

.sc-sub {
  font-size: 14.5px;
  color: var(--muted);
}

.sc-stats {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin: 6px 0 4px;
}
.sc-stat {
  display: grid;
  gap: 3px;
  justify-items: center;
  padding: 14px 8px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--track);
}
.sc-value {
  font: 500 18px/1.1 var(--sans);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.sc-label {
  font: 400 11.5px/1 var(--mono);
  color: var(--muted);
}
.sc-actions {
  width: 100%;
  display: grid;
  gap: 10px;
  margin-top: 4px;
}
.sc-btn {
  width: 100%;
  height: 48px;
}
.sc-promo {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  text-decoration: none;
  text-align: left;
  transition: border-color 150ms ease, background-color 150ms ease;
}
.sc-promo:hover {
  border-color: var(--faint);
}
.sc-promo-logo {
  width: 40px;
  height: 40px;
  border-radius: 9px;
  flex: none;
}
.sc-promo-text {
  min-width: 0;
  display: grid;
  gap: 2px;
  color: var(--ink);
}
.sc-promo-text strong {
  font: 500 14.5px/1.2 var(--sans);
}
.sc-promo-text span {
  font: 400 13px/1.4 var(--sans);
  color: var(--muted);
}
.sc-promo .ic {
  margin-left: auto;
  color: var(--muted);
  width: 17px;
  height: 17px;
}
</style>
