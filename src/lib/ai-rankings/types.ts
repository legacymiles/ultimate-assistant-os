// ---------------------------------------------------------------------------
// The Board — shared types.
//
// A record is any tool worth remembering: an AI model, a website, a desktop
// app, an open-source project. Two levels of filing (group › category) because
// one flat list stops working the moment the board is more than AI.
//
// Three facts are kept on separate axes because they vary independently:
//
//   access      what it costs YOU          free | freemium | paid
//   openSource  is the code/weights open   true | false
//   hosting     where it runs              hosted | self-host | both
//
// Flux is open weights AND sells a paid hosted tier; Figma is freemium and
// hosted-only; Obsidian is free, closed, and local. Collapsing these into one
// enum loses exactly the distinction the board exists to make.
// ---------------------------------------------------------------------------

export type Access = "free" | "freemium" | "paid";
export type Hosting = "hosted" | "self-host" | "both";
export type ApiKey = "required" | "optional" | "none";

/**
 * One thing you noticed about a tool. This is what actually drives the ranking:
 * a model that lost the benchmark but owns one feature you rely on keeps its
 * slot because that feature is written down here, with a verdict attached.
 */
export interface Feature {
  id: string;
  text: string;
  /** love = the reason you keep it. miss = the reason you don't reach for it. */
  verdict: "love" | "good" | "miss" | "dealbreaker";
}

export interface Tool {
  id: string;
  name: string;
  url: string;
  /** One line — what it is, in plain terms. */
  summary: string;
  /** Top level of the tree: AI, Dev, Design, Productivity, Media… */
  group: string;
  /** Leaf within the group: Image, Video, Editors, Note-taking… */
  category: string;
  /**
   * Capabilities rather than kinds: `vision`, `long-context`, `lipsync`.
   * Vision lives here on purpose — it cuts across LLM, image and video, so it
   * can't be a category without forcing a false choice.
   */
  tags: string[];
  access: Access;
  openSource: boolean;
  hosting: Hosting;
  apiKey: ApiKey;
  /** Whether you already hold a key for it. */
  haveKey: boolean;
  /** Free text — "$20/mo", "credits", "50 free/day". */
  pricingNote?: string;
  /** Your running log on this tool. Anything that doesn't fit a field. */
  notes?: string;
  /** The scored observations behind the rank. */
  features: Feature[];
  /** 1-based position on its category leaderboard; undefined = unranked. */
  rank?: number;
  /** When YOU added it — this is what makes old-vs-new legible. */
  addedAt: string;
  updatedAt: string;
}

export interface BoardData {
  tools: Tool[];
  /**
   * Groups and their categories, including empty ones. Kept explicitly rather
   * than derived from the tools, so a section you just made doesn't vanish
   * before you've filed anything into it.
   */
  tree: Record<string, string[]>;
}

/** A seed entry before ids and timestamps are stamped on. */
export type SeedTool = Omit<Tool, "id" | "addedAt" | "updatedAt" | "features"> & {
  features?: Omit<Feature, "id">[];
};

// ----- display labels ------------------------------------------------------

export const ACCESS_LABEL: Record<Access, string> = {
  free: "Free",
  freemium: "Free tier",
  paid: "Paid",
};

export const HOSTING_LABEL: Record<Hosting, string> = {
  hosted: "Website",
  "self-host": "Self-host",
  both: "Both",
};

export const API_KEY_LABEL: Record<ApiKey, string> = {
  required: "Required",
  optional: "Optional",
  none: "None",
};

export const VERDICT_LABEL: Record<Feature["verdict"], string> = {
  love: "Why I keep it",
  good: "Good",
  miss: "Missing",
  dealbreaker: "Dealbreaker",
};

/** Group accent hue, used by the sidebar and the rank badges. */
export const GROUP_HUE: Record<string, number> = {
  AI: 265,
  Dev: 200,
  Design: 305,
  Productivity: 155,
  Media: 25,
  Security: 350,
  Trading: 45,
  Web: 190,
};

export function groupHue(group: string): number {
  if (GROUP_HUE[group] !== undefined) return GROUP_HUE[group];
  // Anything the user invents still gets a stable colour of its own.
  let h = 0;
  for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) % 360;
  return h;
}

/** Entries added within this many days are badged NEW. */
export const NEW_DAYS = 30;

export function isNew(tool: Tool, now = Date.now()): boolean {
  const added = new Date(tool.addedAt).getTime();
  if (Number.isNaN(added)) return false;
  return now - added < NEW_DAYS * 24 * 60 * 60 * 1000;
}
