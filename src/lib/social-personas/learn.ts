// ---------------------------------------------------------------------------
// The self-improvement loop.
//
// Four traps, and the design is mostly about avoiding them.
//
// 1. RAW NUMBERS LIE. A post shown to 38,600 people with 610 comments did worse
//    than a post shown to 9,800 with 860, and an agent chasing raw counts learns
//    "make more of whatever the algorithm happened to push". So nothing here
//    compares counts between posts. Every post is scored against THIS page's own
//    normal, per person reached.
//
// 2. SMALL SAMPLES ALWAYS LOOK LIKE DISCOVERIES. Two lucky posts will out-average
//    forty honest ones. Two defences: every effect is shrunk toward the page
//    average by a fixed prior, so n=2 keeps a third of its apparent strength and
//    n=40 keeps nearly all of it; and ranking uses the LOWER BOUND of the
//    confidence interval, never the mean. That second one is what actually stops
//    a single fluke being crowned — a mean of +1.4 at n=1 has a lower bound below
//    zero, so it simply cannot win.
//
// 3. LEVERS TRAVEL TOGETHER. Wrong-fact posts are usually text-on-image, so a
//    naive pass credits both for the same success and the agent "learns" two
//    rules where there is one. Effects are therefore fitted additively: each
//    dimension is estimated on the residuals the other dimensions leave behind,
//    three passes, which splits shared credit roughly where it belongs.
//
// 4. COLLAPSE. An agent that only exploits its best format gets very good at one
//    post and then goes stale, and the audience leaves. So every batch reserves
//    slots for a lever under test and for a format never tried — a floor that
//    decays as the page learns but never reaches zero.
//
// Everything here is pure, synchronous arithmetic: no model, no network. That is
// deliberate — it means the loop keeps working with no AI key set, and only the
// WORDING of an idea degrades to the offline path.
// ---------------------------------------------------------------------------

import { detectFormat, formatsFor, type ContentFormat } from "./formats";
import {
  DEFAULT_LEARN,
  LEVER_DIMS,
  LEVER_DIM_NAME,
  type IdeaRole,
  type LearnSettings,
  type Lesson,
  type LessonSet,
  type LeverDim,
  type LeverEffect,
  type LeverTier,
  type Persona,
  type Post,
} from "./types";

/**
 * Strength of the prior, in posts. A lever with K_LEVER posts behind it is
 * believed exactly half as strongly as its raw average suggests.
 *
 * 4 is chosen for the real cadence: a Page posting twice a day accumulates ~14
 * posts a week, so a lever reaches useful confidence inside a fortnight — fast
 * enough to be worth watching, slow enough that one lucky Tuesday cannot
 * rewrite the strategy.
 */
export const K_LEVER = 4;

/** Passes of additive back-fitting. Three is enough below n≈100 and cheap. */
const FIT_PASSES = 3;

/** Scores are clipped to ±3 so one freak post cannot define the scale. */
const CLIP = 3;

// --- small statistics ------------------------------------------------------

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation, scaled to compare with a standard deviation. */
function mad(xs: number[], m: number): number {
  return xs.length ? 1.4826 * median(xs.map((x) => Math.abs(x - m))) : 0;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

const clip = (x: number, lo = -CLIP, hi = CLIP): number => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0);

/**
 * Robust z — median and MAD rather than mean and standard deviation.
 *
 * A viral outlier inflates a standard deviation enough to flatten every real
 * difference beneath it, which is exactly the signal being looked for here.
 */
function rz(xs: number[]): number[] {
  const m = median(xs);
  const d = mad(xs, m);
  if (!(d > 0)) return xs.map(() => 0);
  return xs.map((x) => clip((x - m) / d));
}

/** Two-sided 90% t critical values by degrees of freedom. */
const T90: Record<number, number> = {
  1: 6.314, 2: 2.92, 3: 2.353, 4: 2.132, 5: 2.015, 6: 1.943, 7: 1.895,
  8: 1.86, 9: 1.833, 10: 1.812, 12: 1.782, 15: 1.753, 20: 1.725, 25: 1.708, 30: 1.697,
};

function t90(df: number): number {
  if (df < 1) return 6.314;
  if (T90[df]) return T90[df];
  const keys = Object.keys(T90).map(Number).sort((a, b) => a - b);
  for (const k of keys) if (df <= k) return T90[k];
  return 1.645;
}

// --- levers ----------------------------------------------------------------

const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function captionLenBucket(caption: string): string {
  const words = caption.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 12) return "to-12w";
  if (words <= 30) return "13-30w";
  if (words <= 60) return "31-60w";
  return "over-60w";
}

export function postSlotBucket(d: Date): string {
  const h = d.getHours();
  const part = h < 9 ? "early" : h < 15 ? "mid" : h < 21 ? "evening" : "late";
  const day = d.getDay();
  return `${part}-${day === 0 || day === 6 ? "weekend" : "weekday"}`;
}

