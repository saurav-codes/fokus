<template>
  <div class="room">
    <p class="err" v-if="notFoundError">
      This room does not exist. <router-link to="/">Start a new one.</router-link>
    </p>

    <div class="room-grid" v-else-if="payload">
      <section class="timer-card" ref="cardEl">
        <div class="meta">
          <span class="conn" :class="connection">{{ connectionText }}</span>
          <span class="tag">{{ payload.technique }}</span>
          <span class="tag" v-if="payload.state === 'paused'">paused</span>
        </div>

        <template v-if="payload.state !== 'completed'">
          <TimerRing
            :progress="progress"
            :text="countdown"
            :phase="currentType"
            :sub="cycleTotal"
            :state="payload.state"
            :remaining-ms="remainingMs"
          />

          <div class="controls" v-if="isOwner">
            <div class="ctl">
              <button
                type="button"
                class="ctl-main"
                @click="toggle"
                :aria-label="payload.state === 'paused' ? 'Resume' : 'Pause'"
              >
                <svg v-if="payload.state === 'paused'" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
                </svg>
                <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" />
                  <rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" />
                </svg>
              </button>
              <span class="ctl-label">{{ payload.state === "paused" ? "Resume" : "Pause" }}</span>
            </div>
            <div class="ctl">
              <button type="button" class="ctl-ghost" @click="skip" aria-label="Skip">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 5.5v13l9-6.5z" fill="currentColor" />
                  <rect x="15.5" y="5" width="3" height="14" rx="1" fill="currentColor" />
                </svg>
              </button>
              <span class="ctl-label">Skip</span>
            </div>
            <div class="ctl">
              <button
                type="button"
                class="ctl-ghost"
                :class="{ confirm: stopConfirm }"
                @click="askStop"
                aria-label="Stop"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
                </svg>
              </button>
              <span class="ctl-label" :class="{ confirm: stopConfirm }">
                {{ stopConfirm ? "Sure?" : "Stop" }}
              </span>
            </div>
          </div>
        </template>

        <div class="done" v-else>
          <strong>Session done.</strong>
          <router-link class="again" to="/">Start a new session</router-link>
        </div>

        <div class="card-foot">
          <span class="ends" v-if="endsAt">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" stroke-linecap="round" />
            </svg>
            Will end at {{ endsAt }}
          </span>
          <button
            type="button"
            class="fs"
            @click="toggleFullscreen"
            :aria-label="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
            :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path
                v-if="isFullscreen"
                d="M9 4v4a1 1 0 0 1-1 1H4M20 8h-4a1 1 0 0 1-1-1V4M4 16h4a1 1 0 0 1 1 1v4M15 20v-3a1 1 0 0 1 1-1h4"
                stroke-linecap="round"
              />
              <path
                v-else
                d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
      </section>

      <aside class="rail">
        <section class="card">
          <header class="card-head">
            <h2>In this room</h2>
            <span class="count">{{ followers.length }}</span>
          </header>

          <form class="join" v-if="!joined" @submit.prevent="join">
            <label class="sr-only" for="join-name">Display name</label>
            <input
              id="join-name"
              v-model="nameInput"
              placeholder="Your name"
              maxlength="60"
              autocomplete="nickname"
            />
            <button type="submit">Join</button>
          </form>

          <ul class="people">
            <li v-for="follower in followers" :key="follower.username">
              <span class="dot" aria-hidden="true" />
              <span class="who">{{ follower.username }}</span>
              <span class="you" v-if="follower.username === myName">You</span>
            </li>
          </ul>
          <p class="empty" v-if="!followers.length">Nobody here yet. Share the link.</p>
          <p class="err-inline" v-if="error">{{ error }}</p>
        </section>

        <section class="card">
          <header class="card-head">
            <h2>Session plan</h2>
          </header>
          <ol class="plan">
            <li
              v-for="cycle in payload.cycles"
              :key="cycle.order"
              :class="{ cur: cycle.order === payload.currentCycle?.order }"
            >
              <span class="num">{{ cycle.order }}</span>
              <span class="kind">{{ cycle.type === "FOCUS" ? "Focus" : "Break" }}</span>
              <span class="mins">{{ Math.round(cycle.durationMs / 60000) }} min</span>
            </li>
          </ol>
        </section>
      </aside>
    </div>

    <SessionCompleteModal
      v-if="showComplete"
      :cycles="payload?.cycles ?? []"
      @close="completeDismissed = true"
    />

    <ShareButton />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { getJson } from "../api";
