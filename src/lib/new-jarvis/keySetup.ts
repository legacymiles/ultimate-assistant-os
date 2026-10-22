// ---------------------------------------------------------------------------
// The onboarding "Keys" step — which keys to ask for, where each one is got,
// and the three ways in.
//
//   Get key    → opens the provider's own key page in a new tab.
//   Paste      → the value goes straight to .env.local on the PC through the
//                local agent (never to a model, never to Supabase), and a
//                ready `NAME=value` line is copied for Vercel.
//   Jarvis     → hands the super-agent chat the whole job: open the page in
//                the automation browser, make the key, put it where it goes.
//
// Pure, so the step, the checklist and the tests agree.
// ---------------------------------------------------------------------------

import { CAPABILITIES, read, type Capability, type Reading } from "@/lib/armory/catalog";

export interface KeyStep {
  /** What to do, in plain words. */
  text: string;
  /** The exact page for this step, opened by its button. */
  url?: string;
  /** The button's label. Defaults to "Open". */
  cta?: string;
}

export interface KeySource {
  /** Who issues it, as the owner would say it. */
  site: string;
  /** The page where the key is made. */
  url: string;
  /** One line on what to click once there. */
  how: string;
  /** Optional shape check — a prefix the real key always has. */
  prefix?: string;
  /** Free, or what it costs, in a few words. */
  cost?: string;
  /**
   * The whole walk-through, each step with a button to the exact page, for
   * keys that take more than one page to make (Google's take three).
   */
  steps?: KeyStep[];
}

/** The last step for every key on the live site: where it goes on Vercel. */
export const VERCEL_STEP: KeyStep = {
  text: "On the live site, add it in Vercel: your project → Settings → Environment Variables, then Redeploy.",
  url: "https://vercel.com/dashboard",
  cta: "Open Vercel",
};

/** Where each key is got. Names only; values never live in this file. */
export const KEY_SOURCES: Record<string, KeySource> = {
  OPENROUTER_API_KEY: {
    site: "OpenRouter",
    url: "https://openrouter.ai/settings/keys",
    how: "Create key → copy it. Add a few dollars of credit or answers stop.",
    prefix: "sk-or-",
    cost: "Pay as you go",
    steps: [
      { text: "Sign in to OpenRouter (Google sign-in works).", url: "https://openrouter.ai/sign-in", cta: "Sign in" },
      { text: "Add a few dollars of credit, or answers stop.", url: "https://openrouter.ai/settings/credits", cta: "Add credit" },
      { text: "Create a key named Jarvis and copy it.", url: "https://openrouter.ai/settings/keys", cta: "Create key" },
    ],
  },
  AI_GATEWAY_API_KEY: {
    site: "Vercel AI Gateway",
    url: "https://vercel.com/dashboard/ai-gateway",
    how: "AI Gateway → API keys → Create key.",
  },
  COMPOSIO_API_KEY: {
    site: "Composio",
    url: "https://platform.composio.dev",
    how: "Settings → API keys → copy the project key.",
  },
  NEXT_PUBLIC_SUPABASE_URL: {
    site: "Supabase",
    url: "https://supabase.com/dashboard/project/_/settings/api",
    how: "Project settings → API → copy the Project URL.",
    prefix: "https://",
  },
  NEXT_PUBLIC_SUPABASE_ANON_KEY: {
    site: "Supabase",
    url: "https://supabase.com/dashboard/project/_/settings/api",
    how: "Project settings → API → copy the anon public key.",
  },
  SUPABASE_SERVICE_ROLE_KEY: {
    site: "Supabase",
    url: "https://supabase.com/dashboard/project/_/settings/api",
    how: "Project settings → API → reveal and copy the service_role key.",
  },
  FISH_API_KEY: {
    site: "Fish Audio",
    url: "https://fish.audio/app/api-keys",
    how: "API keys → Create → copy.",
  },
  MINIMAX_API_KEY: {
    site: "MiniMax",
    url: "https://www.minimax.io/platform",
    how: "Account → API keys → Create new secret key.",
  },
  TOMTOM_API_KEY: {
    site: "TomTom",
    url: "https://developer.tomtom.com/user/me/apps",
    how: "My apps → copy the key of your default app.",
  },
  RESEND_API_KEY: {
    site: "Resend",
    url: "https://resend.com/api-keys",
    how: "Create API key → Sending access → copy.",
    prefix: "re_",
  },
  TICKETMASTER_API_KEY: {
    site: "Ticketmaster",
    url: "https://developer.ticketmaster.com/",
    how: "Sign in → My Apps → copy the Consumer Key.",
  },
  YOUTUBE_API_KEY: {
    site: "Google Cloud",
    url: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    how: "Turn on YouTube Data API v3, then Credentials → Create credentials → API key.",
    prefix: "AIza",
    cost: "Free (10,000 lookups a day)",
    steps: [
      { text: "Sign in to Google Cloud and make a project (any name, e.g. Jarvis). Skip if you have one.", url: "https://console.cloud.google.com/projectcreate", cta: "New project" },
      { text: "Turn on YouTube Data API v3: press Enable.", url: "https://console.cloud.google.com/apis/library/youtube.googleapis.com", cta: "Enable API" },
      { text: "Create credentials → API key, then copy it (it starts with AIza).", url: "https://console.cloud.google.com/apis/credentials", cta: "Create key" },
      { text: "Optional but safer: on that key, Restrict key → YouTube Data API v3 → Save.", url: "https://console.cloud.google.com/apis/credentials", cta: "Restrict" },
    ],
  },
  AUDD_API_TOKEN: {
    site: "AudD",
    url: "https://dashboard.audd.io/",
    how: "Sign up → copy the API token from the dashboard.",
    cost: "A few free lookups a day without it; paid plans for more",
    steps: [
      { text: "Sign up at AudD (email or Google).", url: "https://dashboard.audd.io/", cta: "Sign up" },
      { text: "Copy the API token shown on your dashboard.", url: "https://dashboard.audd.io/", cta: "Open dashboard" },
    ],
  },
  NEXT_PUBLIC_GOOGLE_API_KEY: {
    site: "Google Cloud",
    url: "https://console.cloud.google.com/apis/credentials",
    how: "Create credentials → API key → restrict it to Places.",
  },
};

