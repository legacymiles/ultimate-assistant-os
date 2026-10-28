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
  /** Share another row's request folder, e.g. "flow:animate-my-character". */
  folder?: string;
  done?: boolean;
}

export const PINNED_TASKS: PinnedTask[] = [
  {
    id: "test-animate-my-character",
    name: "Test the Kids Animation Flow",
    blurb:
      "The Studio card: pick it, attach a character, type the story and press Make the storyboard — the flow opens, then Send to my PC. "
      + "Then in Claude Code on the PC say “work my Jarvis queue” — it renders with the animate-character-story skill "
      + "and the request leaves the queue when the MP4 exists. Type story ideas for it in this row's folder.",
    priority: 0,
    href: "/apps/jarvis#studio",
    folder: "flow:animate-my-character",
  },
  {
    id: "test-film-3d",
    name: "Test the 3D Animation Flow",
    blurb:
      "The Studio card: pick “3D Animation Flow”, attach a character, type the story and press Make the storyboard — the 3D film plays live. "
      + "Press Make it now to render the MP4 in the browser; or Send to my PC and say “work my Jarvis queue” in Claude Code — it renders "
      + "in HD with the threejs-film-story skill. Type story ideas for it in this row's folder.",
    priority: 0,
    href: "/apps/jarvis#studio",
    folder: "flow:film-3d",
  },
  {
    id: "test-custom-video-swap",
    name: "Test Custom Video Swap",
    blurb:
      "The Studio card (Recast & build): pick “Custom Video Swap”, drop a short clip, a face photo and a background picture, say who becomes who, press Open the swap — "
      + "everything lands in its slot. Tap the person on the frame, press Make it (the clip uploads with the job). Then in Claude Code on the PC say "
      + "“work my Jarvis queue” — it runs the custom-video-swap skill (Viggle → H3 plate → matte) and the before | after appears on the screen.",
    priority: 0,
    href: "/apps/jarvis#studio",
    folder: "flow:custom-video-swap",
  },
  {
    id: "test-workflow-maker",
    name: "Test the Workflow Maker",
    blurb:
      "The Studio card (Recast & build): pick “Workflow Maker”, drop a video of a money-making or step-by-step process and say what you want, press Watch it — "
      + "the blueprint appears (inputs, stages with engines, the card). Edit it, press Build it, then “work my Jarvis queue” in Claude Code builds the tool "
      + "with the rea-to-workflow skill.",
    priority: 0,
    href: "/apps/jarvis#studio",
    folder: "flow:workflow-maker",
  },
  {
    id: "iphone-setup-video",
    name: "iPhone setup video",
    blurb:
      "A short screen recording of building the “Send to Jarvis” Shortcut and the Camera-closed automation, playing inside the iPhone setup guide. Record it on the iPhone (Control Centre › Screen Recording), upload the mp4, and set NEXT_PUBLIC_IPHONE_SETUP_VIDEO.",
    priority: 1,
    href: "/apps/jarvis#iphone",
  },
  {
    id: "iphone-shortcut-link",
    name: "One-tap “Send to Jarvis” Shortcut",
    blurb:
      "Build the Shortcut once, share it as an iCloud link with an import question that asks for the user's link, and set NEXT_PUBLIC_IPHONE_SHORTCUT_URL — then setup for anyone is tap Add Shortcut and paste.",
    priority: 2,
    href: "/apps/jarvis#iphone",
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
    folder: t.folder,
    signals: { done: t.done === true, priority: t.priority },
  }));
}
