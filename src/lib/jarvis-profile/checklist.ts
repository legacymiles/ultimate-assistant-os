// ---------------------------------------------------------------------------
// Jarvis Profile — the self-learning build checklist.
//
// The "common sense" rules the owner keeps having to say out loud when an app
// or website gets built: if more than one person uses it, it needs a login; a
// photo never shows twice; the newest thing goes on top; errors are in plain
// English. A regular person building an app would forget most of these, and
// the owner should never have to say one twice.
//
// Three places a rule comes from:
//   • starter — the basics every app needs, there from day one
//   • learned — Jarvis read the owner's chats and saw them ask for it
//   • you     — the owner typed it in
// Every rule can be switched off or removed. Jarvis follows the ones that are
// on in every chat build, and the same list is published as a Claude Code
// skill so builds on the PC and the VPS follow it too.
//
// Pure: no storage, no network. useJarvisProfile.ts owns state.
// ---------------------------------------------------------------------------

export type RuleArea = "users" | "data" | "display" | "auto" | "words" | "phone" | "setup" | "safety";

export const RULE_AREAS: { id: RuleArea; label: string }[] = [
  { id: "users", label: "Users & logins" },
  { id: "data", label: "Data" },
  { id: "display", label: "What shows" },
  { id: "auto", label: "Automatic" },
  { id: "words", label: "Words & errors" },
  { id: "phone", label: "Phones" },
  { id: "setup", label: "Setup" },
  { id: "safety", label: "Safety" },
];

export type RuleSource = "starter" | "learned" | "you";

export interface ChecklistRule {
  id: string;
  /** The "if" half — "Always" when it applies to everything. */
  when: string;
  /** The "then" half: what every build must do. */
  then: string;
  area: RuleArea;
  source: RuleSource;
  on: boolean;
  /** How many times the owner has asked for this (learned rules count up). */
  said: number;
  addedAt: number;
  /** Last time it was seen in a chat. */
  lastSaid?: number;
  /** What the owner said that taught it, paraphrased with the date. */
  evidence?: string[];
  /** Learned since the owner last looked — shown with a "new" mark. */
  fresh?: boolean;
}

export interface JarvisProfileState {
  rules: ChecklistRule[];
  /** Rules the owner removed, by key, so Jarvis never learns them back. */
  removed: string[];
  /** When the chats were last read for new rules. */
  learnedAt: number | null;
  /** How many chat messages had been read at that point. */
  learnedThrough: number;
  /** The skill text last published for Claude Code, so it only re-publishes on change. */
  publishedHash: string | null;
  publishedAt: number | null;
}

const ALWAYS = "Always";

