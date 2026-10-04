<template>
  <div class="wrap room">
    <p class="err" v-if="notFoundError">This room does not exist. Start a new one.</p>

    <div class="room-grid" v-else-if="payload">
      <div class="card-dark timer-card">
        <div class="timer-head">
          <span class="pill" :class="statePillClass">{{ payload.state }}</span>
          <span class="pill">{{ payload.technique }}</span>
          <span class="conn" :class="connection">{{ connectionText }}</span>
        </div>

        <template v-if="payload.state !== 'completed'">
          <div class="countdown">{{ countdown }}</div>
          <div class="progress">
            <span
              :style="{ width: progressPct + '%' }"
              :class="{ 'is-focus': currentType === 'FOCUS' }"
            />
          </div>
          <div class="chips">
            <span class="chip" v-if="payload.currentCycle">
              <span class="muted"
                >Cycle {{ payload.currentCycle.order }} of {{ payload.cycles.length }}</span
              >
              <span>{{ payload.currentCycle.type === 'FOCUS' ? 'focus' : 'break' }} mode</span>
            </span>
          </div>
          <div class="controls" v-if="isOwner">
            <button class="btn btn-light" @click="toggle">
              {{ payload.state === 'paused' ? 'Resume' : 'Pause' }}
            </button>
            <button class="btn btn-ghost-light" @click="skip">Skip</button>
            <button class="btn btn-ghost-light" @click="askStop">
              {{ stopConfirm ? 'Really stop?' : 'Stop' }}
            </button>
          </div>
          <div class="timer-foot" v-if="payload.willFinishAtMs">
            <span v-if="payload.state === 'paused'">paused</span>
            <span v-else>will land at {{ finishTime }}</span>
            <span>{{ countdown }}</span>
          </div>
        </template>

        <div class="completed-note" v-else>
          <strong>Session done.</strong>
          <router-link class="btn btn-light" to="/">Start a new session</router-link>
        </div>
      </div>

      <div class="side">
        <div class="card">
          <h3>In this room</h3>
          <div class="join-form" v-if="!joined">
            <input v-model="nameInput" placeholder="Your name" maxlength="60" @keyup.enter="join" />
            <button class="btn btn-dark btn-sm" @click="join">Join</button>
          </div>
          <div class="followers">
            <div class="follower" v-for="follower in followers" :key="follower.username">
              <span class="dot" />
              <span>{{ follower.username }}</span>
            </div>
            <p class="muted" style="font-size: 13.5px" v-if="!followers.length">
              Nobody here yet. Send the link.
            </p>
          </div>
          <p class="err" v-if="error" style="margin-top: 12px">{{ error }}</p>
        </div>

        <div class="card">
          <h3>All cycles</h3>
          <div class="cycle-list">
            <div
              class="cycle-item"
              :class="{ cur: cycle.order === payload.currentCycle?.order }"
              v-for="cycle in payload.cycles"
              :key="cycle.order"
            >
              <span class="muted">#{{ cycle.order }}</span>
              <span class="what">{{ cycle.type.toLowerCase() }}</span>
              <span class="muted">{{ Math.round(cycle.durationMs / 60000) }}m</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { getJson } from "../api";
import { computeRemainingMs, formatCountdown, type SyncedPayload } from "../clock";

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
const progressPct = ref(0);
const stopConfirm = ref(false);

let ws: WebSocket | null = null;
let offset = 0;
let tick: ReturnType<typeof setInterval> | null = null;
let retry: ReturnType<typeof setInterval> | null = null;

const connectionText = computed(() =>
  connection.value === "on" ? "live" : connection.value === "connecting" ? "connecting" : "offline",
);
const currentType = computed(() => payload.value?.currentCycle?.type ?? "FOCUS");
const statePillClass = computed(() =>
  payload.value?.state === "paused" ? "pill-warn" : "pill-ok",
);
const finishTime = computed(() =>
  payload.value?.willFinishAtMs
    ? new Date(payload.value.willFinishAtMs).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "",
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

function updateClock() {
  const view = payload.value;
  if (!view) return;
  const remaining = computeRemainingMs(view, offset, Date.now());
  countdown.value = formatCountdown(remaining);
  const duration = view.currentCycle?.durationMs ?? 0;
  progressPct.value = duration > 0 ? ((duration - remaining) / duration) * 100 : 0;
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
  } catch (err) {
    notFoundError.value = (err as Error).message;
  }
});

onUnmounted(() => {
  ws?.close();
  if (tick) clearInterval(tick);
  if (retry) clearInterval(retry);
  document.removeEventListener("visibilitychange", onVisibility);
  document.title = "fokus";
});
</script>
