<template>
  <header class="nav">
    <div class="wrap nav-inner">
      <router-link class="logo" to="/" aria-label="fokus home">
        <svg class="logo-mark" viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r="19" fill="none" stroke="currentColor" stroke-width="7" />
          <circle cx="22" cy="22" r="5" fill="currentColor" />
        </svg>
        <span>fokus</span>
      </router-link>
      <nav class="nav-links" aria-label="Primary">
        <router-link to="/">New session</router-link>
        <router-link to="/dashboard">Dashboard</router-link>
      </nav>
    </div>
  </header>
  <main id="main">
    <router-view />
  </main>
  <footer class="footer">
    <div class="wrap footer-inner">
      <svg class="logo-mark-sm" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="19" fill="none" stroke="currentColor" stroke-width="7" />
        <circle cx="22" cy="22" r="5" fill="currentColor" />
      </svg>
      <p>fokus. Free, passwordless, and shared by design.</p>
    </div>
  </footer>
</template>

<script setup lang="ts"></script>
