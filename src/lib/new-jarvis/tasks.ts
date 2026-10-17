// ---------------------------------------------------------------------------
// Priorities — things the owner asked to be kept at the top of In Queue until
// they are done.
//
// Unlike apps, skills and workflows, a task has no evidence to derive a state
// from, so it is amber until either `done: true` is written here or the owner
// clicks its pip on the board. Lower `priority` sits higher.
// ---------------------------------------------------------------------------

import type { QueueFact } from "./queue";

export interface PinnedTask {
  /** Stable — the owner's verdict is filed under `task:<id>`. */
  id: string;
  name: string;
  /** What "done" means, in one or two sentences. */
  blurb: string;
  priority: number;
  href?: string;
  done?: boolean;
}

export const PINNED_TASKS: PinnedTask[] = [
  {
    id: "iphone-setup-video",
    name: "iPhone setup video",
    blurb:
      "A short screen recording of building the “Send to Jarvis” Shortcut and the Camera-closed automation, playing inside the iPhone setup guide. Record it on the iPhone (Control Centre › Screen Recording), upload the mp4, and set NEXT_PUBLIC_IPHONE_SETUP_VIDEO.",
    priority: 1,
    href: "/apps/new-jarvis#iphone",
  },
  {
    id: "iphone-shortcut-link",
    name: "One-tap “Send to Jarvis” Shortcut",
    blurb:
      "Build the Shortcut once, share it as an iCloud link with an import question that asks for the user's link, and set NEXT_PUBLIC_IPHONE_SHORTCUT_URL — then setup for anyone is tap Add Shortcut and paste.",
    priority: 2,
    href: "/apps/new-jarvis#iphone",
  },
];

export function taskFacts(tasks: PinnedTask[] = PINNED_TASKS): QueueFact[] {
  return tasks.map((t) => ({
    id: `task:${t.id}`,
    kind: "task" as const,
    name: t.name,
    blurb: t.blurb,
    group: "Priority",
    href: t.href,
    signals: { done: t.done === true, priority: t.priority },
  }));
}
