// ---------------------------------------------------------------------------
// Everything Jarvis can reach, and whether it can reach it right now.
//
// The walkthrough this came from shows a wall of vendor logos with
// connect / connected badges. Most of those would be decoration here: a Canva
// tile with a button that does nothing is worse than no tile, because it makes
// the whole grid untrustworthy — if one badge is theatre, none of them mean
// anything.
//
// What is actually true in this repo is more useful. There are ~80 documented
// keys, each switching on something real, and most of them are off. So this
// catalog answers the question worth asking: WHAT CAN IT DO RIGHT NOW, AND
// WHAT IS ONE KEY AWAY — grouped by what the capability lets the owner do
// rather than by who sells it.
//
// It is also the source the self-audit reads for "features switched off for
// want of a key", which was a hardcoded empty list until this existed.
//
// Pure. The server reports which key NAMES are set — never a value — and the
// status is worked out here where it can be tested.
// ---------------------------------------------------------------------------

export type Category =
  | "thinking"
  | "memory"
  | "apps"
  | "machine"
  | "voice"
  | "phone"
  | "pictures"
  | "money"
  | "social"
  | "world";

export const CATEGORY_LABEL: Record<Category, string> = {
  thinking: "Thinking",
  memory: "Memory & sync",
  apps: "Your apps",
  machine: "This machine",
  voice: "Voice",
  phone: "Phone",
  pictures: "Pictures & video",
  money: "Money",
  social: "Social",
  world: "The world",
};

/** How a capability is switched on. */
export type Via =
  /** One or more environment keys. */
  | "key"
  /** The local bridge process, not a key at all. */
  | "bridge"
  /** An OAuth connection through Composio. */
  | "connector"
  /** Already working, with nothing to configure. */
  | "built-in";

export interface Capability {
  id: string;
  name: string;
  /** What it lets the owner DO. Not what it is. */
  what: string;
  category: Category;
  via: Via;
  /** Every one of these must be set. */
  needs?: string[];
  /** Any ONE of these is enough — alternative providers for the same job. */
  anyOf?: string[][];
  /** Nice to have; their absence degrades rather than disables. */
  optional?: string[];
  /** For `connector`: the Composio toolkit slug. */
  slug?: string;
  /** For `bridge`: which capability the bridge reports. */
  capability?: "browser" | "shell" | "files" | "system" | "vault";
  /** What the owner loses while it is off. Shown on the tile. */
  without?: string;
}

/**
 * The catalog.
 *
 * Deliberately not generated from .env.example: a key name is not a capability,
 * and the sentence explaining what the owner gets is the entire value of this
 * surface. Paths and data directories are left out — they are configuration,
 * not things Jarvis can or cannot do.
 */
