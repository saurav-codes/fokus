<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="room-created-title">
      <button class="modal-close" type="button" @click="emit('close')" aria-label="Close">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <div class="check-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h2 id="room-created-title">Room created</h2>
      <p>Your focus room is ready. Share the link with others to join.</p>
      <div class="url-field">
        <input :value="url" readonly :aria-label="copied ? 'Room link copied' : 'Room link'" @focus="selectLink" />
        <button type="button" @click="copy" :aria-label="copied ? 'Copied' : 'Copy link'">
          <svg v-if="copied" class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <svg v-else class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" @click="copy">
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
          </svg>
          {{ copied ? "Copied" : "Copy link" }}
        </button>
        <button class="btn btn-ghost" type="button" @click="share">
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4" />
          </svg>
          Share
        </button>
      </div>
      <button class="btn btn-dark open-btn" type="button" @click="openRoom">
        Open room
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

const props = defineProps<{ path: string }>();
const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const url = computed(() => `${window.location.origin}${props.path}`);
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

function selectLink(event: FocusEvent) {
  (event.target as HTMLInputElement).select();
}

async function copy() {
  try {
    await navigator.clipboard.writeText(url.value);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), 2000);
  } catch {
    /* clipboard denied: keep the field so the user can copy manually */
  }
}

async function share() {
  if (navigator.share) {
    try {
      await navigator.share({ title: "fokus focus room", url: url.value });
      return;
    } catch {
      /* cancelled or failed: fall back to clipboard */
    }
  }
  await copy();
}

function openRoom() {
  emit("close");
  router.push(props.path);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  clearTimeout(copiedTimer);
});
</script>
