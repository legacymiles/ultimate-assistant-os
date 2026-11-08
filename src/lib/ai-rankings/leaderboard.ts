// ---------------------------------------------------------------------------
// AI Rankings — the public leaderboard: categories, scoring, filtering.
//
// Everything here is a pure function of the board, so it runs the same on the
// server (the sweep, the API) and in the browser, and can be tested without
// either.
//
// The board is category-first. A visitor arrives wanting one answer — "the
// best open-source TTS", "what video model dropped this week" — so the
// category is the first thing picked and every list below it is about one
// kind of model only.
// ---------------------------------------------------------------------------

import type { Access, ContentRating } from "./types";

// ----- categories ------------------------------------------------------------

export type FamilyId = "language" | "voice" | "image" | "video" | "music" | "spatial" | "sites";

export interface Category {
  id: string;
  label: string;
  /** Short line under the label on the overview card. */
  blurb: string;
  family: FamilyId;
  /**
   * Hugging Face pipeline tags whose trending models the daily sweep files
   * here. Empty = the sweep has no reliable feed for it (lipsync, platforms),
   * and those are added by hand or from a link.
   */
  hfPipelines: string[];
  /**
   * Likes a new HF repo needs before the sweep suggests it. Text generation
   * gets hundreds of uploads a day, most of them fine-tunes, so its bar is
   * far higher than a quiet category like 3D.
   */
  minLikes: number;
}

export interface Family {
  id: FamilyId;
  label: string;
}

export const FAMILIES: Family[] = [
  { id: "language", label: "Language" },
  { id: "voice", label: "Voice" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "music", label: "Music" },
  { id: "spatial", label: "3D and worlds" },
  { id: "sites", label: "Sites" },
];

export const CATEGORIES: Category[] = [
  { id: "llm", label: "LLMs", blurb: "Chat and reasoning models", family: "language", hfPipelines: ["text-generation", "image-text-to-text"], minLikes: 150 },
  { id: "coding-agents", label: "Coding agents", blurb: "Agents and models that write code", family: "language", hfPipelines: [], minLikes: 0 },
  { id: "tts", label: "Text-to-speech", blurb: "Turn text into a voice", family: "voice", hfPipelines: ["text-to-speech"], minLikes: 25 },
  { id: "realtime-voice", label: "Realtime voice", blurb: "Talk to it live, interrupt it", family: "voice", hfPipelines: ["audio-to-audio", "any-to-any"], minLikes: 40 },
  { id: "stt", label: "Speech-to-text", blurb: "Transcribe speech", family: "voice", hfPipelines: ["automatic-speech-recognition"], minLikes: 30 },
  { id: "image", label: "Image", blurb: "Text-to-image generation", family: "image", hfPipelines: ["text-to-image"], minLikes: 60 },
  { id: "image-edit", label: "Image editing", blurb: "Edit a picture with words", family: "image", hfPipelines: ["image-to-image"], minLikes: 40 },
  { id: "text-to-video", label: "Text-to-video", blurb: "Video from a prompt", family: "video", hfPipelines: ["text-to-video"], minLikes: 30 },
  { id: "image-to-video", label: "Image-to-video", blurb: "Animate a still", family: "video", hfPipelines: ["image-to-video"], minLikes: 30 },
  { id: "lipsync", label: "Lipsync and avatars", blurb: "Talking heads and dubbing", family: "video", hfPipelines: [], minLikes: 0 },
  { id: "music", label: "Music", blurb: "Songs and sound from a prompt", family: "music", hfPipelines: ["text-to-audio"], minLikes: 25 },
  { id: "3d", label: "3D", blurb: "Meshes and scenes", family: "spatial", hfPipelines: ["image-to-3d", "text-to-3d"], minLikes: 20 },
  { id: "world-models", label: "World models", blurb: "Interactive, realtime worlds", family: "spatial", hfPipelines: [], minLikes: 0 },
  { id: "platforms", label: "Platforms and sites", blurb: "Where to run all of the above", family: "sites", hfPipelines: [], minLikes: 0 },
];

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryOf(id: string): Category | undefined {
  return CATEGORY_BY_ID.get(id);
}

/** Category label → id, loosely, for filing an analyzer suggestion. */
export function categoryFromLabel(label: string): string | null {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const c of CATEGORIES) {
    if (c.id.replace(/-/g, "") === key || c.label.toLowerCase().replace(/[^a-z0-9]+/g, "") === key) {
      return c.id;
    }
  }
  return null;
}

// ----- records -----------------------------------------------------------------

