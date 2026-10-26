// ---------------------------------------------------------------------------
// Skills Library — what each skill COSTS, not just how often it runs.
//
// The call counts in usage.ts say which skills get used. This says which ones
// burn tokens, so the expensive ones can be found, capped, or moved to a
// cheaper model — and which ones cost nothing because nobody uses them, so
// they can be retired.
//
// Where the numbers come from:
//   - jarvis       every AI call a Jarvis skill/workflow makes is metered by
//                  provider.ts (real cost from OpenRouter when it reports it)
//   - claude-code  the PC/VPS Stop hook (scripts/skill-sync.mjs usage-cost)
//                  reads the session transcript and sends the tokens each
//                  skill's turn used; priced from the model catalogue, so
//                  marked as an estimate (a subscription pays nothing extra —
//                  the figure is what it WOULD cost at API prices)
//
// Plus two owner controls per skill:
//   cap   dollars per week. Over it, Jarvis drops that skill to the cheapest
//         tier that can do the job until the week resets.
//   pin   a fixed model tier, so Jev never routes it ("felix always gets the
//         best model", "grammar always free").
//
// And Jev routing: before a Jarvis skill runs, the decision model picks the
// tier it needs (see routeTier). Every routing is counted per tier, so the
// page can show how often a skill was sent to a cheaper model.
//
// Pure — provider.ts, the routes, the page and the tests share it.
// ---------------------------------------------------------------------------

import type { Skill } from "./types";
import { callNames, usageFor, type UsageData } from "./usage";

export const SPEND_DOC = "skill-spend";

/** The router rungs Jev may pick between for a skill. Cheapest first. */
export const ROUTE_TIERS = ["free", "harder", "hardest"] as const;
export type RouteTier = (typeof ROUTE_TIERS)[number];

export const TIER_LABEL: Record<RouteTier, string> = {
  free: "Free model",
  harder: "Cheap model",
  hardest: "Best model",
};

export function isRouteTier(v: unknown): v is RouteTier {
  return ROUTE_TIERS.includes(v as RouteTier);
}

export type SpendSource = "jarvis" | "claude-code";

export interface SkillSpend {
  /** Metered runs (one per AI call for Jarvis, one per turn for Claude Code). */
  runs: number;
  promptTokens: number;
  completionTokens: number;
  /** Dollars, lifetime. */
  cost: number;
  /** True when any of `cost` was priced from the catalogue rather than reported. */
  estimated?: boolean;
  /** ISO week the `week*` fields belong to ("2026-W43"). */
  week: string;
  weekCost: number;
  weekTokens: number;
  /** How many runs each tier answered (Jev's routing, pins and caps included). */
  routed: Partial<Record<RouteTier, number>>;
  /** Runs Jev sent to a cheaper tier than the request would otherwise have taken. */
  savedRuns: number;
  by: Partial<Record<SpendSource, number>>;
  last: string;
}

export interface JevStats {
  /** Routing decisions asked for, answered or not. */
  calls: number;
  /** Decisions confident enough to use. */
  used: number;
  /** Dollars Jev itself cost. */
  cost: number;
  /** Total decision time, for the average. */
  ms: number;
}

export interface SpendDoc {
  v: 1;
  skills: Record<string, SkillSpend>;
  /** Dollars per week, per skill key. */
  caps: Record<string, number>;
  pins: Record<string, RouteTier>;
  jev: JevStats;
  /** Recent event ids, so a retried hook never counts a turn twice. */
  seen: string[];
}

export const EMPTY_SPEND: SpendDoc = { v: 1, skills: {}, caps: {}, pins: {}, jev: { calls: 0, used: 0, cost: 0, ms: 0 }, seen: [] };

const SEEN_MAX = 800;
const MAX_KEYS = 2000;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : 0);
const pos = (v: unknown) => Math.max(0, num(v));

/** "Studio:Film-3D " / "/felix" → "studio:film-3d" / "felix". Junk → "". */
export function spendKey(raw: unknown): string {
  const k = String(raw ?? "")
    .trim()
    .replace(/^[@/]+/, "")
    .toLowerCase();
  return k && k.length <= 120 && /^[a-z0-9][a-z0-9._:-]*$/.test(k) ? k : "";
}

