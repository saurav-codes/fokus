import bodyDoubling from "./posts-body-doubling";
import choosingRhythm from "./posts-choosing-focus-rhythm";
import deepWork from "./posts-deep-work-session-planning";
import pomodoroGuide from "./posts-pomodoro-complete-guide";
import ultradian from "./posts-ultradian-rhythm";

export interface Post {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  html: string;
}

export const posts: Post[] = [ultradian, pomodoroGuide, bodyDoubling, deepWork, choosingRhythm];

export function postBySlug(slug: string): Post | undefined {
  return posts.find((p) => p.slug === slug);
}