export interface PublicScore {
  value: number;
  /** elo = arena rating, normalised within its category; percent = 0–100 already. */
  kind: "elo" | "percent";
  /** "TTS Arena Elo", "SWE-bench Verified". */
  label: string;
  source: string;
  url?: string;
  /** yyyy-mm-dd the number was read. */
  asOf?: string;
}

export interface Model {
  id: string;
  name: string;
  maker: string;
  category: string;
  url: string;
  /** "owner/repo" — what dedupes the sweep against the board. */
  hfId?: string;
  summary: string;
  /** yyyy-mm-dd. When the MODEL came out, which is what "just dropped" means. */
  releasedAt: string;
  /** When it went on this board. */
  addedAt: string;
  updatedAt: string;
  openSource: boolean;
  runsLocally: boolean;
  access: Access;
  license?: string;
  features: string[];
  tags: string[];
  publicScore?: PublicScore;
  /** The owner's own 1–10. */
  myRating?: number;
  /** The owner's take, shown to visitors. */
  note?: string;
  contentRating?: ContentRating;
}

/** A release the sweep noticed, waiting for the owner. */
export interface InboxItem {
  id: string;
  hfId: string;
  name: string;
  maker: string;
  category: string;
  url: string;
  releasedAt: string;
  likes: number;
  downloads: number;
  license?: string;
  pipeline: string;
  foundAt: string;
}

export interface PublicBoard {
  version: 1;
  models: Model[];
  inbox: InboxItem[];
  /** HF ids the owner said no to, so the sweep never offers them again. */
  dismissed: string[];
  lastSweepAt?: string;
  lastSweepNote?: string;
}

export const EMPTY_BOARD: PublicBoard = { version: 1, models: [], inbox: [], dismissed: [] };

// ----- scoring -------------------------------------------------------------------

/** Elo points per score point: 400 Elo (10:1 odds) spans the whole 0–100 scale. */
const ELO_PER_POINT = 4;

export interface ScoreBreakdown {
  /** 0–100, or null when there is nothing to rank by. */
  total: number | null;
  /** The public score on the 0–100 scale, or null. */
  publicPart: number | null;
  /** The owner's rating on the 0–100 scale, or null. */
  ownerPart: number | null;
}

