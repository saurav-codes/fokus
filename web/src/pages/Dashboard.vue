<template>
  <div class="wrap dash">
    <h1 class="h2">Dashboard</h1>
    <div class="stats">
      <div class="stat">
        <p class="label">Sessions run</p>
        <p class="value">{{ stats.sessions }}</p>
      </div>
      <div class="stat">
        <p class="label">Total focus</p>
        <p class="value">{{ formatFocusTime(stats.focusMs) }}</p>
      </div>
      <div class="stat">
        <p class="label">Average session</p>
        <p class="value">{{ formatFocusTime(stats.avgSessionMs) }}</p>
      </div>
    </div>

    <div v-if="sessions.length">
      <div class="sessions-list">
        <router-link
          class="session-row"
          :to="`/session/${session.id}`"
          v-for="session in sessions"
          :key="session.id"
        >
          <span class="tech">{{ session.technique }}</span>
          <span class="pill" :class="session.state === 'completed' ? 'pill-ok' : 'pill-warn'">
            {{ session.state }}
          </span>
          <span class="when">{{ timeAgo(session.createdAtMs) }}</span>
        </router-link>
      </div>
    </div>

    <div class="card" v-else>
      <h3>Nothing yet</h3>
      <p class="muted" style="margin-top: 6px">Start your first shared session.</p>
      <router-link class="btn btn-dark btn-sm" to="/" style="margin-top: 14px">New session</router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getJson } from "../api";
import { formatFocusTime } from "../clock";

type MeResponse = {
  user: { id: number } | null;
  stats: { sessions: number; focusMs: number; avgSessionMs: number };
  sessions: { id: string; technique: string; state: string; createdAtMs: number }[];
};

const stats = ref({ sessions: 0, focusMs: 0, avgSessionMs: 0 });
const sessions = ref<MeResponse["sessions"]>([]);

function timeAgo(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

onMounted(async () => {
  const me = await getJson<MeResponse>("/api/me");
  stats.value = me.stats;
  sessions.value = me.sessions;
});
</script>