import { computeRemainingMs, formatCountdown, type SyncedPayload } from "../clock";
import TimerRing from "../components/TimerRing.vue";
import ShareButton from "../components/ShareButton.vue";
import SessionCompleteModal from "../components/SessionCompleteModal.vue";

type CycleView = {
  order: number;
  type: "FOCUS" | "BREAK";
  durationMs: number;
  completed: boolean;
};
type Payload = SyncedPayload & {
  id: string;
  technique: string;
  isOwner?: boolean;
  currentCycle: (SyncedPayload["currentCycle"] & { order: number; type: "FOCUS" | "BREAK" }) | null;
  cycles: CycleView[];
  willFinishAtMs: number | null;
};
type Follower = { username: string; joinedAtMs: number };

const route = useRoute();
const sessionId = String(route.params.id);

const payload = ref<Payload | null>(null);
const notFoundError = ref("");
const error = ref("");
const isOwner = ref(false);
const followers = ref<Follower[]>([]);
const joined = ref(false);
const nameInput = ref(localStorage.getItem("fokus-name") ?? "");
const connection = ref<"on" | "off" | "connecting">("connecting");
const countdown = ref("0:00");
const remainingMs = ref(0);
const progress = ref(0);
const stopConfirm = ref(false);
const cardEl = ref<HTMLElement | null>(null);
const isFullscreen = ref(false);

let ws: WebSocket | null = null;
let offset = 0;
let tick: ReturnType<typeof setInterval> | null = null;
let retry: ReturnType<typeof setInterval> | null = null;

const connectionText = computed(() =>
  connection.value === "on" ? "live" : connection.value === "connecting" ? "connecting" : "offline",
);
const currentType = computed(() => payload.value?.currentCycle?.type ?? "FOCUS");
const myName = computed(() => nameInput.value.trim() || (localStorage.getItem("fokus-name") ?? ""));
const cycleTotal = computed(() => {
  const cycle = payload.value?.currentCycle;
  if (!cycle) return "";
  const minutes = Math.round(cycle.durationMs / 60000);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
});
const endsAt = computed(() => {
  const view = payload.value;
  if (!view?.willFinishAtMs) return "";
  return new Date(view.willFinishAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
});
const completeDismissed = ref(false);
const showComplete = computed(() => payload.value?.state === "completed" && !completeDismissed.value);
watch(
  () => payload.value?.state,
  (state) => {
    if (state === "completed") completeDismissed.value = false;
  },
);

// WebAudio chime: two overlapping sines (G4+B4), quick attack, ~1.5s decay.
// Browsers block autoplay, so the context is created lazily and resumed on
// the first transition; if it stays suspended we silently skip.
let audioCtx: AudioContext | null = null;
function chime() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (audioCtx.state !== "running") return;
    const now = audioCtx.currentTime;
    const out = audioCtx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
    out.connect(audioCtx.destination);
    for (const freq of [392, 493.88]) {
      const osc = audioCtx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(out);
      osc.start(now);
      osc.stop(now + 1.6);
    }
  } catch {
    // audio is best-effort
  }
}

async function notifyTransition(type: "FOCUS" | "BREAK") {
  const title = type === "BREAK" ? "Break time" : "Focus time";
  try {
    if ((window as any).Capacitor?.isNativePlatform?.() === true) {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      if ((await LocalNotifications.requestPermission()).display === "granted") {
        await LocalNotifications.schedule({
          notifications: [{ id: 1, title, schedule: { at: new Date(Date.now() + 100) } }],
        });
      }
    } else if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title);
    }
  } catch {
    // notification is best-effort
  }
}

watch(
  () => payload.value?.currentCycle,
  (cycle, prev) => {
    if (!cycle?.type || cycle.order === prev?.order) return;
    notifyTransition(cycle.type);
    chime();
  },
);

function handleMessage(data: any) {
  if (data.type === "timer_update") {
    if (typeof data.isOwner === "boolean") isOwner.value = data.isOwner;
    payload.value = data;
    offset = data.serverNowMs - Date.now();
    updateClock();
  } else if (data.type === "followers_update") {
    followers.value = data.followers;
    const mine = nameInput.value.trim();
    joined.value = data.followers.some((follower: Follower) => follower.username === mine);
  } else if (data.type === "error") {
    error.value = data.message;
  }
}