/** ISO-8601 week of a date, e.g. "2026-W43". Weeks start Monday, like the cap resets. */
export function weekKey(at: Date | string | number = Date.now()): string {
  const d = new Date(at);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const day = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(t - day * 86_400_000 + 3 * 86_400_000);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = 1 + Math.floor((thursday.getTime() - yearStart) / (7 * 86_400_000));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** A fresh, valid copy of whatever was stored. */
export function normalizeSpend(raw: unknown): SpendDoc {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<SpendDoc>;
  const skills: SpendDoc["skills"] = {};
  for (const [k, s] of Object.entries(r.skills ?? {})) {
    const key = spendKey(k);
    if (!key || !s || typeof s !== "object") continue;
    const routed: SkillSpend["routed"] = {};
    for (const t of ROUTE_TIERS) if (pos(s.routed?.[t])) routed[t] = Math.floor(pos(s.routed?.[t]));
    skills[key] = {
      runs: Math.floor(pos(s.runs)),
      promptTokens: Math.floor(pos(s.promptTokens)),
      completionTokens: Math.floor(pos(s.completionTokens)),
      cost: pos(s.cost),
      ...(s.estimated ? { estimated: true } : {}),
      week: typeof s.week === "string" ? s.week : weekKey(),
      weekCost: pos(s.weekCost),
      weekTokens: Math.floor(pos(s.weekTokens)),
      routed,
      savedRuns: Math.floor(pos(s.savedRuns)),
      by: { ...(s.by ?? {}) },
      last: String(s.last ?? ""),
    };
  }
  const caps: SpendDoc["caps"] = {};
  for (const [k, v] of Object.entries(r.caps ?? {})) {
    const key = spendKey(k);
    if (key && pos(v) > 0) caps[key] = Math.round(pos(v) * 100) / 100;
  }
  const pins: SpendDoc["pins"] = {};
  for (const [k, v] of Object.entries(r.pins ?? {})) {
    const key = spendKey(k);
    if (key && isRouteTier(v)) pins[key] = v;
  }
  const j = (r.jev ?? {}) as Partial<JevStats>;
  return {
    v: 1,
    skills,
    caps,
    pins,
    jev: { calls: Math.floor(pos(j.calls)), used: Math.floor(pos(j.used)), cost: pos(j.cost), ms: pos(j.ms) },
    seen: Array.isArray(r.seen) ? r.seen.filter((x) => typeof x === "string").slice(-SEEN_MAX) : [],
  };
}

// ----- recording ----------------------------------------------------------------

export interface SpendEvent {
  skill: string;
  source: SpendSource;
  cost: number;
  promptTokens: number;
  completionTokens: number;
  estimated?: boolean;
  /** The tier that answered, when the router chose. */
  tier?: RouteTier;
  /** Jev picked a cheaper tier than the request would otherwise have taken. */
  saved?: boolean;
  at?: string;
  /** Turn / message id from the caller, for de-duplication. */
  id?: string;
}

function roll(s: SkillSpend, week: string): void {
  if (s.week === week) return;
  s.week = week;
  s.weekCost = 0;
  s.weekTokens = 0;
}

/** Add metered runs. Mutates and returns how many were counted. */
export function addSpend(doc: SpendDoc, events: SpendEvent[], now = Date.now()): number {
  const seen = new Set(doc.seen);
  let added = 0;
  for (const e of events) {
    const key = spendKey(e?.skill);
    if (!key || (e.source !== "jarvis" && e.source !== "claude-code")) continue;
    const id = typeof e.id === "string" ? e.id.slice(0, 120) : "";
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
      doc.seen = [...doc.seen, id].slice(-SEEN_MAX);
    }
    const t = e.at && Number.isFinite(Date.parse(e.at)) && Date.parse(e.at) <= now + 300_000 ? Date.parse(e.at) : now;
    const at = new Date(t).toISOString();
    const week = weekKey(t);
    let s = doc.skills[key];
    if (!s) {
      if (Object.keys(doc.skills).length >= MAX_KEYS) continue;
      s = doc.skills[key] = { runs: 0, promptTokens: 0, completionTokens: 0, cost: 0, week, weekCost: 0, weekTokens: 0, routed: {}, savedRuns: 0, by: {}, last: at };
    }
    // An event from last week arriving late still counts toward lifetime, not this week.
    const thisWeek = week >= s.week;
    if (thisWeek) roll(s, week);
    const pt = Math.floor(pos(e.promptTokens));
    const ct = Math.floor(pos(e.completionTokens));
    const cost = pos(e.cost);
    s.runs += 1;
    s.promptTokens += pt;
    s.completionTokens += ct;
    s.cost += cost;
    if (e.estimated && cost > 0) s.estimated = true;
    if (thisWeek) {
      s.weekCost += cost;
      s.weekTokens += pt + ct;
    }
    if (e.tier && isRouteTier(e.tier)) s.routed[e.tier] = (s.routed[e.tier] ?? 0) + 1;
    if (e.saved) s.savedRuns += 1;
    s.by[e.source] = (s.by[e.source] ?? 0) + 1;
    if (at > s.last) s.last = at;
    added += 1;
  }
  return added;
}