function hookType(text: string): string {
  const t = text.trim();
  if (/\?\s*$/.test(t) || /^(how|what|which|who|why|when|guess)\b/i.test(t)) return "question";
  if (/^(name|pick|choose|tell|describe|finish|find|spot|rank)\b/i.test(t)) return "command";
  if (/\b(i have never|i will die|confession|i'?ve been saying)\b/i.test(t)) return "confession";
  if (/\b(most people|only|bet you|can you|1%)\b/i.test(t)) return "challenge";
  if (/^\s*\d+[.)]|\b(top \d|ranked|best to worst)\b/i.test(t)) return "list";
  return "false-claim";
}

function mediaKind(p: Post): string {
  const f = (p.format ?? "").toLowerCase();
  if (/bad.?photoshop|cloned|edit/.test(f)) return "bad-photoshop";
  if (/reel|video|clip|short/.test(f)) return "reel";
  if (/carousel|album/.test(f)) return "carousel";
  if (/text.?on.?image|graphic|meme/.test(f)) return "text-on-image";
  if (/photo|image|picture/.test(f)) return "photo";
  if (/\bhttps?:\/\//.test(p.caption)) return "link";
  return p.thumbnail ? "photo" : "plain-text";
}

function ctaStyle(caption: string): string {
  const t = caption.trim();
  if (/\?\s*$/.test(t)) return "open-question";
  if (/\b(i will not be taking questions|that'?s it|i said what i said|settled|i'?ve been saying this)\b/i.test(t))
    return "implicit-disagreement";
  if (/\b(reminder|always been|is a vegetable|basic (geography|science|maths))\b/i.test(t)) return "deliberate-error";
  return "none";
}

function emojiBucket(caption: string): string {
  const n = (caption.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).length;
  return n === 0 ? "0" : n === 1 ? "1" : "2-plus";
}

/**
 * Every repeatable choice behind one post, as `dim:value` keys.
 *
 * A post the agent wrote carries its own levers — it chose them at generation
 * time, which is strictly more reliable than re-deriving them later — so those
 * win. An imported post is read: its analyzed format and topic become levers,
 * and its caption is matched against the format library, so posts from before
 * the agent existed still get a vote.
 */
export function leverKeysFor(p: Post, nickname: string): string[] {
  const keys = new Set<string>(p.leverKeys ?? []);
  const has = (dim: LeverDim) => [...keys].some((k) => k.startsWith(dim + ":"));

  if (!has("format")) {
    // Only a library format may occupy the `format` dimension. The analyzer's
    // own `format` field holds things like "reel" and "text-on-image", which
    // are MEDIA, and letting them fall through to here silently merged two
    // dimensions into one — so the loop would credit "text-on-image" as a
    // creative mechanic and then deconfound it against itself.
    const detected = detectFormat(nickname, [p.hook, p.title, p.caption].filter(Boolean).join(" "));
    keys.add(`format:${detected ? detected.slug : "unclassified"}`);
  }
  if (!has("topic") && p.topic) {
    const first = p.topic.split(",")[0]?.trim();
    if (first) keys.add(`topic:${slugify(first)}`);
  }
  if (!has("hookType")) keys.add(`hookType:${hookType(p.hook || p.title || p.caption)}`);
  if (!has("media")) keys.add(`media:${mediaKind(p)}`);
  if (!has("captionLen")) keys.add(`captionLen:${captionLenBucket(p.caption)}`);
  if (!has("ctaStyle")) keys.add(`ctaStyle:${ctaStyle(p.caption)}`);
  if (!has("emoji")) keys.add(`emoji:${emojiBucket(p.caption)}`);
  if (!has("postSlot")) {
    const when = p.postedAt ? new Date(p.postedAt) : null;
    if (when && !Number.isNaN(when.getTime())) keys.add(`postSlot:${postSlotBucket(when)}`);
  }
  return [...keys];
}

export function dimOf(key: string): LeverDim | null {
  const d = key.split(":")[0] as LeverDim;
  return LEVER_DIMS.includes(d) ? d : null;
}

export function leverLabel(key: string, nickname: string): string {
  const [d, ...rest] = key.split(":");
  const value = rest.join(":");
  const dimName = LEVER_DIM_NAME[d as LeverDim] ?? d;
  if (d === "format") {
    const f = formatsFor(nickname).find((x) => x.slug === value);
    if (f) return `${dimName}: ${f.label}`;
  }
  return `${dimName}: ${value.replace(/-/g, " ")}`;
}

// --- scoring ---------------------------------------------------------------

export interface ScoredPost {
  post: Post;
  /** Weighted actions, for the owner's eyes. */
  actions: number;
  /** Actions per person reached, when reach is known. */
  rate: number | null;
  /** The composite, clipped to ±3. Zero is this page's own normal. */
  score: number;
  tier: "reach" | "raw";
  leverKeys: string[];
}

export interface Scoring {
  scored: ScoredPost[];
  /** Too young, or too little reach, to say anything about yet. */
  maturing: Post[];
  /** No engagement data at all. */
  unusable: Post[];
}

function weightedActions(p: Post, s: LearnSettings): number {
  const st = p.stats;
  if (!st) return 0;
  // Comments and shares are distribution events on Facebook — they put the post
  // in front of someone new. A reaction mostly does not. The objective weights
  // are what make this agent optimise for people typing, not people tapping.
  return (st.likes ?? 0) * s.wLikes + (st.comments ?? 0) * s.wComments * 6 + (st.shares ?? 0) * s.wShares * 10;
}

function postedAtMs(p: Post): number {
  return Date.parse(p.postedAt || p.addedAt) || 0;
}

/**
 * Score every post old enough and seen widely enough to mean something.
 *
 * Posts split into two tiers — reach known and reach unknown — and each tier is
 * standardised against its own median before the two are pooled. Mixing a rate
 * with a raw count in one distribution would make the TIER the strongest signal
 * in the data instead of the content.
 */
export function scorePosts(posts: Post[], nickname: string, settings = DEFAULT_LEARN, now = new Date()): Scoring {
  const unusable: Post[] = [];
  const maturing: Post[] = [];
  const candidates: Post[] = [];

  // The gate asks only "has this been seen by enough people to mean anything
  // at all". It is deliberately NOT a percentile of this page's own reach: on a
  // healthy page the 10th percentile is thousands of views, and cutting there
  // throws away the low-reach posts twice — once here, and again in the
  // shrinkage, whose pseudo-view prior already pulls a 2,000-view post hard
  // toward the page average. Discarding real data to avoid noise the estimator
  // is built to absorb is how a loop ends up blind to its own best experiments.
  const reachGate = Math.max(1, settings.reachFloor);

  for (const p of posts) {
    const st = p.stats;
    const anyData = Boolean(st && ((st.likes ?? 0) + (st.comments ?? 0) + (st.shares ?? 0) > 0 || (st.views ?? 0) > 0));
    if (!anyData) {
      unusable.push(p);
      continue;
    }
    const ageHours = (now.getTime() - postedAtMs(p)) / 3_600_000;
    const views = st?.views ?? null;
    const reachOk = views === null || views >= reachGate;
    if (ageHours < settings.minAgeHours || !reachOk) {
      maturing.push(p);
      continue;
    }
    candidates.push(p);
  }

  const scored: ScoredPost[] = [];
  for (const tier of ["reach", "raw"] as const) {
    const group = candidates.filter((p) =>
      tier === "reach" ? (p.stats?.views ?? 0) > 0 : !((p.stats?.views ?? 0) > 0),
    );
    if (!group.length) continue;

    const actions = group.map((p) => weightedActions(p, settings));
    const comments = group.map((p) => p.stats?.comments ?? 0);
    const shares = group.map((p) => p.stats?.shares ?? 0);
    const likes = group.map((p) => p.stats?.likes ?? 0);

    let scores: number[];
    let rates: (number | null)[];

    if (tier === "reach") {
      const views = group.map((p) => p.stats?.views ?? 1);
      const mView = median(views);
      // Pooled page rate, and a prior measured in pseudo-views: a 2,000-view
      // post barely leaves the page average, a 30,000-view post dominates it.
      const pooled = actions.reduce((a, b) => a + b, 0) / Math.max(1, views.reduce((a, b) => a + b, 0));
      const k = Math.max(200, 0.25 * mView);
      const erh = group.map((_, i) => (actions[i] + k * pooled) / (views[i] + k));
      // Did the algorithm pick it up at all, relative to this page's normal.
      const reachMult = views.map((v) => clip(Math.log2(Math.max(v, 1) / Math.max(mView, 1))));

      const zc = rz(group.map((_, i) => comments[i] / views[i]));
      const zs = rz(group.map((_, i) => shares[i] / views[i]));
      const zl = rz(group.map((_, i) => likes[i] / views[i]));
      const zErh = rz(erh);
      const zRm = rz(reachMult);

      scores = group.map((_, i) => {
        const objective = settings.wComments * zc[i] + settings.wShares * zs[i] + settings.wLikes * zl[i];
        const spread = 0.7 * zErh[i] + 0.3 * zRm[i];
        return clip(0.6 * objective + 0.4 * spread);
      });
      rates = group.map((_, i) => actions[i] / views[i]);
    } else {
      const zc = rz(comments);
      const zs = rz(shares);
      const zl = rz(likes);
      scores = group.map((_, i) =>
        clip(settings.wComments * zc[i] + settings.wShares * zs[i] + settings.wLikes * zl[i]),
      );
      rates = group.map(() => null);
    }

    group.forEach((post, i) => {
      scored.push({
        post,
        actions: actions[i],
        rate: rates[i],
        score: scores[i],
        tier,
        leverKeys: leverKeysFor(post, nickname),
      });
    });
  }

  return { scored: scored.sort((a, b) => b.score - a.score), maturing, unusable };
}

/** The page's own normal engagement rate, as a percentage. */
export function baselineRate(scored: ScoredPost[]): number {
  const rates = scored.map((s) => s.rate).filter((r): r is number => r !== null);
  return rates.length ? median(rates) * 100 : 0;
}

// --- lever effects ---------------------------------------------------------

interface Cell {
  key: string;
  dim: LeverDim;
  value: string;
  idx: number[];
}

/**
 * How each lever performed, deconfounded and shrunk, with a 90% interval.
 *
 * A dimension with only one distinct value is dropped entirely: if every post
 * is a photo, "photo" cannot explain why some did better than others, and
 * reporting it would be the loop inventing a finding out of a constant.
 */
export function leverEffects(scored: ScoredPost[], nickname: string): LeverEffect[] {
  if (!scored.length) return [];
  const scores = scored.map((s) => s.score);
  const globalMean = mean(scores);

  const cells = new Map<string, Cell>();
  scored.forEach((s, i) => {
    for (const key of s.leverKeys) {
      const dim = dimOf(key);
      if (!dim) continue;
      const value = key.slice(dim.length + 1);
      const cell = cells.get(key);
      if (cell) cell.idx.push(i);
      else cells.set(key, { key, dim, value, idx: [i] });
    }
  });

  // Drop a dimension with no contrast. "No contrast" means CONSTANT — one
  // distinct value across every post — because a constant cannot explain why
  // some posts did better than others, and reporting it would be the loop
  // inventing a finding. A dimension where one value has many posts and the
  // others have one each is the opposite of useless: that asymmetry is exactly
  // the comparison being looked for, so it must survive.
  const byDim = new Map<LeverDim, Cell[]>();
  for (const c of cells.values()) {
    const list = byDim.get(c.dim);
    if (list) list.push(c);
    else byDim.set(c.dim, [c]);
  }
  for (const [dim, list] of byDim) {
    if (list.length < 2) {
      byDim.delete(dim);
      for (const c of list) cells.delete(c.key);
    }
  }

  // Additive back-fitting: estimate each dimension on the residual the others
  // leave behind, so co-occurring levers split the credit instead of both
  // claiming all of it.
  const effect = new Map<string, number>();
  for (const key of cells.keys()) effect.set(key, 0);

  const keysOfPost = scored.map((s) => s.leverKeys.filter((k) => cells.has(k)));
  const otherSum = (i: number, skip: LeverDim): number => {
    let total = 0;
    for (const k of keysOfPost[i]) if (dimOf(k) !== skip) total += effect.get(k) ?? 0;
    return total;
  };

  for (let pass = 0; pass < FIT_PASSES; pass++) {
    for (const [dim, list] of byDim) {
      for (const c of list) {
        const resid = c.idx.map((i) => scores[i] - globalMean - otherSum(i, dim));
        const n = c.idx.length;
        effect.set(c.key, (n / (n + K_LEVER)) * mean(resid));
      }
    }
  }

  // Pooled variance, from the fitted model's own residuals.
  //
  // A cell's own standard deviation cannot be used: at n=2 it is a hopeless
  // estimate, and when both observations are clipped to the same bound it
  // collapses to nearly zero and hands a fluke a CONFIDENT-looking interval —
  // the exact failure this whole design exists to prevent. Assuming one common
  // residual variance across cells is far more defensible at these sample
  // sizes, and it makes the interval widen with 1/sqrt(n) the way it should.
  const modelResid = scored.map((s, i) => {
    let fitted = globalMean;
    for (const k of keysOfPost[i]) fitted += effect.get(k) ?? 0;
    return s.score - fitted;
  });
  const sdPooled = Math.max(0.15, sd(modelResid));
  const df = Math.max(1, scored.length - byDim.size - 1);

  const out: LeverEffect[] = [];
  for (const c of cells.values()) {
    const n = c.idx.length;
    const e = effect.get(c.key) ?? 0;
    const shrink = n / (n + K_LEVER);
    // At n=1 the lever's effect is NOT IDENTIFIED: there is no way to separate
    // "this mechanic works" from "that one post happened to do well", because
    // both explanations fit the single observation exactly. A narrow interval
    // there would be a statement the data cannot support — and it is precisely
    // the case the seed's 2,100-view freak result is built to probe. So a
    // single-observation interval is widened to span zero by construction,
    // which is the honest answer and keeps it out of every believed tier.
    const half =
      n >= 2
        ? shrink * t90(df) * (sdPooled / Math.sqrt(n))
        : Math.abs(e) + t90(df) * sdPooled;
    const ciLo = e - half;
    const ciHi = e + half;
    out.push({
      key: c.key,
      dim: c.dim,
      value: c.value,
      label: leverLabel(c.key, nickname),
      n,
      effect: e,
      ciLo,
      ciHi,
      tier: tierOf(n, ciLo, ciHi),
      evidencePostIds: c.idx
        .map((i) => scored[i])
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map((s) => s.post.id),
    });
  }
  // Pessimistic ordering: by the lower bound, never the mean. This single line
  // is what stops n=2 beating n=40.
  return out.sort((a, b) => b.ciLo - a.ciLo);
}

export function tierOf(n: number, ciLo: number, ciHi: number): LeverTier {
  if (n === 0) return "prior";
  if (n < 3) return "unproven";
  if (n >= 7 && ciLo > 0) return "proven";
  if (n >= 7 && ciHi < 0) return "proven-loser";
  if (ciLo > 0 || ciHi < 0) return "emerging";
  return "unproven";
}

const TIER_RANK: Record<LeverTier, number> = {
  "proven-loser": 0,
  prior: 1,
  unproven: 2,
  emerging: 3,
  proven: 4,
};

// --- statements ------------------------------------------------------------

const pct = (x: number): string => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(0)}`;

function why(e: LeverEffect, scored: ScoredPost[], nickname: string): string {
  if (e.dim === "format") {
    const f = formatsFor(nickname).find((x) => x.slug === e.value);
    if (f) {
      const reflex =
        f.reflex === "correction"
          ? "this audience corrects errors in the comments rather than reacting"
          : f.reflex === "identity"
            ? "the in-group announces itself in the comments"
            : f.reflex === "tribalism"
              ? "a harmless side to pick gets people arguing with each other"
              : "an unfinished pattern gets finished in the comments";
      if (e.effect > 0) return ` Why: ${reflex}.`;
    }
  }
  // For a loser, say what is actually wrong rather than restating the number.
  if (e.effect < 0) {
    const inCell = new Set(e.evidencePostIds);
    const cellPosts = scored.filter((s) => inCell.has(s.post.id) && s.rate !== null);
    const pageMedian = median(scored.map((s) => s.rate).filter((r): r is number => r !== null));
    const cellViews = median(cellPosts.map((s) => s.post.stats?.views ?? 0));
    const pageViews = median(scored.map((s) => s.post.stats?.views ?? 0));
    if (cellPosts.length && cellViews > pageViews * 1.3 && median(cellPosts.map((s) => s.rate!)) < pageMedian) {
      return " Why: plenty of reach, very little typing per viewer.";
    }
  }
  return "";
}

export function statementFor(e: LeverEffect, scored: ScoredPost[], nickname: string): string {
  const band = `(n=${e.n}, 90% CI ${pct(e.ciLo)}% to ${pct(e.ciHi)}%)`;
  const head =
    e.tier === "proven"
      ? `${e.label} is running ${pct(e.effect)}% against this page's own average ${band}.`
      : e.tier === "proven-loser"
        ? `${e.label} is running ${pct(e.effect)}% against this page's own average ${band} — proven loser.`
        : e.tier === "emerging"
          ? `${e.label} looks like ${pct(e.effect)}% against average ${band} — emerging, not settled.`
          : `${e.label} sits at ${pct(e.effect)}% against average ${band} — too early to call.`;
  return head + why(e, scored, nickname);
}