function wsUrl() {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.host}/ws/session/${sessionId}`;
}

function send(msg: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  connection.value = "connecting";
  ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    connection.value = "on";
    if (retry) {
      clearInterval(retry);
      retry = null;
    }
    const name = nameInput.value.trim();
    if (name) send({ action: "join_session", guest_name: name });
  };
  ws.onmessage = (event) => handleMessage(JSON.parse(String(event.data)));
  ws.onclose = () => {
    connection.value = "off";
    if (!retry) retry = setInterval(connect, 2500);
  };
}

function join() {
  const name = nameInput.value.trim();
  if (!name) {
    error.value = "Enter a name to join the room";
    return;
  }
  error.value = "";
  localStorage.setItem("fokus-name", name);
  send({ action: "join_session", guest_name: name });
}

function toggle() {
  stopConfirm.value = false;
  send({ action: "toggle_timer" });
}

function skip() {
  stopConfirm.value = false;
  send({ action: "transition_to_next_cycle" });
}

function askStop() {
  if (!stopConfirm.value) {
    stopConfirm.value = true;
    return;
  }
  send({ action: "stop_timer" });
  stopConfirm.value = false;
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    cardEl.value?.requestFullscreen();
  }
}

function onFullscreenChange() {
  isFullscreen.value = Boolean(document.fullscreenElement);
}

function updateClock() {
  const view = payload.value;
  if (!view) return;
  const remaining = computeRemainingMs(view, offset, Date.now());
  countdown.value = formatCountdown(remaining);
  remainingMs.value = remaining;
  const duration = view.currentCycle?.durationMs ?? 0;
  progress.value = duration > 0 ? Math.min(Math.max((duration - remaining) / duration, 0), 1) : 0;
  document.title = view.state === "completed" ? "fokus · done" : `${countdown.value} · fokus`;
}

function onVisibility() {
  if (document.visibilityState === "visible") send({ action: "sync_inactive_timer" });
}

onMounted(async () => {
  try {
    const view = (await getJson<Payload>(`/api/sessions/${sessionId}`)) as Payload;
    if (typeof view.isOwner === "boolean") isOwner.value = view.isOwner;
    payload.value = view;
    offset = view.serverNowMs - Date.now();
    connect();
    tick = setInterval(updateClock, 250);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreenChange);
  } catch (err) {
    notFoundError.value = (err as Error).message;
  }
});

onUnmounted(() => {
  ws?.close();
  if (audioCtx) audioCtx.close().catch(() => undefined);
  if (tick) clearInterval(tick);
  if (retry) clearInterval(retry);
  document.removeEventListener("visibilitychange", onVisibility);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  document.title = "fokus";
});
</script>

<style scoped>
.room {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px 20px 96px;
}
.err {
  padding: 12px 14px;
  border: 1px solid var(--border, #e6e6e2);
  border-radius: 10px;
  color: #c9423e;
  font: 400 14px/1.5 var(--sans, ui-sans-serif, system-ui, sans-serif);
}
.err a {
  color: inherit;
  text-decoration: underline;
}

.room-grid {
  display: grid;
  grid-template-columns: minmax(0, 13fr) minmax(260px, 7fr);
  gap: 20px;
  align-items: start;
}

.timer-card {
  position: relative;
  border: 1px solid var(--border, #e6e6e2);
  border-radius: 16px;
  background: var(--surface, #ffffff);
  padding: 20px 28px 16px;
}
.timer-card:fullscreen {
  background: var(--bg, #fbfbfa);
  border: 0;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.conn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font: 400 12px/1 var(--mono, ui-monospace, "SF Mono", Menlo, monospace);
  color: var(--muted, #757570);
}
.conn::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--muted, #757570);
}
.conn.on::before {
  background: var(--accent, #22c55e);
}
.conn.off::before {
  background: #c9423e;
}
.tag {
  margin-left: auto;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--bg, #fbfbfa);
  color: var(--muted, #757570);
  font: 400 11.5px/1.3 var(--mono, ui-monospace, "SF Mono", Menlo, monospace);
}
.tag + .tag {
  margin-left: 0;
}

.controls {
  display: flex;
  justify-content: center;
  gap: 34px;
  margin-top: 22px;
}
.ctl {
  display: grid;
  justify-items: center;
  gap: 8px;
}
.ctl button {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  cursor: pointer;
}
.ctl button svg {
  width: 22px;
  height: 22px;
}
.ctl button:focus-visible {
  outline: 2px solid var(--accent, #22c55e);
  outline-offset: 3px;
}
.ctl-main {
  border: 0;
  background: var(--ink, #111111);
  color: var(--surface, #ffffff);
}
.ctl-ghost {
  border: 1px solid var(--border, #e6e6e2);
  background: var(--surface, #ffffff);
  color: var(--ink, #111111);
}
.ctl-ghost:hover {
  border-color: var(--muted, #757570);
}
.ctl-label {
  font: 400 12.5px/1 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--muted, #757570);
}
.ctl-ghost.confirm {
  border-color: #c9423e;
  color: #c9423e;
}
.ctl-label.confirm {
  color: #c9423e;
}

.done {
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: 80px 0;
  font: 500 17px/1.4 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--ink, #111111);
}
.again {
  padding: 10px 18px;
  border-radius: 999px;
  background: var(--ink, #111111);
  color: var(--surface, #ffffff);
  font: 500 14px/1 var(--sans, ui-sans-serif, system-ui, sans-serif);
  text-decoration: none;
}

.card-foot {
  display: flex;
  align-items: center;
  margin-top: 18px;
  min-height: 28px;
}
.ends {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font: 400 12.5px/1 var(--mono, ui-monospace, "SF Mono", Menlo, monospace);
  color: var(--muted, #757570);
}
.ends svg {
  width: 15px;
  height: 15px;
}
.fs {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  background: transparent;
  color: var(--muted, #757570);
  cursor: pointer;
}
.fs:hover {
  color: var(--ink, #111111);
}
.fs:focus-visible {
  outline: 2px solid var(--accent, #22c55e);
  outline-offset: 2px;
}
.fs svg {
  width: 18px;
  height: 18px;
}

.rail {
  display: grid;
  gap: 20px;
}
.card {
  border: 1px solid var(--border, #e6e6e2);
  border-radius: 14px;
  background: var(--surface, #ffffff);
  padding: 18px 20px;
}
.card-head {
  display: flex;
  align-items: center;
  margin-bottom: 14px;
}
.card-head h2 {
  margin: 0;
  font: 500 15px/1.3 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--ink, #111111);
}
.count {
  margin-left: auto;
  min-width: 24px;
  padding: 3px 7px;
  border-radius: 7px;
  background: var(--bg, #fbfbfa);
  border: 1px solid var(--border, #e6e6e2);
  color: var(--ink, #111111);
  font: 400 12px/1.2 var(--mono, ui-monospace, "SF Mono", Menlo, monospace);
  text-align: center;
}

.join {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.join input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 11px;
  border: 1px solid var(--border, #e6e6e2);
  border-radius: 8px;
  background: var(--surface, #ffffff);
  font: 400 14px/1 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--ink, #111111);
}
.join input:focus-visible {
  outline: 2px solid var(--accent, #22c55e);
  outline-offset: 1px;
}
.join button {
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 8px;
  background: var(--ink, #111111);
  color: var(--surface, #ffffff);
  font: 500 13.5px/1 var(--sans, ui-sans-serif, system-ui, sans-serif);
  cursor: pointer;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.people {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.people li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 2px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent, #22c55e);
  flex: none;
}
.who {
  font: 500 14px/1.3 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--ink, #111111);
}
.you {
  margin-left: auto;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--accent-soft, rgba(34, 197, 94, 0.14));
  color: var(--accent, #22c55e);
  font: 500 11.5px/1 var(--sans, ui-sans-serif, system-ui, sans-serif);
}
.empty {
  margin: 4px 0 0;
  font: 400 13px/1.5 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--muted, #757570);
}
.err-inline {
  margin: 8px 0 0;
  font: 400 12.5px/1.4 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: #c9423e;
}

.plan {
  list-style: none;
  margin: 0;
  padding: 0;
}
.plan li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 10px;
  border-radius: 9px;
}
.plan li + li {
  margin-top: 12px;
}
.plan li + li::before {
  content: "";
  position: absolute;
  left: 26px;
  top: -12px;
  width: 1px;
  height: 12px;
  background: var(--border, #e6e6e2);
}
.num {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--bg, #fbfbfa);
  border: 1px solid var(--border, #e6e6e2);
  color: var(--muted, #757570);
  font: 400 12.5px/1 var(--mono, ui-monospace, "SF Mono", Menlo, monospace);
  flex: none;
}
.kind {
  font: 500 14px/1.3 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--ink, #111111);
}
.mins {
  margin-left: auto;
  font: 400 13px/1 var(--sans, ui-sans-serif, system-ui, sans-serif);
  color: var(--muted, #757570);
  font-variant-numeric: tabular-nums;
}
.plan li.cur {
  background: var(--accent-soft, rgba(34, 197, 94, 0.12));
}
.plan li.cur .num {
  background: var(--accent, #22c55e);
  border-color: var(--accent, #22c55e);
  color: #ffffff;
}

@media (max-width: 880px) {
  .room-grid {
    grid-template-columns: 1fr;
  }
}
</style>
