// ---------------------------------------------------------------------------
// AI Rankings — every change the owner can make to the public board.
//
// Pure: (board, action, now) → new board or a plain-English error. The route
// does the owner check and the saving; this decides what a change means, so
// it can be tested without a server.
//
// Input is untrusted even from the owner's own browser — it arrives as JSON
// and is written to a public page — so every model goes through cleanModel.
// ---------------------------------------------------------------------------

import { OWNER_SOURCE } from "./dimensions";
import { ALL_DIM_IDS, categoryOf, dimOf, findExisting } from "./leaderboard";
import type { InboxItem, Model, PublicBoard, PublicScore } from "./leaderboard";
import type { Access, ContentRating } from "./types";

export type BoardAction =
  | { type: "upsert"; model: Partial<Model> }
  | { type: "delete"; id: string }
  | { type: "rate"; id: string; myRating: number | null }
  | { type: "setDim"; id: string; dim: string; kind: "rating" | "metric"; value: number | null }
  | { type: "approve"; inboxId: string; category?: string }
  | { type: "dismiss"; inboxId: string }
  | { type: "dismissAll" }
  | { type: "import"; models: Partial<Model>[] };

export type ActionResult =
  | { ok: true; board: PublicBoard; message: string; id?: string }
  | { ok: false; error: string };

const ACCESS: Access[] = ["free", "freemium", "paid"];
const RATINGS: ContentRating[] = ["unknown", "sfw", "soft", "explicit"];

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, max = 12) =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => str(x, 80)).filter(Boolean))].slice(0, max)
    : [];

function cleanDate(v: unknown, fallback: string): string {
  const s = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : fallback;
}

function cleanUrl(v: unknown): string {
  const s = str(v, 500);
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    // A public page renders this as a link, so only http(s) ever gets through.
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

function cleanScore(v: unknown): PublicScore | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const value = Number(o.value);
  if (!Number.isFinite(value)) return undefined;
  const kind = o.kind === "percent" ? "percent" : "elo";
  if (kind === "percent" && (value < 0 || value > 100)) return undefined;
  return {
    value,
    kind,
    label: str(o.label, 60) || (kind === "elo" ? "Arena Elo" : "Benchmark"),
    source: str(o.source, 60) || "Unknown",
    url: cleanUrl(o.url) || undefined,
    asOf: o.asOf ? cleanDate(o.asOf, "") || undefined : undefined,
  };
}

function cleanRating(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Math.round(Number(v) * 2) / 2;
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : undefined;
}

const DIM_IDS = new Set(ALL_DIM_IDS);

/**
 * A map of dimension id → number, keeping only the ids dimensions.ts knows.
 *
 * An unknown key is dropped rather than rejected: a rating typed under one
 * category and then moved to another would otherwise block the save, and the
 * value is harmless — it simply has no column to appear in.
 */