/** The basics, there from the start. Ids are fixed so a later edit doesn't duplicate them. */
const STARTERS: Omit<ChecklistRule, "source" | "on" | "said" | "addedAt">[] = [
  { id: "s-login", area: "users", when: "If more than one person will use it", then: "Add sign-in, and keep each person's data their own." },
  { id: "s-admin", area: "users", when: "If there is an admin or owner side", then: "Lock admin pages and admin APIs to the owner on the server, not just by hiding buttons." },
  { id: "s-share", area: "users", when: "If people share or invite others", then: "Give each invite its own link that can be turned off." },
  { id: "s-nodupes", area: "data", when: ALWAYS, then: "No duplicates — the same item never shows or saves twice, even when it arrives twice." },
  { id: "s-noloss", area: "data", when: ALWAYS, then: "Never lose data on a failure: keep it until it's safely saved, then retry by itself." },
  { id: "s-sync", area: "data", when: "If it's used on more than one device", then: "Keep it in sync across devices, not just in one browser." },
  { id: "s-undo", area: "data", when: "If something can be deleted", then: "Ask once before deleting, or give an undo." },
  { id: "s-newest", area: "display", when: "If it shows a list or feed", then: "Newest first, at the top." },
  { id: "s-empty", area: "display", when: "If a list can be empty", then: "Show a friendly empty state that says what to do next." },
  { id: "s-loading", area: "display", when: "If anything takes more than a moment", then: "Show what it's doing and how far along it is." },
  { id: "s-search", area: "display", when: "If a list can grow long", then: "Add search or filters." },
  { id: "s-auto", area: "auto", when: "If it checks for or fetches new things", then: "Update by itself — the user should never have to press a button to see new things." },
  { id: "s-notify", area: "auto", when: "If it sends notifications", then: "Make them opt-in in settings, and switch-off-able per kind." },
  { id: "s-plain", area: "words", when: ALWAYS, then: "Errors and messages in plain English — never raw codes or stack traces." },
  { id: "s-nokeys", area: "words", when: "If it needs an API key", then: "Still work without one (demo mode), and say plainly what the key unlocks." },
  { id: "s-mobile", area: "phone", when: ALWAYS, then: "Works on a phone: fits the screen, big enough to tap, nothing hidden off the edge." },
  { id: "s-uploads", area: "phone", when: "If people upload photos or files", then: "Resize big photos and send them a few at a time, so uploads never hit size limits." },
  { id: "s-simple", area: "setup", when: ALWAYS, then: "Make setup as simple as possible — do the setup steps for the user instead of listing them." },
  { id: "s-ship", area: "setup", when: "When a change is finished", then: "Commit, push and check it actually deployed, then test it live." },
  { id: "s-confirm", area: "safety", when: "If an action can't be undone (pay, send, delete)", then: "Confirm it with the user first." },
  { id: "s-secrets", area: "safety", when: ALWAYS, then: "Never show passwords or keys in the page or in logs." },
];

export function starterRules(now: number): ChecklistRule[] {
  return STARTERS.map((r) => ({ ...r, source: "starter" as const, on: true, said: 0, addedAt: now }));
}

export function emptyProfile(now: number): JarvisProfileState {
  return {
    rules: starterRules(now),
    removed: [],
    learnedAt: null,
    learnedThrough: 0,
    publishedHash: null,
    publishedAt: null,
  };
}

/** A key that matches the same rule however it's worded: lowercase words, no filler. */
export function ruleKey(then: string): string {
  const filler = new Set(["a", "an", "the", "it", "its", "to", "be", "is", "and", "or", "of", "should", "must", "always", "never", "by", "itself"]);
  return then
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !filler.has(w))
    .slice(0, 8)
    .join(" ");
}