export const CAPABILITIES: Capability[] = [
  // --- thinking ------------------------------------------------------------
  {
    id: "openrouter",
    name: "Thinking",
    what: "Every answer, every agent step, every document it reads.",
    category: "thinking",
    via: "key",
    anyOf: [["OPENROUTER_API_KEY"], ["AI_GATEWAY_API_KEY"]],
    without: "Jarvis cannot answer anything. Everything else here still works.",
  },
  {
    id: "embeddings",
    name: "Meaning search",
    what: "Finding a memory by what it meant rather than the words in it.",
    category: "thinking",
    via: "key",
    needs: ["OPENROUTER_API_KEY"],
    without: "Search falls back to matching words, which is worse but not broken.",
  },

  // --- memory --------------------------------------------------------------
  {
    id: "supabase",
    name: "Cross-device memory",
    what: "The same folders, lists and vault on your phone as on your laptop.",
    category: "memory",
    via: "key",
    needs: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    without: "Everything stays on this one browser.",
  },
  {
    id: "server-docs",
    name: "Shared boards",
    what: "The family lists, the app password, and anything other people write.",
    category: "memory",
    via: "key",
    needs: ["SUPABASE_SERVICE_ROLE_KEY"],
    without: "Lists are yours alone and cannot be shared.",
  },
  {
    id: "vault",
    name: "Obsidian vault",
    what: "Your notes as the source of truth, read and written on this machine.",
    category: "memory",
    via: "bridge",
    capability: "vault",
    without: "The graph shows the index only, and nothing can be written to disk.",
  },

  // --- your apps -----------------------------------------------------------
  {
    id: "composio",
    name: "Your accounts",
    what: "Mail, calendar, Slack, Notion and the rest — read and acted on through one key.",
    category: "apps",
    via: "key",
    needs: ["COMPOSIO_API_KEY"],
    optional: ["COMPOSIO_USER_ID"],
    without: "Jarvis cannot see an inbox or a real calendar. It still has your own folders and lists.",
  },

  // --- this machine --------------------------------------------------------
  {
    id: "bridge-browser",
    name: "A real browser",
    what: "Opens pages signed in as you, reads them, clicks and fills them in.",
    category: "machine",
    via: "bridge",
    capability: "browser",
    without: "It can only read pages that need no login.",
  },
  {
    id: "bridge-shell",
    name: "The command line",
    what: "Runs commands on this PC and reads the real output.",
    category: "machine",
    via: "bridge",
    capability: "shell",
  },
  {
    id: "bridge-files",
    name: "Your files",
    what: "Lists folders, reads and writes files on this machine.",
    category: "machine",
    via: "bridge",
    capability: "files",
  },
  {
    id: "bridge-system",
    name: "Windows itself",
    what: "Apps, windows, the screen and the clipboard.",
    category: "machine",
    via: "bridge",
    capability: "system",
  },

  // --- voice ---------------------------------------------------------------
  {
    id: "listening",
    name: "Listening",
    what: "Waits for its name and hears the sentence after it.",
    category: "voice",
    via: "built-in",
    without: "Needs Chrome, Edge or Safari — it is the browser that listens, not a key.",
  },
  {
    id: "tts",
    name: "Its own voice",
    what: "Answers aloud in a real voice rather than the browser's robot.",
    category: "voice",
    via: "key",
    anyOf: [["FISH_API_KEY"], ["TTS_SELF_HOST_URL"]],
    optional: ["FISH_MODEL", "TTS_BACKEND", "TTS_SELF_HOST_KEY"],
    without: "It still speaks, using the browser's built-in voice.",
  },

  // --- phone ---------------------------------------------------------------
  {
    id: "calls",
    name: "Ringing your phone",
    what: "Calls you when something genuinely cannot wait.",
    category: "phone",
    via: "key",
    anyOf: [
      ["RETELL_API_KEY", "RETELL_AGENT_ID", "RETELL_FROM_NUMBER"],
      ["VAPI_API_KEY", "VAPI_ASSISTANT_ID", "VAPI_PHONE_NUMBER_ID"],
      ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_VOICE_URL"],
    ],
    optional: ["JARVIS_CALL_TO_NUMBER", "JARVIS_CALL_WEBHOOK_SECRET", "JARVIS_CALL_PROVIDER"],
    without: "Nothing rings — but it still shows you every call it would have made, and why it declined the rest.",
  },

  // --- pictures and video --------------------------------------------------
  {
    id: "images",
    name: "Drawing",
    what: "Makes pictures — icons, storyboards, reference sheets.",
    category: "pictures",
    via: "key",
    needs: ["OPENROUTER_API_KEY"],
  },
  {
    id: "video-h3",
    name: "Video",
    what: "Turns a still and a prompt into a moving shot.",
    category: "pictures",
    via: "key",
    anyOf: [["MINIMAX_API_KEY"], ["RUNPOD_API_KEY", "RUNPOD_ENDPOINT_ID"], ["MUAPI_API_KEY"]],
    optional: ["MINIMAX_VIDEO_MODEL", "MINIMAX_API_BASE"],
    without: "Studio can plan a film but not render one. Local WanGP still works through the bridge.",
  },
  {
    id: "ffmpeg",
    name: "Cutting video",
    what: "Trims, stitches, loops and compresses — the free half of the pipeline.",
    category: "pictures",
    via: "bridge",
    capability: "shell",
    optional: ["FFMPEG_PATH"],
    without: "Needs the local agent; ffmpeg runs on this machine, not in the cloud.",
  },
  {
    id: "ytdlp",
    name: "Downloading a link",
    what: "Pulls the actual video behind a TikTok, Instagram or YouTube link.",
    category: "pictures",
    via: "bridge",
    capability: "shell",
    optional: ["YTDLP_PATH", "YTDLP_COOKIES_INSTAGRAM", "YTDLP_COOKIES_FACEBOOK", "COBALT_API_URL"],
    without: "Needs the local agent.",
  },

  // --- money ---------------------------------------------------------------
  {
    id: "plaid",
    name: "Your bank",
    what: "Real transactions, so the ledger is not typed in by hand.",
    category: "money",
    via: "key",
    needs: ["PLAID_CLIENT_ID", "PLAID_SECRET"],
    optional: ["PLAID_ENV", "PLAID_WEBHOOK_URL", "FINANCE_ENC_KEY", "PLAID_WEBHOOK_URL"],
    without: "Finance runs on the bills you declare yourself.",
  },
  {
    id: "alerts",
    name: "Email alerts",
    what: "Sends you a message when something in the money folder needs you.",
    category: "money",
    via: "key",
    needs: ["RESEND_API_KEY"],
    optional: ["FINANCE_ALERT_EMAIL"],
  },

  // --- social --------------------------------------------------------------
  {
    id: "tiktok",
    name: "TikTok",
    what: "Posting and reading as you.",
    category: "social",
    via: "key",
    needs: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  },
  {
    id: "instagram",
    name: "Instagram",
    what: "Posting and reading as you.",
    category: "social",
    via: "key",
    needs: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
  },
  {
    id: "facebook",
    name: "Facebook",
    what: "Posting and reading as you.",
    category: "social",
    via: "key",
    needs: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
  },

  // --- the world -----------------------------------------------------------
  {
    id: "youtube",
    name: "YouTube picks",
    what: "Real YouTube videos in YouTube videos › For you, picked from what you save.",
    category: "world",
    via: "key",
    needs: ["YOUTUBE_API_KEY"],
    without: "For you suggests searches instead of real videos.",
  },
  {
    id: "maps",
    name: "Maps & traffic",
    what: "Real routes and travel times.",
    category: "world",
    via: "key",
    needs: ["TOMTOM_API_KEY"],
  },
  {
    id: "events",
    name: "What's on",
    what: "Real events near you, for a night out.",
    category: "world",
    via: "key",
    needs: ["TICKETMASTER_API_KEY"],
  },
  {
    id: "google-maps",
    name: "Places",
    what: "Looking a real place up, with its hours and address.",
    category: "world",
    via: "key",
    needs: ["NEXT_PUBLIC_GOOGLE_API_KEY"],
  },
  {
    id: "signin",
    name: "Sign in with Google",
    what: "One-click sign-in instead of another password.",
    category: "world",
    via: "key",
    needs: ["NEXT_PUBLIC_GOOGLE_CLIENT_ID"],
  },
];

