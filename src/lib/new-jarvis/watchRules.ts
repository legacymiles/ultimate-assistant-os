// ---------------------------------------------------------------------------
// Workflow notifications — "tell me when…" rules the owner writes in plain
// English. Pure: the rule shapes, the parser and the evaluator. The store and
// hook live in watches.ts.
//
// A rule is a small, closed shape, never free code: the model (or the local
// parser when there is no key) turns the sentence into one of five kinds, the
// owner sees exactly what it understood, and only then is it saved. Like every
// other source in the Updates feed, a rule's notifications are DERIVED from
// live data each tick — nothing appends a row — so its ids are deterministic
// and a pop-up fires once.
//
//   schedule  at a time of day, every day or on chosen weekdays
//   match     any update (or one source's) whose text mentions a word
//   due       a list item due within N days
//   spend     today's AI spend passes a dollar amount
//   camera    at least N photos are waiting in Camera Autopilot
// ---------------------------------------------------------------------------

import { ago, localDay, money, type JarvisUpdate, type SpendFeed, type UpdateSource } from "@/lib/jarvis/updates";
import type { BoardPayload } from "@/lib/recall/lists/types";

export type MatchSource = Exclude<UpdateSource, "custom"> | "any";

export type WatchRule =
  | { kind: "schedule"; time: string; days: number[]; message: string }
  | { kind: "match"; source: MatchSource; contains: string[] }
  | { kind: "due"; listId: string | null; daysAhead: number }
  | { kind: "spend"; over: number }
  | { kind: "camera"; atLeast: number };

export interface Watch {
  id: string;
  /** Exactly what the owner typed. */
  prompt: string;
  /** Short label for the row and the settings list. */
  title: string;
  rule: WatchRule;
  on: boolean;
  createdAt: string;
}

export interface ParsedWatch {
  title: string;
  rule: WatchRule;
}

const MATCH_SOURCES: MatchSource[] = ["any", "lists", "calendar", "photos", "camera", "memory", "actions", "spend"];
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// ----- validation ------------------------------------------------------------

/** Accept a rule only in exactly the shape the evaluator understands. */
export function coerceRule(raw: unknown): WatchRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case "schedule": {
      const time = typeof r.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : null;
      if (!time) return null;
      const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
      const message = typeof r.message === "string" && r.message.trim() ? r.message.trim().slice(0, 140) : "Reminder";
      return { kind: "schedule", time, days, message };
    }
    case "match": {
      const source = MATCH_SOURCES.includes(r.source as MatchSource) ? (r.source as MatchSource) : "any";
      const contains = (Array.isArray(r.contains) ? r.contains : [r.contains])
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8);
      return contains.length ? { kind: "match", source, contains } : null;
    }
    case "due": {
      const daysAhead = Math.min(30, Math.max(0, Math.round(Number(r.daysAhead ?? 1))));
      const listId = typeof r.listId === "string" && r.listId.trim() ? r.listId.trim() : null;
      return Number.isFinite(daysAhead) ? { kind: "due", listId, daysAhead } : null;
    }
    case "spend": {
      const over = Number(r.over);
      return Number.isFinite(over) && over > 0 ? { kind: "spend", over: Math.round(over * 100) / 100 } : null;
    }
    case "camera": {
      const atLeast = Math.max(1, Math.round(Number(r.atLeast ?? 1)));
      return Number.isFinite(atLeast) ? { kind: "camera", atLeast } : null;
    }
    default:
      return null;
  }
}

// ----- phrasing --------------------------------------------------------------

function clock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

function daysPhrase(days: number[]): string {
  if (!days.length || days.length === 7) return "every day";
  if (days.join() === "1,2,3,4,5") return "every weekday";
  if (days.join() === "0,6") return "every weekend day";
  return `every ${days.map((d) => DAY_NAMES[d][0].toUpperCase() + DAY_NAMES[d].slice(1, 3)).join(", ")}`;
}

const SOURCE_WORD: Record<MatchSource, string> = {
  any: "anything",
  lists: "a list item",
  calendar: "a calendar event",
  photos: "a filed photo",
  camera: "a new photo",
  memory: "a memory",
  actions: "an action waiting on you",
  spend: "an AI spend alert",
};

/** One sentence the owner can check before saving: what will actually happen. */
export function describeRule(rule: WatchRule): string {
  switch (rule.kind) {
    case "schedule":
      return `${daysPhrase(rule.days)[0].toUpperCase()}${daysPhrase(rule.days).slice(1)} at ${clock(rule.time)}: “${rule.message}”`;
    case "match":
      return `When ${SOURCE_WORD[rule.source]} mentions ${rule.contains.map((c) => `“${c}”`).join(" or ")}`;
    case "due":
      return `When ${rule.listId ? `a ${rule.listId === "todo" ? "to-do" : rule.listId} item` : "a list item"} is due ${
        rule.daysAhead === 0 ? "today" : rule.daysAhead === 1 ? "today or tomorrow" : `within ${rule.daysAhead} days`
      }`;
    case "spend":
      return `When today's AI spend passes ${money(rule.over)}`;
    case "camera":
      return rule.atLeast <= 1 ? "When a new photo lands in Camera Autopilot" : `When ${rule.atLeast} or more photos are waiting to sort`;
  }
}