/** Count one Jev routing decision. Mutates. */
export function addJev(doc: SpendDoc, d: { used: boolean; cost: number; ms: number }): void {
  doc.jev.calls += 1;
  if (d.used) doc.jev.used += 1;
  doc.jev.cost += pos(d.cost);
  doc.jev.ms += pos(d.ms);
}

// ----- caps and pins -----------------------------------------------------------------

export function setCap(doc: SpendDoc, skill: string, dollars: number | null): SpendDoc {
  const key = spendKey(skill);
  if (!key) return doc;
  const caps = { ...doc.caps };
  if (dollars === null || !(pos(dollars) > 0)) delete caps[key];
  else caps[key] = Math.round(pos(dollars) * 100) / 100;
  return { ...doc, caps };
}

export function setPin(doc: SpendDoc, skill: string, tier: RouteTier | null): SpendDoc {
  const key = spendKey(skill);
  if (!key) return doc;
  const pins = { ...doc.pins };
  if (!tier) delete pins[key];
  else if (isRouteTier(tier)) pins[key] = tier;
  return { ...doc, pins };
}

export interface CapState {
  cap: number | null;
  /** This week's dollars. */
  used: number;
  over: boolean;
  /** 0..1 of the cap spent, or 0 with no cap. */
  share: number;
}

export function capState(doc: SpendDoc, skill: string, now = Date.now()): CapState {
  const key = spendKey(skill);
  const cap = doc.caps[key] ?? null;
  const s = doc.skills[key];
  const used = s && s.week === weekKey(now) ? s.weekCost : 0;
  return { cap, used, over: cap !== null && used >= cap, share: cap ? Math.min(1, used / cap) : 0 };
}

// ----- routing (Jev picks the tier) -------------------------------------------------------

/**
 * The question Jev answers before a skill runs in Jarvis. A choice, never
 * text: the model routes, it never acts.
 */
export function tierQuestion(): { type: "choice"; instructions: string; criteria: Record<RouteTier, string> } {
  return {
    type: "choice",
    instructions:
      "Which model tier does this skill run need? Pick the cheapest that will do it well. A clear-cut procedure with fixed steps, a short lookup, a format or spelling pass → free. Ordinary writing, planning or a few tool steps → harder. Open-ended creative work, long multi-step reasoning, code, or anything where a weak answer costs the owner real time → hardest.",
    criteria: {
      free: "A simple, clear-cut task: the skill already spells out the steps, or it is short and mechanical.",
      harder: "Ordinary work with some judgment: writing, summarising, planning, a few tool calls.",
      hardest: "Hard, open-ended or high-stakes work: deep reasoning, real code, long creative output.",
    },
  };
}

export type RouteWhy = "pin" | "cap" | "jev" | "router";

export interface RouteChoice {
  /** null = let the normal router decide. */
  tier: RouteTier | null;
  why: RouteWhy;
}

/**
 * Which tier a skill run gets, in order of who has the say:
 *   1. the owner's pin for that skill
 *   2. over its weekly cap → the cheapest tier
 *   3. Jev's pick, when confident
 *   4. otherwise the router's own rules (null)
 * Pure: the caller asks Jev and passes the confident answer (or null) in.
 */
