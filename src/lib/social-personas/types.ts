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
 * The platforms whose official login is wired up here (sync, and the Message
 * Inbox where the platform allows it). The rest are handle + sign-in only,
 * posted with the one-tap manual flow.
 */
export type ConnectablePlatform = "tiktok" | "instagram" | "facebook" | "youtube";
export const CONNECTABLE: ConnectablePlatform[] = ["tiktok", "instagram", "facebook", "youtube"];
export const isConnectable = (p: string): p is ConnectablePlatform => (CONNECTABLE as string[]).includes(p);

/** The connectable platforms that can also auto-post. YouTube connects for syncing and comments only. */
export type PostablePlatform = "tiktok" | "instagram" | "facebook";
export const canAutoPost = (p: string): p is PostablePlatform => p === "tiktok" || p === "instagram" || p === "facebook";

/** The connectable platforms whose messages and comments can be read and answered in the Message Inbox. */
export type InboxPlatform = "instagram" | "facebook" | "youtube";
export const hasInbox = (p: string): p is InboxPlatform => p === "instagram" || p === "facebook" || p === "youtube";

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
  /** The connection was made with the messaging/comment scopes (Message Inbox is on). */
  canInbox?: boolean;
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
  /** Stamped when the agent planned this post — closes the learning loop, so a
   *  result can be attributed to the exact creative decision being tested. A
   *  lever recorded at generation time beats one re-derived afterwards. */
  fromIdeaId?: string;
  leverKeys?: string[];
  basedOnLessonVersion?: number;
  aboutMeVersion?: number;
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

/** Why this idea is in today's batch. The split is enforced, not suggested. */
export type IdeaRole = "exploit" | "explore" | "wildcard";

