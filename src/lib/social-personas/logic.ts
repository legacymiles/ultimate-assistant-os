// ---------------------------------------------------------------------------
// Pure logic shared by the client and the API routes: persona context for the
// model, merging synced posts, normalising model output, and the offline
// heuristics that keep the app useful with no AI key.
// ---------------------------------------------------------------------------

import { HARD_AVOID_TEXT, RANKING_NOTE, checkPolicy, formatsFor } from "./formats";
import { planBatch, sanitizeLeverKeys } from "./learn";
import {
  DEFAULT_LEARN,
  PLATFORM_NAME,
  SOCIAL_PLATFORMS,
  type Brain,
  type Idea,
  type IdeaRole,
  type Persona,
  type Post,
  type PostStats,
  type SocialPlatform,
  type StatSnapshot,
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
  const base: Persona = {
    id: uid("p_"),
    nickname: "",
    username: "",
    avatar: null,
    aboutMe: "",
    aboutMeVersion: 1,
    aboutMeHistory: [],
    lessonLog: [],
    learn: { ...DEFAULT_LEARN },
    niche: "",
    overview: "",
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
    drafts: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
  // A persona is never left without a character document: an empty about-me
  // means the agent has no voice to hold, and asking the owner to write one
  // into a blank box is the setup list the house rule forbids.
  const aboutMe = base.aboutMe.trim() || aboutMeTemplate(base);
  return {
    ...base,
    username: base.username.trim() || suggestUsername(base.name),
    aboutMe,
    aboutMeHistory: base.aboutMeHistory.length ? base.aboutMeHistory : [{ version: 1, at: now, markdown: aboutMe }],
  };
}

/** A plausible handle from a display name: "Barry Knows Things" → barryknowsthings. */
export function suggestUsername(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 28) || "newpersona";
}

/**
 * The starting character document, written from what the owner already typed.
 *
 * Every heading the agent reads at generation time is present and filled with
 * something true, so the document is useful on day one and the owner edits
 * rather than authors. The prompt reads this verbatim, so a blank section here
 * is a blank instruction there.
 */
export function aboutMeTemplate(p: Persona): string {
  const types = p.contentTypes.length ? p.contentTypes : ["posts"];
  const lib = formatsFor(p.nickname ?? "");
  return `# ${p.name}

## Purpose

${p.overview || p.niche || `A ${(p.nickname || "social").toLowerCase()} persona`}${p.audience ? `, made for ${p.audience}` : ""}.

Write here what this character is actually FOR — not what it posts, but what it
is trying to make happen in the people who see it.

## Voice

${p.tone || "Describe how this character talks: sentence length, rhythm, how certain it sounds."}

Sentence length, punctuation habits, how it sounds when it is confident and how
it sounds when it is wrong.

## Vocabulary and rhythm

- Words it reaches for, and words it never uses.
- Whether it uses hashtags, emoji or exclamation marks — and how many.
- Spelling and references: which country, which decade.

## Catchphrases

One recurring line, not five. Write it here and the agent will use it sparingly.

## In the comments

How it replies when someone corrects it, agrees with it, or tries to start a
fight. This matters more than the post: a reply inside twenty minutes is what
keeps a post alive.

## Never says

${p.avoid ? p.avoid.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => `- ${x}`).join("\n") : "- List the subjects, phrasings and targets this character must never touch."}

## Content ideas

${types.map((t) => `- ${t}`).join("\n")}
${lib.length ? `\nThe format library for this nickname holds ${lib.length} mechanics to draw on, and the agent will test the ones this page has never tried.` : ""}

## Goals

${p.goals || "What does success look like? Name the one number that matters, and the thing that must never be risked to get it."}
`;
}

/** Handle from a profile link or "@name", without the @. */
export function handleFrom(input: string): string {
  const t = input.trim();
  const m = t.match(/(?:tiktok\.com\/@|instagram\.com\/|facebook\.com\/|youtube\.com\/@|(?:x|twitter)\.com\/)([A-Za-z0-9._-]+)/i);
  if (m) return m[1];
  return t.replace(/^@/, "").replace(/\s+/g, "");
}

export function profileUrl(platform: SocialPlatform, handle: string): string {
  const h = handleFrom(handle);
  if (!h) return "";
  if (platform === "tiktok") return `https://www.tiktok.com/@${h}`;
  if (platform === "instagram") return `https://www.instagram.com/${h}/`;
  if (platform === "youtube") return `https://www.youtube.com/@${h}`;
  if (platform === "x") return `https://x.com/${h}`;
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
  if (host === "x.com" || host.endsWith(".x.com") || host.endsWith("twitter.com")) return "x";
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
        history: p.stats ? addSnapshot(e.history ?? (e.stats ? [{ ...e.stats, at: e.addedAt }] : []), p.stats, p.addedAt) : e.history,
        externalId: e.externalId ?? p.externalId,
        draftId: e.draftId ?? p.draftId,
      };
    } else out.push(p.stats && !p.history?.length ? { ...p, history: [{ ...p.stats, at: p.addedAt }] } : p);
  }
  return out.sort((a, b) => stamp(b) - stamp(a));
}

