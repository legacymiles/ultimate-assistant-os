// ---------------------------------------------------------------------------
// Skills Library — how often each skill gets called.
//
// Pure, so the page, the API route and the tests share it.
//
// A "call" is one time a skill was actually loaded to do work:
//   - claude-code  Claude Code ran the Skill tool, or the owner typed /<skill>
//                  (recorded by scripts/skill-sync.mjs as a hook on the PC/VPS,
//                  plus a one-time backfill from that machine's past sessions)
//   - connector    the jarvis-memory connector's get_skill (claude.ai, phone,
//                  cloud Claude Code sessions)
//   - jarvis       a Jarvis Studio workflow ran in chat
//
// Counts live in ONE app_state row per account (key USAGE_KEY), written only
// on the server. Keys are the skill's call name, lowercased: "felix",
// "superpowers:brainstorming", "studio:kids-story".
// ---------------------------------------------------------------------------

import type { Skill } from "./types";

export const USAGE_KEY = "jarvis:skill-usage";

export type UsageSource = "claude-code" | "connector" | "jarvis";
export const USAGE_SOURCES: UsageSource[] = ["claude-code", "connector", "jarvis"];

export interface SkillUse {
  count: number;
  /** ISO time of the first and the most recent call. */
  first: string;
  last: string;
  /** Calls per place they came from. */
  by: Partial<Record<UsageSource, number>>;
}

export interface UsageData {
  skills: Record<string, SkillUse>;
  /** Machines whose past sessions were already counted once (host -> when). */
  backfilled?: Record<string, string>;
  /** Recent event ids, so a retried hook never counts the same call twice. */
  seen?: string[];
}

export interface UsageEvent {
  skill: string;
  source: UsageSource;
  /** ISO time of the call; defaults to now. */
  at?: string;
  /** Tool-use id or message id when the caller has one. */
  id?: string;
}

const SEEN_MAX = 500;
const MAX_KEYS = 2000;

/** "/Felix " -> "felix". Anything that can't be a skill name -> "". */
export function usageKey(raw: unknown): string {
  const k = String(raw ?? "")
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase();
  if (!k || k.length > 120) return "";
  return /^[a-z0-9][a-z0-9._:-]*$/.test(k) ? k : "";
}

export function isSource(v: unknown): v is UsageSource {
  return USAGE_SOURCES.includes(v as UsageSource);
}

function validTime(iso: unknown, now: number): string {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  // A clock far in the future would pin a skill to "most recent" forever.
  return Number.isFinite(t) && t <= now + 5 * 60_000 ? new Date(t).toISOString() : new Date(now).toISOString();
}

function bump(data: UsageData, key: string, source: UsageSource, at: string, n = 1, first = at): void {
  const cur = data.skills[key];
  if (!cur) {
    if (Object.keys(data.skills).length >= MAX_KEYS) return;
    data.skills[key] = { count: n, first, last: at, by: { [source]: n } };
    return;
  }
  cur.count += n;
  cur.by[source] = (cur.by[source] ?? 0) + n;
  if (at > cur.last) cur.last = at;
  if (first < cur.first) cur.first = first;
}

/** A fresh copy of whatever was stored, safe to mutate. */
export function cleanUsage(v: unknown): UsageData {
  const raw = (v && typeof v === "object" ? v : {}) as Partial<UsageData>;
  const skills: Record<string, SkillUse> = {};
  for (const [k, u] of Object.entries(raw.skills ?? {})) {
    const key = usageKey(k);
    if (!key || !u || typeof u.count !== "number" || u.count <= 0) continue;
    skills[key] = {
      count: Math.floor(u.count),
      first: String(u.first ?? u.last ?? ""),
      last: String(u.last ?? ""),
      by: { ...(u.by ?? {}) },
    };
  }
  return {
    skills,
    backfilled: { ...(raw.backfilled ?? {}) },
    seen: Array.isArray(raw.seen) ? raw.seen.filter((s) => typeof s === "string").slice(-SEEN_MAX) : [],
  };
}

/** Add live calls. Returns how many were counted (duplicates and junk are dropped). */
export function addEvents(data: UsageData, events: UsageEvent[], now = Date.now()): number {
  const seen = new Set(data.seen ?? []);
  let added = 0;
  for (const e of events) {
    const key = usageKey(e?.skill);
    if (!key || !isSource(e.source)) continue;
    const id = typeof e.id === "string" ? e.id.slice(0, 120) : "";
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
      data.seen = [...(data.seen ?? []), id].slice(-SEEN_MAX);
    }
    bump(data, key, e.source, validTime(e.at, now));
    added++;
  }
  return added;
}

/**
 * Add a machine's past calls, once per machine. A second backfill from the
 * same host is ignored, so re-running setup never doubles the counts.
 */