/** A format with no data yet, shipped as a visible assumption. */
function priorLesson(f: ContentFormat, day: string, id: (p: string) => string): Lesson {
  return {
    id: id("l_"),
    key: `format:${f.slug}`,
    dim: "format",
    value: f.slug,
    label: `Format: ${f.label}`,
      effect: 0,
    n: 0,
    ciLo: 0,
    ciHi: 0,
    tier: "prior",
    statement: `Assumed, not measured: ${f.mechanic} This page has never posted it.`,
    evidencePostIds: [],
    source: "prior",
    createdAt: new Date().toISOString(),
  };
}

// --- the review ------------------------------------------------------------

export interface Derived {
  set: LessonSet;
  scoring: Scoring;
  effects: LeverEffect[];
}

/**
 * One pass of the loop: score, fit, then write an immutable lesson set whose
 * diff against the previous one IS the visible self-improvement.
 *
 * Nothing is mutated. A lesson that stops being true is not edited away — the
 * new set simply does not carry it, and the diff records the retirement with a
 * reason, so the owner can tell a real finding from a fossil.
 */
export function deriveLessons(
  persona: Persona,
  day: string,
  id: (prefix: string) => string,
  now = new Date(),
): Derived {
  const settings = persona.learn ?? DEFAULT_LEARN;
  const scoring = scorePosts(persona.posts, persona.nickname, settings, now);
  const effects = leverEffects(scoring.scored, persona.nickname);
  const prev = persona.lessonLog[0] ?? null;
  const prevByKey = new Map((prev?.lessons ?? []).map((l) => [l.key, l]));

  const lessons: Lesson[] = [];
  for (const e of effects) {
    if (e.tier === "unproven" && e.n < 2) continue;
    const old = prevByKey.get(e.key);
    lessons.push({
      id: id("l_"),
      key: e.key,
      dim: e.dim,
      value: e.value,
      label: e.label,
      effect: e.effect,
      n: e.n,
      ciLo: e.ciLo,
      ciHi: e.ciHi,
      tier: e.tier,
      statement: statementFor(e, scoring.scored, persona.nickname),
      evidencePostIds: e.evidencePostIds,
      source: "data",
      supersedesId: old?.id,
      createdAt: now.toISOString(),
    });
  }

  // Cold start: until there are three scored posts, the library's assumptions
  // are all there is. They are labelled `prior` so the owner can tell a belief
  // from a finding, and they are the first things real data replaces.
  if (scoring.scored.length < 3) {
    const covered = new Set(lessons.map((l) => l.key));
    for (const f of formatsFor(persona.nickname).slice(0, 6)) {
      if (!covered.has(`format:${f.slug}`)) lessons.push(priorLesson(f, day, id));
    }
  }

  const nowByKey = new Map(lessons.map((l) => [l.key, l]));
  const learned: string[] = [];
  const changedMind: string[] = [];
  const promoted: string[] = [];
  const retired: string[] = [];

  for (const l of lessons) {
    if (l.source !== "data") continue;
    const old = prevByKey.get(l.key);
    if (!old || old.source !== "data") {
      learned.push(l.id);
      continue;
    }
    if (Math.sign(l.effect) !== Math.sign(old.effect) && (l.tier === "proven" || l.tier === "emerging")) {
      changedMind.push(l.id);
      continue;
    }
    if (TIER_RANK[l.tier] > TIER_RANK[old.tier]) promoted.push(l.id);
  }
  for (const [key, old] of prevByKey) {
    if (old.source !== "data") continue;
    const current = nowByKey.get(key);
    const wasBelieved = old.tier === "proven" || old.tier === "emerging";
    if (wasBelieved && (!current || current.tier === "proven-loser" || current.tier === "unproven")) retired.push(old.id);
  }

  const set: LessonSet = {
    version: (prev?.version ?? 0) + 1,
    generatedAt: now.toISOString(),
    day,
    lessons,
    postsConsidered: persona.posts.length,
    postsScored: scoring.scored.length,
    postsMaturing: scoring.maturing.length,
    baselineRate: baselineRate(scoring.scored),
    medianScore: median(scoring.scored.map((s) => s.score)),
    diff: { learned, changedMind, promoted, retired },
    note: noteFor(scoring, lessons, { learned, changedMind, promoted, retired }),
  };
  return { set, scoring, effects };
}