export function chooseTier(doc: SpendDoc, skill: string, jevPick: string | null, now = Date.now()): RouteChoice {
  const key = spendKey(skill);
  if (key && doc.pins[key]) return { tier: doc.pins[key], why: "pin" };
  if (key && capState(doc, key, now).over) return { tier: "free", why: "cap" };
  if (jevPick && isRouteTier(jevPick)) return { tier: jevPick, why: "jev" };
  return { tier: null, why: "router" };
}

/** True when `picked` is a cheaper rung than `wouldBe`. */
export function cheaper(picked: RouteTier, wouldBe: string): boolean {
  const a = ROUTE_TIERS.indexOf(picked);
  const b = ROUTE_TIERS.indexOf(wouldBe as RouteTier);
  // Anything the router would have sent off the three-rung ladder (long / audio /
  // everything) is at least as dear as "hardest".
  return a >= 0 && a < (b < 0 ? ROUTE_TIERS.length - 1 : b);
}

// ----- reading it back in the library ---------------------------------------------------------

/** This skill's spend, matched by the same call names usage uses. */
export function spendFor(s: Pick<Skill, "slug" | "title">, doc: SpendDoc | null): SkillSpend | null {
  if (!doc) return null;
  for (const k of callNames(s)) {
    const v = doc.skills[k] ?? doc.skills[`studio:${k}`];
    if (v && v.runs > 0) return v;
  }
  return null;
}

/** The key a skill's caps and pins are stored under: its first call name. */
export function controlKey(s: Pick<Skill, "slug" | "title">): string {
  return callNames(s)[0] ?? "";
}

const tokensOf = (s: SkillSpend | null) => (s ? s.promptTokens + s.completionTokens : 0);

/** Most dollars first; tokens break ties (Claude Code runs priced at zero still rank), then A–Z. */
export function bySpend(list: Skill[], doc: SpendDoc | null): Skill[] {
  return [...list].sort((a, b) => {
    const sa = spendFor(a, doc);
    const sb = spendFor(b, doc);
    return (sb?.cost ?? 0) - (sa?.cost ?? 0) || tokensOf(sb) - tokensOf(sa) || a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });
}

export interface RetireCandidate {
  skill: Skill;
  why: "never" | "stale";
  /** Days since the last call, for "stale". */
  days?: number;
}

/**
 * Skills worth retiring: never called, or not called in `staleDays` days.
 * Never-called first, then the longest-idle. Purely a suggestion — retiring
 * is always the owner's tap.
 */
export function retireCandidates(list: Skill[], usage: UsageData | null, staleDays = 45, now = Date.now()): RetireCandidate[] {
  const out: RetireCandidate[] = [];
  for (const s of list) {
    const u = usageFor(s, usage);
    if (!u) out.push({ skill: s, why: "never" });
    else {
      const days = Math.floor((now - Date.parse(u.last)) / 86_400_000);
      if (Number.isFinite(days) && days >= staleDays) out.push({ skill: s, why: "stale", days });
    }
  }
  return out.sort((a, b) => (a.why === b.why ? (b.days ?? 0) - (a.days ?? 0) || a.skill.title.localeCompare(b.skill.title) : a.why === "never" ? -1 : 1));
}

// ----- labels ------------------------------------------------------------------------------

/** "$0.00" / "$1.24" / "<$0.01". */
export function dollars(n: number): string {
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

/** "12.4k" / "1.2M" tokens. */
export function tokensLabel(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/** "Free 12 · Cheap 3 · Best 1" — where Jev, pins and caps sent a skill's runs. */
export function routedLabel(s: SkillSpend): string {
  return ROUTE_TIERS.filter((t) => (s.routed[t] ?? 0) > 0)
    .map((t) => `${TIER_LABEL[t].replace(" model", "")} ${s.routed[t]}`)
    .join(" · ");
}

/** Average Jev decision time in ms, or 0. */
export function jevAverageMs(j: JevStats): number {
  return j.calls ? Math.round(j.ms / j.calls) : 0;
}
