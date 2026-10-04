<template>
  <section class="wrap builder">
    <div class="builder-grid">
      <div class="card">
        <div class="card-head">
          <h2>New session</h2>
          <p>Choose a focus technique and configure your session.</p>
        </div>
        <div class="field" style="margin-bottom: 16px">
          <label for="tech">Technique</label>
          <div class="select-wrap">
            <svg class="lead-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="4.5" />
              <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
            </svg>
            <select id="tech" v-model="technique">
              <option v-for="t in techniques" :key="t" :value="t">{{ t }}</option>
            </select>
            <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
        <div class="stepper-grid">
          <div class="field">
            <label for="h">Hours</label>
            <div class="stepper">
              <button type="button" @click="hours = Math.max(0, (hours || 0) - 1)" aria-label="Decrease hours">−</button>
              <input id="h" type="number" min="0" max="17" v-model.number="hours" />
              <button type="button" @click="hours = Math.min(17, (hours || 0) + 1)" aria-label="Increase hours">+</button>
            </div>
          </div>
          <div class="field">
            <label for="m">Minutes</label>
            <div class="stepper">
              <button type="button" @click="minutes = Math.max(0, (minutes || 0) - 1)" aria-label="Decrease minutes">−</button>
              <input id="m" type="number" min="0" max="59" v-model.number="minutes" />
              <button type="button" @click="minutes = Math.min(59, (minutes || 0) + 1)" aria-label="Increase minutes">+</button>
            </div>
          </div>
        </div>
        <div v-if="isCamel" style="display: grid; gap: 10px; margin-top: 18px">
          <label class="check">
            <input type="checkbox" v-model="distributeLong" />
            <span>Give extra time to long focus cycles</span>
          </label>
          <label class="check">
            <input type="checkbox" v-model="distributeShort" />
            <span>Give extra time to short focus cycles</span>
          </label>
          <label class="check">
            <input type="checkbox" v-model="distributeLast" />
            <span>Give extra time to the closing 25/5/25/5 cycles</span>
          </label>
        </div>
        <p class="err" v-if="error" style="margin-top: 16px">{{ error }}</p>
      </div>

      <div class="card" v-if="cycles.length">
        <div class="card-head">
          <h2>Your cycles</h2>
          <p>Define the sequence of focus and break cycles.</p>
        </div>
        <div class="cycle-table">
          <div class="cycle-row" v-for="(cycle, index) in cycles" :key="index">
            <span class="order">{{ index + 1 }}</span>
            <div class="sel">
              <select v-model="cycle.type" :aria-label="`Cycle ${index + 1} type`">
                <option value="FOCUS">Focus</option>
                <option value="BREAK">Break</option>
              </select>
              <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
            <div class="min-field">
              <input type="number" min="1" max="600" v-model.number="cycle.minutes" :aria-label="`Cycle ${index + 1} minutes`" />
              <span>min</span>
            </div>
            <button class="del" type="button" @click="removeCycle(index)" :aria-label="`Remove cycle ${index + 1}`">
              <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
        </div>
        <button class="btn btn-outline btn-sm" style="margin-top: 14px" @click="addCycle">
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add cycle
        </button>
        <div class="cycle-sum">
          <span>Total</span>
          <strong>{{ formatTotal }}</strong>
        </div>
        <button class="btn btn-accent" style="width: 100%; margin-top: 18px; height: 52px; font-size: 15.5px" @click="startSession" :disabled="starting">
          Start session
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  </section>

  <RoomCreatedModal v-if="createdPath" :path="createdPath" @close="createdPath = ''" />
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { postJson } from "../api";
import RoomCreatedModal from "../components/RoomCreatedModal.vue";

const techniques = [
  "Camel",
  "Pomodoro",
  "52/17 Method",
  "90-Minute Focus Sessions",
  "2-Hour Focus Blocks",
  "Flowtime Technique",
  "Custom Technique",
] as const;

const technique = ref<string>("Camel");
const hours = ref(1);
const minutes = ref(0);
const distributeLong = ref(false);
const distributeShort = ref(false);
const distributeLast = ref(false);
const cycles = ref<{ type: string; minutes: number }[]>([]);
const error = ref("");
const starting = ref(false);
const createdPath = ref("");

const isCamel = computed(() => technique.value === "Camel");
const formatTotal = computed(() => {
  const total = cycles.value.reduce((sum, cycle) => sum + (Number(cycle.minutes) || 0), 0);
  const h = Math.floor(total / 60);
  return h > 0 ? `${h}h ${total % 60}m` : `${total}m`;
});

function newCycle(type: string) {
  return { type, minutes: type === "BREAK" ? 5 : 25 };
}

function addCycle() {
  const last = cycles.value.at(-1);
  cycles.value.push(newCycle(!last || last.type === "BREAK" ? "FOCUS" : "BREAK"));
}

function removeCycle(index: number) {
  cycles.value.splice(index, 1);
}

let debounce: ReturnType<typeof setTimeout> | undefined;
let requestId = 0;

async function generate() {
  const id = ++requestId;
  error.value = "";
  try {
    const totalMinutes = Math.max(0, hours.value) * 60 + Math.max(0, minutes.value);
    const result = await postJson<{ cycles: { type: string; minutes: number }[] }>(
      "/api/techniques/preview",
      {
        technique: technique.value,
        totalMinutes,
        distributeLong: distributeLong.value,
        distributeShort: distributeShort.value,
        distributeLast: distributeLast.value,
      },
    );
    if (id === requestId) cycles.value = result.cycles;
  } catch (err) {
    if (id === requestId) error.value = (err as Error).message;
  }
}

// re-preview on any input change, debounced
watch([technique, hours, minutes, distributeLong, distributeShort, distributeLast], () => {
  clearTimeout(debounce);
  debounce = setTimeout(generate, 150);
});

async function startSession() {
  error.value = "";
  starting.value = true;
  try {
    const result = await postJson<{ id: string }>("/api/sessions", {
      technique: technique.value,
      cycles: cycles.value,
    });
    createdPath.value = `/session/${result.id}`;
    starting.value = false;
  } catch (err) {
    error.value = (err as Error).message;
    starting.value = false;
  }
}

// preview on mount
generate();
</script>