// --- status ----------------------------------------------------------------

export type Status =
  /** Working right now. */
  | "live"
  /** Some of what it needs is set, but not all. The most actionable state there is. */
  | "partial"
  /** Nothing set. One key away. */
  | "off"
  /** Needs the local agent, which is not running. */
  | "needs-pc";

export interface Reading {
  capability: Capability;
  status: Status;
  /** Keys that are set. Names only — never values. */
  have: string[];
  /** Keys still wanted for the cheapest route to "live". */
  missing: string[];
  /** Optional keys not set. Absence degrades rather than disables. */
  missingOptional: string[];
}

export interface Environment {
  /** Key name → whether it is set. Values never travel. */
  keys: Record<string, boolean>;
  /** What the local bridge reports it can do. */
  bridge: Partial<Record<"browser" | "shell" | "files" | "system" | "vault", boolean>>;
  /** True when the bridge is reachable at all. */
  bridgeUp: boolean;
}

/**
 * The cheapest route to switching something on.
 *
 * With alternatives, the one already closest to complete wins — telling someone
 * to go and get a Twilio account when they have two of Retell's three keys set
 * is advice that costs them money for no reason.
 */
function cheapestRoute(capability: Capability, keys: Record<string, boolean>): { have: string[]; missing: string[] } {
  const routes = capability.anyOf ?? (capability.needs ? [capability.needs] : [[]]);
  let best: { have: string[]; missing: string[] } | null = null;

  for (const route of routes) {
    const have = route.filter((k) => keys[k]);
    const missing = route.filter((k) => !keys[k]);
    if (!best) best = { have, missing };
    // Fewest still missing wins; a tie goes to the one with more already set.
    else if (missing.length < best.missing.length || (missing.length === best.missing.length && have.length > best.have.length)) {
      best = { have, missing };
    }
  }
  return best ?? { have: [], missing: [] };
}