function noteFor(
  scoring: Scoring,
  lessons: Lesson[],
  diff: { learned: string[]; changedMind: string[]; promoted: string[]; retired: string[] },
): string {
  const total = scoring.scored.length + scoring.maturing.length + scoring.unusable.length;
  if (!scoring.scored.length) {
    if (scoring.maturing.length) {
      return `${scoring.maturing.length} post${scoring.maturing.length === 1 ? "" : "s"} still maturing — nothing is scored until a post has had two days and real reach. Running on the format library's assumptions until then.`;
    }
    return total
      ? `Read ${total} posts but none carry reach or reaction numbers yet, so there is nothing to learn from. Sync the Page, or add the stats by hand.`
      : "No posts on file yet. The first sync is what gives this something to read.";
  }
  const best = lessons.find((l) => l.source === "data" && l.effect > 0 && (l.tier === "proven" || l.tier === "emerging"));
  const bits = [`Scored ${scoring.scored.length} of ${total} posts.`];
  if (best) bits.push(`Strongest thing on this page: ${best.label.toLowerCase()} at ${pct(best.effect)}% over its own average across ${best.n} posts.`);
  else bits.push("Nothing clears the confidence bar yet — every lever's interval still crosses zero.");
  const moves: string[] = [];
  if (diff.learned.length) moves.push(`${diff.learned.length} new rule${diff.learned.length === 1 ? "" : "s"}`);
  if (diff.promoted.length) moves.push(`${diff.promoted.length} promoted`);
  if (diff.changedMind.length) moves.push(`${diff.changedMind.length} changed its mind about`);
  if (diff.retired.length) moves.push(`${diff.retired.length} retired`);
  bits.push(moves.length ? `${moves.join(", ")}.` : "No change since the last run.");
  return bits.join(" ");
}

