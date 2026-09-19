// ---------------------------------------------------------------------------
// Pure logic shared by the client and the API routes: persona context for the
// model, merging synced posts, normalising model output, and the offline
// heuristics that keep the app useful with no AI key.
// ---------------------------------------------------------------------------

import {
  PLATFORM_NAME,
  SOCIAL_PLATFORMS,
  type Brain,
  type Idea,
  type Persona,
  type Post,
  type SocialPlatform,
} from "./types";

export function uid(prefix = ""): string {
  const r =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  return prefix + r;
}

/** Local calendar day as YYYY-MM-DD (not UTC — "today" is the owner's day). */
export function localDay(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function newPersona(partial: Partial<Persona> & { name: string }): Persona {
  const now = new Date().toISOString();
  return {
    id: uid("p_"),
    niche: "",
    contentTypes: [],
    audience: "",
    tone: "",
    goals: "",
    avoid: "",
    hue: Math.floor(Math.random() * 360),
    accounts: [],
    posts: [],
    brain: null,
    ideaDays: [],
    chat: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/** Handle from a profile link or "@name", without the @. */
export function handleFrom(input: string): string {
  const t = input.trim();
  const m = t.match(/(?:tiktok\.com\/@|instagram\.com\/|facebook\.com\/)([A-Za-z0-9._-]+)/i);
  if (m) return m[1];
  return t.replace(/^@/, "").replace(/\s+/g, "");
}

export function profileUrl(platform: SocialPlatform, handle: string): string {
  const h = handleFrom(handle);
  if (!h) return "";
  if (platform === "tiktok") return `https://www.tiktok.com/@${h}`;
  if (platform === "instagram") return `https://www.instagram.com/${h}/`;
  return `https://www.facebook.com/${h}`;
}

/** Which of our platforms a post link belongs to. */
export function platformOfUrl(url: string): Post["platform"] {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host.endsWith("tiktok.com")) return "tiktok";
  if (host.endsWith("instagram.com")) return "instagram";
  if (host.endsWith("facebook.com") || host === "fb.watch") return "facebook";
  if (host.endsWith("youtube.com") || host === "youtu.be") return "youtube";
  return "other";
}

/**
 * Fold freshly synced posts into the existing list. A post already present
 * (same externalId, or same URL) keeps its analysis and gets fresh stats and
 * caption; new ones are added. Newest first.
 */
export function mergePosts(existing: Post[], incoming: Post[]): Post[] {
  const out = [...existing];
  for (const p of incoming) {
    const i = out.findIndex(
      (e) => (p.externalId && e.externalId === p.externalId) || (p.url && e.url === p.url),
    );
    if (i >= 0) {
      const e = out[i];
      out[i] = {
        ...e,
        caption: p.caption || e.caption,
        thumbnail: p.thumbnail ?? e.thumbnail,
        postedAt: p.postedAt ?? e.postedAt,
        stats: p.stats ?? e.stats,
        externalId: e.externalId ?? p.externalId,
      };
    } else out.push(p);
  }
  return out.sort((a, b) => stamp(b) - stamp(a));
}

function stamp(p: Post): number {
  return Date.parse(p.postedAt || p.addedAt) || 0;
}

/**
 * Everything the model should know about a persona, as compact labelled text.
 * Posts are capped (best performers + most recent) so a big account doesn't
 * blow the context window.
 */
export function personaContext(p: Persona, { maxPosts = 40 } = {}): string {
  const lines: string[] = [];
  lines.push(`PERSONA: ${p.name}`);
  if (p.niche) lines.push(`NICHE: ${p.niche}`);
  if (p.contentTypes.length) lines.push(`CONTENT TYPES: ${p.contentTypes.join(", ")}`);
  if (p.audience) lines.push(`AUDIENCE: ${p.audience}`);
  if (p.tone) lines.push(`TONE / VOICE: ${p.tone}`);
  if (p.goals) lines.push(`GOALS: ${p.goals}`);
  if (p.avoid) lines.push(`NEVER SUGGEST: ${p.avoid}`);
  if (p.accounts.length) {
    lines.push(
      `ACCOUNTS: ${p.accounts
        .map((a) => `${PLATFORM_NAME[a.platform]} @${a.handle}${a.followers ? ` (${a.followers} followers)` : ""}`)
        .join("; ")}`,
    );
  }
  if (p.brain) {
    lines.push(`WHAT WE KNOW SO FAR: ${p.brain.summary}`);
    if (p.brain.pillars.length) lines.push(`CONTENT PILLARS: ${p.brain.pillars.join("; ")}`);
    if (p.brain.whatWorks.length) lines.push(`WHAT WORKS: ${p.brain.whatWorks.join("; ")}`);
  }
  const posts = pickPosts(p.posts, maxPosts);
  if (posts.length) {
    lines.push(`\nPOSTS (${posts.length} of ${p.posts.length}, best + most recent):`);
    posts.forEach((x, i) => lines.push(`${i + 1}. ${postLine(x)}`));
  } else {
    lines.push("\nNo posts imported yet — work from the profile above.");
  }
  return lines.join("\n");
}

export function postLine(x: Post): string {
  const bits: string[] = [];
  bits.push(`[${x.platform}${x.postedAt ? " " + x.postedAt.slice(0, 10) : ""}]`);
  if (x.title) bits.push(x.title);
  if (x.format) bits.push(`format: ${x.format}`);
  if (x.hook) bits.push(`hook: "${x.hook}"`);
  if (x.summary) bits.push(x.summary);
  else if (x.caption) bits.push(`caption: ${x.caption.replace(/\s+/g, " ").slice(0, 220)}`);
  const s = x.stats;
  if (s && (s.views || s.likes)) {
    bits.push(`stats: ${[s.views && `${s.views} views`, s.likes && `${s.likes} likes`, s.comments && `${s.comments} comments`].filter(Boolean).join(", ")}`);
  }
  return bits.join(" — ");
}

/** Top half by engagement, rest by recency, no duplicates. */
export function pickPosts(posts: Post[], max: number): Post[] {
  if (posts.length <= max) return [...posts].sort((a, b) => stamp(b) - stamp(a));
  const score = (p: Post) => (p.stats?.views ?? 0) + 20 * (p.stats?.likes ?? 0) + 50 * (p.stats?.comments ?? 0);
  const best = [...posts].filter((p) => score(p) > 0).sort((a, b) => score(b) - score(a)).slice(0, Math.floor(max / 2));
  const recent = [...posts].sort((a, b) => stamp(b) - stamp(a));
  const out = [...best];
  for (const p of recent) {
    if (out.length >= max) break;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

// --- normalising model output ----------------------------------------------

const strs = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max) : [];
const str = (v: unknown, max = 600): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function normalizeIdeas(raw: unknown): Idea[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { ideas?: unknown })?.ideas) ? (raw as { ideas: unknown[] }).ideas : [];
  return list
    .map((r): Idea | null => {
      const o = (r ?? {}) as Record<string, unknown>;
      const title = str(o.title, 140);
      if (!title) return null;
      const plat = str(o.platform).toLowerCase();
      return {
        id: uid("i_"),
        title,
        hook: str(o.hook, 240),
        format: str(o.format, 80),
        outline: strs(o.outline, 8),
        why: str(o.why, 400),
        platform: (SOCIAL_PLATFORMS as string[]).includes(plat) ? (plat as SocialPlatform) : "any",
        status: "new",
      };
    })
    .filter((x): x is Idea => x !== null)
    .slice(0, 10);
}

export function normalizeBrain(raw: unknown, postCount: number, by: Brain["by"]): Brain {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    summary: str(o.summary, 1200) || "Not enough to go on yet.",
    pillars: strs(o.pillars, 8),
    whatWorks: strs(o.whatWorks ?? o.what_works, 8),
    voice: str(o.voice, 400),
    gaps: strs(o.gaps, 8),
    updatedAt: new Date().toISOString(),
    postCount,
    by,
  };
}