/**
 * Which capabilities the step asks about, in the order it asks.
 *
 * Not the whole armory — eighty keys in a welcome flow is a reason to close
 * it. The first is the one everything needs; the rest are the ones that switch
 * on a whole feature the owner will notice.
 */
export const ESSENTIAL = ["openrouter"] as const;
export const SETUP_CAPABILITIES = ["openrouter", "composio", "supabase", "youtube", "tts", "video-h3", "maps", "alerts", "events"];

/**
 * Every capability switched on by a key we can say where to get — what
 * Profile › Connections lists. Onboarding asks only the SETUP_CAPABILITIES.
 */
export function connectionRows(keys: Record<string, boolean>): KeyRow[] {
  const env = { keys, bridge: {}, bridgeUp: false };
  const order = [...SETUP_CAPABILITIES, ...CAPABILITIES.map((c) => c.id).filter((id) => !SETUP_CAPABILITIES.includes(id))];
  return order
    .map((id) => CAPABILITIES.find((c) => c.id === id))
    // Key-based ones, plus the few that work without a key but get better with
    // one (the song finder), so their key has a guide too.
    .filter((c): c is Capability => Boolean(c) && (c!.via === "key" || (c!.optional ?? []).some((k) => KEY_SOURCES[k])))
    .map((capability) => {
      const reading = read(capability, env);
      const firstRoute = capability.anyOf?.[0] ?? capability.needs ?? capability.optional ?? [];
      const ask = (reading.missing.length ? reading.missing : firstRoute).filter((k) => KEY_SOURCES[k]);
      return { capability, reading, essential: (ESSENTIAL as readonly string[]).includes(capability.id), ask };
    })
    .filter((r) => r.ask.length > 0);
}