/** Highest Elo in each category, which the rest are measured from. */
export function eloLeaders(models: Model[]): Map<string, number> {
  const top = new Map<string, number>();
  for (const m of models) {
    if (m.publicScore?.kind !== "elo") continue;
    const cur = top.get(m.category);
    if (cur === undefined || m.publicScore.value > cur) top.set(m.category, m.publicScore.value);
  }
  return top;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * One model's score.
 *
 * Elo is relative, so it is read as a distance from the category leader: the
 * leader scores 100 and every 4 Elo behind costs a point. That keeps a TTS
 * arena (centred near 1000) and an LLM arena (near 1400) on one scale without
 * pretending their raw numbers mean the same thing — and a category with a
 * single Elo entry still scores it sensibly instead of dividing by zero.
 */
export function scoreOf(model: Model, leaders: Map<string, number>): ScoreBreakdown {
  let publicPart: number | null = null;
  const ps = model.publicScore;
  if (ps && Number.isFinite(ps.value)) {
    if (ps.kind === "percent") publicPart = clamp(ps.value);
    else {
      const top = leaders.get(model.category) ?? ps.value;
      publicPart = clamp(100 - (top - ps.value) / ELO_PER_POINT);
    }
  }
  const ownerPart =
    model.myRating !== undefined && Number.isFinite(model.myRating)
      ? clamp(model.myRating * 10)
      : null;

  let total: number | null = null;
  if (publicPart !== null && ownerPart !== null) total = (publicPart + ownerPart) / 2;
  else total = publicPart ?? ownerPart;
  return { total: total === null ? null : Math.round(total * 10) / 10, publicPart, ownerPart };
}

export interface RankedModel {
  model: Model;
  score: ScoreBreakdown;
  /** 1-based within its category, among ranked models; undefined = unranked. */
  rank?: number;
}

/**
 * Every model with its score and its rank in its own category.
 *
 * Ranks are computed over the WHOLE board, not the filtered view: switching on
 * "open source" should show the open models at their true positions (#3, #5),
 * not renumber them as if the closed leaders didn't exist.
 */
export function rankAll(models: Model[]): Map<string, RankedModel> {
  const leaders = eloLeaders(models);
  const out = new Map<string, RankedModel>();
  const byCat = new Map<string, RankedModel[]>();
  for (const m of models) {
    const r: RankedModel = { model: m, score: scoreOf(m, leaders) };
    out.set(m.id, r);
    const list = byCat.get(m.category) ?? [];
    list.push(r);
    byCat.set(m.category, list);
  }
  for (const list of byCat.values()) {
    list
      .filter((r) => r.score.total !== null)
      .sort(compareRanked)
      .forEach((r, i) => (r.rank = i + 1));
  }
  return out;
}

/** Higher score first; a tie goes to the newer release, then the name. */
function compareRanked(a: RankedModel, b: RankedModel): number {
  const d = (b.score.total ?? -1) - (a.score.total ?? -1);
  if (d !== 0) return d;
  const r = b.model.releasedAt.localeCompare(a.model.releasedAt);
  return r !== 0 ? r : a.model.name.localeCompare(b.model.name);
}

// ----- filtering -------------------------------------------------------------------

export type ReleasedWithin = "any" | "7" | "30" | "90";

export interface BoardFilters {
  query: string;
  openSource: boolean;
  runsLocally: boolean;
  free: boolean;
  released: ReleasedWithin;
}

export const NO_FILTERS: BoardFilters = {
  query: "",
  openSource: false,
  runsLocally: false,
  free: false,
  released: "any",
};

export function filtersActive(f: BoardFilters): boolean {
  return Boolean(f.query.trim() || f.openSource || f.runsLocally || f.free || f.released !== "any");
}

const DAY = 24 * 60 * 60 * 1000;

/** yyyy-mm-dd as local midnight — a date typed as a day means that day where you are. */
export function dayMs(date: string): number {
  const t = new Date(`${date.slice(0, 10)}T00:00:00`).getTime();
  return Number.isNaN(t) ? NaN : t;
}

export function daysSince(date: string, now = Date.now()): number {
  const t = dayMs(date);
  if (Number.isNaN(t)) return Infinity;
  return Math.max(0, Math.floor((now - t) / DAY));
}

function matchesQuery(m: Model, q: string): boolean {
  if (!q) return true;
  const hay = [m.name, m.maker, m.summary, m.note ?? "", m.license ?? "", m.hfId ?? "", ...m.tags, ...m.features]
    .join(" ")
    .toLowerCase();
  // Every word must appear, so "open voice clone" narrows instead of widening.
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export function filterModels(models: Model[], f: BoardFilters, now = Date.now()): Model[] {
  const q = f.query.trim();
  return models.filter((m) => {
    if (f.openSource && !m.openSource) return false;
    if (f.runsLocally && !m.runsLocally) return false;
    if (f.free && m.access === "paid") return false;
    if (f.released !== "any" && daysSince(m.releasedAt, now) > Number(f.released)) return false;
    return matchesQuery(m, q);
  });
}

/** Ranked first by rank, then the unranked by newest release. */
export function topRanked(models: Model[], ranks: Map<string, RankedModel>): RankedModel[] {
  const rows = models.map((m) => ranks.get(m.id)!).filter(Boolean);
  return rows.sort((a, b) => {
    if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
    if (a.rank !== undefined) return -1;
    if (b.rank !== undefined) return 1;
    return b.model.releasedAt.localeCompare(a.model.releasedAt);
  });
}

/** Newest release first. */
export function justDropped(models: Model[], ranks: Map<string, RankedModel>): RankedModel[] {
  return models
    .map((m) => ranks.get(m.id)!)
    .filter(Boolean)
    .sort((a, b) => {
      const d = b.model.releasedAt.localeCompare(a.model.releasedAt);
      return d !== 0 ? d : a.model.name.localeCompare(b.model.name);
    });
}

/** Released this recently counts as fresh: the dot on a category, the NEW badge. */
export const FRESH_DAYS = 14;

export function isFresh(m: Pick<Model, "releasedAt">, now = Date.now()): boolean {
  return daysSince(m.releasedAt, now) <= FRESH_DAYS;
}

/** "today", "3 days ago", "2 weeks ago", "Mar 2026". */
export function releasedLabel(date: string, now = Date.now()): string {
  const d = daysSince(date, now);
  if (!Number.isFinite(d)) return "date unknown";
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  const t = new Date(dayMs(date));
  return t.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ----- dedupe ------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function urlKey(u: string): string {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

/** Whether a candidate is already on the board — by HF id, then URL, then name. */
export function findExisting(
  models: Model[],
  c: { hfId?: string; url?: string; name?: string },
): Model | undefined {
  const hf = c.hfId?.toLowerCase();
  const url = c.url ? urlKey(c.url) : "";
  const name = c.name ? norm(c.name) : "";
  return models.find(
    (m) =>
      (hf && m.hfId?.toLowerCase() === hf) ||
      (url && urlKey(m.url) === url) ||
      (name && norm(m.name) === name),
  );
}
