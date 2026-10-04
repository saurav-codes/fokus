<script setup lang="ts">
import { computed, watchEffect } from "vue";
import { useRoute } from "vue-router";
import { postBySlug } from "../blog";

const route = useRoute();
const post = computed(() => postBySlug(String(route.params.slug ?? "")));

watchEffect(() => {
  document.title = post.value ? `${post.value.title} — fokus` : "blog — fokus";
});
</script>

<template>
  <section class="wrap post">
    <RouterLink to="/blog" class="back">← all posts</RouterLink>
    <article v-if="post" class="body" v-html="post.html" />
    <p v-else class="missing">Post not found.</p>
  </section>
</template>

<style scoped>
.back {
  color: var(--muted);
  text-decoration: none;
  font-size: 13px;
}
.post {
  max-width: 720px;
}
/* v-html content styling */
.body :deep(h1) {
  font-size: 34px;
  letter-spacing: -0.02em;
  margin: 16px 0 20px;
}
.body :deep(h2) {
  font-size: 21px;
  margin: 28px 0 10px;
}
.body :deep(h3) {
  font-size: 16px;
  margin: 20px 0 8px;
}
.body :deep(p),
.body :deep(ul),
.body :deep(table) {
  color: var(--ink);
  font-size: 15px;
  line-height: 1.65;
  margin: 0 0 14px;
}
.body :deep(ul) {
  padding-left: 20px;
}
.body :deep(li) {
  margin-bottom: 4px;
}
.body :deep(table) {
  border-collapse: collapse;
  width: 100%;
}
.body :deep(th),
.body :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 10px;
  text-align: left;
  font-size: 14px;
}
.body :deep(th) {
  background: var(--surface);
  font-weight: 600;
}
.body :deep(a) {
  color: var(--accent);
}
.missing,
.back {
  display: inline-block;
  margin-bottom: 8px;
}
</style>