// ----- the local parser (no key needed) --------------------------------------

function parseTime(t: string): string | null {
  if (/\bnoon\b/.test(t)) return "12:00";
  if (/\bmidnight\b/.test(t)) return "00:00";
  const m = t.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/);
  if (m && (m[3] || m[2] || /\bat\s+\d/.test(t))) {
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const ap = m[3]?.[0];
    if (ap === "p" && h < 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  if (/\bmorning\b/.test(t)) return "08:00";
  if (/\bafternoon\b/.test(t)) return "13:00";
  if (/\bevening\b|\btonight\b/.test(t)) return "18:00";
  return null;
}

function parseDays(t: string): number[] {
  if (/\bweekdays?\b|\bwork ?days?\b/.test(t)) return [1, 2, 3, 4, 5];
  if (/\bweekends?\b/.test(t)) return [0, 6];
  const found = DAY_NAMES.map((d, i) => (new RegExp(`\\b${d.slice(0, 3)}(${d.slice(3)})?s?\\b`).test(t) ? i : -1)).filter((i) => i >= 0);
  return found;
}

function sourceIn(t: string): MatchSource {
  if (/\b(list|to-?do|shopping|to-?buy|bill)s?\b/.test(t)) return "lists";
  if (/\b(calendar|event|meeting|appointment)s?\b/.test(t)) return "calendar";
  if (/\bmemor(y|ies)\b/.test(t)) return "memory";
  return "any";
}

const strip = (s: string) =>
  s
    .trim()
    .replace(/^(please\s+)?(remind me|tell me|notify me|let me know|ping me|alert me|send me a notification)\s*(to|that|about|when|if)?\s*/i, "")
    .replace(/[.!?]+$/, "")
    .trim();

/**
 * The keyword version. Good enough for the common sentences, and it is what
 * runs when no AI key is set — so the feature works on a fresh deploy.
 */
export function parseWatchLocal(text: string): ParsedWatch | null {
  const raw = text.trim();
  const t = raw.toLowerCase();
  if (!t) return null;

  // spend
  const spend = t.match(/(?:spend|spent|cost|costs|bill)\D{0,30}\$?\s?(\d+(?:\.\d+)?)/);
  if (spend && /\b(ai|model|openrouter|spend|spent|cost)\b/.test(t)) {
    return { title: `AI spend over ${money(Number(spend[1]))}`, rule: { kind: "spend", over: Number(spend[1]) } };
  }

  // camera
  if (/\b(photo|photos|picture|pictures|pic|pics|image|images|camera|screenshot|screenshots)\b/.test(t) && !/\bmention/.test(t)) {
    const n = t.match(/(\d+)\s*(?:or more\s*)?(?:new\s*)?(?:photo|picture|pic|image|screenshot)/);
    const atLeast = n ? Number(n[1]) : 1;
    return { title: atLeast > 1 ? `${atLeast}+ photos waiting` : "New photo taken", rule: { kind: "camera", atLeast } };
  }

  // due
  if (/\b(due|deadline|overdue)\b/.test(t)) {
    const n = t.match(/(\d+)\s*days?/);
    const daysAhead = /\btoday\b/.test(t) && !/tomorrow/.test(t) ? 0 : n ? Number(n[1]) : /\bweek\b/.test(t) ? 7 : 1;
    const listId = /\bto-?do/.test(t) ? "todo" : /\bbills?\b/.test(t) ? "bills" : /\b(buy|shopping)\b/.test(t) ? "buy" : null;
    return { title: `${listId === "bills" ? "Bills" : listId === "buy" ? "To-buy" : listId === "todo" ? "To-dos" : "Items"} coming due`, rule: { kind: "due", listId, daysAhead } };
  }

  // match: "when … mentions X", "if anything about X", "whenever X comes up"
  const match =
    t.match(/\b(?:mentions?|contains?|says?|about|with|includes?|named|called)\s+["“']?([^"”']+?)["”']?\s*(?:comes up|shows up|is added)?$/) ??
    t.match(/\bwhenever\s+["“']?([^"”']+?)["”']?\s+(?:comes up|shows up|is added|appears)/);
  if (match && /\b(when|whenever|if|any ?time)\b/.test(t)) {
    const words = match[1]
      .split(/\s*(?:,|\bor\b)\s*/)
      .map((w) => w.trim())
      .filter((w) => w.length > 1);
    if (words.length) {
      return { title: `Mentions ${words.join(" / ")}`, rule: { kind: "match", source: sourceIn(t), contains: words } };
    }
  }

  // schedule
  const time = parseTime(t);
  const recurring = /\b(every|each|daily|weekdays?|weekends?|mornings?|evenings?|tonight)\b/.test(t) || parseDays(t).length > 0;
  if (time && recurring) {
    const message =
      strip(
        raw
          .replace(/\b(every|each)\s+(day|morning|evening|night|afternoon|weekday|weekend|week ?day|(?:mon|tues|wednes|thurs|fri|satur|sun)day)s?\b/gi, "")
          .replace(/\b(daily|on weekdays|on weekends|weekdays|weekends)\b/gi, "")
          .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?\b/gi, "")
          .replace(/\b(at\s+)?(noon|midnight)\b/gi, "")
          .replace(/\s{2,}/g, " "),
      ) || "Reminder";
    return { title: message.slice(0, 60), rule: { kind: "schedule", time, days: parseDays(t), message: message[0].toUpperCase() + message.slice(1) } };
  }

  return null;
}

