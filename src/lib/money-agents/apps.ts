// ---------------------------------------------------------------------------
// Money Agent Studio — the seven apps inside it.
//
// The studio is not one screen with tabs along the top: it is a small suite,
// and each part is its own app with its own job. This file is the single list
// of them — name, what it does in one line, the accent it wears — plus the
// live line each app shows on its tile ("3 waiting on you", "$1,240 this
// month"), so a glance at the shelf says where the work is.
//
// Pure: no React, no storage, no clock. The shelf renders it, the tests check
// the wording, and the ids are the same ones `?tab=` has always used.
// ---------------------------------------------------------------------------

import { ROOMS } from "@/lib/bible/rooms";
import { money } from "./logic";

export type StudioAppId = "radar" | "approve" | "pipeline" | "agents" | "campaigns" | "earnings" | "bible";

/** Which of the studio's four accents an app wears. Gold is money. */
export type AppAccent = "mint" | "gold" | "blue" | "violet";

export interface StudioApp {
  id: StudioAppId;
  /** The name on the tile. */
  name: string;
  /** What this app does, in one line — the line under the name in the launcher. */
  what: string;
  accent: AppAccent;
}

export const STUDIO_APPS: StudioApp[] = [
  {
    id: "radar",
    name: "Radar",
    what: "The biggest money moves right now, why they are moving, and what is due next.",
    accent: "mint",
  },
  {
    id: "approve",
    name: "Approve",
    what: "Watch every finished video and say yes before anything is ever posted.",
    accent: "gold",
  },
  {
    id: "pipeline",
    name: "Pipeline",
    what: "Every item on its way from idea to posted, and which stage it is sitting in.",
    accent: "blue",
  },
  {
    id: "agents",
    name: "Agents",
    what: "The standing jobs: clippers, faceless channels and campaign clippers.",
    accent: "mint",
  },
  {
    id: "campaigns",
    name: "Campaigns",
    what: "Paid clipping campaigns, their rules, their rate per 1,000 views and the payout.",
    accent: "gold",
  },
  {
    id: "earnings",
    name: "Earnings",
    what: "What has actually been paid, what the views are worth, and by which agent.",
    accent: "gold",
  },
  {
    id: "bible",
    name: "Financial Bible",
    what: "What the money is for: the plans, costed and sourced, and every money play.",
    accent: "violet",
  },
];

export function studioApp(id: StudioAppId): StudioApp {
  const found = STUDIO_APPS.find((a) => a.id === id);
  // The id union makes this unreachable; the fallback keeps the shelf drawable
  // rather than throwing if a stale `?tab=` ever widens the type.
  return found ?? STUDIO_APPS[0];
}

/** Everything the shelf needs to count, gathered once by the studio. */
export interface StudioCounts {
  /** Opportunities on the radar board right now. */
  plays: number;
  /** Move-bot catches today. */
  catches: number;
  /** Items waiting for the owner's Approve. */
  waiting: number;
  /** Items being found, written or made. */
  inFlight: number;
  /** Agents that are not paused. */
  agents: number;
  /** Agents working a paid clipping campaign. */
  campaigns: number;
  paidThisMonth: number;
}

export interface AppStat {
  /** The figure, short enough for a tile. */
  value: string;
  /** What the figure is, in the owner's words. */
  label: string;
  /** True when this app is the one wanting attention. */
  hot: boolean;
}

/**
 * The live line on an app's tile. Never a bare zero dressed up as news: an
 * empty app says so in words ("all clear", "none yet") so the shelf reads
 * honestly at a glance.
 */
export function appStat(id: StudioAppId, c: StudioCounts): AppStat {
  switch (id) {
    case "radar":
      return c.plays > 0
        ? { value: String(c.plays), label: "on the board", hot: c.catches > 0 }
        : { value: "—", label: "scanning", hot: false };
    case "approve":
      return c.waiting > 0
        ? { value: String(c.waiting), label: "waiting on you", hot: true }
        : { value: "0", label: "all clear", hot: false };
    case "pipeline":
      return c.inFlight > 0
        ? { value: String(c.inFlight), label: "in the works", hot: false }
        : { value: "—", label: "nothing in flight", hot: false };
    case "agents":
      return c.agents > 0
        ? { value: String(c.agents), label: c.agents === 1 ? "running" : "agents running", hot: false }
        : { value: "—", label: "none yet", hot: false };
    case "campaigns":
      return c.campaigns > 0
        ? { value: String(c.campaigns), label: c.campaigns === 1 ? "campaign" : "campaigns", hot: false }
        : { value: "—", label: "none joined", hot: false };
    case "earnings":
      return { value: money(c.paidThisMonth), label: "this month", hot: false };
    case "bible":
      return { value: String(ROOMS.length), label: ROOMS.length === 1 ? "room" : "rooms", hot: false };
  }
}

/**
 * The number on an app's tile corner — only for the two things that are
 * genuinely news: work waiting for a yes, and a move the bot caught today.
 */
export function appBadge(id: StudioAppId, c: StudioCounts): number {
  if (id === "approve") return c.waiting;
  if (id === "radar") return c.catches;
  return 0;
}
