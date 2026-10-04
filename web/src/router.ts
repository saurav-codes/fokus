import { createRouter, createWebHistory } from "vue-router";
import Dashboard from "./pages/Dashboard.vue";
import Home from "./pages/Home.vue";
import Room from "./pages/Room.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: Home },
    { path: "/dashboard", name: "dashboard", component: Dashboard },
    { path: "/session/:id", name: "room", component: Room },
  ],
});
