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
// This is the ONE build checklist. It holds both the common-sense rules the
// owner keeps repeating and the technical standard (crash logging, security,
// speed, client handoff) that used to be a separate "backend checklist" doc.
// Starter rules carry a short code (R2, S3…), a level and how to check them, so
// Felix, the prompt enhancer and super-board cards can cite a line by code.
//
// Pure: no storage, no network. useJarvisProfile.ts owns state.
// ---------------------------------------------------------------------------

export type RuleArea = "users" | "data" | "display" | "auto" | "words" | "phone" | "speed" | "setup" | "safety" | "client";

export const RULE_AREAS: { id: RuleArea; label: string }[] = [
  { id: "users", label: "Users & logins" },
  { id: "data", label: "Data" },
  { id: "display", label: "What shows" },
  { id: "auto", label: "Automatic" },
  { id: "words", label: "Words & errors" },
  { id: "phone", label: "Phones" },
  { id: "speed", label: "Speed" },
  { id: "setup", label: "Setup & shipping" },
  { id: "safety", label: "Safety" },
  { id: "client", label: "Client sites" },
];

/** Must = a ship-blocker · Should = before a client sees it · Nice = when there is time. */
export type RuleLevel = "Must" | "Should" | "Nice";

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
  /** Starter rules: a short code to cite (R2, S3…), how much it matters, and how to check it. */
  code?: string;
  level?: RuleLevel;
  check?: string;
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

/**
 * The starter rules, there from day one. Ids never change, so a later edit
 * refreshes the owner's copy instead of duplicating it. Codes by family:
 * R = never crash/confuse, S = security, D = data, P = speed, U = what people
 * see, L = logins, A = automatic, O = setup & shipping, C = client sites.
 */
