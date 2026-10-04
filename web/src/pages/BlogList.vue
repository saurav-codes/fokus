<script setup lang="ts">
import { posts } from "../blog";

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
</script>

<template>
  <section class="wrap blog">
    <header class="blog-head">
      <h1>Blog</h1>
      <p>Practical focus: methods, rhythms, and how to run shared sessions.</p>
    </header>
    <ul class="post-list">
      <li v-for="p in posts" :key="p.slug">
        <RouterLink :to="`/blog/${p.slug}`" class="post-link">
          <h2>{{ p.title }}</h2>
          <p>{{ p.description }}</p>
          <time :datetime="p.publishedAt">{{ fmtDate(p.publishedAt) }}</time>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.blog-head h1 {
  font-size: 40px;
  letter-spacing: -0.03em;
  margin: 0 0 8px;
}
.blog-head p {
  color: var(--muted);
  margin: 0 0 32px;
}
.post-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}
.post-link {
  display: block;
  padding: 20px 22px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  text-decoration: none;
  color: var(--ink);
  transition: border-color 0.15s;
}
.post-link:hover {
  border-color: var(--accent);
}
.post-link h2 {
  font-size: 19px;
  margin: 0 0 6px;
}
.post-link p {
  color: var(--muted);
  margin: 0 0 8px;
  font-size: 14px;
}
.post-link time {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
