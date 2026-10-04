import { createRouter, createWebHistory } from "vue-router";
import BlogList from "./pages/BlogList.vue";
import BlogPost from "./pages/BlogPost.vue";
import Dashboard from "./pages/Dashboard.vue";
import Home from "./pages/Home.vue";
import Room from "./pages/Room.vue";

declare module "vue-router" {
  interface RouteMeta {
    title?: string;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "home",
      component: Home,
      meta: { title: "fokus — focus together" },
    },
    {
      path: "/dashboard",
      name: "dashboard",
      component: Dashboard,
      meta: { title: "dashboard — fokus" },
    },
    {
      path: "/session/:id",
      name: "room",
      component: Room,
      meta: { title: "room — fokus" },
    },
    {
      path: "/blog",
      name: "blog",
      component: BlogList,
      meta: { title: "blog — fokus" },
    },
    {
      path: "/blog/:slug",
      name: "blog-post",
      component: BlogPost,
    },
  ],
});

router.afterEach((to) => {
  document.title = to.meta.title ?? "fokus";
});