const STARTERS: Omit<ChecklistRule, "source" | "on" | "said" | "addedAt">[] = [
  // Users & logins
  { id: "s-login", code: "L1", level: "Must", area: "users", when: "If more than one person will use it", then: "Add sign-in, and keep each person's data their own.", check: "Sign in as two people: neither sees the other's data." },
  { id: "s-admin", code: "S3", level: "Must", area: "users", when: "If there is an admin or owner side", then: "Lock admin pages and admin APIs to the owner on the server, not just by hiding buttons.", check: "Call the admin API signed out or as someone else: 401/403." },
  { id: "s-share", code: "L2", level: "Should", area: "users", when: "If people share or invite others", then: "Give each invite its own link that can be turned off.", check: "Turn a link off: it stops working at once." },
  // Data
  { id: "s-nodupes", code: "D5", level: "Must", area: "data", when: ALWAYS, then: "No duplicates — the same item never shows or saves twice, even when it arrives twice.", check: "Send the same item twice: one copy." },
  { id: "s-noloss", code: "R6", level: "Must", area: "data", when: ALWAYS, then: "Never lose data on a failure: keep what was typed or sent until it's safely saved, then retry by itself.", check: "Cut the network, submit, restore: nothing is lost and it saves." },
  { id: "s-sync", code: "D3", level: "Should", area: "data", when: "If it's used on more than one device", then: "Keep it in sync across devices, not just in one browser.", check: "Change it on the phone, refresh the laptop: same value." },
  { id: "s-undo", code: "D6", level: "Should", area: "data", when: "If something can be deleted", then: "Ask once before deleting, or give an undo.", check: "Delete by mistake: it can be got back or was confirmed first." },
  { id: "s-d4", code: "D4", level: "Should", area: "data", when: "If it stores personal data", then: "Give people a way to delete their data, and actually remove it.", check: "Delete an account: its rows are gone." },
  { id: "s-d1", code: "D1", level: "Must", area: "data", when: "If it has a database", then: "Database changes only add things; anything that drops, renames or empties data is approved by the owner first.", check: "Search the migrations for drop/rename/truncate: each has the owner's OK." },
  { id: "s-d2", code: "D2", level: "Should", area: "data", when: "If it has a database", then: "Have backups, and try a restore once.", check: "A restore to a scratch copy works." },
  // What shows
  { id: "s-newest", code: "U6", level: "Must", area: "display", when: "If it shows a list or feed", then: "Newest first, at the top.", check: "Add one: it appears at the top." },
  { id: "s-empty", code: "U4", level: "Should", area: "display", when: "If a list can be empty", then: "Show a friendly empty state that says what to do next — never a blank or \"undefined\".", check: "Open it with a brand-new account." },
  { id: "s-search", code: "U7", level: "Should", area: "display", when: "If a list can grow long", then: "Add search or filters.", check: "Find an item in under 5 seconds with 100 in the list." },
  { id: "s-u2", code: "U2", level: "Must", area: "display", when: ALWAYS, then: "Accessible: labels on controls, visible focus, alt text, readable contrast.", check: "Lighthouse accessibility 95+; tab through every control." },
  { id: "s-u3", code: "U3", level: "Should", area: "display", when: "If it's a public page or site", then: "Give it a title, description, share image and icon.", check: "Paste the link in a chat app: the preview looks right." },
  { id: "s-u5", code: "U5", level: "Nice", area: "display", when: ALWAYS, then: "Readable in both light and dark mode.", check: "Switch the phone's theme." },
  // Automatic
  { id: "s-auto", code: "A1", level: "Must", area: "auto", when: "If it checks for or fetches new things", then: "Update by itself — the user should never have to press a button to see new things.", check: "Leave it open: new items appear without a refresh." },
  { id: "s-notify", code: "A2", level: "Should", area: "auto", when: "If it sends notifications", then: "Make them opt-in in settings, and switch-off-able per kind.", check: "A new user gets none until they turn them on." },
  { id: "s-o5", code: "O5", level: "Nice", area: "auto", when: ALWAYS, then: "Logged crashes become board cards by themselves, so fixes don't wait for someone to notice.", check: "A new crash shows up as a Backlog card after the next collect." },
  // Words & errors
  { id: "s-r1", code: "R1", level: "Must", area: "words", when: ALWAYS, then: "Never show a white or broken page: every screen has a friendly fallback with \"Try again\".", check: "Force an error on a preview: the friendly screen shows." },
  { id: "s-r2", code: "R2", level: "Must", area: "words", when: ALWAYS, then: "Log every crash (browser errors, failed promises, server failures) so it can be fixed before anyone reports it.", check: "Force one: it appears in Jarvis › Deck › Site errors within a minute." },
  { id: "s-plain", code: "R3", level: "Must", area: "words", when: ALWAYS, then: "Errors and messages in plain English with a next step — never raw codes or stack traces.", check: "Read every error message: none shows a code, \"Error:\" or JSON." },
  { id: "s-nokeys", code: "R4", level: "Must", area: "words", when: "If it needs an API key or outside service", then: "Still work without one (demo mode), and say plainly what the key unlocks — never a crash.", check: "Run it with no keys: every page loads." },
  // Phones
  { id: "s-mobile", code: "U1", level: "Must", area: "phone", when: ALWAYS, then: "Works on a phone: fits the screen, big enough to tap, nothing hidden off the edge.", check: "At 375 px wide: no sideways scroll, every button tappable." },
  { id: "s-uploads", code: "P5", level: "Should", area: "phone", when: "If people upload photos or files", then: "Resize big photos and send them a few at a time, so uploads never hit size limits.", check: "Upload 20 phone photos at once: all arrive." },
  // Speed
  { id: "s-loading", code: "R5", level: "Should", area: "speed", when: "If anything takes more than a moment", then: "Show what it's doing and how far along; calls time out and retry once, so nothing spins forever.", check: "On a slow connection nothing spins past its limit." },
  { id: "s-p1", code: "P1", level: "Must", area: "speed", when: "If people open it on a phone", then: "The main content shows in under 2.5 s on a phone — aim for 1 s.", check: "Lighthouse mobile, median of 3 runs." },
  { id: "s-p2", code: "P2", level: "Should", area: "speed", when: "If it shows images, video or 3D", then: "Size and compress images; load heavy 3D or video only when needed.", check: "No image over 300 KB above the fold." },
  { id: "s-p3", code: "P3", level: "Should", area: "speed", when: ALWAYS, then: "Nothing jumps around while the page loads.", check: "Lighthouse layout shift under 0.1." },
  { id: "s-p4", code: "P4", level: "Nice", area: "speed", when: "If it's a site people visit", then: "Set a speed budget that's checked on every deploy.", check: "The deploy fails when the budget is broken." },
  // Setup & shipping
  { id: "s-simple", code: "O6", level: "Must", area: "setup", when: ALWAYS, then: "Make setup as simple as possible — do the setup steps for the user instead of listing them.", check: "A new user is set up without asking a question." },
  { id: "s-ship", code: "O7", level: "Must", area: "setup", when: "When a change is finished", then: "Commit, push and check it actually deployed, then test it live.", check: "The live site shows the change." },
  { id: "s-o1", code: "O1", level: "Must", area: "setup", when: ALWAYS, then: "Typecheck and tests pass before every deploy.", check: "A failing test blocks the deploy." },
  { id: "s-o2", code: "O2", level: "Should", area: "setup", when: ALWAYS, then: "Try every change on a preview deploy before it goes live.", check: "Each change has a preview link." },
  { id: "s-o3", code: "O3", level: "Should", area: "setup", when: "If it's live for other people", then: "Watch that it's up, and alert someone when it's down.", check: "An uptime check pings it every 5 minutes." },
  { id: "s-o4", code: "O4", level: "Should", area: "setup", when: "If it's live for other people", then: "Rolling back to the last good version is one click.", check: "Roll back once, on purpose." },
  // Safety
  { id: "s-confirm", code: "S7", level: "Must", area: "safety", when: "If an action can't be undone (pay, send, delete)", then: "Confirm it with the user first.", check: "Every pay/send/delete asks first." },
  { id: "s-secrets", code: "S1", level: "Must", area: "safety", when: ALWAYS, then: "Never show passwords or keys in the page, the browser bundle or logs; secret keys stay on the server.", check: "Search the built site for sk-, service_role, secret." },
  { id: "s-s2", code: "S2", level: "Must", area: "safety", when: "If it has a Supabase database", then: "Every table has Row Level Security on, with a policy.", check: "No public table has RLS off." },
  { id: "s-s4", code: "S4", level: "Must", area: "safety", when: "If it takes input", then: "Check every input on the server (type and size); never trust the browser.", check: "Send an oversized or wrong-type request: a clean 400." },
  { id: "s-s5", code: "S5", level: "Should", area: "safety", when: "If anything costs money per use (AI, SMS, email)", then: "Rate-limit it, so nobody can run up the bill.", check: "Fire 50 requests: later ones are refused politely." },
  { id: "s-s6", code: "S6", level: "Should", area: "safety", when: "If it's a public site", then: "HTTPS only and standard security headers.", check: "securityheaders.com grade B or better." },
  // Client sites
  { id: "s-c1", code: "C1", level: "Must", area: "client", when: "If it's a client's website", then: "Domain, DNS and email (SPF, DKIM, DMARC) set up and owned by the client.", check: "mxtoolbox.com shows all three passing." },
  { id: "s-c2", code: "C2", level: "Must", area: "client", when: "If it's a client's website", then: "Privacy policy, contact page, and a cookie notice where analytics run.", check: "The footer links work." },
  { id: "s-c3", code: "C3", level: "Must", area: "client", when: "If it's a client's website with a form", then: "Forms actually deliver, somewhere the client reads.", check: "Send a test: it arrives." },
  { id: "s-c4", code: "C4", level: "Should", area: "client", when: "If it's a client's website", then: "Add the Jarvis error script so its crashes reach you.", check: "A forced error shows under the client's name in Site errors." },
  { id: "s-c5", code: "C5", level: "Should", area: "client", when: "If it's a client's website", then: "Install analytics the client can see.", check: "One visit shows in their dashboard." },
  { id: "s-c6", code: "C6", level: "Should", area: "client", when: "If it's a client's website", then: "Send the Client Review link so edit requests come through Jarvis.", check: "The client opens their link and signs in." },
];