function cleanDimMap(v: unknown, clean: (x: unknown) => number | undefined): Record<string, number> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>).slice(0, 60)) {
    if (!DIM_IDS.has(k)) continue;
    const n = clean(raw);
    if (n !== undefined) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Where each measurement came from, kept so a refresh never overwrites a typed one. */
function cleanSourceMap(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>).slice(0, 60)) {
    if (!DIM_IDS.has(k)) continue;
    const s = str(raw, 60);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * A measurement in its dimension's own unit.
 *
 * Any non-negative number is allowed — the units run from 0.003 dollars an
 * image to a million tokens of context — so the only rules are that it is a
 * real number, not negative, and not absurd enough to be a paste accident.
 */
function cleanMeasure(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return undefined;
  // Keep four significant decimals: $0.0035 an image is a real price.
  return Math.round(n * 10000) / 10000;
}

/** A model from untrusted input, or the reason it can't be one. */
export function cleanModel(
  raw: Partial<Model>,
  now: string,
  existing?: Model,
): Model | string {
  const name = str(raw.name, 80) || existing?.name || "";
  if (!name) return "Give it a name.";
  const category = str(raw.category, 40) || existing?.category || "";
  if (!categoryOf(category)) return "Pick a category.";
  const url = cleanUrl(raw.url) || existing?.url || "";
  if (!url) return "Add a link to its page.";
  const today = now.slice(0, 10);

  return {
    id: existing?.id ?? (str(raw.id, 80) || `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`),
    name,
    maker: str(raw.maker, 60) || existing?.maker || "",
    category,
    url,
    hfId: str(raw.hfId, 120) || existing?.hfId || undefined,
    summary: str(raw.summary, 160) || (raw.summary === "" ? "" : existing?.summary ?? ""),
    // An empty date is a real answer — "the release date could not be
    // confirmed" — and the board already reads it as "date unknown". Falling
    // back to today instead would date an arena find to the day it was found
    // and hand it a full recency score it has not earned.
    releasedAt: raw.releasedAt === "" ? "" : cleanDate(raw.releasedAt, existing?.releasedAt ?? today),
    addedAt: existing?.addedAt ?? (str(raw.addedAt, 30) || now),
    updatedAt: now,
    openSource: typeof raw.openSource === "boolean" ? raw.openSource : existing?.openSource ?? false,
    runsLocally: typeof raw.runsLocally === "boolean" ? raw.runsLocally : existing?.runsLocally ?? false,
    access: ACCESS.includes(raw.access as Access) ? (raw.access as Access) : existing?.access ?? "paid",
    license: str(raw.license, 60) || existing?.license || undefined,
    features: raw.features !== undefined ? strList(raw.features) : existing?.features ?? [],
    tags: raw.tags !== undefined ? strList(raw.tags, 8).map((t) => t.toLowerCase()) : existing?.tags ?? [],
    publicScore: "publicScore" in raw ? cleanScore(raw.publicScore) : existing?.publicScore,
    myRating: "myRating" in raw ? cleanRating(raw.myRating) : existing?.myRating,
    ratings: "ratings" in raw ? cleanDimMap(raw.ratings, cleanRating) : existing?.ratings,
    metrics: "metrics" in raw ? cleanDimMap(raw.metrics, cleanMeasure) : existing?.metrics,
    metricsFrom: "metricsFrom" in raw ? cleanSourceMap(raw.metricsFrom) : existing?.metricsFrom,
    measuredAt: "measuredAt" in raw ? cleanDate(raw.measuredAt, "") || undefined : existing?.measuredAt,
    note: raw.note !== undefined ? str(raw.note, 600) || undefined : existing?.note,
    contentRating: RATINGS.includes(raw.contentRating as ContentRating)
      ? raw.contentRating === "unknown" ? undefined : (raw.contentRating as ContentRating)
      : existing?.contentRating,
  };
}

/**
 * What an approved inbox item becomes.
 *
 * A Hugging Face repo is open weights you can download and run, which is why
 * those three facts can be assumed. An arena entry is not: it says a model
 * exists and nothing about where its weights are, so one starts as hosted and
 * paid — the conservative reading — and carries no Hugging Face id.
 */
export function modelFromInbox(item: InboxItem, category: string, now: string): Partial<Model> {
  const fromHf = item.source !== "aa";
  return {
    name: item.name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim(),
    maker: item.maker,
    category,
    url: item.url,
    hfId: fromHf ? item.hfId : undefined,
    summary: "",
    releasedAt: item.releasedAt,
    addedAt: now,
    openSource: fromHf,
    runsLocally: fromHf,
    access: fromHf ? "free" : "paid",
    license: item.license,
    tags: [],
    features: [],
  };
}

export function applyAction(board: PublicBoard, action: BoardAction, now: string): ActionResult {
  switch (action.type) {
    case "upsert": {
      const id = str(action.model.id, 80);
      const existing = id ? board.models.find((m) => m.id === id) : undefined;
      if (id && !existing) return { ok: false, error: "That model isn't on the board any more." };
      const m = cleanModel(action.model, now, existing);
      if (typeof m === "string") return { ok: false, error: m };
      if (!existing) {
        const dupe = findExisting(board.models, m);
        if (dupe) return { ok: false, error: `${dupe.name} is already on the board.` };
      }
      const models = existing
        ? board.models.map((x) => (x.id === m.id ? m : x))
        : [m, ...board.models];
      // A model added by hand that was waiting in the inbox leaves the inbox.
      const inbox = m.hfId ? board.inbox.filter((i) => i.hfId.toLowerCase() !== m.hfId!.toLowerCase()) : board.inbox;
      return { ok: true, board: { ...board, models, inbox }, message: existing ? "Saved" : `Added ${m.name}`, id: m.id };
    }
    case "delete": {
      const m = board.models.find((x) => x.id === action.id);
      if (!m) return { ok: false, error: "That model isn't on the board any more." };
      return { ok: true, board: { ...board, models: board.models.filter((x) => x.id !== action.id) }, message: `Removed ${m.name}` };
    }
    case "rate": {
      const m = board.models.find((x) => x.id === action.id);
      if (!m) return { ok: false, error: "That model isn't on the board any more." };
      const next = cleanModel({ myRating: action.myRating as number | undefined }, now, m);
      if (typeof next === "string") return { ok: false, error: next };
      return { ok: true, board: { ...board, models: board.models.map((x) => (x.id === m.id ? next : x)) }, message: "Rating saved", id: m.id };
    }
    case "setDim": {
      // One dimension at a time, so the owner can score a model from the
      // sheet without opening the whole edit form — and so a half-filled
      // row is saved as it is filled rather than all at the end.
      const m = board.models.find((x) => x.id === action.id);
      if (!m) return { ok: false, error: "That model isn't on the board any more." };
      const dim = dimOf(m.category, action.dim);
      if (!dim) return { ok: false, error: "That isn't one of this category's dimensions." };
      const measuring = action.kind === "metric";
      if (measuring && !dim.metric) return { ok: false, error: `${dim.label} is a 1–10 rating, not a measurement.` };
      const clearing = action.value === null || action.value === undefined;
      const value = measuring ? cleanMeasure(action.value) : cleanRating(action.value);
      if (!clearing && value === undefined) {
        return {
          ok: false,
          error: measuring
            ? `Give ${dim.label.toLowerCase()} a number in ${dim.metric!.unit}.`
            : `${dim.label} is a number from 1 to 10.`,
        };
      }

      const next = { ...((measuring ? m.metrics : m.ratings) ?? {}) };
      if (value === undefined) delete next[action.dim];
      else next[action.dim] = value;
      const kept = Object.keys(next).length ? next : undefined;

      // A measurement typed here is the owner's, so the daily refresh leaves
      // it alone from now on; clearing it hands the dimension back.
      const from = { ...(m.metricsFrom ?? {}) };
      if (value === undefined) delete from[action.dim];
      else from[action.dim] = OWNER_SOURCE;

      const updated: Model = measuring
        ? {
            ...m,
            metrics: kept,
            metricsFrom: Object.keys(from).length ? from : undefined,
            measuredAt: value === undefined ? m.measuredAt : now.slice(0, 10),
            updatedAt: now,
          }
        : { ...m, ratings: kept, updatedAt: now };
      return {
        ok: true,
        board: { ...board, models: board.models.map((x) => (x.id === m.id ? updated : x)) },
        message: value === undefined ? `${dim.label} cleared` : `${dim.label} saved`,
        id: m.id,
      };
    }
    case "approve": {
      const item = board.inbox.find((i) => i.id === action.inboxId);
      if (!item) return { ok: false, error: "That suggestion has already been handled." };
      const category = action.category && categoryOf(action.category) ? action.category : item.category;
      const inbox = board.inbox.filter((i) => i.id !== item.id);
      if (findExisting(board.models, { hfId: item.hfId, url: item.url })) {
        return { ok: true, board: { ...board, inbox }, message: `${item.name} was already on the board` };
      }
      const m = cleanModel(modelFromInbox(item, category, now), now);
      if (typeof m === "string") return { ok: false, error: m };
      return { ok: true, board: { ...board, inbox, models: [m, ...board.models] }, message: `Added ${m.name}`, id: m.id };
    }
    case "dismiss": {
      const item = board.inbox.find((i) => i.id === action.inboxId);
      if (!item) return { ok: true, board, message: "Already handled" };
      return {
        ok: true,
        board: {
          ...board,
          inbox: board.inbox.filter((i) => i.id !== item.id),
          dismissed: [...new Set([...board.dismissed, item.hfId])].slice(-2000),
        },
        message: `Dismissed ${item.name}`,
      };
    }
    case "dismissAll": {
      const n = board.inbox.length;
      return {
        ok: true,
        board: { ...board, inbox: [], dismissed: [...new Set([...board.dismissed, ...board.inbox.map((i) => i.hfId)])].slice(-2000) },
        message: `Dismissed ${n} suggestion${n === 1 ? "" : "s"}`,
      };
    }
    case "import": {
      let models = board.models;
      let added = 0;
      for (const raw of (action.models ?? []).slice(0, 500)) {
        const m = cleanModel(raw, now);
        if (typeof m === "string" || findExisting(models, m)) continue;
        models = [m, ...models];
        added += 1;
      }
      return { ok: true, board: { ...board, models }, message: added ? `Imported ${added}` : "Nothing new to import" };
    }
  }
}
