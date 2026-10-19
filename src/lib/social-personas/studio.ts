// ---------------------------------------------------------------------------
// Personas Studio — the pure half of the new screens: drafts and the calendar,
// per-video progress, and the numbers the Studio home and Analytics show.
//
// Everything here is deterministic and tested (studio.test.ts). The UI only
// draws what these functions return, so a number on screen always has a test
// behind how it was worked out.
// ---------------------------------------------------------------------------

import { localDay, uid } from "./logic";
import {
  CAPTION_LIMIT,
  type Account,
  type Draft,
  type Idea,
  type Persona,
  type Post,
  type SocialPlatform,
  type Stage,
  type StatSnapshot,
} from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// --- drafts ------------------------------------------------------------------

export function newDraft(partial: Partial<Draft> = {}): Draft {
  const now = new Date().toISOString();
  return {
    id: uid("d_"),
    title: "",
    hook: "",
    caption: "",
    hashtags: [],
    outline: [],
    notes: "",
    stage: "idea",
    accountIds: [],
    scheduledAt: null,
    media: null,
    results: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/** Turn a saved idea into a draft in the pipeline, aimed at the persona's accounts. */
export function draftFromIdea(idea: Idea, persona: Persona): Draft {
  const accounts = idea.platform === "any" ? persona.accounts : persona.accounts.filter((a) => a.platform === idea.platform);
  return newDraft({
    title: idea.title,
    hook: idea.hook,
    outline: idea.outline,
    notes: idea.why ? `Why it should work: ${idea.why}` : "",
    caption: idea.hook && idea.hook !== idea.title ? idea.hook : "",
    stage: "script",
    accountIds: (accounts.length ? accounts : persona.accounts).map((a) => a.id),
    ideaId: idea.id,
  });
}

/** Pull "#tags" out of free text, lower-cased and without duplicates. */
export function parseHashtags(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/#?([\p{L}\p{N}_]{2,40})/gu)) {
    const t = m[1].toLowerCase();
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 30);
}

/**
 * The caption a platform actually gets: the caption, then the hashtags, cut to
 * the platform's limit at a word boundary. X keeps only as many tags as fit.
 */
export function captionFor(draft: Pick<Draft, "caption" | "hashtags" | "title">, platform: SocialPlatform): string {
  const limit = CAPTION_LIMIT[platform];
  const body = (draft.caption || draft.title).trim();
  const tags = draft.hashtags.map((t) => "#" + t.replace(/^#/, ""));
  let text = body;
  for (const tag of tags) {
    const next = text ? `${text}${text.includes("\n\n#") || /#\S+$/.test(text) ? " " : "\n\n"}${tag}` : tag;
    if (next.length > limit) break;
    text = next;
  }
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return (space > limit * 0.6 ? cut.slice(0, space) : cut) + "…";
}

/** Where a draft belongs once something happens to it, from what its results say. */
export function stageFromResults(d: Draft): Stage {
  if (!d.results.length) return d.stage;
  if (d.accountIds.length && d.accountIds.every((id) => d.results.some((r) => r.accountId === id && (r.status === "posted" || r.status === "inbox" || r.status === "manual")))) {
    return "posted";
  }
  if (d.results.some((r) => r.status === "queued" || r.status === "publishing")) return "scheduled";
  return d.stage;
}

/** Fold a result in, replacing the earlier one for the same account (never a duplicate row). */
export function withResult(d: Draft, r: Draft["results"][number]): Draft {
  const results = [...d.results.filter((x) => x.accountId !== r.accountId), r];
  const next = { ...d, results, updatedAt: new Date().toISOString() };
  return { ...next, stage: stageFromResults(next) };
}

/** Drafts in newest-first order (rule U6), scheduled ones by their time. */
export function sortDrafts(drafts: Draft[]): Draft[] {
  return [...drafts].sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
}

// --- the calendar --------------------------------------------------------------

/** Monday of the week holding `d`, as a local date at midnight. */
export function weekStart(d = new Date()): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** The seven local days of a week, as YYYY-MM-DD. */
export function weekDays(start: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => localDay(addDays(start, i)));
}

/** Drafts scheduled on a local day, earliest first. */
export function draftsOn(drafts: Draft[], day: string): Draft[] {
  return drafts
    .filter((d) => d.scheduledAt && localDay(new Date(d.scheduledAt)) === day)
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
}

/**
 * Put a draft on a day. Keeps its time of day if it had one; otherwise uses
 * the persona's best posting hour (or 6 pm, the common evening peak). A time
 * already in the past moves to the next free hour, so nothing is scheduled
 * behind you.
 */
export function scheduleOnDay(draft: Draft, day: string, hour: number | null, now = new Date()): string {
  const [y, m, d] = day.split("-").map(Number);
  const prev = draft.scheduledAt ? new Date(draft.scheduledAt) : null;
  const h = prev ? prev.getHours() : hour ?? 18;
  const min = prev ? prev.getMinutes() : 0;
  const at = new Date(y, m - 1, d, h, min, 0, 0);
  if (at.getTime() <= now.getTime()) {
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    if (localDay(next) === day) return next.toISOString();
  }
  return at.toISOString();
}

// --- per-video progress --------------------------------------------------------

/** A post's stat history, oldest first, falling back to its current stats. */
export function historyOf(p: Post): StatSnapshot[] {
  if (p.history?.length) return p.history;
  return p.stats ? [{ ...p.stats, at: p.addedAt }] : [];
}

export interface CurvePoint {
  /** Hours since the post went up. */
  h: number;
  views: number;
  likes: number;
}

/** The video's growth: views and likes against hours since posting. */
export function growthCurve(p: Post): CurvePoint[] {
  const t0 = Date.parse(p.postedAt || p.addedAt);
  const pts = historyOf(p)
    .map((s) => ({ h: Math.max(0, (Date.parse(s.at) - t0) / HOUR), views: s.views ?? 0, likes: s.likes ?? 0 }))
    .filter((x) => Number.isFinite(x.h));
  // A video starts at zero the moment it is posted.
  if (pts.length && pts[0].h > 0) pts.unshift({ h: 0, views: 0, likes: 0 });
  return pts;
}

/** Views (or likes when a platform hides views) — the number a post is ranked by. */
export function reach(p: Post): number {
  return p.stats?.views ?? (p.stats?.likes != null ? p.stats.likes * 10 : 0);
}

export function engagementRate(p: Post): number | null {
  const v = p.stats?.views;
  if (!v) return null;
  const e = (p.stats?.likes ?? 0) + (p.stats?.comments ?? 0) + (p.stats?.shares ?? 0);
  return e / v;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type Momentum = "breakout" | "above" | "normal" | "below" | "new";

/**
 * How a post is doing against the persona's own normal: its reach divided by
 * the median reach of the persona's other posts on the same platform. Posts
 * younger than six hours are "new" — too early to call.
 */
export function momentum(p: Post, all: Post[], now = Date.now()): { kind: Momentum; ratio: number } {
  const age = now - Date.parse(p.postedAt || p.addedAt);
  const peers = all.filter((x) => x.id !== p.id && x.platform === p.platform).map(reach).filter((n) => n > 0);
  const base = median(peers);
  const ratio = base > 0 ? reach(p) / base : 0;
  if (age < 6 * HOUR) return { kind: "new", ratio };
  if (!base) return { kind: "normal", ratio };
  if (ratio >= 3) return { kind: "breakout", ratio };
  if (ratio >= 1.3) return { kind: "above", ratio };
  if (ratio <= 0.5) return { kind: "below", ratio };
  return { kind: "normal", ratio };
}

/** Views gained in the last `hours`, from the stat history (null when unknown). */
export function gainedSince(p: Post, hours: number, now = Date.now()): number | null {
  const h = historyOf(p).filter((s) => s.views != null);
  if (h.length < 2) return null;
  const cutoff = now - hours * HOUR;
  const latest = h[h.length - 1].views ?? 0;
  if (Date.parse(h[0].at) >= cutoff) return latest - (h[0].views ?? 0);
  // The views at the window's start, read off the line between the readings
  // either side of it — the honest estimate between two syncs.
  for (let i = h.length - 1; i >= 0; i--) {
    const t = Date.parse(h[i].at);
    if (t > cutoff) continue;
    const a = h[i];
    const b = h[i + 1];
    if (!b) return 0;
    const ta = t;
    const tb = Date.parse(b.at);
    const va = a.views ?? 0;
    const vb = b.views ?? 0;
    const at = va + ((vb - va) * (cutoff - ta)) / Math.max(1, tb - ta);
    return Math.round(latest - at);
  }
  return latest - (h[0].views ?? 0);
}

// --- best time to post ---------------------------------------------------------

/**
 * A 7×24 grid (Monday first, local hours) of how well posts published in each
 * slot did — median reach, relative to the persona's overall median. Slots
 * with no posts are null. `top` is the three best slots with ≥1 post.
 */
export function bestTimes(posts: Post[]): { grid: (number | null)[][]; top: { dow: number; hour: number; score: number; n: number }[] } {
  const buckets: number[][][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => [] as number[]));
  const dated = posts.filter((p) => p.postedAt && reach(p) > 0);
  for (const p of dated) {
    const d = new Date(p.postedAt!);
    buckets[(d.getDay() + 6) % 7][d.getHours()].push(reach(p));
  }
  const overall = median(dated.map(reach)) || 1;
  const grid = buckets.map((row) => row.map((b) => (b.length ? median(b) / overall : null)));
  const top: { dow: number; hour: number; score: number; n: number }[] = [];
  grid.forEach((row, dow) => row.forEach((score, hour) => score != null && top.push({ dow, hour, score, n: buckets[dow][hour].length })));
  top.sort((a, b) => b.score - a.score || b.n - a.n);
  return { grid, top: top.slice(0, 3) };
}

/**
 * The persona's best posting hour, once its history says so: the best slot
 * must hold at least two posts, so one lucky video doesn't move the calendar.
 */
export function bestHour(posts: Post[]): number | null {
  const best = bestTimes(posts).top.find((t) => t.n >= 2);
  return best ? best.hour : null;
}

// --- totals --------------------------------------------------------------------

export interface PersonaTotals {
  followers: number;
  posts: number;
  views7d: number;
  posts7d: number;
  medianViews: number;
  engagement: number | null;
  /** Daily views over the last 14 days (oldest first), for the sparkline. */
  daily: number[];
  scheduled: number;
  nextUp: Draft | null;
  ideasWaiting: number;
}

/**
 * The numbers on a persona's Studio-home row.
 *
 * "Views in the last 7 days" is views GAINED in the window where the history
 * shows it, and otherwise the views of posts published in the window — never
 * the account's lifetime total relabelled.
 */
export function personaTotals(p: Persona, now = Date.now()): PersonaTotals {
  const weekAgo = now - 7 * DAY;
  let views7d = 0;
  let posts7d = 0;
  for (const post of p.posts) {
    const posted = Date.parse(post.postedAt || post.addedAt);
    if (posted >= weekAgo) {
      // Posted this week: every view it has came this week.
      posts7d += 1;
      views7d += post.stats?.views ?? 0;
    } else {
      const gained = gainedSince(post, 7 * 24, now);
      if (gained != null) views7d += Math.max(0, gained);
    }
  }
  const rates = p.posts.map(engagementRate).filter((x): x is number => x != null);
  const upcoming = p.drafts.filter((d) => d.scheduledAt && Date.parse(d.scheduledAt) >= now && d.stage !== "posted");
  upcoming.sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
  const today = localDay(new Date(now));
  return {
    followers: p.accounts.reduce((s, a) => s + (a.followers ?? 0), 0),
    posts: p.posts.length,
    views7d,
    posts7d,
    medianViews: median(p.posts.map((x) => x.stats?.views ?? 0).filter((n) => n > 0)),
    engagement: rates.length ? median(rates) : null,
    daily: dailyViews(p.posts, 14, now),
    scheduled: upcoming.length,
    nextUp: upcoming[0] ?? null,
    ideasWaiting: (p.ideaDays.find((d) => d.date === today)?.ideas ?? []).filter((i) => i.status === "new" || i.status === "saved").length,
  };
}

/**
 * Views per day over the last `days` days. A post's first reading counts on
 * the day it was posted (we don't know how those views were spread); every
 * later reading adds what it gained on the day it was taken.
 */
export function dailyViews(posts: Post[], days: number, now = Date.now()): number[] {
  const out = new Array<number>(days).fill(0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const startMs = end.getTime() - days * DAY + 1;
  const add = (ms: number, n: number) => {
    const s = Math.floor((ms - startMs) / DAY);
    if (n > 0 && s >= 0 && s < days) out[s] += n;
  };
  for (const p of posts) {
    const h = historyOf(p).filter((x) => x.views != null);
    if (!h.length) continue;
    add(Date.parse(p.postedAt || p.addedAt), h[0].views ?? 0);
    for (let i = 1; i < h.length; i++) add(Date.parse(h[i].at), (h[i].views ?? 0) - (h[i - 1].views ?? 0));
  }
  return out;
}

/** Follower count history across a persona's accounts (summed per day). */
export function followerSeries(accounts: Account[]): { day: string; n: number }[] {
  const byDay = new Map<string, Map<string, number>>();
  for (const a of accounts) {
    for (const pt of a.followerHistory ?? []) {
      const day = pt.at.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, new Map());
      byDay.get(day)!.set(a.id, pt.n);
    }
  }
  const days = [...byDay.keys()].sort();
  const last = new Map<string, number>();
  return days.map((day) => {
    for (const [id, n] of byDay.get(day)!) last.set(id, n);
    return { day, n: [...last.values()].reduce((s, n) => s + n, 0) };
  });
}

/** Add today's follower count to an account's history (one point per day). */
export function withFollowerPoint(a: Account, n: number | null | undefined, at = new Date().toISOString()): Account {
  if (n == null) return a;
  const day = at.slice(0, 10);
  const hist = (a.followerHistory ?? []).filter((x) => x.at.slice(0, 10) !== day);
  return { ...a, followers: n, followerHistory: [...hist, { at, n }].slice(-120) };
}

/** What each format/hook style earns, for the "what's working" table. */
export function byFormat(posts: Post[]): { format: string; posts: number; median: number }[] {
  const m = new Map<string, number[]>();
  for (const p of posts) {
    const f = (p.format || "").trim().toLowerCase();
    if (!f || !reach(p)) continue;
    m.set(f, [...(m.get(f) ?? []), reach(p)]);
  }
  return [...m.entries()].map(([format, xs]) => ({ format, posts: xs.length, median: median(xs) })).sort((a, b) => b.median - a.median);
}

export function compact(n: number): string {
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/**
 * The next good time to post (Buffer's "next open slot"): the persona's best
 * hours from its own history (or 12 pm / 6 pm / 8 pm, the common short-video
 * peaks, until there's data), the first one that is at least `leadMin`
 * minutes away and not within 2 hours of another scheduled draft.
 */
export function nextBestSlot(p: Persona, now = new Date(), leadMin = 20): string {
  const fromData = bestTimes(p.posts).top.filter((t) => t.n >= 2).map((t) => t.hour);
  const hours = [...new Set([...fromData, 18, 12, 20])].sort((a, b) => a - b);
  const taken = p.drafts.filter((d) => d.scheduledAt && d.stage !== "posted").map((d) => Date.parse(d.scheduledAt!));
  for (let day = 0; day < 30; day++) {
    for (const h of hours) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, h, 0, 0, 0);
      if (at.getTime() < now.getTime() + leadMin * 60_000) continue;
      if (taken.some((t) => Math.abs(t - at.getTime()) < 2 * HOUR)) continue;
      return at.toISOString();
    }
  }
  return new Date(now.getTime() + DAY).toISOString();
}