export interface Idea {
  id: string;
  title: string;
  hook: string;
  format: string;
  outline: string[];
  why: string;
  platform: SocialPlatform | "any";
  status: IdeaStatus;
  /** The ready-to-post caption, for a text or image post. */
  caption?: string;
  /** The persona's own first comment — a lever in its own right. */
  firstComment?: string;
  /** Which levers this idea is testing, so the next review can attribute it. */
  leverKeys?: string[];
  role?: IdeaRole;
  /** The lesson set and character version in force when it was written. */
  basedOnLessonVersion?: number;
  aboutMeVersion?: number;
  /** Set when the policy guard refused it. Shown with the reason, never
   *  silently dropped — a silent filter looks like the agent going quiet. */
  blockedReason?: string;
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

// --- the self-improvement loop ---------------------------------------------

/**
 * The dimensions a post can be sliced on — closed, so the taxonomy cannot
 * fragment into free text and stay groupable. A lever is `dim:value`.
 */
export type LeverDim =
  | "format"
  | "hookType"
  | "topic"
  | "media"
  | "postSlot"
  | "captionLen"
  | "ctaStyle"
  | "firstComment"
  | "emoji";

export const LEVER_DIMS: LeverDim[] = [
  "format",
  "hookType",
  "topic",
  "media",
  "postSlot",
  "captionLen",
  "ctaStyle",
  "firstComment",
  "emoji",
];

export const LEVER_DIM_NAME: Record<LeverDim, string> = {
  format: "Format",
  hookType: "Hook type",
  topic: "Topic",
  media: "Media",
  postSlot: "Post time",
  captionLen: "Caption length",
  ctaStyle: "How it closes",
  firstComment: "Seeded first comment",
  emoji: "Emoji",
};

/**
 * How much the data has earned the right to be believed.
 *
 * `prior` is the format library's stated assumption with no data behind it,
 * shown as an assumption so a belief is never mistaken for a finding.
 */
export type LeverTier = "prior" | "unproven" | "emerging" | "proven" | "proven-loser";

export const TIER_NAME: Record<LeverTier, string> = {
  prior: "assumed",
  unproven: "too early",
  emerging: "emerging",
  proven: "proven",
  "proven-loser": "proven loser",
};

/** One lever's measured effect, after deconfounding and shrinkage. */
export interface LeverEffect {
  /** "format:deliberately-wrong-fact" — stable across runs. */
  key: string;
  dim: LeverDim;
  value: string;
  label: string;
  /** Matured posts carrying this lever. */
  n: number;
  /** Shrunk, deconfounded effect in score units (baseline 0). */
  effect: number;
  /** 90% interval on that effect. Ranking uses ciLo, never the mean. */
  ciLo: number;
  ciHi: number;
  tier: LeverTier;
  evidencePostIds: string[];
}

/** One thing the agent believes, in a sentence, with its proof attached. */
export interface Lesson {
  id: string;
  key: string;
  dim: LeverDim;
  value: string;
  label: string;
  effect: number;
  n: number;
  ciLo: number;
  ciHi: number;
  tier: LeverTier;
  /** Plain English, one sentence. This is what the owner reads. */
  statement: string;
  evidencePostIds: string[];
  source: "data" | "prior" | "owner";
  /** The lesson this one replaced, so a change of mind is traceable. */
  supersedesId?: string;
  createdAt: string;
}

/**
 * One immutable snapshot of everything the agent believes.
 *
 * Append-only: nothing is overwritten, and the DIFF between two versions is
 * the visible self-improvement. Without that the loop is a black box claiming
 * to have learned something.
 */
export interface LessonSet {
  version: number;
  generatedAt: string;
  day: string;
  lessons: Lesson[];
  postsConsidered: number;
  postsScored: number;
  /** Too young or too little reach to score yet — shown, never hidden. */
  postsMaturing: number;
  /** Median engagement rate as a percentage, for the owner's eyes. */
  baselineRate: number;
  /** Median composite score — the series behind the "is it improving?" chart. */
  medianScore: number;
  diff: {
    learned: string[];
    changedMind: string[];
    promoted: string[];
    retired: string[];
  };
  note: string;
}

/** The objective and the gates. Per persona, because a trolling agent wants
 *  comments where a fitness page wants saves and shares. */
export interface LearnSettings {
  wComments: number;
  wShares: number;
  wLikes: number;
  /** A post is not scored until it has had this long to be seen. */
  minAgeHours: number;
  /** Nor until this many people have seen it. */
  reachFloor: number;
  /** Idea slots per batch that must test something untested. Never 0. */
  exploreFloor: number;
}

export const DEFAULT_LEARN: LearnSettings = {
  wComments: 0.5,
  wShares: 0.35,
  wLikes: 0.15,
  minAgeHours: 48,
  reachFloor: 300,
  exploreFloor: 1,
};

/** One saved state of the character document. */
export interface AboutMeVersion {
  version: number;
  at: string;
  markdown: string;
}

export interface Persona {
  id: string;
  name: string;
  /**
   * The job this persona does, and the shelf it is filed under on the home
   * screen — "Trolling agent", "Fitness influencer". Several personas can
   * share one nickname; the groups are derived from this field rather than
   * stored separately, so a rename can never orphan a group.
   */
  nickname: string;
  /** The handle shown beside the picture, without the @. */
  username: string;
  /** Profile picture: a data URL, or a path under /public. */
  avatar: string | null;
  /**
   * The character document, in markdown: how it talks, what it never says,
   * what it is for. Injected VERBATIM into every generation ahead of the
   * engagement data — the numbers may change what it talks about, never how
   * it sounds.
   */
  aboutMe: string;
  aboutMeVersion: number;
  /** Newest first. */
  aboutMeHistory: AboutMeVersion[];
  /** Newest first. The head is what the agent currently believes. */
  lessonLog: LessonSet[];
  learn: LearnSettings;
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
  /**
   * Message Inbox settings. Only what this person chose and what they've read
   * is kept here; the messages themselves stay on the platforms and on this
   * device's cache, never in the synced blob.
   */
  inbox?: PersonaInbox;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaInbox {
  /** "Open inbox" shortcuts turned on for apps that can't be read here (Tinder, TikTok…), in the order added. */
  apps: string[];
  /** Thread id → the newest message time already seen, so unread survives across devices. */
  seen: Record<string, string>;
}

export interface Board {
  version: 1;
  personas: Persona[];
  /** Display order of the nickname groups on the home screen. The groups
   *  themselves are derived from the personas; this only remembers the
   *  arrangement. */
  nicknameOrder?: string[];
  /**
   * Ids of shipped personas the owner has deleted.
   *
   * The studio seeds personas by their absence (see store.loadBoard), so a
   * deletion that leaves no record of itself is undone on the next load — the
   * persona comes back, which reads as the app ignoring the owner.
   */
  dismissed?: string[];
}

/** The current lesson set, or null before the first review. */
export function currentLessons(p: Persona): LessonSet | null {
  return p.lessonLog?.[0] ?? null;
}

/** Starting points offered when creating a persona. */
export interface PersonaPreset {
  /** The shelf this preset files a new persona under. */
  nickname: string;
  niche: string;
  contentTypes: string[];
  audience: string;
  tone: string;
}

export const PRESETS: PersonaPreset[] = [
  {
    nickname: "Trolling agent",
    niche: "Confidently incorrect facts that hijack the comments",
    contentTypes: ["deliberately wrong fact", "impossible choice", "wrong nostalgia", "trick riddle", "mild food take"],
    audience: "Facebook feed, 35-65, who cannot let a wrong answer stand",
    tone: "Flat, certain, never explains the joke, never argues — doubles down",
  },
  {
    nickname: "Music artist",
    niche: "Rap music videos",
    contentTypes: ["music video", "verse snippet", "studio session", "behind the scenes"],
    audience: "Hip-hop fans 16-30",
    tone: "Confident, raw, punchy",
  },
  {
    nickname: "Explainer",
    niche: "Explainer videos",
    contentTypes: ["explainer", "myth vs fact", "how it works", "quick tip"],
    audience: "Curious people who want it simple",
    tone: "Clear, friendly, fast",
  },
  {
    nickname: "Family diary",
    niche: "Baby growth videos",
    contentTypes: ["month-by-month update", "milestone", "day in the life", "parent tip"],
    audience: "New and expecting parents",
    tone: "Warm, honest, gentle humour",
  },
  {
    nickname: "Funny story guy",
    niche: "Comedy skits",
    contentTypes: ["skit", "POV", "relatable moment", "character bit"],
    audience: "Broad, 18-35",
    tone: "Playful, quick, surprising",
  },
  {
    nickname: "Fitness influencer",
    niche: "Fitness & training",
    contentTypes: ["workout", "form check", "transformation", "meal prep"],
    audience: "Beginners to intermediates",
    tone: "Motivating, no-nonsense",
  },
];
