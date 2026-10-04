<template>
  <div class="dash">
    <header class="head">
      <h1>Dashboard</h1>
      <p>Your focus sessions and activity.</p>
    </header>

    <p class="err" v-if="loadError">{{ loadError }}</p>

    <div class="stats">
      <section class="stat">
        <p class="num">{{ stats.sessions }}</p>
        <p class="lbl">Sessions</p>
      </section>
      <section class="stat">
        <p class="num">{{ formatFocusTime(stats.focusMs) }}</p>
        <p class="lbl">Focused</p>
      </section>
      <section class="stat">
        <p class="num">{{ completionPct }}</p>
        <p class="lbl">Completion</p>
      </section>
    </div>

    <div class="grid">
      <section class="panel">
        <h2>Recent sessions</h2>
        <ul class="rows" v-if="sessions.length">
          <li v-for="session in sessions" :key="session.id">
            <router-link class="row" :to="`/session/${session.id}`">
              <span class="mark" :class="{ on: session.state === 'completed' }" aria-hidden="true" />
              <span class="what">
                <strong>{{ dateLine(session.createdAtMs) }}</strong>
                <span class="sub">
                  {{ session.technique }}<template v-if="session.joined"> · joined</template>
                </span>
              </span>
              <span class="state" :class="session.state === 'completed' ? 'ok' : 'warn'">
                {{ session.state }}
              </span>
            </router-link>
          </li>
        </ul>
        <div class="empty" v-else>
          <p>No sessions yet.</p>
          <router-link class="start" to="/">Start your first one</router-link>
        </div>
      </section>

      <section class="panel cal">
        <header class="cal-head">
          <h2>{{ monthLabel }}</h2>
          <div class="cal-nav">
            <button type="button" @click="shiftMonth(-1)" aria-label="Previous month">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M14.5 5.5 8 12l6.5 6.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <button type="button" @click="shiftMonth(1)" aria-label="Next month">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M9.5 5.5 16 12l-6.5 6.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>
        </header>
        <div class="week" aria-hidden="true">
          <span v-for="dayName in WEEKDAYS" :key="dayName">{{ dayName }}</span>
        </div>
        <div class="days">
          <span v-for="blank in leadingBlanks" :key="`b${blank}`" class="blank" />
          <span
            v-for="day in daysInMonth"
            :key="day"
            class="day"
            :class="{ sess: hasSession(day), today: isToday(day) }"
          >
            {{ day }}
          </span>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getJson } from "../api";
import { formatFocusTime } from "../clock";

