// ---------------------------------------------------------------------------
// Social Personas — one persona per creator identity (a rap channel, an
// explainer channel, a baby-growth diary…), each with the TikTok / Instagram /
// Facebook accounts it posts to and everything the AI has learned from them.
//
// The whole board is one JSON blob (see store.ts) synced through app_state.
// OAuth tokens are NOT in here: they live server-side in server_docs, keyed by
// `Account.connectionId`, so a copy of this blob never carries a credential.
// ---------------------------------------------------------------------------

export type SocialPlatform = "tiktok" | "instagram" | "facebook";

export const SOCIAL_PLATFORMS: SocialPlatform[] = ["tiktok", "instagram", "facebook"];

export const PLATFORM_NAME: Record<SocialPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
};

export interface Account {
  id: string;
  platform: SocialPlatform;
  handle: string;
  url: string;
  /** Set once the account is connected through the platform's own login. */
  connectionId?: string;
  displayName?: string;
  followers?: number | null;
  lastSyncAt?: string;
}

export interface PostStats {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
}

/** One piece of content the persona has posted, and what the AI read from it. */
export interface Post {
  id: string;
  platform: SocialPlatform | "youtube" | "other";
  url: string;
  /** The platform's own id, used to de-duplicate re-syncs. */
  externalId?: string;
  caption: string;
  thumbnail?: string | null;
  postedAt?: string | null;
  addedAt: string;
  stats?: PostStats;
  /** How it got here. */
  source: "sync" | "link" | "manual";
  /** Filled by the analyzer. */
  title?: string;
  format?: string;
  topic?: string;
  hook?: string;
  summary?: string;
  /** True when a model actually watched the video, not just read the caption. */
  watched?: boolean;
  analyzedAt?: string;
}

/** What the AI knows about the persona, built from the profile + posts. */
export interface Brain {
  summary: string;
  pillars: string[];
  whatWorks: string[];
  voice: string;
  gaps: string[];
  updatedAt: string;
  postCount: number;
  /** "ai" = written by a model; "heuristic" = offline keyword pass. */
  by: "ai" | "heuristic";
}

export type IdeaStatus = "new" | "saved" | "made" | "skipped";

export interface Idea {
  id: string;
  title: string;
  hook: string;
  format: string;
  outline: string[];
  why: string;
  platform: SocialPlatform | "any";
  status: IdeaStatus;
}

export interface IdeaDay {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  ideas: Idea[];
  by: "ai" | "heuristic";
}

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface Persona {
  id: string;
  name: string;
  /** One line: "Rap music videos", "Baby growth diary"… */
  niche: string;
  contentTypes: string[];
  audience: string;
  tone: string;
  goals: string;
  /** Things the AI must never suggest. */
  avoid: string;
  hue: number;
  accounts: Account[];
  posts: Post[];
  brain: Brain | null;
  ideaDays: IdeaDay[];
  chat: ChatMsg[];
  createdAt: string;
  updatedAt: string;
}

export interface Board {
  version: 1;
  personas: Persona[];
}

/** Starting points offered when creating a persona. */
export interface PersonaPreset {
  niche: string;
  contentTypes: string[];
  audience: string;
  tone: string;
}

export const PRESETS: PersonaPreset[] = [
  {
    niche: "Rap music videos",
    contentTypes: ["music video", "verse snippet", "studio session", "behind the scenes"],
    audience: "Hip-hop fans 16-30",
    tone: "Confident, raw, punchy",
  },
  {
    niche: "Explainer videos",
    contentTypes: ["explainer", "myth vs fact", "how it works", "quick tip"],
    audience: "Curious people who want it simple",
    tone: "Clear, friendly, fast",
  },
  {
    niche: "Baby growth videos",
    contentTypes: ["month-by-month update", "milestone", "day in the life", "parent tip"],
    audience: "New and expecting parents",
    tone: "Warm, honest, gentle humour",
  },
  {
    niche: "Comedy skits",
    contentTypes: ["skit", "POV", "relatable moment", "character bit"],
    audience: "Broad, 18-35",
    tone: "Playful, quick, surprising",
  },
  {
    niche: "Fitness & training",
    contentTypes: ["workout", "form check", "transformation", "meal prep"],
    audience: "Beginners to intermediates",
    tone: "Motivating, no-nonsense",
  },
];
