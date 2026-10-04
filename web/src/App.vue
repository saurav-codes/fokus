<template>
  <header class="nav">
    <div class="wrap nav-inner">
      <router-link class="logo" to="/" aria-label="fokus home">
        <img class="logo-mark" src="/mark.png" alt="" />
        <span>fokus</span>
      </router-link>
      <div class="nav-actions">
        <button class="icon-btn" type="button" @click="toggleTheme" :aria-label="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'">
          <svg v-if="theme === 'dark'" class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
          <svg v-else class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        </button>
        <router-link class="icon-btn" to="/" aria-label="New session">
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </router-link>
        <router-link class="icon-btn" to="/dashboard" aria-label="Dashboard">
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 20V13M12 20V6M19 20v-9" />
          </svg>
        </router-link>
      </div>
    </div>
  </header>
  <main id="main">
    <router-view />
  </main>
  <footer class="footer">
    <div class="wrap footer-inner">
      <img class="logo-mark-sm" src="/mark.png" alt="" />
      <p>fokus · focus together</p>
      <RouterLink to="/blog" class="footer-link">blog</RouterLink>
      <!-- APK lands in web/public once built with Android Studio -->
      <a href="/fokus.apk" download class="footer-link">android app</a>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { ref } from "vue";

type Theme = "light" | "dark";

function initialTheme(): Theme {
  const stored = localStorage.getItem("fokus-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const theme = ref<Theme>(initialTheme());
document.documentElement.dataset.theme = theme.value;

function toggleTheme() {
  theme.value = theme.value === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme.value;
  localStorage.setItem("fokus-theme", theme.value);
}
</script>