/** Most readings kept per post — enough for a smooth curve, small enough to sync. */
export const MAX_SNAPSHOTS = 48;

/**
 * Add one reading of a post's stats to its history. A reading identical to the
 * last one is dropped (a re-sync that learned nothing), and once the history is
 * full the oldest middle points are thinned so the first and latest stay.
 */
export function addSnapshot(history: StatSnapshot[], stats: PostStats, at: string): StatSnapshot[] {
  const last = history[history.length - 1];
  const same = last && last.views == stats.views && last.likes == stats.likes && last.comments == stats.comments && last.shares == stats.shares;
  if (same) return history;
  const next = [...history, { at, views: stats.views ?? null, likes: stats.likes ?? null, comments: stats.comments ?? null, shares: stats.shares ?? null }];
  // Over the cap: drop the middle point closest in time to its neighbour, so
  // the curve keeps its shape (early hours stay as detailed as late days).
  while (next.length > MAX_SNAPSHOTS) {
    let drop = 1;
    let best = Infinity;
    for (let i = 1; i < next.length - 1; i++) {
      const gap = Date.parse(next[i + 1].at) - Date.parse(next[i - 1].at);
      if (gap < best) {
        best = gap;
        drop = i;
      }
    }
    next.splice(drop, 1);
  }
  return next;
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
  // The character document goes in FIRST and WHOLE.
  //
  // It is the style lock: the numbers can change what this persona talks about
  // and which mechanic it reaches for, but never how it sounds. Summarise it
  // and the voice drifts a little with every generation until, a month later,
  // the character is gone and nobody can point at when it left.
  if (p.aboutMe?.trim()) {
    lines.push("## STYLE LOCK — the character document. Follow it exactly; the engagement data never overrides it.");
    lines.push(p.aboutMe.trim());
    lines.push(`(character document version ${p.aboutMeVersion})`);
    lines.push("");
  }
  lines.push(`PERSONA: ${p.name}${p.username ? ` (@${p.username})` : ""}`);
  if (p.nickname) lines.push(`NICKNAME / JOB: ${p.nickname}`);
  if (p.niche) lines.push(`NICHE: ${p.niche}`);
  if (p.overview) lines.push(`PROFILE OVERVIEW: ${p.overview}`);
  if (p.contentTypes.length) lines.push(`CONTENT TYPES: ${p.contentTypes.join(", ")}`);
  if (p.audience) lines.push(`AUDIENCE: ${p.audience}`);
  if (p.tone) lines.push(`TONE / VOICE: ${p.tone}`);
  if (p.goals) lines.push(`GOALS: ${p.goals}`);
  if (p.avoid) lines.push(`NEVER SUGGEST: ${p.avoid}`);
  if (formatsFor(p.nickname ?? "").length) {
    lines.push("");
    lines.push("## HARD LIMITS — not style notes. Breaking one costs the Page its reach, or gets it removed.");
    lines.push(HARD_AVOID_TEXT);
    lines.push(`- ${RANKING_NOTE}`);
    lines.push("The governing test: funny-annoying about a THING, never mean about a PERSON.");
    lines.push("");
  }
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

export interface NormalizeIdeaOpts {
  /** The persona's own avoid list, checked alongside the hard list. */
  avoid?: string;
  /** Stamped onto every idea so a result can be traced to what produced it. */
  lessonVersion?: number;
  aboutMeVersion?: number;
}

/**
 * Turn a model's reply into ideas, and run the policy guard over every one.
 *
 * A blocked idea is KEPT, with its reason, rather than dropped. A silent
 * filter looks exactly like the agent having an off day, and the owner would
 * have no way to tell "it wrote nothing good" from "it wrote something that
 * would have cost us the Page".
 */
export function normalizeIdeas(raw: unknown, opts: NormalizeIdeaOpts = {}): Idea[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { ideas?: unknown })?.ideas) ? (raw as { ideas: unknown[] }).ideas : [];
  const roles: IdeaRole[] = ["exploit", "explore", "wildcard"];
  return list
    .map((r): Idea | null => {
      const o = (r ?? {}) as Record<string, unknown>;
      const title = str(o.title, 140);
      if (!title) return null;
      const plat = str(o.platform).toLowerCase();
      const role = str(o.role).toLowerCase() as IdeaRole;
      const caption = str(o.caption, 1200);
      const hook = str(o.hook, 240);
      const firstComment = str(o.firstComment ?? o.first_comment, 300);
      const verdict = checkPolicy([title, hook, caption, firstComment].filter(Boolean).join("\n"), opts.avoid ?? "");
      return {
        id: uid("i_"),
        title,
        hook,
        format: str(o.format, 80),
        outline: strs(o.outline, 8),
        why: str(o.why, 400),
        platform: (SOCIAL_PLATFORMS as string[]).includes(plat) ? (plat as SocialPlatform) : "any",
        status: "new",
        caption: caption || undefined,
        firstComment: firstComment || undefined,
        leverKeys: sanitizeLeverKeys(o.leverKeys ?? o.levers),
        role: roles.includes(role) ? role : undefined,
        basedOnLessonVersion: opts.lessonVersion,
        aboutMeVersion: opts.aboutMeVersion,
        blockedReason: verdict.ok ? undefined : verdict.reason,
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

/** The SUBJECTS this persona posts about — cars, kitchens, the 1990s.
 *
 *  Deliberately not `contentTypes`: those are mechanics ("impossible choice"),
 *  and mixing the two produced titles like "Deliberately wrong fact about
 *  wrong nostalgia" — a mechanic pointed at another mechanic, about nothing.
 *  Caption keywords are out for the same reason: they surfaced filler. */
function subjectsOf(p: Persona): string[] {
  const fromPosts = [
    ...new Set(p.posts.flatMap((x) => (x.topic ?? "").split(",").map((t) => t.trim().toLowerCase()))),
  ].filter(Boolean);
  if (fromPosts.length >= 2) return fromPosts;
  const pillars = (p.brain?.pillars ?? []).map((x) => x.toLowerCase());
  const seeds = [...new Set([...fromPosts, ...pillars])];
  return seeds.length ? seeds : [p.niche.toLowerCase() || "your niche"];
}

/**
 * Ideas with no AI key — and still the agent's own plan, not a generic list.
 *
 * The learning loop is pure arithmetic, so it runs whether or not a key is
 * set. That means the offline path can honour the same exploit / explore /
 * wildcard slots and the same proven levers; only the WORDING is mechanical.
 * A fallback that ignored the plan would quietly stop the agent improving the
 * moment the key went missing, which is the worst time not to notice.
 *
 * Deterministic per day, so a reload shows the same list.
 */
export function heuristicIdeas(p: Persona, day: string, count = 5): Idea[] {
  const plan = planBatch(p, count, day);
  const subjects = subjectsOf(p);
  const library = formatsFor(p.nickname ?? "");
  let h = 0;
  for (const c of day + p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;

  const out: Idea[] = [];
  for (let i = 0; i < count; i++) {
    const slot = plan.slots[i];
    const subject = subjects[(h + i * 3) % subjects.length];
    const bestFormat = plan.exploit.find((e) => e.key.startsWith("format:"));
    const fmt =
      slot?.format
      ?? (slot?.leverKey?.startsWith("format:")
        ? library.find((f) => f.slug === slot.leverKey!.slice("format:".length))
        : undefined)
      ?? (slot?.role === "exploit" && bestFormat
        ? library.find((f) => f.slug === bestFormat.key.slice("format:".length))
        : undefined);

    if (fmt) {
      out.push({
        id: uid("i_"),
        title: `${fmt.label} about ${subject}`,
        hook: fmt.example,
        format: fmt.label,
        outline: [
          fmt.mechanic,
          `Point it at ${subject}, which this page already posts about.`,
          "One line. No hashtags, no call to action.",
          "Reply to the first few corrections within twenty minutes.",
        ],
        why:
          slot.role === "wildcard"
            ? `This page has never tried ${fmt.label.toLowerCase()}. Built offline — connect an AI key for wording in the character's own voice.`
            : slot.role === "explore"
              ? `Re-testing ${slot.label.toLowerCase()} because one result is not evidence. Built offline.`
              : `${slot.label} is the strongest lever on this page. Built offline — an AI key writes the caption in character.`,
        platform: p.accounts[0]?.platform ?? "any",
        status: "new",
        role: slot.role,
        leverKeys: [`format:${fmt.slug}`],
        basedOnLessonVersion: p.lessonLog?.[0]?.version,
        aboutMeVersion: p.aboutMeVersion,
      });
      continue;
    }

    const hook = HOOKS[(h + i * 3) % HOOKS.length].replace("{x}", subject);
    out.push({
      id: uid("i_"),
      title: hook,
      hook,
      format: p.contentTypes[(h + i) % Math.max(1, p.contentTypes.length)] ?? "short video",
      outline: ["Open on the hook in the first second", `Show the ${subject} moment`, "Pay it off", "End with a question for the comments"],
      why: "Built offline from this page's own topics and past posts. Connect an AI key for ideas that read the actual posts.",
      platform: "any",
      status: "new",
      role: slot?.role,
      basedOnLessonVersion: p.lessonLog?.[0]?.version,
      aboutMeVersion: p.aboutMeVersion,
    });
  }
  return out;
}