export const WATCH_EXAMPLES = [
  "Every weekday at 9am remind me to call my leads",
  "Tell me when a to-do is due tomorrow",
  "Notify me when a new photo is taken",
  "Let me know when anything mentions rent or invoice",
  "Alert me if AI spend goes over $5 today",
];

// ----- evaluation --------------------------------------------------------------

export interface WatchContext {
  /** Every other row in the feed this tick, before filtering. */
  rows: JarvisUpdate[];
  board: BoardPayload | null;
  spend: SpendFeed | null;
  camera: { id: string; addedAt: string }[];
  now: number;
}

/** "YYYY-MM-DD" + "HH:MM" → that instant, in this browser's timezone. */
function atLocal(day: string, time: string): number {
  const [y, mo, d] = day.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime();
}

function addDays(day: string, n: number): string {
  const [y, mo, d] = day.split("-").map(Number);
  return localDay(new Date(y, mo - 1, d + n, 12).toISOString());
}

export function customUpdates(watches: Watch[], ctx: WatchContext): JarvisUpdate[] {
  const { now } = ctx;
  const today = localDay(new Date(now).toISOString(), new Date(now));
  const out: JarvisUpdate[] = [];

  for (const w of watches) {
    if (!w.on) continue;
    const r = w.rule;
    const base = { source: "custom" as const };

    if (r.kind === "schedule") {
      const weekday = new Date(now).getDay();
      if (r.days.length && !r.days.includes(weekday)) continue;
      const fires = atLocal(today, r.time);
      if (now < fires) continue;
      out.push({ ...base, id: `custom:${w.id}:${today}`, title: r.message, detail: w.title, at: new Date(fires).toISOString(), when: ago(new Date(fires).toISOString(), now) });
    } else if (r.kind === "match") {
      for (const row of ctx.rows) {
        if (row.source === "custom") continue;
        if (r.source !== "any" && row.source !== r.source) continue;
        const text = `${row.title} ${row.detail}`.toLowerCase();
        const hit = r.contains.find((c) => text.includes(c));
        if (!hit) continue;
        out.push({ ...base, id: `custom:${w.id}:${row.id}`, title: row.title, detail: `mentions “${hit}” · ${w.title}`, at: row.at, when: row.when, who: row.who, colour: row.colour });
      }
    } else if (r.kind === "due") {
      const last = addDays(today, r.daysAhead);
      for (const item of ctx.board?.items ?? []) {
        if (item.done || !item.dueDate) continue;
        if (r.listId && item.listId !== r.listId) continue;
        if (item.dueDate < today || item.dueDate > last) continue;
        // It became news the morning it entered the window.
        const opens = Math.max(atLocal(addDays(item.dueDate, -r.daysAhead), "08:00"), Date.parse(item.createdAt) || 0);
        if (opens > now) continue;
        const when = item.dueDate === today ? "due today" : item.dueDate === addDays(today, 1) ? "due tomorrow" : `due ${item.dueDate}`;
        out.push({ ...base, id: `custom:${w.id}:${item.id}:${item.dueDate}`, title: item.text, detail: `${when} · ${w.title}`, at: new Date(opens).toISOString(), when });
      }
    } else if (r.kind === "spend") {
      const calls = (ctx.spend?.recent ?? []).filter((c) => localDay(c.at, new Date(now)) === today).sort((a, b) => a.at.localeCompare(b.at));
      let total = 0;
      for (const c of calls) {
        total += c.cost || 0;
        if (total > r.over) {
          const all = calls.reduce((s, x) => s + (x.cost || 0), 0);
          out.push({ ...base, id: `custom:${w.id}:${today}`, title: `AI spend today is ${money(all)}`, detail: `over your ${money(r.over)} limit`, at: c.at, when: ago(c.at, now) });
          break;
        }
      }
    } else if (r.kind === "camera") {
      if (ctx.camera.length < r.atLeast) continue;
      const newest = ctx.camera.map((p) => p.addedAt).sort().pop()!;
      // Per new photo when the threshold is 1; once a day for a pile-up rule.
      const id = r.atLeast <= 1 ? `custom:${w.id}:${ctx.camera.length}:${newest}` : `custom:${w.id}:${today}`;
      out.push({
        ...base,
        id,
        title: r.atLeast <= 1 ? "You took a new photo" : `${ctx.camera.length} photos waiting to sort`,
        detail: w.title,
        at: newest,
        when: ago(newest, now),
      });
    }
  }
  return out;
}