/** Share of words two rules have in common, 0..1. */
function overlap(a: string, b: string): number {
  const A = new Set(ruleKey(a).split(" ").filter(Boolean));
  const B = new Set(ruleKey(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

/** The rule already in the list that says the same thing, if any. */
export function matchingRule(rules: readonly ChecklistRule[], then: string): ChecklistRule | null {
  const key = ruleKey(then);
  let best: { r: ChecklistRule; s: number } | null = null;
  for (const r of rules) {
    if (ruleKey(r.then) === key) return r;
    const s = overlap(r.then, then);
    if (s >= 0.75 && (!best || s > best.s)) best = { r, s };
  }
  return best?.r ?? null;
}

function newId(prefix: string, now: number): string {
  return `${prefix}-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Turn what the owner typed into a rule. "if it has multiple users then it
 * needs a login" → when "If it has multiple users", then "It needs a login".
 */
export function parseRule(text: string): { when: string; then: string } | null {
  const t = text.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  if (t.length < 3) return null;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const m = t.match(/^(if|when|whenever)\s+(.+?)(?:,\s*then\s+|\s+then\s+|\s*(?:→|->|=>)\s*|,\s+)(.+)$/i);
  if (m) return { when: cap(`${m[1].toLowerCase()} ${m[2]}`), then: cap(m[3]) };
  return { when: ALWAYS, then: cap(t) };
}

/** Guess an area from the words, for rules the owner types in. */
export function guessArea(text: string): RuleArea {
  const t = text.toLowerCase();
  if (/login|sign.?in|user|account|admin|owner|invite|member/.test(t)) return "users";
  if (/duplicate|save|lose|sync|delete|backup|data|store/.test(t)) return "data";
  if (/newest|order|top|list|empty|loading|show|display|filter|search/.test(t)) return "display";
  if (/auto|refresh|update|notif|schedule|every \d/.test(t)) return "auto";
  if (/error|message|plain|english|word|key/.test(t)) return "words";
  if (/phone|mobile|iphone|upload|tap|screen/.test(t)) return "phone";
  if (/setup|set up|deploy|push|commit|install/.test(t)) return "setup";
  if (/pay|password|secret|confirm|safe|privacy/.test(t)) return "safety";
  return "data";
}

/** The owner adds a rule. Saying one already there just counts it again. */
export function addOwnRule(state: JarvisProfileState, text: string, now: number): JarvisProfileState {
  const parsed = parseRule(text);
  if (!parsed) return state;
  const existing = matchingRule(state.rules, parsed.then);
  if (existing) {
    return {
      ...state,
      rules: state.rules.map((r) => (r.id === existing.id ? { ...r, on: true, said: r.said + 1, lastSaid: now } : r)),
    };
  }
  const rule: ChecklistRule = {
    id: newId("you", now),
    when: parsed.when,
    then: parsed.then,
    area: guessArea(text),
    source: "you",
    on: true,
    said: 1,
    addedAt: now,
    lastSaid: now,
  };
  const key = ruleKey(rule.then);
  return { ...state, rules: [rule, ...state.rules], removed: state.removed.filter((k) => k !== key) };
}

export interface LearnedRule {
  when?: string;
  then: string;
  area?: string;
  evidence?: string[];
}

/** Keep only well-formed rules from the model, trimmed. */
export function coerceLearned(raw: unknown): LearnedRule[] {
  const list = Array.isArray((raw as { rules?: unknown })?.rules) ? (raw as { rules: unknown[] }).rules : Array.isArray(raw) ? raw : [];
  const out: LearnedRule[] = [];
  for (const r of list.slice(0, 20)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const then = typeof o.then === "string" ? o.then.trim().slice(0, 200) : "";
    const evidence = Array.isArray(o.evidence)
      ? o.evidence.filter((e): e is string => typeof e === "string" && e.trim().length > 0).map((e) => e.slice(0, 160)).slice(0, 3)
      : [];
    // A rule with nothing the owner said behind it is a guess, and guesses stay out.
    if (then.length < 6 || !evidence.length) continue;
    out.push({
      then,
      when: typeof o.when === "string" && o.when.trim() ? o.when.trim().slice(0, 120) : ALWAYS,
      area: typeof o.area === "string" ? o.area : undefined,
      evidence,
    });
  }
  return out;
}

/**
 * Fold what was learned from the chats into the list. A rule already there
 * counts up ("said 3×"); a new one is added, switched on and marked new; one
 * the owner removed is never added back.
 */
export function mergeLearned(state: JarvisProfileState, learned: LearnedRule[], now: number, readThrough: number): JarvisProfileState {
  let rules = [...state.rules];
  const removed = new Set(state.removed);
  for (const l of learned) {
    if (removed.has(ruleKey(l.then))) continue;
    const existing = matchingRule(rules, l.then);
    if (existing) {
      rules = rules.map((r) =>
        r.id === existing.id
          ? {
              ...r,
              said: r.said + 1,
              lastSaid: now,
              evidence: [...(l.evidence ?? []), ...(r.evidence ?? [])].slice(0, 4),
            }
          : r,
      );
      continue;
    }
    const area = RULE_AREAS.some((a) => a.id === l.area) ? (l.area as RuleArea) : guessArea(`${l.when} ${l.then}`);
    rules = [
      {
        id: newId("learned", now),
        when: l.when || ALWAYS,
        then: l.then,
        area,
        source: "learned",
        on: true,
        said: 1,
        addedAt: now,
        lastSaid: now,
        evidence: l.evidence,
        fresh: true,
      },
      ...rules,
    ];
  }
  return { ...state, rules, learnedAt: now, learnedThrough: readThrough };
}

export function removeRule(state: JarvisProfileState, id: string): JarvisProfileState {
  const r = state.rules.find((x) => x.id === id);
  if (!r) return state;
  return {
    ...state,
    rules: state.rules.filter((x) => x.id !== id),
    removed: [...new Set([...state.removed, ruleKey(r.then)])].slice(-300),
  };
}

export function toggleRule(state: JarvisProfileState, id: string): JarvisProfileState {
  return { ...state, rules: state.rules.map((r) => (r.id === id ? { ...r, on: !r.on } : r)) };
}

export function markSeen(state: JarvisProfileState): JarvisProfileState {
  if (!state.rules.some((r) => r.fresh)) return state;
  return { ...state, rules: state.rules.map((r) => (r.fresh ? { ...r, fresh: false } : r)) };
}

/** Fill in starter rules added since the owner's list was first made. */
export function withStarters(state: JarvisProfileState, now: number): JarvisProfileState {
  const have = new Set(state.rules.map((r) => r.id));
  const removed = new Set(state.removed);
  const missing = starterRules(now).filter((s) => !have.has(s.id) && !removed.has(ruleKey(s.then)));
  return missing.length ? { ...state, rules: [...state.rules, ...missing] } : state;
}

export function coerceProfile(raw: unknown, now: number): JarvisProfileState {
  const base = emptyProfile(now);
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Partial<JarvisProfileState>;
  const rules = Array.isArray(o.rules)
    ? o.rules.filter((r): r is ChecklistRule => Boolean(r && typeof r.id === "string" && typeof r.then === "string"))
    : base.rules;
  return withStarters(
    {
      rules,
      removed: Array.isArray(o.removed) ? o.removed.filter((k): k is string => typeof k === "string") : [],
      learnedAt: typeof o.learnedAt === "number" ? o.learnedAt : null,
      learnedThrough: typeof o.learnedThrough === "number" ? o.learnedThrough : 0,
      publishedHash: typeof o.publishedHash === "string" ? o.publishedHash : null,
      publishedAt: typeof o.publishedAt === "number" ? o.publishedAt : null,
    },
    now,
  );
}

/** Rules that are on, most-asked-for first within each area. */
export function activeRules(state: JarvisProfileState): ChecklistRule[] {
  const order = new Map(RULE_AREAS.map((a, i) => [a.id, i]));
  return state.rules
    .filter((r) => r.on)
    .sort((a, b) => (order.get(a.area) ?? 9) - (order.get(b.area) ?? 9) || b.said - a.said);
}

function line(r: ChecklistRule): string {
  return r.when === ALWAYS ? `- ${r.then}` : `- ${r.when}: ${r.then}`;
}

/** What Jarvis's chat brain is told, for every build. */
export function checklistPrompt(state: JarvisProfileState, max = 3_500): string {
  const rules = activeRules(state);
  if (!rules.length) return "";
  const out: string[] = [];
  for (const a of RULE_AREAS) {
    const mine = rules.filter((r) => r.area === a.id);
    if (!mine.length) continue;
    out.push(`${a.label}:`, ...mine.map(line));
  }
  const text = out.join("\n");
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

export const SKILL_NAME = "website-build-checklist";

/** The same list as a Claude Code skill, so builds on the PC and VPS follow it. */
export function checklistSkill(state: JarvisProfileState): string {
  const body = checklistPrompt(state, 20_000);
  return `---
name: ${SKILL_NAME}
description: The owner's standing checklist for building or changing ANY app or website — the common-sense rules they should never have to repeat (logins for multi-user apps, no duplicates, newest first, auto-updating, plain-English errors, phone-friendly, simple setup). Use it every time you build, change or review an app or website for them.
---

# Website & app build checklist

This list is kept by Jarvis Profile (Jarvis › Dashboard › Jarvis Profile) and learns from the
owner's chats. Do not edit it here — changes made in Jarvis Profile are published over this file.

Before you call any build or change finished, go through every rule below that applies, and fix
anything that misses one. If a rule genuinely cannot apply, say so in one line.

${body}
`;
}

/** A short stable hash, to tell whether the published skill is out of date. */
export function textHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