/** Every starter rule's code, level and text — what Felix and the board cite. */
export const STARTER_LINES: readonly { id: string; code: string; level: RuleLevel; area: RuleArea; when: string; then: string; check: string }[] =
  STARTERS.map((r) => ({ id: r.id, code: r.code!, level: r.level!, area: r.area, when: r.when, then: r.then, check: r.check! }));

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

/**
 * Fill in starter rules added since the owner's list was first made, and
 * bring the owner's copies of existing starters up to date (wording, code,
 * level, check) — keeping what is theirs: on/off, how often they said it, the
 * evidence. A starter the owner removed stays removed.
 */
export function withStarters(state: JarvisProfileState, now: number): JarvisProfileState {
  const byId = new Map(STARTERS.map((s) => [s.id, s]));
  const removed = new Set(state.removed);
  let changed = false;
  const rules = state.rules.map((r) => {
    const s = r.source === "starter" ? byId.get(r.id) : undefined;
    if (!s) return r;
    if (r.then === s.then && r.when === s.when && r.code === s.code && r.level === s.level && r.check === s.check && r.area === s.area) return r;
    changed = true;
    return { ...r, then: s.then, when: s.when, area: s.area, code: s.code, level: s.level, check: s.check };
  });
  const have = new Set(rules.map((r) => r.id));
  const missing = starterRules(now).filter((s) => !have.has(s.id) && !removed.has(ruleKey(s.then)));
  return missing.length || changed ? { ...state, rules: [...rules, ...missing] } : state;
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

function line(r: ChecklistRule, withCheck = false): string {
  const tag = r.code ? `[${r.code}${r.level === "Must" ? "" : ` · ${r.level?.toLowerCase()}`}] ` : "";
  const text = r.when === ALWAYS ? r.then : `${r.when}: ${r.then}`;
  return `- ${tag}${text}${withCheck && r.check ? ` — check: ${r.check}` : ""}`;
}

/** What Jarvis's chat brain is told, for every build. */
export function checklistPrompt(state: JarvisProfileState, max = 5_000, withChecks = false): string {
  const rules = activeRules(state);
  if (!rules.length) return "";
  const out: string[] = [];
  for (const a of RULE_AREAS) {
    const mine = rules.filter((r) => r.area === a.id);
    if (!mine.length) continue;
    out.push(`${a.label}:`, ...mine.map((r) => line(r, withChecks)));
  }
  const text = out.join("\n");
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

export const SKILL_NAME = "website-build-checklist";

/** The same list as a Claude Code skill, so builds on the PC and VPS follow it. */
export function checklistSkill(state: JarvisProfileState): string {
  const body = checklistPrompt(state, 30_000, true);
  return `---
name: ${SKILL_NAME}
description: The owner's ONE build checklist for building, changing or reviewing ANY app or website — the common-sense rules they never want to repeat (logins for multi-user apps, no duplicates, newest first, updates by itself, plain-English errors, phone-friendly, simple setup) plus the pro standard (never a white page, every crash logged, security, speed, shipping, client-site handoff). Each rule has a code (R2, S3…) and how to check it. Felix, the prompt enhancer and the software factory hold every build to it. Use it every time you build, change or review an app or website for the owner. Nicknames: the checklist, build checklist, backend checklist, website checklist, Jarvis Profile checklist.
metadata:
  category: Build & Ship, Web Design
  nicknames: the checklist, build checklist, backend checklist, website checklist, Jarvis Profile checklist
---

# Website & app build checklist

This is the only build checklist. It is kept by Jarvis Profile (Jarvis › Dashboard › Jarvis
Profile), learns from the owner's chats, and is published over this file on every change — do
not edit it here.

Before you call any build or change finished, go through every rule below that applies and fix
anything that misses one. Use each rule's check as the proof, not your own opinion. If a rule
genuinely cannot apply, say so in one line. Cite rules by code (e.g. "closes R2") in plans,
prompts and board cards. Untagged levels are Must (ship-blockers); "should" is before a client
sees it; "nice" is when there is time.

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