// --- what changes in the next batch ---------------------------------------

export interface Slot {
  role: IdeaRole;
  /** The lever this slot is built on, when there is one. */
  leverKey?: string;
  label: string;
  /** For a wildcard, the library entry to try. */
  format?: ContentFormat;
}

export interface Plan {
  slots: Slot[];
  exploit: LeverEffect[];
  losers: LeverEffect[];
  onTrial: LeverEffect[];
  wildcards: ContentFormat[];
  /** Formats used in the last three days, rested on purpose. */
  fatigued: string[];
  counts: { exploit: number; explore: number; wildcard: number };
  /** Carried so the prompt can word each finding with its own evidence. */
  scored: ScoredPost[];
}

/** Deterministic RNG, so a reload shows the same morning's plan. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0);
  return () => {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) ^ (Math.imul(h ^ (h >>> 13), 3266489909) >>> 0);
    return ((h >>> 0) % 100000) / 100000;
  };
}

/** Box-Muller, for Thompson sampling. */
function gauss(r: () => number, mu: number, sigma: number): number {
  const u = Math.max(1e-9, r());
  const v = r();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Split the next batch between what is proven, what is uncertain and what has
 * never been tried.
 *
 * The explore share decays as the page learns but never reaches zero, and a
 * format used in the last three days loses exploit priority — both exist to
 * stop the agent converging on one post and going stale, which is the failure
 * mode that actually loses an audience.
 */
export function planBatch(persona: Persona, count: number, day: string, now = new Date()): Plan {
  const settings = persona.learn ?? DEFAULT_LEARN;
  const scoring = scorePosts(persona.posts, persona.nickname, settings, now);
  const effects = leverEffects(scoring.scored, persona.nickname);

  const matured = scoring.scored.length;
  const floor = Math.max(1, settings.exploreFloor);
  const exploreCount =
    matured < 10 ? Math.ceil(count * 0.5) : matured < 30 ? Math.max(floor, Math.round(count / 3)) : floor;

  const tried = new Set<string>();
  for (const e of effects) if (e.n >= 1) tried.add(e.key);
  for (const p of persona.posts) for (const k of leverKeysFor(p, persona.nickname)) tried.add(k);
  const untried = formatsFor(persona.nickname).filter((f) => !tried.has(`format:${f.slug}`));

  const threeDaysAgo = now.getTime() - 3 * 86_400_000;
  const fatigued = new Set<string>();
  for (const p of persona.posts) {
    if (postedAtMs(p) >= threeDaysAgo) {
      for (const k of leverKeysFor(p, persona.nickname)) if (k.startsWith("format:")) fatigued.add(k);
    }
  }

  // Built from the CURRENT numbers, not from the stored lesson log.
  //
  // The log is a record for the owner to read; deriving the plan from it made
  // the agent's behaviour depend on whether a derivation had happened to run
  // yet, and on first load it had not — so the day's ideas came out generic
  // while the Learning tab, reading the live figures, showed the real winner.
  // Same arithmetic either way, and now there is no order to get wrong.
  const exploit = effects
    .filter((e) => e.effect > 0 && (e.tier === "proven" || e.tier === "emerging"))
    .map((e) => ({ e, priority: e.ciLo - (fatigued.has(e.key) ? 0.3 : 0) }))
    .sort((a, b) => b.priority - a.priority)
    .map((x) => x.e);
  const losers = effects.filter((e) => e.tier === "proven-loser" || (e.effect < 0 && e.tier === "emerging"));

  // Thompson sampling over the uncertain cells: sample each from its own
  // posterior and take the highest draw, so a wide interval gets its turn
  // instead of always losing to a safer mean.
  const r = rng(day + persona.id);
  const onTrial = effects
    .filter((e) => e.n >= 1 && e.n < 3)
    .map((e) => ({ e, draw: gauss(r, e.effect, Math.max(0.2, (e.ciHi - e.ciLo) / (2 * 1.645))) }))
    .sort((a, b) => b.draw - a.draw)
    .map((x) => x.e);

  const wildcardCount = untried.length ? 1 : 0;
  const explore = Math.min(exploreCount, Math.max(0, count - wildcardCount));
  const exploitCount = Math.max(0, count - explore - wildcardCount);

  const wildcards = Array.from({ length: Math.min(wildcardCount, untried.length) }, (_, i) => {
    return untried[Math.floor(r() * untried.length + i) % untried.length];
  });

  const slots: Slot[] = [];
  for (let i = 0; i < exploitCount; i++) {
    const l = exploit[i % Math.max(1, exploit.length)];
    slots.push(
      l
        ? { role: "exploit", leverKey: l.key, label: l.label }
        : { role: "exploit", label: "No proven lever yet — spread this one across a different mechanic" },
    );
  }
  for (let i = 0; i < explore; i++) {
    const e = onTrial[i % Math.max(1, onTrial.length)];
    slots.push(
      e
        ? { role: "explore", leverKey: e.key, label: `${e.label} — re-test, n=${e.n}` }
        : { role: "explore", label: "Nothing on trial — test any mechanic this page has not settled" },
    );
  }
  for (const f of wildcards) slots.push({ role: "wildcard", leverKey: `format:${f.slug}`, label: `Format: ${f.label}`, format: f });

  return {
    slots,
    exploit: exploit.slice(0, 4),
    losers: losers.slice(0, 6),
    onTrial: onTrial.slice(0, 3),
    wildcards,
    fatigued: [...fatigued],
    counts: { exploit: exploitCount, explore, wildcard: wildcards.length },
    scored: scoring.scored,
  };
}

/**
 * The loop's conclusions, as the block injected into the generation prompt
 * directly after the character document.
 *
 * It names the evidence on every line on purpose: a rule with "n=11, CI +21%
 * to +103%" attached gets followed, and a bare instruction gets averaged in
 * with everything else in the prompt and ignored.
 */
export function lessonsPrompt(persona: Persona, plan: Plan): string {
  const out: string[] = [];

  if (plan.exploit.length) {
    out.push("## PROVEN — do more of this today");
    for (const e of plan.exploit) out.push(`- ${statementFor(e, plan.scored, persona.nickname)}`);
  }
  if (plan.losers.length) {
    out.push("## RETIRED — do not use today");
    for (const e of plan.losers) out.push(`- ${statementFor(e, plan.scored, persona.nickname)}`);
  }
  if (plan.onTrial.length) {
    out.push("## ON TRIAL — being tested today, do not treat as true");
    for (const e of plan.onTrial)
      out.push(`- ${e.label}: ${pct(e.effect)}% at n=${e.n}. Say nothing confident about it.`);
  }
  if (plan.wildcards.length) {
    out.push("## NEVER TRIED — one idea must test this, so the page does not collapse onto one shape");
    for (const f of plan.wildcards) out.push(`- ${f.label}: ${f.mechanic} (e.g. "${f.example}")`);
  }
  if (plan.fatigued.length) {
    out.push("## FATIGUE");
    out.push(`- Used in the last three days, rest them: ${plan.fatigued.map((k) => leverLabel(k, persona.nickname)).join(", ")}.`);
  }
  if (!plan.exploit.length && !plan.losers.length) {
    out.push("## NO DATA YET");
    out.push(
      "- Nothing on this page is proven. Spread today's ideas across different mechanics rather than betting on one, "
        + "so the next review has something to compare.",
    );
  }

  out.push("## TODAY'S SLOTS — one idea each, in this order, and do not merge or reorder them");
  plan.slots.forEach((s, i) => out.push(`${i + 1}. [${s.role}] ${s.label}`));
  out.push(
    "No single format may take more than 2 slots, and the exploit ideas must span at least 3 different subjects. "
      + "Tag every idea with `leverKeys` (\"format:<slug>\", \"hookType:<question|false-claim|command|list|confession|challenge>\", "
      + "\"media:<plain-text|text-on-image|photo|bad-photoshop|carousel|reel|link>\", \"captionLen:<to-12w|13-30w|31-60w|over-60w>\") "
      + "and set `role` to the slot's role. That tagging is the only thing that lets tomorrow's review tell which choice earned the result.",
  );
  return out.join("\n");
}

// --- the chart -------------------------------------------------------------

export interface SeriesPoint {
  /** ISO date of the week's Monday. */
  week: string;
  medianScore: number;
  posts: number;
}

/**
 * Weekly median composite score — the one series that answers "is this
 * actually getting better?" rather than "is it getting more views?".
 */
export function scoreSeries(persona: Persona, now = new Date()): SeriesPoint[] {
  const { scored } = scorePosts(persona.posts, persona.nickname, persona.learn ?? DEFAULT_LEARN, now);
  const byWeek = new Map<string, number[]>();
  for (const s of scored) {
    const t = postedAtMs(s.post);
    if (!t) continue;
    const d = new Date(t);
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const list = byWeek.get(key);
    if (list) list.push(s.score);
    else byWeek.set(key, [s.score]);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, xs]) => ({ week, medianScore: median(xs), posts: xs.length }));
}

/** Levers an idea claims, cleaned up before they are trusted as data. */
export function sanitizeLeverKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item ?? "").trim().toLowerCase();
    const dim = dimOf(s);
    if (!dim) continue;
    const value = slugify(s.slice(dim.length + 1));
    if (value) out.push(`${dim}:${value}`);
  }
  return [...new Set(out)].slice(0, 8);
}