export function read(capability: Capability, env: Environment): Reading {
  const { have, missing } = cheapestRoute(capability, env.keys);
  const missingOptional = (capability.optional ?? []).filter((k) => !env.keys[k]);

  if (capability.via === "bridge") {
    const able = capability.capability ? env.bridge[capability.capability] === true : env.bridgeUp;
    return {
      capability,
      status: able ? "live" : "needs-pc",
      have,
      missing,
      missingOptional,
    };
  }

  if (capability.via === "built-in") {
    return { capability, status: "live", have, missing, missingOptional };
  }

  const status: Status = missing.length === 0 ? "live" : have.length > 0 ? "partial" : "off";
  return { capability, status, have, missing, missingOptional };
}

export function readAll(env: Environment): Reading[] {
  return CAPABILITIES.map((c) => read(c, env));
}

/** Every key name the catalog cares about, for the server to check presence of. */
export function allKeyNames(): string[] {
  const names = new Set<string>();
  for (const c of CAPABILITIES) {
    for (const k of c.needs ?? []) names.add(k);
    for (const route of c.anyOf ?? []) for (const k of route) names.add(k);
    for (const k of c.optional ?? []) names.add(k);
  }
  return [...names].sort();
}

// --- summary ---------------------------------------------------------------

export interface ArmorySummary {
  live: number;
  partial: number;
  off: number;
  needsPc: number;
  total: number;
}

export function summarise(readings: Reading[]): ArmorySummary {
  const by = (s: Status) => readings.filter((r) => r.status === s).length;
  return { live: by("live"), partial: by("partial"), off: by("off"), needsPc: by("needs-pc"), total: readings.length };
}

export function describeArmory(summary: ArmorySummary): string {
  const parts = [`${summary.live} of ${summary.total} working`];
  if (summary.partial) parts.push(`${summary.partial} half set up`);
  if (summary.needsPc) parts.push(`${summary.needsPc} waiting on your PC`);
  return `${parts.join(", ")}.`;
}

/**
 * What the self-audit should raise.
 *
 * Only the things that are genuinely one step away: half-configured first,
 * because having two of three keys set is the most annoying state to leave
 * something in and the cheapest to fix.
 */
export function gapsForAudit(readings: Reading[]): { name: string; feature: string }[] {
  return readings
    .filter((r) => r.status === "partial" || r.status === "off")
    .sort((a, b) => (a.status === "partial" ? 0 : 1) - (b.status === "partial" ? 0 : 1) || a.missing.length - b.missing.length)
    .slice(0, 6)
    .map((r) => ({ name: r.missing.join(", "), feature: r.capability.what }));
}

/** Search across the name, what it does, and the key names. */
export function matches(reading: Reading, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    reading.capability.name,
    reading.capability.what,
    CATEGORY_LABEL[reading.capability.category],
    ...(reading.missing ?? []),
    ...(reading.have ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}