export function addBackfill(
  data: UsageData,
  host: string,
  counts: Record<string, { count?: unknown; first?: unknown; last?: unknown }>,
  now = Date.now(),
): { added: number; already: boolean } {
  const h = String(host ?? "").trim().toLowerCase().slice(0, 80);
  if (!h) return { added: 0, already: false };
  data.backfilled ??= {};
  if (data.backfilled[h]) return { added: 0, already: true };
  let added = 0;
  for (const [k, c] of Object.entries(counts ?? {})) {
    const key = usageKey(k);
    const n = Math.floor(Number(c?.count));
    if (!key || !Number.isFinite(n) || n <= 0) continue;
    const last = validTime(c.last, now);
    const first = c.first ? validTime(c.first, now) : last;
    bump(data, key, "claude-code", last, Math.min(n, 100_000), first < last ? first : last);
    added += n;
  }
  data.backfilled[h] = new Date(now).toISOString();
  return { added, already: false };
}

// ---- reading it back in the library ------------------------------------------

/**
 * The names a skill can be called by, best match first: its slug ("felix",
 * "superpowers:brainstorming", "studio:kids-story"), then the bare name after
 * a plugin prefix, then its title as a name.
 */
export function callNames(s: Pick<Skill, "slug" | "title">): string[] {
  const out: string[] = [];
  const add = (v: string) => {
    const k = usageKey(v);
    if (k && !out.includes(k)) out.push(k);
  };
  const slug = (s.slug ?? "").replace(/^github:/, "");
  if (slug) add(slug);
  if (slug.includes(":") && !slug.startsWith("studio:")) add(slug.slice(slug.lastIndexOf(":") + 1));
  add(s.title.trim().replace(/\s+/g, "-"));
  return out;
}

/** This skill's calls, or null when it has never been called. */
export function usageFor(s: Pick<Skill, "slug" | "title">, data: UsageData | null): SkillUse | null {
  if (!data) return null;
  for (const k of callNames(s)) {
    const u = data.skills[k];
    if (u && u.count > 0) return u;
  }
  return null;
}

export type UsageFilter = "any" | "top" | "used" | "unused" | "retire";

export const USAGE_FILTERS: { id: UsageFilter; label: string }[] = [
  { id: "any", label: "Any" },
  { id: "top", label: "Top 10" },
  { id: "used", label: "Used" },
  { id: "unused", label: "Never used" },
  { id: "retire", label: "Retire?" },
];

export function isUsageFilter(v: unknown): v is UsageFilter {
  return USAGE_FILTERS.some((f) => f.id === v);
}

const callsOf = (s: Skill, data: UsageData | null) => usageFor(s, data)?.count ?? 0;

/** Most calls first; ties go to the more recently used, then A–Z. */
export function byMostUsed(list: Skill[], data: UsageData | null): Skill[] {
  return [...list].sort((a, b) => {
    const ua = usageFor(a, data);
    const ub = usageFor(b, data);
    return (
      (ub?.count ?? 0) - (ua?.count ?? 0) ||
      (ub?.last ?? "").localeCompare(ua?.last ?? "") ||
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
    );
  });
}

/**
 * Narrow an already-filtered list by usage. "top" keeps the 10 most-called
 * skills (only ones actually called) and returns them most-used first.
 */
/** A skill idle this many days (or never called) is suggested for retiring. */
export const RETIRE_DAYS = 45;

export function filterByUsage(list: Skill[], filter: UsageFilter, data: UsageData | null, now = Date.now()): Skill[] {
  if (filter === "any") return list;
  if (filter === "unused") return list.filter((s) => callsOf(s, data) === 0);
  // Worth retiring: never called, or idle for RETIRE_DAYS. Idle longest first.
  if (filter === "retire") {
    const idle = (s: Skill) => {
      const u = usageFor(s, data);
      return u ? Math.floor((now - Date.parse(u.last)) / 86_400_000) : Infinity;
    };
    return list.filter((s) => idle(s) >= RETIRE_DAYS).sort((a, b) => idle(b) - idle(a) || a.title.localeCompare(b.title));
  }
  const used = list.filter((s) => callsOf(s, data) > 0);
  return filter === "top" ? byMostUsed(used, data).slice(0, 10) : used;
}

/** "1 call" / "24 calls". */
export function callsLabel(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "call" : "calls"}`;
}

/** "used today", "used 3 days ago", "used Oct 2". */
export function lastUsedLabel(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return "used today";
  if (days === 1) return "used yesterday";
  if (days < 30) return `used ${days} days ago`;
  return `used ${new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

const SOURCE_LABEL: Record<UsageSource, string> = {
  "claude-code": "Claude Code",
  connector: "connector",
  jarvis: "Jarvis",
};

/** "Claude Code 20 · Jarvis 4" — where the calls came from. */
export function sourcesLabel(u: SkillUse): string {
  return USAGE_SOURCES.filter((s) => (u.by[s] ?? 0) > 0)
    .map((s) => `${SOURCE_LABEL[s]} ${u.by[s]}`)
    .join(" · ");
}
