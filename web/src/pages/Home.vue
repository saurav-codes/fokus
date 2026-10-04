<template>
  <section class="hero">
    <div class="wrap">
      <h1 class="display">Focus, together.</h1>
      <p class="lede" style="margin-top: 18px">
        Pick a technique, preview the cycles, send the link. Everyone who opens it joins the same
        room and watches the same countdown. Free, no account.
      </p>
    </div>
  </section>

  <section class="wrap builder" id="build">
    <div class="builder-grid">
      <div class="card">
        <h2 class="h2" style="font-size: 26px; margin-bottom: 18px">New session</h2>
        <form @submit.prevent="generate">
          <div class="field" style="margin-bottom: 14px">
            <label for="tech">Technique</label>
            <select id="tech" v-model="technique">
              <option v-for="t in techniques" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
          <div style="display: flex; gap: 12px; margin-bottom: 14px">
            <div class="field">
              <label for="h">Hours</label>
              <input id="h" type="number" min="0" max="17" v-model.number="hours" />
            </div>
            <div class="field">
              <label for="m">Minutes</label>
              <input id="m" type="number" min="0" max="59" v-model.number="minutes" />
            </div>
          </div>
          <div v-if="isCamel" style="display: grid; gap: 8px; margin-bottom: 16px">
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
          <button class="btn btn-dark" type="submit" :disabled="generating">
            Generate cycles
          </button>
        </form>
        <p class="err" v-if="error" style="margin-top: 14px">{{ error }}</p>
      </div>

      <div class="card" v-if="cycles.length">
        <h2 class="h2" style="font-size: 26px; margin-bottom: 14px">Your cycles</h2>
        <div class="cycle-table">
          <div class="cycle-row" v-for="(cycle, index) in cycles" :key="index">
            <span class="order">{{ index + 1 }}</span>
            <select v-model="cycle.type">
              <option value="FOCUS">FOCUS</option>
              <option value="BREAK">BREAK</option>
            </select>
            <input type="number" min="1" max="600" v-model.number="cycle.minutes" />
            <button class="del" type="button" @click="removeCycle(index)" aria-label="Remove cycle">
              <svg class="ic" viewBox="0 0 256 256" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M205.65,61.65a8,8,0,0,0-11.31,0L128,127.66l-66.35-66.35a8,8,0,0,0-11.31,11.31l66.35,66.35-66.35,66.35a8,8,0,1,0,11.31,11.31L128,213.31l66.35,66.35a8,8,0,0,0,11.31-11.31l-66.35-66.35,66.35-66.35A8,8,0,0,0,205.65,61.65Z"
                />
              </svg>
            </button>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" style="margin-top: 12px" @click="addCycle">Add cycle</button>
        <div class="cycle-sum">
          <span>Total</span>
          <strong>{{ formatTotal }}</strong>
        </div>
        <button class="btn btn-dark" style="width: 100%; margin-top: 14px" @click="startSession" :disabled="starting">
          Start session
        </button>
      </div>
    </div>

    <div class="how">
      <div>
        <h3><span class="how-n">Step 1</span>Pick a technique</h3>
        <p>
          Camel builds long and short focus cycles for you. Pomodoro, 52/17, and block timers are
          fixed. Flowtime is one unbroken stretch.
        </p>
      </div>
      <div>
        <h3><span class="how-n">Step 2</span>Tweak the cycles</h3>
        <p>Add, remove, or edit any cycle before you start. Camel leftovers can go to your long or short cycles.</p>
      </div>
      <div>
        <h3><span class="how-n">Step 3</span>Send the link</h3>
        <p>Anyone who opens your link joins the same room and watches the same timer. Good for up to 20 parallel rooms.</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { postJson } from "../api";

const router = useRouter();
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
const generating = ref(false);
const starting = ref(false);

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

async function generate() {
  error.value = "";
  generating.value = true;
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
    cycles.value = result.cycles;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    generating.value = false;
  }
}

async function startSession() {
  error.value = "";
  starting.value = true;
  try {
    const result = await postJson<{ id: string }>("/api/sessions", {
      technique: technique.value,
      cycles: cycles.value,
    });
    router.push(`/session/${result.id}`);
  } catch (err) {
    error.value = (err as Error).message;
    starting.value = false;
  }
}

// preview on mount
generate();
</script>
