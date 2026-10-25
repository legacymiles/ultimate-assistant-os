// ---------------------------------------------------------------------------
// Money Agent Studio — the shapes, named once.
//
// An AGENT is a standing job that makes money from video: a Clipper (cuts the
// best moments out of long videos), a Faceless channel (ideas → script → a
// voiced explainer, on a cadence) or a Campaign clipper (makes clips for a
// clipping campaign that pays per thousand views). Every agent posts through a
// Personas Studio persona, so accounts, sign-ins and auto-posting live in ONE
// place and are never duplicated here.
//
// An ITEM is one piece of content on its way to money:
//   idea → script → rendering (on the owner's PC, via In Queue) → ready
//   (waiting for the owner's Approve) → approved (handed to Personas Studio)
//   → posted → paid.  Rejected items stay, greyed, so they are not re-made.
//
// Nothing ever posts without the owner's Approve — his rule (Oct 2026).
// ---------------------------------------------------------------------------

export type AgentKind = "clipper" | "faceless" | "campaign";

export const AGENT_KINDS: { id: AgentKind; label: string; short: string; blurb: string }[] = [
  {
    id: "clipper",
    label: "Clipper",
    short: "Clips",
    blurb: "Paste a podcast, stream or long video. It finds the moments people share and cuts them into captioned shorts.",
  },
  {
    id: "faceless",
    label: "Faceless channel",
    short: "Faceless",
    blurb: "Runs a channel with no face on camera: picks topics, writes the script, voices it and makes the video on a schedule.",
  },
  {
    id: "campaign",
    label: "Campaign clipper",
    short: "Campaign",
    blurb: "Makes clips for a paid clipping campaign (paid per 1,000 views), follows its rules and tracks the payout.",
  },
];

export type AgentStatus = "active" | "paused";

export type Aspect = "9:16" | "16:9" | "1:1";

export interface Agent {
  id: string;
  kind: AgentKind;
  name: string;
  status: AgentStatus;
  /** The Personas Studio persona it posts as, and which of its accounts. */
  personaId: string | null;
  accountIds: string[];
  /** What it makes: "Podcast clips about money", "Space facts", … */
  niche: string;
  /** Tone and voice for scripts, captions and hooks. */
  voice: string;
  aspect: Aspect;
  /** Target clip/video length in seconds. */
  minSeconds: number;
  maxSeconds: number;
  /** Videos per week the owner wants from it (faceless cadence). */
  perWeek: number;
  /** Long videos / channels a clipper takes from. Newest first. */
  sources: string[];
  /**
   * Dollars per 1,000 views, for estimates. Campaigns: the campaign's rate.
   * Faceless/clipper: the owner's own RPM guess (0 = don't estimate).
   */
  ratePer1k: number;
  campaign: CampaignInfo | null;
  /** Free text the agent must follow on every item ("no swearing", campaign rules…). */
  rules: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignInfo {
  /** Where the campaign lives (Whop, Vyro, a brand's page…). */
  url: string;
  /** Who runs it. */
  brand: string;
  /** Payout stops at this budget, or 0 when unknown. */
  budget: number;
  /** Views a clip needs before it pays anything (0 = none). */
  minViews: number;
  /** Platforms the campaign pays for. */
  platforms: string[];
  /** The content the campaign wants clipped. */
  contentUrls: string[];
  /** ISO day it ends, or "" when open-ended. */
  endsOn: string;
}

export type ItemStage =
  | "idea"
  | "script"
  | "rendering"
  | "ready"
  | "approved"
  | "posted"
  | "rejected";

export const STAGES: { id: ItemStage; label: string; hint: string }[] = [
  { id: "idea", label: "Idea", hint: "found, not made yet" },
  { id: "script", label: "Script", hint: "written, ready to make" },
  { id: "rendering", label: "Making", hint: "your PC is cutting it" },
  { id: "ready", label: "Approve", hint: "waiting for your yes" },
  { id: "approved", label: "Sent", hint: "in Personas Studio" },
  { id: "posted", label: "Posted", hint: "live, earning" },
];

/** A moment worth clipping, found in a long video. Seconds from the start. */
export interface Moment {
  start: number;
  end: number;
  /** The on-screen hook for the first two seconds. */
  hook: string;
  /** Working title. */
  title: string;
  /** Why it will travel, in one sentence. */
  why: string;
  /** 0-100: how likely it is to be shared. */
  score: number;
  /** The words said in that span, when known. */
  quote: string;
  /** A ready-to-post caption and hashtags, when the AI wrote them. */
  caption?: string;
  hashtags?: string[];
}

export interface Script {
  hook: string;
  /** Spoken lines, in order. */
  beats: string[];
  cta: string;
  /** What goes on screen while each beat is spoken (same order as beats). */
  visuals: string[];
  /** Big words for the thumbnail. */
  thumbnail: string;
  description: string;
}

export interface Item {
  id: string;
  agentId: string;
  kind: "clip" | "video";
  stage: ItemStage;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  /** Clips: the long video and the span. */
  sourceUrl: string;
  start: number | null;
  end: number | null;
  score: number | null;
  why: string;
  /** Faceless videos: the script. */
  script: Script | null;
  /** The In Queue request that is making it on the PC. */
  requestId: string | null;
  /** Set when approved: where it went in Personas Studio. */
  personaId: string | null;
  draftId: string | null;
  /** Views counted by hand when Personas Studio has no synced number. */
  manualViews: number | null;
  createdAt: string;
  updatedAt: string;
}

export type PayoutSource = "campaign" | "youtube" | "tiktok" | "sponsor" | "other";

export const PAYOUT_SOURCES: { id: PayoutSource; label: string }[] = [
  { id: "campaign", label: "Campaign payout" },
  { id: "youtube", label: "YouTube" },
  { id: "tiktok", label: "TikTok" },
  { id: "sponsor", label: "Sponsor / deal" },
  { id: "other", label: "Other" },
];

/** Money that actually arrived. Estimates are computed, never stored. */
export interface Payout {
  id: string;
  agentId: string;
  amount: number;
  /** YYYY-MM-DD the money arrived. */
  date: string;
  source: PayoutSource;
  note: string;
  createdAt: string;
}

export interface Board {
  version: 1;
  agents: Agent[];
  items: Item[];
  payouts: Payout[];
}

/** A clipping campaign found on the web, before the owner adds it. */
export interface FoundCampaign {
  name: string;
  brand: string;
  url: string;
  ratePer1k: number;
  platforms: string[];
  notes: string;
}

/** A faceless video idea, before it becomes an item. */
export interface VideoIdea {
  title: string;
  hook: string;
  angle: string;
  why: string;
}