export interface PostAnalysis {
  title: string;
  format: string;
  topic: string;
  hook: string;
  summary: string;
}

export function normalizeAnalysis(raw: unknown): PostAnalysis {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    title: str(o.title, 120),
    format: str(o.format, 60),
    topic: str(o.topic, 80),
    hook: str(o.hook, 240),
    summary: str(o.summary, 500),
  };
}

// --- offline heuristics ------------------------------------------------------

const STOP = new Set(
  "the a an and or but to of in on for with at by from is are was were be been this that it its my your our their you we i me so just like not no yes do did does get got have has had what when how why who all any more most very can will fyp foryou foryoupage viral trending reels explore".split(
    " ",
  ),
);

/** Most frequent meaningful words and hashtags across captions. */
export function topTerms(texts: string[], n = 8): string[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set<string>();
    for (const raw of t.toLowerCase().match(/#?[a-z][a-z0-9']{2,}/g) ?? []) {
      const w = raw.replace(/^#/, "");
      if (STOP.has(w) || seen.has(w)) continue;
      seen.add(w);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c > 1 || texts.length < 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([w]) => w);
}

export function heuristicAnalysis(caption: string): PostAnalysis {
  const clean = caption.replace(/\s+/g, " ").trim();
  const firstSentence = clean.split(/(?<=[.!?])\s|\n/)[0] ?? "";
  const noTags = firstSentence.replace(/#\S+/g, "").trim();
  return {
    title: noTags.slice(0, 80) || "Untitled post",
    format: "",
    topic: topTerms([clean], 3).join(", "),
    hook: noTags.slice(0, 140),
    summary: clean.slice(0, 240),
  };
}

export function heuristicBrain(p: Persona): Brain {
  const texts = p.posts.map((x) => [x.title, x.topic, x.caption].filter(Boolean).join(" "));
  const terms = topTerms(texts, 8);
  const top = pickPosts(p.posts.filter((x) => x.stats?.views || x.stats?.likes), 3);
  const pillars = p.contentTypes.length ? p.contentTypes.slice(0, 6) : terms.slice(0, 4);
  return normalizeBrain(
    {
      summary:
        `${p.name} makes ${p.niche || "content"}${p.audience ? ` for ${p.audience}` : ""}.` +
        (p.posts.length ? ` ${p.posts.length} posts on file; recurring themes: ${terms.slice(0, 5).join(", ") || "not clear yet"}.` : " No posts imported yet."),
      pillars,
      whatWorks: top.map((x) => `${x.title || x.caption.slice(0, 60)} (${x.stats?.views ?? x.stats?.likes} ${x.stats?.views ? "views" : "likes"})`),
      voice: p.tone,
      gaps: p.posts.length < 5 ? ["Import more posts so ideas can follow what already works."] : [],
    },
    p.posts.length,
    "heuristic",
  );
}

const HOOKS = [
  "Nobody talks about this part of {x}",
  "I tried {x} for 7 days — here's what happened",
  "3 things I wish I knew before {x}",
  "Rating every {x} I've done",
  "The {x} mistake almost everyone makes",
  "POV: your first time with {x}",
  "Watch this before you try {x}",
  "{x}, but in 30 seconds",
];

/** Deterministic per day, so a reload shows the same list. */
export function heuristicIdeas(p: Persona, day: string, count = 5): Idea[] {
  const seeds = [...p.contentTypes, ...(p.brain?.pillars ?? []), ...topTerms(p.posts.map((x) => x.caption), 5)];
  const topics = seeds.length ? seeds : [p.niche || "your niche"];
  let h = 0;
  for (const c of day + p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const out: Idea[] = [];
  for (let i = 0; i < count; i++) {
    const topic = topics[(h + i) % topics.length];
    const hook = HOOKS[(h + i * 3) % HOOKS.length].replace("{x}", topic);
    out.push({
      id: uid("i_"),
      title: hook,
      hook,
      format: p.contentTypes[(h + i) % Math.max(1, p.contentTypes.length)] ?? "short video",
      outline: ["Open on the hook in the first second", `Show the ${topic} moment`, "Pay it off", "End with a question for the comments"],
      why: `Built offline from your ${seeds.length ? "content types and past posts" : "niche"}. Connect an AI key for ideas that read your actual videos.`,
      platform: "any",
      status: "new",
    });
  }
  return out;
}