/** The walk-through for one key: its own steps, or one step from url + how. Always ends on Vercel. */
export function stepsFor(name: string): KeyStep[] {
  const s = KEY_SOURCES[name];
  if (!s) return [];
  const own = s.steps ?? [{ text: s.how, url: s.url, cta: `Open ${s.site}` }];
  return [...own, { text: "Paste it into the box below and press Save." }, VERCEL_STEP];
}

export interface KeyRow {
  capability: Capability;
  reading: Reading;
  essential: boolean;
  /** The keys to ask for now — the cheapest route still missing, else the first route. */
  ask: string[];
}

export function keyRows(keys: Record<string, boolean>): KeyRow[] {
  const env = { keys, bridge: {}, bridgeUp: false };
  return SETUP_CAPABILITIES.map((id) => CAPABILITIES.find((c) => c.id === id))
    .filter((c): c is Capability => Boolean(c))
    .map((capability) => {
      const reading = read(capability, env);
      const firstRoute = capability.anyOf?.[0] ?? capability.needs ?? [];
      // Only keys we can say where to get. A self-hosted URL is not a sign-up.
      const ask = (reading.missing.length ? reading.missing : firstRoute).filter((k) => KEY_SOURCES[k]);
      return { capability, reading, essential: (ESSENTIAL as readonly string[]).includes(capability.id), ask };
    })
    .filter((r) => r.ask.length > 0 || r.reading.status === "live");
}

/** True once the one key everything needs is set. */
export function thinkingReady(keys: Record<string, boolean>): boolean {
  return Boolean(keys.OPENROUTER_API_KEY || keys.AI_GATEWAY_API_KEY);
}

/** A reason not to save, or "" when the value looks like a key. */
export function checkKey(name: string, raw: string): string {
  const v = raw.trim();
  if (!v) return "Paste the key first.";
  if (/\s/.test(v)) return "That has spaces or line breaks in it — copy just the key.";
  if (v.length < 8) return "That looks too short to be a key.";
  if (/^[A-Z_]+=/.test(v)) return `Paste only the value, not "${v.split("=")[0]}=".`;
  const p = KEY_SOURCES[name]?.prefix;
  if (p && !v.startsWith(p)) return `${KEY_SOURCES[name].site} keys start with "${p}". Check you copied the right one.`;
  return "";
}

/**
 * Set one line of a .env file, keeping every other line exactly as it was.
 *
 * Replaces an existing `NAME=` line (commented-out copies are left alone),
 * otherwise appends. Values with characters a dotenv parser would split on are
 * quoted.
 */
export function upsertEnvLine(text: string, name: string, value: string): string {
  const v = /[\s#"'=]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  const line = `${name}=${v}`;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.length ? text.split(/\r?\n/) : [];
  const at = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?${name}\\s*=`).test(l));
  if (at >= 0) {
    lines[at] = line;
    return lines.join(eol);
  }
  // Append before a trailing blank line so the file still ends in a newline.
  if (lines.length && lines[lines.length - 1] === "") lines.splice(lines.length - 1, 0, line);
  else lines.push(line, "");
  return lines.join(eol);
}

/**
 * The job handed to the super-agent when the owner says "Jarvis, do it".
 *
 * Written as an instruction a model can follow without this conversation:
 * where to go, what to make, where it goes, and when to stop and hand back.
 */
export function agentTaskForKeys(names: string[]): string {
  const lines = names
    .filter((n) => KEY_SOURCES[n])
    .map((n) => `- ${n} from ${KEY_SOURCES[n].site} (${KEY_SOURCES[n].url}) — ${KEY_SOURCES[n].how}`);
  return [
    `Set up my API key${names.length === 1 ? "" : "s"} for Jarvis. Use the browser.`,
    ...lines,
    "For each one: open the page, and if I'm not signed in, stop and tell me to sign in in the browser window — never type a password. Create the key and name it \"Jarvis\".",
    "Then add it to my Vercel project ultimate-assistant-os under Settings → Environment Variables (Production, Preview and Development), and to .env.local in the repo root on this PC (keep every other line as it is).",
    "Ask me before anything that costs money or can't be undone. When you're done, tell me which keys you added and remind me to redeploy on Vercel.",
  ].join("\n");
}