type MeResponse = {
  user: { id: number } | null;
  stats: { sessions: number; focusMs: number; avgSessionMs: number };
  sessions: { id: string; technique: string; state: string; createdAtMs: number; joined: boolean }[];
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const stats = ref({ sessions: 0, focusMs: 0, avgSessionMs: 0 });
const sessions = ref<MeResponse["sessions"]>([]);
const loadError = ref("");
const cursor = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

const completionPct = computed(() => {
  if (!sessions.value.length) return "0%";
  const done = sessions.value.filter((session) => session.state === "completed").length;
  return `${Math.round((done / sessions.value.length) * 100)}%`;
});

const monthLabel = computed(() =>
  cursor.value.toLocaleDateString([], { month: "long", year: "numeric" }),
);
const leadingBlanks = computed(
  () => new Date(cursor.value.getFullYear(), cursor.value.getMonth(), 1).getDay(),
);
const daysInMonth = computed(
  () => new Date(cursor.value.getFullYear(), cursor.value.getMonth() + 1, 0).getDate(),
);
const sessionDays = computed(() => {
  const days = new Set<string>();
  for (const session of sessions.value) {
    const d = new Date(session.createdAtMs);
    days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  return days;
});

function hasSession(day: number): boolean {
  return sessionDays.value.has(`${cursor.value.getFullYear()}-${cursor.value.getMonth()}-${day}`);
}

function isToday(day: number): boolean {
  const now = new Date();
  return (
    day === now.getDate() &&
    cursor.value.getMonth() === now.getMonth() &&
    cursor.value.getFullYear() === now.getFullYear()
  );
}

function shiftMonth(delta: number) {
  const next = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + delta, 1);
  cursor.value = next;
}

function dateLine(ms: number): string {
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

onMounted(async () => {
  try {
    const me = await getJson<MeResponse>("/api/me");
    stats.value = me.stats;
    sessions.value = me.sessions;
  } catch (err) {
    loadError.value = (err as Error).message;
  }
});
</script>

<style scoped>
.dash {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px 20px 80px;
}
.head h1 {
  margin: 0;
  font: 600 clamp(30px, 4vw, 40px) / 1.1 var(--sans, ui-sans-serif, system-ui, sans-serif);
  letter-spacing: -0.025em;
  color: var(--ink, #111111);
}
.head p {
  margin: 8px 0 0;
  font: 400 15px/1.5 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--muted, #757570);
}
.err {
  margin-top: 18px;
  padding: 12px 14px;
  border: 1px solid var(--border, #e6e6e2);
  border-radius: 10px;
  color: #c9423e;
  font: 400 14px/1.5 var(--sans, ui-sans-serif, system-ui, sans-serif);
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: 26px;
}
.stat {
  border: 1px solid var(--border, #e6e6e2);
  border-radius: 14px;
  background: var(--surface, #ffffff);
  padding: 20px 22px;
}
.stat .num {
  margin: 0;
  font: 300 clamp(30px, 4vw, 40px) / 1 var(--sans, ui-sans-serif, system-ui, sans-serif);
  letter-spacing: -0.02em;
  color: var(--ink, #111111);
  font-variant-numeric: tabular-nums;
}
.stat .lbl {
  margin: 8px 0 0;
  font: 400 13px/1 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--muted, #757570);
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 7fr) minmax(280px, 5fr);
  gap: 16px;
  margin-top: 16px;
  align-items: start;
}
.panel {
  border: 1px solid var(--border, #e6e6e2);
  border-radius: 14px;
  background: var(--surface, #ffffff);
  padding: 20px 22px;
}
.panel h2 {
  margin: 0 0 12px;
  font: 500 15px/1.3 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--ink, #111111);
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 11px 4px;
  border-radius: 8px;
  text-decoration: none;
}
.row:hover {
  background: var(--bg, #fbfbfa);
}
.mark {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid var(--border, #e6e6e2);
  flex: none;
}
.mark.on {
  background: var(--accent, #22c55e);
  border-color: var(--accent, #22c55e);
}
.what {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.what strong {
  font: 500 14px/1.2 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--ink, #111111);
}
.what .sub {
  font: 400 12.5px/1.2 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--muted, #757570);
}
.state {
  margin-left: auto;
  padding: 4px 11px;
  border-radius: 999px;
  font: 500 11.5px/1 var(--sans, ui-sans-serif, system-ui, sans-serif);
  white-space: nowrap;
}
.state.ok {
  background: var(--accent-soft, rgba(34, 197, 94, 0.14));
  color: var(--accent, #22c55e);
}
.state.warn {
  background: var(--bg, #fbfbfa);
  border: 1px solid var(--border, #e6e6e2);
  color: var(--muted, #757570);
}
.empty {
  display: grid;
  gap: 8px;
  padding: 22px 0 10px;
}
.empty p {
  margin: 0;
  font: 400 14px/1.5 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--muted, #757570);
}
.start {
  font: 500 14px/1 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--ink, #111111);
  text-decoration: underline;
}

.cal-head {
  display: flex;
  align-items: center;
  margin-bottom: 14px;
}
.cal-head h2 {
  margin: 0;
}
.cal-nav {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.cal-nav button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border, #e6e6e2);
  border-radius: 8px;
  background: var(--surface, #ffffff);
  color: var(--ink, #111111);
  cursor: pointer;
}
.cal-nav button:hover {
  border-color: var(--muted, #757570);
}
.cal-nav button:focus-visible {
  outline: 2px solid var(--accent, #22c55e);
  outline-offset: 2px;
}
.cal-nav svg {
  width: 15px;
  height: 15px;
}
.week,
.days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
}
.week span {
  padding: 6px 0;
  font: 400 11px/1 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--muted, #757570);
}
.days {
  row-gap: 4px;
  margin-top: 4px;
}
.day,
.blank {
  display: grid;
  place-items: center;
  height: 34px;
  font: 400 13px/1 var(--sans, ui-sans-serif, system-ui, sans-serif);
  font-variant-numeric: tabular-nums;
  color: var(--ink, #111111);
}
.day {
  border-radius: 50%;
  margin-inline: auto;
  width: 34px;
}
.day.today:not(.sess) {
  box-shadow: inset 0 0 0 1.5px var(--border, #e6e6e2);
}
.day.sess {
  background: var(--accent, #22c55e);
  color: #ffffff;
}

@media (max-width: 880px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 560px) {
  .stats {
    grid-template-columns: 1fr;
  }
}
</style>
