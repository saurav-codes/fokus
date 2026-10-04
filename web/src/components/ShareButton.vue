<template>
  <button
    type="button"
    class="fab"
    :class="{ copied }"
    @click="copy"
    :aria-label="copied ? 'Link copied' : 'Copy room link'"
    :title="copied ? 'Copied' : 'Copy link'"
  >
    <svg v-if="copied" class="ic" aria-hidden="true">
      <use href="/icons.svg#i-check" />
    </svg>
    <svg
      v-else
      class="ic"
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      stroke-width="16"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="180" cy="50" r="27" />
      <circle cx="64" cy="128" r="27" />
      <circle cx="180" cy="206" r="27" />
      <path d="M88 110 156 70" />
      <path d="M88 146 156 186" />
    </svg>
  </button>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from "vue";

const copied = ref(false);
let reset: ReturnType<typeof setTimeout> | null = null;

async function copy() {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // clipboard API needs https or focus; fall back to a selection copy
    const el = document.createElement("textarea");
    el.value = url;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    el.remove();
  }
  copied.value = true;
  if (reset) clearTimeout(reset);
  reset = setTimeout(() => (copied.value = false), 1600);
}

onUnmounted(() => {
  if (reset) clearTimeout(reset);
});
</script>

<style scoped>
.fab {
  position: fixed;
  right: 26px;
  bottom: 26px;
  z-index: 60;
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border: 1px solid var(--border, #e6e6e2);
  border-radius: 50%;
  background: var(--surface, #ffffff);
  color: var(--ink, #111111);
  cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease;
}
.fab:hover {
  color: var(--accent, #22c55e);
  border-color: var(--accent, #22c55e);
}
.fab:focus-visible {
  outline: 2px solid var(--accent, #22c55e);
  outline-offset: 3px;
}
.fab.copied {
  color: var(--accent, #22c55e);
  border-color: var(--accent, #22c55e);
}
.fab .ic {
  width: 22px;
  height: 22px;
}
</style>
