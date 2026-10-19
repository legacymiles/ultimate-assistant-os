// ---------------------------------------------------------------------------
// Social Personas — one persona per creator identity (a rap channel, an
// explainer channel, a baby-growth diary…), each with the TikTok / Instagram /
// Facebook accounts it posts to and everything the AI has learned from them.
//
// The whole board is one JSON blob (see store.ts) synced through app_state.
// OAuth tokens are NOT in here: they live server-side in server_docs, keyed by
// `Account.connectionId`, so a copy of this blob never carries a credential.
// ---------------------------------------------------------------------------

export type SocialPlatform = "tiktok" | "instagram" | "facebook" | "youtube" | "x";

/** Every platform a persona can hold an account on, in display order. */
export const SOCIAL_PLATFORMS: SocialPlatform[] = ["tiktok", "instagram", "youtube", "facebook", "x"];

/**
 * The platforms whose official login is wired up here (sync + auto-post).
 * The rest are handle + sign-in only, posted with the one-tap manual flow.
 */
export type ConnectablePlatform = "tiktok" | "instagram" | "facebook";
export const CONNECTABLE: ConnectablePlatform[] = ["tiktok", "instagram", "facebook"];
export const isConnectable = (p: string): p is ConnectablePlatform => (CONNECTABLE as string[]).includes(p);

export const PLATFORM_NAME: Record<SocialPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  x: "X",
};

/** Where to go to post by hand, when a platform can't be posted to by API yet. */
export const UPLOAD_URL: Record<SocialPlatform, string> = {
  tiktok: "https://www.tiktok.com/tiktokstudio/upload",
  instagram: "https://www.instagram.com/",
  facebook: "https://www.facebook.com/",
  youtube: "https://studio.youtube.com/",
  x: "https://x.com/compose/post",
};

/** Longest caption each platform takes. */
export const CAPTION_LIMIT: Record<SocialPlatform, number> = {
  tiktok: 2200,
  instagram: 2200,
  facebook: 63206,
  youtube: 5000,
  x: 280,
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
  /**
   * The Recall login (kind "credential") holding this account's username,
   * email and password. The password itself lives in the encrypted Jarvis
   * vault (or, until the vault is set up, on that login) — never in this blob.
   */
  loginItemId?: string;
  /** The connection was made with the posting scopes (auto-post is on). */
  canPost?: boolean;
  /** Follower count over time, one point per sync day. */
  followerHistory?: { at: string; n: number }[];
}

export interface PostStats {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
}

/** The stats a post had at one moment — a sync or a manual update. */
export interface StatSnapshot extends PostStats {
  at: string;
}

/** One piece of content the persona has posted, and what the AI read from it. */
export interface Post {
  id: string;
  platform: SocialPlatform | "other";
  url: string;
  /** The platform's own id, used to de-duplicate re-syncs. */
  externalId?: string;
  caption: string;
  thumbnail?: string | null;
  postedAt?: string | null;
  addedAt: string;
  stats?: PostStats;
  /** Every distinct reading of the stats, oldest first — the video's progress. */
  history?: StatSnapshot[];
  /** The Studio draft this post came from, when it was planned here. */
  draftId?: string;
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

/** Where a piece of content is on its way to being posted. */
export type Stage = "idea" | "script" | "film" | "edit" | "ready" | "scheduled" | "posted";

export const STAGES: { id: Stage; label: string }[] = [
  { id: "idea", label: "Idea" },
  { id: "script", label: "Script" },
  { id: "film", label: "Film" },
  { id: "edit", label: "Edit" },
  { id: "ready", label: "Ready" },
  { id: "scheduled", label: "Scheduled" },
  { id: "posted", label: "Posted" },
];

export interface DraftMedia {
  /** Storage key on the server (bucket social-personas-media). */
  key: string;
  name: string;
  size: number;
  type: string;
}

/** What happened when a draft went (or tried to go) to one account. */
export interface DraftResult {
  accountId: string;
  status: "queued" | "publishing" | "posted" | "inbox" | "manual" | "failed";
  url?: string;
  error?: string;
  at: string;
}

/** One piece of content being made: idea → script → … → posted. */
export interface Draft {
  id: string;
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  outline: string[];
  notes: string;
  stage: Stage;
  /** The persona accounts it goes out on. */
  accountIds: string[];
  /** When it should go out (ISO). */
  scheduledAt: string | null;
  media: DraftMedia | null;
  ideaId?: string;
  results: DraftResult[];
  createdAt: string;
  updatedAt: string;
}

export interface Persona {
  id: string;
  name: string;
  /** The profile overview: who this persona is, in a few sentences (also the bio source). */
  overview: string;
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
  /** The content pipeline and calendar. Newest first. */
  drafts: Draft[];
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
