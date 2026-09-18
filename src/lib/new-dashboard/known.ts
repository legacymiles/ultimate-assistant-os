// ---------------------------------------------------------------------------
// What Claude already knows about the hub's owner, gathered from its memory of
// the apps built here. Used ONLY to pre-fill the owner's onboarding as editable
// suggestions — every one is shown as a suggestion the owner confirms or
// rewrites. Nothing here is personal beyond what the hub itself shows publicly.
//
// Deliberately absent: voice samples (the kit forbids anything but a real
// paste) and revenue figures (unknown — guessing money is worse than asking).
// ---------------------------------------------------------------------------

import type { Capability, Intake, Routine } from "./types";

export const OWNER_SUGGESTED_INTAKE: Omit<Intake, "q2"> = {
  q1:
    "I build AI-powered apps and tools with Claude Code, and collect them in one hub — the " +
    "Ultimate Assistant OS (Next.js on Vercel + Supabase), which is also my portfolio. ~30 apps: " +
    "AI video (Auteur, Smart Shot, Seedance Studio), music (Music Creator, Soundprint, Music " +
    "Classified), a second brain (Dashboard/Recall), games (Game Creator for Unreal, 3D Studio), " +
    "trading (Expert Advisor feature specs) and more. Mostly for myself and my family right now; " +
    "the portfolio shows what I can build.",
  q3: [
    "Organise my Claude Code folder into an AI OS so any session finds things fast — by Oct 31",
    "Get Music Creator running end-to-end on a RunPod GPU (YuE2 + voice cloning)",
    "Launch New Dashboard and onboard 3 other people onto their own AI OS",
  ],
  q4: "No revenue yet — the hub is a portfolio. Paid APIs (OpenRouter, Vercel, Supabase, RunPod, fish.audio) are the costs to track.",
  q5: "Gmail, iMessage, and Claude Code itself.",
  q6: "Google Drive, a OneDrive desktop folder (\"claude code files\"), and my Dashboard/Recall app.",
  q7:
    "Re-finding context: which app lives where, which key goes in .env.local, what I decided last " +
    "week. Work is tracked in Projects Timeline, the EA Feature List, and Claude Code sessions.",
};

/** The owner's real, working capabilities — their custom Claude Code skills. */
export const OWNER_CAPABILITIES: Omit<Capability, "id">[] = [
  { name: "/website-redesigner", trigger: "redesign this site <url>", output: "3 redesign directions + build prompt" },
  { name: "/prompt-architect", trigger: "turn my idea into a build prompt", output: "paste-ready build prompt" },
  { name: "/gauntlet-loop", trigger: "gauntlet this", output: "builder-vs-critic refined work" },
  { name: "/video-analyzer", trigger: "watch this YouTube link", output: "summary / transcript / steps" },
  { name: "/social-link-import", trigger: "import from this TikTok/IG link", output: "structured record in an app" },
  { name: "/unreal-game-builder", trigger: "build me a game where…", output: "packaged Unreal .exe" },
  { name: "/animation-director", trigger: "make a 3D video of…", output: "rendered MP4 via Blender" },
  { name: "/ai-os-dashboard", trigger: "onboard someone onto an AI OS", output: "context files + dashboard profile" },
];

/** Things that genuinely run without being asked. Empty lastRun = not yet proven. */
export const OWNER_ROUTINES: Omit<Routine, "id">[] = [
  { name: "iPhone photo inbox → Dashboard (Shortcut push)", schedule: "On every new photo", lastRun: "" },
];
