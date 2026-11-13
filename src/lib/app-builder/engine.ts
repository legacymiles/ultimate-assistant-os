// ---------------------------------------------------------------------------
// App Builder — the pure engine.
//
// Everything here runs with no model and no network, which is why it is the
// part with tests. It is three things:
//
//   1. The OFFLINE super agent: the intake questions, a first read of the idea,
//      and a feature list built from the app's purpose — what the owner gets
//      when no AI key is set, and the floor the AI answer is checked against.
//   2. The feature list's rules: accept / deny / edit / add, as ops, so the
//      chat (AI or typed commands) and the buttons change it the same way.
//   3. The hand-off: the master build prompt (Felix + prompt-enhancer shape,
//      with the owner's always-on skill pipeline written into it), the short
//      In Queue version the PC picks up, and one board card per feature.
//
// The always-on pipeline is the owner's rule for this app: every build runs
// felix → prompt-enhancer → the design skill → software-factory → claude-security,
// held to the one build checklist (website-build-checklist).
// ---------------------------------------------------------------------------

import { redesignBrief } from "./redesignBrief";
import { designIntelligenceBlock, designIntelligenceLine } from "@/lib/design-intelligence/brief";
import { shapeOf } from "@/lib/mockup/spec";
import type { Shape } from "@/lib/mockup/types";

import { CHECKLIST, type BoardTicket } from "../new-jarvis/felix";
import { EDIT_CHECKLIST, editMasterPrompt, editPipeline, editQueueText } from "./clientEdit";
import { depthAxes, depthBrief, depthOf, depthSteps, type Depth } from "./depth";
import { planNotesBlock } from "./planCheck";
import {
  APP_TYPE_LABEL,
  KIND_LABEL,
  KINDS,
  type Answers,
  type AppType,
  type BuilderProject,
  type ChatMsg,
  type Effort,
  type Feature,
  type FeatureKind,
  type FeatureOp,
  type Question,
  type Proof,
  type Scenario,
  type Teardown,
  type TeardownMode,
  type RedesignSource,
  type Understanding,
} from "./types";

// ----- small helpers ---------------------------------------------------------------

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export const asList = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).map((s) => clean(String(s))).filter(Boolean);

export const asText = (v: string | string[] | undefined): string => asList(v).join("; ");

function cap(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

export function newId(prefix: string, rand: () => number = Math.random): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;
}

// ----- reading the idea -------------------------------------------------------------

/** What kind of thing the idea is, from its words. Conservative: web app by default. */
export function appTypeOf(text: string): AppType {
  const t = ` ${text.toLowerCase()} `;
  if (/\b(game|play(er|able)|level|arcade|puzzle|multiplayer)\b/.test(t)) return "game";
  if (/\b(iphone|android|ios|phone app|mobile app|app store|play store)\b/.test(t)) return "mobile";
  if (/\b(marketplace|buyers? and sellers?|sellers?|vendors?|book(ing)? (a|local)|gig|freelancer|rent(al)?s? )\b/.test(t)) return "marketplace";
  if (/\b(saas|subscription|teams?|b2b|businesses|crm|platform)\b/.test(t)) return "saas";
  if (/\b(dashboard|tracker|calculator|tool|admin|internal|generator|converter)\b/.test(t)) return "tool";
  if (/\b(website|web site|landing page|homepage|portfolio|site for)\b/.test(t)) return "website";
  return "webapp";
}

/** A working name from the idea. "called X" / "named X" / quoted wins. */
export function nameFrom(text: string): string {
  const called = text.match(/\b(?:called|named)\s+["“']?([A-Za-z0-9][\w .&'-]{1,40}?)["”']?(?=[,.!?;]|\s+(?:that|which|for|to|where|and)\b|$)/i);
  if (called) return cap(clean(called[1]));
  const quoted = text.match(/["“]([^"”]{2,40})["”]/);
  if (quoted) return clean(quoted[1]);
  const phrase = text
    .toLowerCase()
    .replace(/^(please\s+)?(can you\s+|could you\s+)?(build|make|create|design|develop|code)\s+(me\s+)?/, "")
    .match(/\b(?:an?|the|this|that|my)\s+([a-z0-9][a-z0-9 -]{2,48}?)(?=\s+(?:that|which|for|to|where|where|so|with|who)\b|[,.!?]|$)/);
  const words = (phrase ? phrase[1] : text.toLowerCase())
    .split(/\s+/)
    .filter((w) => w && !/^(a|an|the|this|that|my|super|cool|simple|really|very)$/.test(w))
    .slice(0, 4);
  const name = cap(words.join(" ")).trim();
  return name.length >= 3 ? name : "Untitled App";
}

// ----- the intake (Felix step 1) --------------------------------------------------------

export const LOOK_OPTIONS = ["Futuristic & cinematic", "Clean & professional", "Bold & playful", "Minimal & calm"];
export const TOUCH_OPTIONS = ["Accounts / sign-in", "Payments", "Personal data", "AI", "Other apps", "Works offline"];
export const MONEY_OPTIONS = ["Subscriptions", "Free + paid upgrades", "Marketplace fee", "One-time purchase", "Ads", "Not about money"];

/**
 * The questions the super agent asks before it designs anything. End goal
 * first, because every feature is chosen to serve it (Felix rule 1). The first
 * option is the recommended one, so "use your best guesses" can fill them.
 */
export function intakeQuestions(text: string, withMedia = false): Question[] {
  const type = appTypeOf(text);
  const audience =
    type === "saas"
      ? ["Businesses", "The public", "My clients", "Just me / my team"]
      : type === "tool"
        ? ["Just me / my team", "My clients", "Businesses", "The public"]
        : ["The public", "Businesses", "My clients", "Just me / my team"];
  const money =
    type === "marketplace"
      ? ["Marketplace fee", ...MONEY_OPTIONS.filter((m) => m !== "Marketplace fee")]
      : type === "tool"
        ? ["Not about money", ...MONEY_OPTIONS.filter((m) => m !== "Not about money")]
        : MONEY_OPTIONS;
  return [
    {
      id: "purpose",
      label: "What is it for?",
      hint: "What should be true for people once it exists — the end goal, in your words.",
      options: [],
      free: true,
    },
    { id: "audience", label: "Who is it for?", options: audience },
    {
      id: "success",
      label: "How will we know it worked?",
      options: ["People finish the main task without help", "Makes money", "People come back every week", "Never crashes, fast on phones"],
      multi: true,
      free: true,
    },
    { id: "model", label: "How does it make money?", options: money },
    { id: "touches", label: "What does it touch?", options: TOUCH_OPTIONS, multi: true },
    withMedia
      ? {
          id: "mode",
          label: "What should I do with the recording?",
          hint: "Rebuild what it shows, or use it as the starting point for something different.",
          options: modeOf(text) === "change" ? [MODE_OPTIONS[1], MODE_OPTIONS[0]] : MODE_OPTIONS,
          free: true,
        }
      : { id: "look", label: "Look & feel", options: LOOK_OPTIONS, free: true },
  ];
}

// ----- reverse engineering a recording -----------------------------------------------------

export const MODE_OPTIONS = ["Recreate it as it works", "Change it to my request"];

/** Did the owner ask to rebuild what the recording shows, or to change it? */
export function modeOf(text: string, answer = ""): TeardownMode {
  if (answer === MODE_OPTIONS[0]) return "recreate";
  if (answer && answer !== MODE_OPTIONS[0]) return "change";
  return /\b(but|instead|change|different|differently|better|improve|add|remove|without|except|swap|replace|redesign|make it|for my|for (a|an|the) )\b/i.test(text)
    ? "change"
    : "recreate";
}

const strs = (v: unknown, max: number, len = 240): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => clean(x).slice(0, len)).slice(0, max) : [];

/** The model's teardown, cleaned; null when it saw nothing usable. */
export function coerceTeardown(raw: unknown, mode: TeardownMode): Teardown | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? clean(o.summary).slice(0, 600) : "";
  const screens = Array.isArray(o.screens)
    ? o.screens
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>).name === "string")
        .slice(0, 12)
        .map((x) => ({
          name: clean(String(x.name)).slice(0, 60),
          purpose: typeof x.purpose === "string" ? clean(x.purpose).slice(0, 200) : "",
          elements: strs(x.elements, 10, 120),
        }))
    : [];
  const flow = strs(o.flow, 20);
  if (!summary && !screens.length && !flow.length) return null;
  return {
    mode: o.mode === "recreate" || o.mode === "change" ? o.mode : mode,
    summary,
    screens,
    flow,
    behaviours: strs(o.behaviours, 16),
    dataModel: strs(o.dataModel, 12, 160),
    stackGuess: typeof o.stackGuess === "string" ? clean(o.stackGuess).slice(0, 200) : "",
    changes: strs(o.changes, 10, 300),
    unknowns: strs(o.unknowns, 8),
  };
}

/** The teardown as compact text, for prompts and the queue. */
export function teardownText(t: Teardown, budget = 6_000): string {
  const lines = [
    `Mode: ${t.mode === "recreate" ? "recreate what it shows" : "change it to the owner's request"}.`,
    `What it shows: ${t.summary}`,
    t.screens.length ? `Screens: ${t.screens.map((s) => `${s.name} (${s.purpose}${s.elements.length ? `; ${s.elements.join(", ")}` : ""})`).join(" | ")}` : "",
    t.flow.length ? `Flow: ${t.flow.map((f, i) => `${i + 1}) ${f}`).join(" ")}` : "",
    t.behaviours.length ? `Behaviour to keep: ${t.behaviours.join("; ")}` : "",
    t.dataModel.length ? `Data: ${t.dataModel.join("; ")}` : "",
    t.stackGuess ? `Likely built with: ${t.stackGuess}` : "",
    t.changes.length ? `Owner's changes: ${t.changes.join("; ")}` : "",
    t.unknowns.length ? `Not visible in the recording (confirm): ${t.unknowns.join("; ")}` : "",
  ].filter(Boolean);
  const text = lines.join("\n");
  return text.length > budget ? `${text.slice(0, budget - 1)}…` : text;
}

/**
 * Features straight from a teardown: each screen and kept behaviour (for the
 * owner to accept), and each change they asked for (already accepted — it is
 * their own request, in their words).
 */
export function teardownFeatures(t: Teardown, startAt = 1): Feature[] {
  const short = (x: string) => (x.length > 60 ? `${x.slice(0, 57)}…` : x);
  const out: Feature[] = [];
  const push = (raw: Record<string, unknown>, mine: boolean) => {
    const [f] = coerceFeatures([raw], startAt + out.length);
    if (!f || out.some((x) => x.title.toLowerCase() === f.title.toLowerCase())) return;
    out.push(mine ? { ...f, source: "you", status: "accepted" } : f);
  };
  for (const c of t.changes.slice(0, 5)) {
    push({ title: short(c), detail: c, why: "You asked for this change to what the recording shows.", kind: "core", impact: 3, effort: "M" }, true);
  }
  for (const s of t.screens.slice(0, 6)) {
    push(
      {
        title: s.name,
        detail: `${s.purpose}${s.elements.length ? ` — ${s.elements.slice(0, 5).join(", ")}` : ""}`,
        why: "Seen in the recording; part of the workflow being rebuilt.",
        kind: "core",
        impact: 3,
        effort: "M",
      },
      false,
    );
  }
  for (const b of t.behaviours.slice(0, 4)) {
    push({ title: short(b), detail: b, why: "Behaviour in the recording that makes the workflow work.", kind: "experience", impact: 2, effort: "S" }, false);
  }
  return out;
}

/** Fill every unanswered question with its recommended (first) option. */
export function bestGuesses(questions: Question[], answers: Answers): Answers {
  const out: Answers = { ...answers };
  for (const q of questions) {
    if (asList(out[q.id]).length) continue;
    if (q.options.length) out[q.id] = q.multi ? [q.options[0]] : q.options[0];
  }
  return out;
}

/** A new recording's teardown folded into the one already there (or becoming it). */
export function mergeTeardown(had: Teardown | undefined, next: Teardown): Teardown {
  if (!had) return next;
  const join = <T,>(a: T[], b: T[], key: (x: T) => string, max: number) => {
    const seen = new Set(a.map(key));
    return [...a, ...b.filter((x) => !seen.has(key(x)))].slice(0, max);
  };
  return {
    mode: next.changes.length ? "change" : had.mode,
    summary: next.summary && !had.summary.includes(next.summary) ? `${had.summary} ${next.summary}`.slice(0, 900) : had.summary,
    screens: join(had.screens, next.screens, (s) => s.name.toLowerCase(), 16),
    flow: join(had.flow, next.flow, (s) => s.toLowerCase(), 24),
    behaviours: join(had.behaviours, next.behaviours, (s) => s.toLowerCase(), 20),
    dataModel: join(had.dataModel, next.dataModel, (s) => s.toLowerCase(), 16),
    stackGuess: had.stackGuess || next.stackGuess,
    changes: join(had.changes, next.changes, (s) => s.toLowerCase(), 12),
    unknowns: join(had.unknowns, next.unknowns, (s) => s.toLowerCase(), 10),
  };
}

// ----- the design skill -------------------------------------------------------------------

/** The free design skills App Builder may pick. Paid / footage-rendering ones are opt-in only. */
export const DESIGN_SKILLS: Record<string, string> = {
  "interactive-web-studio": "the default for every app: one original interactive mechanic, purposeful motion, cinematic depth, 60 fps and reduced-motion safe",
  "expo-native-ui": "a phone app that feels native: Apple HIG styling, native controls, semantic colours",
  "website-redesigner": "keeps everything an existing site does and gives it a fresh design",
  "exploded-showcase": "a 3D product teardown hero for a physical product",
  "impeccable": "a restrained, polished interface audit-and-polish pass",
  "taste-skill": "an anti-template, editorial look for landing pages and portfolios",
  "minimalist-skill": "a warm, editorial minimal interface",
  "brutalist-skill": "a raw, data-dense terminal look for dashboards",
  "ui-ux-pro-max": "UI/UX design intelligence for complex multi-screen products",
};

/** Which design skill drives the look, and why. interactive-web-studio unless the idea says otherwise. */
export function designSkillFor(text: string, type: AppType, look = ""): { skill: string; why: string } {
  const t = `${text} ${look}`.toLowerCase();
  const pick = (skill: string) => ({ skill, why: DESIGN_SKILLS[skill] });
  if (type === "mobile") return pick("expo-native-ui");
  if (/\b(redesign|restyle|reskin|make ?over|moderni[sz]e)\b/.test(t)) return pick("website-redesigner");
  if (/\b(exploded|teardown|3d product|gadget|device|hardware)\b/.test(t)) return pick("exploded-showcase");
  if (/\b(brutalist|terminal|raw)\b/.test(t)) return pick("brutalist-skill");
  if (/\b(minimal & calm|minimalist|calm|editorial)\b/.test(t)) return pick("minimalist-skill");
  return pick("interactive-web-studio");
}

/** Keep an AI-picked skill only when it is one we allow. */
export function safeDesignSkill(skill: unknown, fallback: { skill: string; why: string }, why?: unknown): { skill: string; why: string } {
  if (typeof skill === "string" && DESIGN_SKILLS[skill]) {
    return { skill, why: typeof why === "string" && why.trim() ? clean(why).slice(0, 240) : DESIGN_SKILLS[skill] };
  }
  return fallback;
}

// ----- the understanding ------------------------------------------------------------------

const JUDGES: Record<string, string> = {
  "People finish the main task without help": "five people who have never seen it finish the main task on a phone without help",
  "Makes money": "a real payment goes through end to end in Stripe test mode, and the upgrade path is one screen",
  "People come back every week": "day-7 return rate is measured from the first week of real users",
  "Never crashes, fast on phones": "zero logged crashes in the first week, and Lighthouse mobile LCP under 1 s (median of 3)",
};

const BEYOND: Record<AppType, string> = {
  webapp: "it keeps itself right and grows on its own: crashes are logged and fixed before anyone reports them, and every week it gets better from how people use it",
  website: "it keeps bringing in business on its own: fast, trusted, found in search, and editable without a developer",
  mobile: "people open it without being reminded, and it improves every release from real usage",
  saas: "customers succeed with it without talking to anyone, upgrade on their own, and tell other teams",
  marketplace: "both sides trust it enough to come back without a nudge, and every new listing makes it more useful",
  tool: "it takes the chore away for good — it runs itself and flags only what needs a human",
  game: "players come back tomorrow on their own and bring a friend",
};

/** The agent's first read, before questions are answered. */
export function firstRead(idea: string): Understanding {
  const type = appTypeOf(idea);
  const name = nameFrom(idea);
  const design = designSkillFor(idea, type);
  return {
    name,
    oneLiner: clean(idea).slice(0, 140),
    appType: type,
    purpose: "",
    audience: "",
    endGoal: "",
    beyond: BEYOND[type],
    model: "",
    designSkill: design.skill,
    designWhy: design.why,
    judge: [],
  };
}

/** The full understanding once the questions are answered, with no model. */
export function understand(idea: string, answers: Answers): Understanding {
  const base = firstRead(idea);
  const purpose = asText(answers.purpose) || clean(idea);
  const audience = asText(answers.audience) || "The public";
  const look = asText(answers.look);
  const design = designSkillFor(idea, base.appType, look);
  const judge = asList(answers.success).map((s) => JUDGES[s] ?? s);
  if (judge.length < 2) judge.push(JUDGES["Never crashes, fast on phones"]);
  if (judge.length < 3) judge.push("Claude Security finds no high or critical issue before launch");
  return {
    ...base,
    purpose,
    audience,
    endGoal: asText(answers.purpose)
      ? purpose.replace(/\.$/, "")
      : `${base.name} does the job it exists for, for ${audience.toLowerCase()}, without anyone needing help`,
    model: asText(answers.model) || "Not decided",
    designSkill: design.skill,
    designWhy: design.why,
    judge: judge.slice(0, 5),
  };
}

// ----- the offline feature list -----------------------------------------------------------

interface Template {
  title: string;
  detail: string;
  why: string;
  kind: FeatureKind;
  impact: 1 | 2 | 3;
  effort: Effort;
  checklist?: string[];
  when?: (c: Ctx) => boolean;
  /**
   * How you tell this one works, with {name}/{purpose} filled like the rest.
   * Every template has at least one: the offline list is what the owner gets
   * with no AI key, and it must pass `planCheck` just like the AI's does.
   */
  scenarios: { name: string; when: string; then: string; proof?: Proof }[];
}

interface Ctx {
  type: AppType;
  touches: string;
  model: string;
  audience: string;
  name: string;
  purpose: string;
}

const multiUser = (c: Ctx) => c.audience !== "Just me / my team" || /account/.test(c.touches);
const paid = (c: Ctx) => /subscription|upgrade|purchase|fee/i.test(c.model) || /payment/.test(c.touches);

const TEMPLATES: Template[] = [
  {
    title: "The main job in three taps",
    detail: "The one thing {name} exists for — {purpose} — reachable from the home screen in three taps or fewer, with the result shown instantly.",
    why: "People judge an app by how fast it does the thing they came for.",
    kind: "core",
    impact: 3,
    effort: "M",
    checklist: ["U1"],
    scenarios: [
      { name: "Straight to the main job", when: "someone opens {name} for the first time and taps the main action", then: "the thing they came for is on screen within three taps, with no setup screen in between" },
      { name: "The result shows at once", when: "they finish that action", then: "the result is on screen in under a second, not a spinner that outlasts it" },
    ],
  },
  {
    title: "First win in 60 seconds",
    detail: "A guided first run with sample data, so a brand-new user sees a real result before they're asked to sign up or set anything up.",
    why: "Most people decide in the first minute whether an app is for them.",
    kind: "experience",
    impact: 3,
    effort: "M",
    checklist: ["O6", "U4"],
    scenarios: [
      { name: "A real result before signing up", when: "a brand-new visitor starts the guided first run", then: "they reach a real result using sample data without being asked to sign up" },
      { name: "Sample data is theirs to clear", when: "they press to clear the sample data", then: "their own empty state shows, with nothing of the sample left" },
    ],
  },
  {
    title: "AI co-pilot",
    detail: "Describe what you want in one sentence and the app does the main task for you, showing each step it took so it can be undone.",
    why: "Turns {name} from a tool people operate into one that works for them.",
    kind: "automation",
    impact: 3,
    effort: "L",
    checklist: ["R4", "S5"],
    when: (c) => c.type !== "website",
    scenarios: [
      { name: "One sentence does the job", when: "someone describes what they want in one sentence", then: "the main task is done and each step it took is listed under the result" },
      { name: "Every step can be undone", when: "they press undo on a step the co-pilot took", then: "that step is reversed and the data reads as it did before it ran" },
      { name: "A refusal says why", when: "the co-pilot cannot do what was asked", then: "it says in plain words what it could not do and what to try, and changes nothing" },
    ],
  },
  {
    title: "Sign-in that keeps each person's data their own",
    detail: "Email or Google sign-in, every row scoped to its owner with Row Level Security, and an owner-only admin side locked on the server.",
    why: "More than one person will use it, so each one's data has to stay theirs.",
    kind: "trust",
    impact: 3,
    effort: "M",
    checklist: ["L1", "S2", "S3"],
    when: multiUser,
    scenarios: [
      { name: "Each person sees only their own", when: "a signed-in person opens a list another account created", then: "nothing of the other account's data is returned, including when the API is called directly" },
      { name: "Signed out means locked out", when: "a signed-out visitor opens an app page by URL", then: "they are sent to sign-in and no data is in the response" },
      { name: "The owner side is owner-only", when: "a signed-in person who is not the owner opens the admin page", then: "the server refuses it, not just the UI hiding the link" },
    ],
  },
  {
    title: "Plans, trial and checkout",
    detail: "Stripe Checkout with a free trial, a pricing page, upgrade prompts at the moment a limit is hit, and a billing page people manage themselves.",
    why: "It has to make money without anyone chasing payments by hand.",
    kind: "money",
    impact: 3,
    effort: "M",
    checklist: ["S7", "S5"],
    when: (c) => paid(c) && c.type !== "marketplace",
    scenarios: [
      { name: "Checkout starts the trial", when: "someone picks a plan and finishes Stripe Checkout in test mode", then: "their account reads as on that plan with the trial end date shown" },
      { name: "The limit offers the upgrade", when: "a free account hits the plan's limit", then: "an upgrade prompt names the limit they hit and what the next plan gives" },
      { name: "Billing is self-serve", when: "a paying person opens the billing page", then: "they can change or cancel the plan themselves without contacting anyone" },
    ],
  },
  {
    title: "Payouts between buyers and sellers",
    detail: "Stripe Connect: buyers pay in the app, the platform keeps its fee, sellers get paid out automatically with their own dashboard.",
    why: "A marketplace earns on every deal, and both sides need to trust the money.",
    kind: "money",
    impact: 3,
    effort: "L",
    checklist: ["S7", "S3"],
    when: (c) => c.type === "marketplace",
    scenarios: [
      { name: "The fee is split on payment", when: "a buyer pays for a listing in test mode", then: "the seller's balance rises by the amount minus the platform fee, and the fee is recorded" },
      { name: "Sellers see their own money", when: "a seller opens their dashboard", then: "their payouts and pending balance show, and no other seller's figures do" },
    ],
  },
  {
    title: "Reviews & trust badges",
    detail: "Verified reviews after a completed job, response-time and completion badges, and reporting with a moderation queue.",
    why: "Strangers only transact when they can see who to trust.",
    kind: "trust",
    impact: 2,
    effort: "M",
    when: (c) => c.type === "marketplace",
    scenarios: [
      { name: "Only finished jobs get reviewed", when: "someone tries to review a job that never completed", then: "the review is refused with a plain reason" },
      { name: "A report reaches the queue", when: "a visitor reports a listing", then: "it appears in the moderation queue with the reason and who reported it" },
    ],
  },
  {
    title: "Live updates, no refresh",
    detail: "New items, messages and status changes appear on their own, on every open device.",
    why: "Nobody should have to press a button to see what's new.",
    kind: "experience",
    impact: 2,
    effort: "S",
    checklist: ["A1", "D3"],
    when: (c) => c.type !== "website",
    scenarios: [
      { name: "Two devices stay in step", when: "a change is made on one open device", then: "every other open device shows it without anyone refreshing" },
      { name: "A dropped connection catches up", when: "a device loses its connection and regains it", then: "it shows the changes it missed, with no duplicates in the list" },
    ],
  },
  {
    title: "Command bar & instant search",
    detail: "Press ⌘K (or the search icon on a phone) to find anything or run any action by typing, with results in under 100 ms.",
    why: "Power users live in the keyboard; everyone else finds things faster.",
    kind: "experience",
    impact: 2,
    effort: "S",
    checklist: ["U7"],
    when: (c) => c.type === "saas" || c.type === "tool" || c.type === "webapp",
    scenarios: [
      { name: "Typing finds it", when: "someone presses the search shortcut and types part of an item's name", then: "matching results are on screen in under 100 ms" },
      { name: "Actions run from the keyboard", when: "they choose an action from the results with the keyboard", then: "that action runs without the mouse being touched" },
    ],
  },
  {
    title: "Smart reminders that bring people back",
    detail: "Opt-in email and push nudges timed to each person's own habits, each kind switchable off in settings.",
    why: "An app people forget about can't do its job.",
    kind: "growth",
    impact: 2,
    effort: "M",
    checklist: ["A2"],
    when: (c) => c.type !== "website",
    scenarios: [
      { name: "A nudge arrives once", when: "a reminder is due for someone who opted in", then: "they get exactly one notification for it, and the next run sends no repeat" },
      { name: "Off means off", when: "they switch that kind of reminder off in settings", then: "no further notification of that kind is sent to them" },
    ],
  },
  {
    title: "Share links with rich previews",
    detail: "Anything worth showing gets a public share link with a proper title, description and preview image in chat apps.",
    why: "Every share is free marketing for {name}.",
    kind: "growth",
    impact: 2,
    effort: "S",
    checklist: ["U3"],
    scenarios: [
      { name: "A share link previews properly", when: "a share link is pasted into a chat app", then: "the title, description and preview image of that item show" },
      { name: "Private things do not leak", when: "a share link is opened for an item that was made private", then: "the page says it is no longer shared and shows none of its content" },
    ],
  },
  {
    title: "Invite your team / friends",
    detail: "Invite by link or email, each invite its own link that can be turned off, with a reward for both sides when it's accepted.",
    why: "The cheapest growth comes from people who already love it.",
    kind: "growth",
    impact: 2,
    effort: "M",
    checklist: ["L2"],
    when: (c) => multiUser(c) && c.type !== "website",
    scenarios: [
      { name: "An invite joins the right place", when: "someone opens an invite link and signs in", then: "they are in the inviting person's team or board, with the invited role" },
      { name: "A turned-off invite is dead", when: "the inviter turns that invite link off and it is opened again", then: "it is refused and nobody is added" },
    ],
  },
  {
    title: "Search-ready landing pages",
    detail: "Fast, indexable landing pages for the main searches people make, with structured data and a speed budget checked on every deploy.",
    why: "People who are already searching for this should find it first.",
    kind: "growth",
    impact: 2,
    effort: "M",
    checklist: ["P1", "U3", "P4"],
    when: (c) => c.type === "website" || c.type === "marketplace" || c.type === "saas",
    scenarios: [
      { name: "A landing page is indexable", when: "a landing page is fetched with JavaScript off", then: "its heading, copy and links are in the HTML, with a title and meta description" },
      { name: "It stays fast", when: "the page is measured on a throttled phone connection", then: "its largest content paints in under 2.5 s" },
    ],
  },
  {
    title: "Book or contact in one step",
    detail: "A call, book or enquiry button on every screen that actually delivers to an inbox the owner reads.",
    why: "A visitor who wants to act shouldn't have to look for how.",
    kind: "core",
    impact: 3,
    effort: "S",
    checklist: ["C3"],
    when: (c) => c.type === "website",
    scenarios: [
      { name: "An enquiry reaches the inbox", when: "a visitor submits the contact form with a name, email and message", then: "they see a confirmation and the message arrives in the owner's inbox" },
      { name: "A wrong email is caught", when: "they submit it with an email that has no @ in it", then: "the field says what is wrong and nothing is sent" },
      { name: "The button is on every screen", when: "any page is opened at 390 px wide", then: "the call or enquiry button is reachable without scrolling to the footer" },
    ],
  },
  {
    title: "Daily challenge & leaderboard",
    detail: "A fresh challenge every day, a friends leaderboard and streaks that are forgiving (one free miss a week).",
    why: "Players come back for tomorrow's challenge.",
    kind: "growth",
    impact: 3,
    effort: "M",
    when: (c) => c.type === "game",
    scenarios: [
      { name: "Today's challenge is the same for everyone", when: "two players open the game on the same day", then: "they are given the same challenge, and it changes at the day boundary" },
      { name: "A streak forgives one miss", when: "a player misses one day in a week", then: "their streak survives, and a second miss in that week ends it" },
    ],
  },
  {
    title: "Works offline",
    detail: "The main screens work with no signal, changes queue up and sync when the connection is back, with nothing lost.",
    why: "Phones lose signal; the app shouldn't lose work.",
    kind: "experience",
    impact: 2,
    effort: "M",
    checklist: ["D3", "R6"],
    when: (c) => c.type === "mobile" || /offline/.test(c.touches),
    scenarios: [
      { name: "The main screens work with no signal", when: "the connection is cut and a main screen is opened", then: "it shows the last data with a plain note that the app is offline" },
      { name: "Queued changes sync", when: "changes are made offline and the connection comes back", then: "all of them are saved once each, with nothing lost or duplicated" },
    ],
  },
  {
    title: "Owner analytics that answer questions",
    detail: "A dashboard of the numbers that decide whether {name} is working — sign-ups, the main task completed, return rate, revenue — with plain-English weekly insights.",
    why: "You can only improve what you can see.",
    kind: "automation",
    impact: 2,
    effort: "M",
    when: (c) => c.type !== "game",
    scenarios: [
      { name: "The numbers are real", when: "the owner opens the dashboard after a known set of sign-ups and completed tasks", then: "the counts match that set exactly" },
      { name: "The weekly insight is in plain English", when: "a week of data exists", then: "the insight names what moved and by how much, with no jargon or raw metric names" },
    ],
  },
  {
    title: "Self-healing: crashes become fixes",
    detail: "Every crash is logged with context and becomes a Backlog card on the board by itself, so fixes ship before anyone reports it.",
    why: "The goal beyond the goal: it keeps itself right.",
    kind: "automation",
    impact: 2,
    effort: "S",
    checklist: ["R1", "R2", "O5"],
    scenarios: [
      { name: "A crash is logged, not lost", when: "a page throws an error", then: "the visitor sees a plain-English screen with a way back, and the crash is in the log with its context" },
      { name: "A crash becomes a card", when: "a new crash is logged", then: "a Backlog card exists for it, and a second instance of the same crash does not open a duplicate" },
    ],
  },
  {
    title: "Export & delete my data",
    detail: "Anyone can download everything they've put in, or delete their account and have it actually removed.",
    why: "Trust is a feature: people commit more when they can leave.",
    kind: "trust",
    impact: 1,
    effort: "S",
    checklist: ["D4"],
    when: (c) => multiUser(c) && /personal|account/.test(c.touches),
    scenarios: [
      { name: "Export is everything", when: "someone asks to download their data", then: "they get a file holding every record they created, readable without the app" },
      { name: "Delete really deletes", when: "someone deletes their account and it is looked for afterwards", then: "none of their rows remain and signing in with it fails" },
    ],
  },
  {
    title: "Undo everything",
    detail: "Every delete or big change can be undone for 10 seconds, and anything that can't be undone asks once first.",
    why: "People explore more when mistakes are free.",
    kind: "experience",
    impact: 1,
    effort: "S",
    checklist: ["D6", "S7"],
    when: (c) => c.type !== "website",
    scenarios: [
      { name: "Undo brings it back", when: "something is deleted and undo is pressed within ten seconds", then: "it is back in the list exactly as it was" },
      { name: "The un-undoable asks first", when: "an action that cannot be undone is started", then: "it asks once, naming what will happen, and does nothing until confirmed" },
    ],
  },
];

function fill(s: string, c: Ctx): string {
  return s.replace(/\{name\}/g, c.name).replace(/\{purpose\}/g, c.purpose.charAt(0).toLowerCase() + c.purpose.slice(1).replace(/\.$/, ""));
}

/** The offline feature list: chosen from the app's purpose and answers, best first. */
export function offlineFeatures(idea: string, answers: Answers, u: Understanding = understand(idea, answers)): Feature[] {
  const c: Ctx = {
    type: u.appType,
    touches: asText(answers.touches).toLowerCase(),
    model: u.model,
    audience: u.audience,
    name: u.name,
    purpose: u.purpose,
  };
  const picked = TEMPLATES.filter((t) => !t.when || t.when(c));
  const rank = (t: Template) => t.impact * 10 - ({ S: 0, M: 1, L: 2 }[t.effort]);
  return picked
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, 14)
    .map((t, i) => ({
      id: `f${i + 1}`,
      title: t.title,
      detail: fill(t.detail, c),
      why: fill(t.why, c),
      kind: t.kind,
      impact: t.impact,
      effort: t.effort,
      status: "proposed" as const,
      source: "agent" as const,
      checklist: t.checklist,
      scenarios: coerceScenarios(
        t.scenarios.map((sc) => ({ ...sc, name: fill(sc.name, c), when: fill(sc.when, c), then: fill(sc.then, c) })),
        `f${i + 1}`,
      ),
    }));
}

// ----- scenarios -------------------------------------------------------------------------

/**
 * Guess how a scenario gets proven from the way its THEN is written.
 *
 * A THEN about something a person LOOKS at is a browser test; a THEN about
 * data, mail or money is a unit test. It is only a default — the model and the
 * owner can both say otherwise — but it means a scenario typed by hand in the
 * feature card still arrives with a sensible proof instead of none.
 */
export function proofOf(then: string, when = ""): Proof {
  const t = `${then} ${when}`.toLowerCase();
  // Stems (animat-, redirect-, navigat-) take no closing \b, or "redirected"
  // and "animation" would never match. Whole words keep theirs.
  const stems = /(animat|redirect|navigat|scroll|hover|screenshot|highlight)/;
  const words = /\b(sees?|seen|shown|shows|appears?|displays?|reads?|opens?|closes?|looks?|colour|color|layout|tap|taps|click|clicks|press|presses|visible|screen|page|button|form|list|row|modal|toast|banner|phone|mobile|desktop|px)\b/;
  return stems.test(t) || words.test(t) ? "browser" : "unit";
}

const PROOFS = new Set<Proof>(["unit", "browser", "manual"]);

/**
 * Turn whatever the model (or a saved project) sent into valid scenarios,
 * numbered against their feature.
 *
 * Both halves have to be real: a WHEN with no THEN is a wish, and a THEN with
 * no WHEN is a hope. Eight characters is the floor that keeps "ok" and "yes"
 * out without rejecting "email sent".
 */
export function coerceScenarios(raw: unknown, featureId: string, max = 3): Scenario[] {
  if (!Array.isArray(raw)) return [];
  const out: Scenario[] = [];
  for (const r of raw) {
    if (out.length >= max) break;
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const when = typeof o.when === "string" ? clean(o.when).slice(0, 220) : "";
    const then = typeof o.then === "string" ? clean(o.then).slice(0, 260) : "";
    if (when.length < 8 || then.length < 8) continue;
    const given = typeof o.given === "string" ? clean(o.given).slice(0, 160) : "";
    const name = typeof o.name === "string" ? clean(o.name).slice(0, 70) : "";
    out.push({
      id: `${featureId}.s${out.length + 1}`,
      name: name || when.slice(0, 70),
      ...(given ? { given } : {}),
      when,
      then,
      proof: PROOFS.has(o.proof as Proof) ? (o.proof as Proof) : proofOf(then, when),
      ...(o.source === "you" ? { source: "you" as const } : {}),
    });
  }
  return out;
}

/**
 * What the build must prove, and how it reports it.
 *
 * The old line was "every accepted feature has a test or a recorded
 * click-through", which never said what the test must SHOW — so the agent
 * chose, which is marking your own homework. Naming the scenario id in the
 * test name is what lets `coverage()` count it afterwards without trusting
 * the report's prose.
 */
export function scenarioCriteria(p: BuilderProject): string {
  const all = scenariosOf(p.features);
  if (!all.length) return "- Typecheck and tests pass, with a test covering every feature built.";
  const kinds = {
    unit: all.filter((s) => s.proof === "unit").length,
    browser: all.filter((s) => s.proof === "browser").length,
    manual: all.filter((s) => s.proof === "manual").length,
  };
  return [
    `- Every one of the ${all.length} scenarios above has a test that NAMES ITS ID, e.g. it("${all[0].id} ${all[0].name.toLowerCase()}", …).`,
    kinds.unit ? `  · ${kinds.unit} marked "unit": Vitest, next to the code (npx vitest run <path>).` : "",
    kinds.browser ? `  · ${kinds.browser} marked "browser": a Playwright test that drives the real page.` : "",
    kinds.manual ? `  · ${kinds.manual} marked "manual": a before/after screenshot pair, at desktop and 390 px.` : "",
    "- Typecheck and tests pass (npm run verify).",
    "- End your report with a table of every scenario id → the test that covers it → pass/fail. A scenario with no test is a MISS: say so rather than widening another test to cover it.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Every scenario on the accepted features, in list order. */
export function scenariosOf(features: Feature[], onlyAccepted = true): Scenario[] {
  return features
    .filter((f) => (onlyAccepted ? f.status === "accepted" : true))
    .flatMap((f) => f.scenarios ?? []);
}

/** "WHEN … THEN …" on one line, which is how the briefs and cards print it. */
export function scenarioLine(s: Scenario): string {
  return `${s.given ? `GIVEN ${s.given}, ` : ""}WHEN ${s.when} THEN ${s.then}`;
}

// ----- coercing model output ----------------------------------------------------------------

const KIND_SET = new Set<FeatureKind>(KINDS);

/** Turn whatever the model sent back into valid features, renumbered, best first. */
export function coerceFeatures(raw: unknown, startAt = 1): Feature[] {
  if (!Array.isArray(raw)) return [];
  const out: Feature[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, 20)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const title = typeof o.title === "string" ? clean(o.title).slice(0, 80) : "";
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const kind = KIND_SET.has(o.kind as FeatureKind) ? (o.kind as FeatureKind) : "core";
    const impact = [1, 2, 3].includes(Number(o.impact)) ? (Number(o.impact) as 1 | 2 | 3) : 2;
    const effort = ["S", "M", "L"].includes(String(o.effort)) ? (String(o.effort) as Effort) : "M";
    const codes = Array.isArray(o.checklist)
      ? o.checklist.filter((x): x is string => typeof x === "string" && CHECKLIST.some((c) => c.id === x)).slice(0, 5)
      : undefined;
    // Renumbering the features renumbers their scenarios with them, so an id
    // in a build report always points at the feature it belongs to.
    const id = `f${startAt + out.length}`;
    const scenarios = coerceScenarios(o.scenarios, id);
    out.push({
      id,
      title,
      detail: typeof o.detail === "string" ? clean(o.detail).slice(0, 400) : "",
      why: typeof o.why === "string" ? clean(o.why).slice(0, 240) : "",
      kind,
      impact,
      effort,
      status: "proposed",
      source: "agent",
      checklist: codes?.length ? codes : undefined,
      ...(scenarios.length ? { scenarios } : {}),
    });
  }
  return out;
}

/**
 * A saved feature list coming back from the browser: re-validated field by
 * field, keeping each feature's id and the owner's decision on it.
 */
export function coerceSavedFeatures(raw: unknown): Feature[] {
  if (!Array.isArray(raw)) return [];
  const out: Feature[] = [];
  for (const r of raw.slice(0, 60)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const [f] = coerceFeatures([o]);
    if (!f || out.some((x) => x.title.toLowerCase() === f.title.toLowerCase())) continue;
    const id = typeof o.id === "string" && /^f\d{1,3}$/.test(o.id) && !out.some((x) => x.id === o.id) ? o.id : nextFeatureId(out);
    // `coerceFeatures` numbered the scenarios against its own id, which is not
    // the id this feature keeps. Renumber, or a saved project comes back with
    // scenario ids pointing at a different feature.
    const scenarios = coerceScenarios(o.scenarios, id);
    out.push({
      ...f,
      id,
      status: o.status === "accepted" || o.status === "denied" ? o.status : "proposed",
      source: o.source === "you" ? "you" : "agent",
      ...(o.edited === true ? { edited: true } : {}),
      ...(scenarios.length ? { scenarios } : { scenarios: undefined }),
    });
  }
  return out;
}

/** Keep the AI's understanding where it is sensible, the offline one where it isn't. */
export function coerceUnderstanding(raw: unknown, fallback: Understanding): Understanding {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const str = (k: string, max = 300) => (typeof o[k] === "string" && clean(o[k] as string) ? clean(o[k] as string).slice(0, max) : "");
  const type = Object.keys(APP_TYPE_LABEL).includes(String(o.appType)) ? (o.appType as AppType) : fallback.appType;
  const design = safeDesignSkill(o.designSkill, { skill: fallback.designSkill, why: fallback.designWhy }, o.designWhy);
  const judge = Array.isArray(o.judge) ? o.judge.filter((x): x is string => typeof x === "string" && x.trim().length > 8).map(clean).slice(0, 5) : [];
  return {
    name: str("name", 48) || fallback.name,
    oneLiner: str("oneLiner", 160) || fallback.oneLiner,
    appType: type,
    purpose: str("purpose") || fallback.purpose,
    audience: str("audience", 120) || fallback.audience,
    endGoal: str("endGoal") || fallback.endGoal,
    beyond: str("beyond") || fallback.beyond,
    model: str("model", 120) || fallback.model,
    designSkill: design.skill,
    designWhy: design.why,
    judge: judge.length >= 2 ? judge : fallback.judge,
  };
}

/** Keep AI questions only when they are well-formed; never more than six. */
export function coerceQuestions(raw: unknown, fallback: Question[]): Question[] {
  if (!Array.isArray(raw)) return fallback;
  const out: Question[] = [];
  for (const r of raw.slice(0, 6)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const label = typeof o.label === "string" ? clean(o.label).slice(0, 120) : "";
    if (!label) continue;
    const options = Array.isArray(o.options)
      ? o.options.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => clean(x).slice(0, 60)).slice(0, 6)
      : [];
    out.push({
      id: typeof o.id === "string" && /^[a-z][a-z0-9_-]{0,20}$/.test(o.id) ? o.id : `q${out.length + 1}`,
      label,
      hint: typeof o.hint === "string" ? clean(o.hint).slice(0, 160) : undefined,
      options,
      multi: o.multi === true,
      free: o.free === true || options.length === 0,
    });
  }
  // The end goal question is the one we never drop.
  if (out.length < 2) return fallback;
  if (!out.some((q) => q.id === "purpose")) out.unshift(fallback[0]);
  return out.slice(0, 6);
}

// ----- the feature list's rules -------------------------------------------------------------

/** f-number for a new feature, after the highest one in use. */
export function nextFeatureId(features: Feature[]): string {
  const n = features.reduce((m, f) => Math.max(m, Number(f.id.replace(/\D/g, "")) || 0), 0);
  return `f${n + 1}`;
}

/**
 * Add scenarios to a feature, keeping the owner's own.
 *
 * `source: "you"` means the owner typed or reworded that check, and a plan is
 * only as good as the owner trusting it survives the next regenerate — so
 * theirs stay, duplicates by WHEN are dropped, and the rest are renumbered.
 */
export function mergeScenarios(had: Scenario[] | undefined, next: Scenario[], featureId: string, max = 4): Scenario[] {
  const mine = (had ?? []).filter((s) => s.source === "you");
  const seen = new Set(mine.map((s) => s.when.toLowerCase()));
  const kept = [...mine];
  for (const s of [...next, ...(had ?? []).filter((s) => s.source !== "you")]) {
    if (kept.length >= max) break;
    const key = s.when.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(s);
  }
  return kept.map((s, i) => ({ ...s, id: `${featureId}.s${i + 1}` }));
}

/** Apply ops in order. Returns the new list and one plain line per change made. */
export function applyOps(features: Feature[], ops: FeatureOp[]): { features: Feature[]; changes: string[] } {
  let list = features.map((f) => ({ ...f }));
  const changes: string[] = [];
  const byId = (id: string) => list.find((f) => f.id === id);
  for (const op of ops) {
    if (op.op === "acceptAll") {
      const n = list.filter((f) => f.status === "proposed").length;
      list = list.map((f) => (f.status === "proposed" ? { ...f, status: "accepted" } : f));
      if (n) changes.push(`Accepted ${n} feature${n === 1 ? "" : "s"}`);
      continue;
    }
    if (op.op === "denyRest") {
      const n = list.filter((f) => f.status === "proposed").length;
      list = list.map((f) => (f.status === "proposed" ? { ...f, status: "denied" } : f));
      if (n) changes.push(`Denied ${n} remaining feature${n === 1 ? "" : "s"}`);
      continue;
    }
    if (op.op === "add") {
      const title = clean(op.feature.title).slice(0, 80);
      if (!title || list.some((f) => f.title.toLowerCase() === title.toLowerCase())) continue;
      const [made] = coerceFeatures([{ ...op.feature, title }]);
      const id = nextFeatureId(list);
      const f: Feature = {
        ...made,
        id,
        status: op.feature.status === "proposed" ? "proposed" : "accepted",
        source: op.feature.source === "agent" ? "agent" : "you",
        detail: made.detail || title,
        // `coerceFeatures` numbered against its own id, not the one it keeps.
        ...(made.scenarios?.length ? { scenarios: coerceScenarios(made.scenarios, id) } : {}),
      };
      list = [...list, f];
      changes.push(`Added “${f.title}”`);
      continue;
    }
    const f = byId(op.id);
    if (!f) continue;
    if (op.op === "accept" && f.status !== "accepted") {
      f.status = "accepted";
      changes.push(`Accepted “${f.title}”`);
    } else if (op.op === "deny" && f.status !== "denied") {
      f.status = "denied";
      changes.push(`Denied “${f.title}”`);
    } else if (op.op === "reset" && f.status !== "proposed") {
      f.status = "proposed";
      changes.push(`Put “${f.title}” back up for a decision`);
    } else if (op.op === "edit") {
      const title = op.title ? clean(op.title).slice(0, 80) : "";
      const detail = op.detail ? clean(op.detail).slice(0, 400) : "";
      const why = op.why ? clean(op.why).slice(0, 240) : "";
      const scenarios = op.scenarios?.length ? coerceScenarios(op.scenarios, f.id) : [];
      if (!title && !detail && !why && !scenarios.length) continue;
      if (title) f.title = title;
      if (detail) f.detail = detail;
      if (why) f.why = why;
      // The owner's own scenarios are kept: they wrote the check, so the agent
      // may add to it but never quietly replace it.
      if (scenarios.length) f.scenarios = mergeScenarios(f.scenarios, scenarios, f.id);
      f.edited = true;
      // Editing a feature is saying yes to it, the way you described it.
      if (f.status === "proposed") f.status = "accepted";
      changes.push(`Edited “${f.title}”`);
    } else if (op.op === "scenario") {
      const [s] = coerceScenarios([op.scenario], f.id);
      if (!s) continue;
      f.scenarios = mergeScenarios(f.scenarios, [s], f.id);
      if (f.status === "proposed") f.status = "accepted";
      changes.push(`Added a check to “${f.title}”: ${scenarioLine(s)}`);
    }
  }
  return { features: list, changes };
}

/** Coerce the model's ops; anything referring to an unknown feature is dropped. */
export function coerceOps(raw: unknown, features: Feature[]): FeatureOp[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set(features.map((f) => f.id));
  const out: FeatureOp[] = [];
  for (const r of raw.slice(0, 30)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    switch (o.op) {
      case "accept":
      case "deny":
      case "reset":
        if (ids.has(id)) out.push({ op: o.op, id });
        break;
      case "edit":
        if (ids.has(id)) {
          const scenarios = coerceScenarios(o.scenarios, id);
          out.push({
            op: "edit",
            id,
            title: typeof o.title === "string" ? o.title : undefined,
            detail: typeof o.detail === "string" ? o.detail : undefined,
            why: typeof o.why === "string" ? o.why : undefined,
            ...(scenarios.length ? { scenarios } : {}),
          });
        }
        break;
      case "scenario": {
        const s = (o.scenario && typeof o.scenario === "object" ? o.scenario : o) as Record<string, unknown>;
        const [made] = ids.has(id) ? coerceScenarios([s], id) : [];
        if (made) out.push({ op: "scenario", id, scenario: made });
        break;
      }
      case "add": {
        const f = (o.feature && typeof o.feature === "object" ? o.feature : o) as Record<string, unknown>;
        if (typeof f.title === "string" && f.title.trim()) {
          out.push({
            op: "add",
            feature: {
              title: f.title,
              detail: typeof f.detail === "string" ? f.detail : "",
              why: typeof f.why === "string" ? f.why : "",
              kind: KIND_SET.has(f.kind as FeatureKind) ? (f.kind as FeatureKind) : "core",
              impact: [1, 2, 3].includes(Number(f.impact)) ? (Number(f.impact) as 1 | 2 | 3) : 2,
              effort: ["S", "M", "L"].includes(String(f.effort)) ? (String(f.effort) as Effort) : "M",
              status: f.status === "proposed" ? "proposed" : "accepted",
              source: f.source === "agent" ? "agent" : "you",
              ...(Array.isArray(f.scenarios) ? { scenarios: coerceScenarios(f.scenarios, "f0") } : {}),
            },
          });
        }
        break;
      }
      case "acceptAll":
      case "denyRest":
        out.push({ op: o.op });
        break;
    }
  }
  return out;
}

// ----- typed commands (the chat with no AI) ---------------------------------------------------

/** Which features a phrase points at: "1, 3", "f4", "#2 and 5", or a title. */
export function refsIn(text: string, features: Feature[]): string[] {
  const out = new Set<string>();
  const t = text.toLowerCase();
  for (const m of t.matchAll(/\b(?:f|#)?(\d{1,2})\b/g)) {
    const n = Number(m[1]);
    const byLabel = features.find((f) => f.id === `f${n}`);
    if (byLabel) out.add(byLabel.id);
  }
  if (out.size === 0) {
    const words = t.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3);
    for (const f of features) {
      const title = f.title.toLowerCase();
      if (title.length > 3 && t.includes(title)) out.add(f.id);
      else if (words.length && words.filter((w) => title.includes(w)).length >= Math.min(2, words.length)) out.add(f.id);
    }
  }
  return [...out];
}

const HELP =
  "I can accept, deny, edit or add features. Try “accept 1, 3”, “deny f2”, “edit f4: make it voice-first”, “add a waitlist page”, or “accept all”.";

/**
 * Typed commands, for when no AI is connected — and the fast path even when it
 * is, because "accept 3" shouldn't wait on a model.
 * Returns null when the message isn't a command (the AI should answer it).
 */
export function parseCommand(text: string, features: Feature[]): { ops: FeatureOp[]; reply: string } | null {
  const t = clean(text);
  const low = t.toLowerCase();
  if (/^(help|\?|what can you do)/.test(low)) return { ops: [], reply: HELP };
  if (/^(accept|approve|keep|yes to) (them )?all\b|^(all of them|accept everything)\b/.test(low)) {
    return { ops: [{ op: "acceptAll" }], reply: "Done — everything still open is accepted." };
  }
  if (/^(deny|reject|drop|skip) (the )?(rest|others|remaining)\b/.test(low)) {
    return { ops: [{ op: "denyRest" }], reply: "Done — the rest are denied." };
  }
  const edit = t.match(/^(edit|change|update|rename)\s+(?:#|f)?(\d{1,2})\s*(?::|to|-|—)?\s*(.+)$/i);
  if (edit) {
    const id = `f${edit[2]}`;
    if (!features.some((f) => f.id === id)) return { ops: [], reply: `There's no feature ${id} on the list.` };
    const rename = edit[1].toLowerCase() === "rename";
    return {
      ops: [{ op: "edit", id, ...(rename ? { title: edit[3] } : { detail: edit[3] }) }],
      reply: rename ? `Renamed ${id}.` : `Updated ${id} the way you described it — and accepted it.`,
    };
  }
  const verb = low.match(/^(accept|approve|keep|yes|deny|reject|remove|drop|skip|no|undo|reset)\b\s*(.*)$/);
  if (verb) {
    const refs = refsIn(verb[2], features);
    if (refs.length) {
      const kind = /^(accept|approve|keep|yes)$/.test(verb[1]) ? "accept" : /^(undo|reset)$/.test(verb[1]) ? "reset" : "deny";
      return {
        ops: refs.map((id) => ({ op: kind, id }) as FeatureOp),
        reply: `${kind === "accept" ? "Accepted" : kind === "deny" ? "Denied" : "Reset"} ${refs.join(", ")}.`,
      };
    }
  }
  const add = t.match(/^(?:add|also add|new feature|include)\s*:?\s+(.+)$/i);
  if (add) {
    const refs = /^(?:#|f)?\d{1,2}(\s*(,|and)\s*(?:#|f)?\d{1,2})*$/i.test(add[1].trim()) ? refsIn(add[1], features) : [];
    if (refs.length) return { ops: refs.map((id) => ({ op: "accept", id }) as FeatureOp), reply: `Accepted ${refs.join(", ")}.` };
    const title = cap(add[1].replace(/^(a|an|the)\s+/i, "")).slice(0, 80);
    return { ops: [{ op: "add", feature: { title, detail: add[1], source: "you", status: "accepted" } }], reply: `Added “${title}” and accepted it.` };
  }
  return null;
}

export const OFFLINE_HELP = HELP;

// ----- the hand-off -------------------------------------------------------------------------

/** The always-on skill pipeline, in the order the build runs it. */
export function pipeline(
  u: Understanding,
  t?: Teardown | null,
  recorded = false,
  isEdit = false,
  depth: Depth = "commercial",
  redesign?: RedesignSource,
): { skill: string; role: string }[] {
  if (isEdit) return editPipeline();
  const mode = t?.mode ?? "recreate";
  const re = redesign
    ? [
        {
          skill: "website-redesigner",
          role: `Open ${redesign.url} and list every page, form, link, flow and piece of content it has — that list is what the redesign must keep, and the acceptance test.`,
        },
        {
          skill: "redesign-skill",
          role: "Audit the current design first (what reads as generic, what the brand truly owns), then give it a completely new premium look without breaking any function.",
        },
      ]
    : t || recorded
    ? [
        { skill: "video-analyzer", role: "Watch the attached recording properly — every frame and the narration — and list each screen, step and state change." },
        {
          skill: "reverse-engineer-anything",
          role: `Use REA (rea) to take apart how what the recording shows works — the flow, the states, the data behind it — then ${mode === "recreate" ? "recreate it" : "rebuild it with the owner's changes"} in original code and design (no copied branding or proprietary assets).`,
        },
      ]
    : [];
  return [
    ...re,
    { skill: "felix", role: "Confirm the end goal and the goal beyond it, set the Altitude ladder, Depth target and Range crew before any code." },
    { skill: "prompt-enhancer", role: "Sharpen this brief (Felix pass + Anthropic best practices) and resolve any gaps from the repo first." },
    ...(depth === "plain"
      ? []
      : [
          {
            skill: depth === "commercial-2x" ? "commercial 2x" : "commercial",
            role: `Run Steps ${depthSteps(depth, u.appType).join(", ")} — ${
              depth === "commercial-2x"
                ? "the full foundation plus the money switched on (pricing, paywalls, upgrade moments), a competitor teardown and a critic panel to 9/10 on every axis"
                : depthSteps(depth, u.appType).includes(3)
                  ? "Apple-standard look, the full foundation (logins, profiles, roles, owner admin, billing wired but SWITCHED OFF, emails, legal pages), onboarding to the aha moment, growth and retention. The app stays completely free"
                  : "Apple-standard look, the growth layer and the honest-product pass. No foundation to build on a site people only visit"
            }. Score ${depthAxes(depth, u.appType).join(" · ")}.`,
          },
        ]),
    {
      skill: "design-intelligence",
      role: `${redesign ? "Audit the current site with the design check, then u" : "U"}nderstand, research real references, commit to one distinctive direction, find real components (shadcn + @magicui/@aceternity/21st.dev), give each important page one standout, and prove it with the design check — the shared process every Jarvis website build runs.`,
    },
    { skill: u.designSkill, role: `Invoke before writing any UI — ${u.designWhy}.` },
    { skill: "impeccable", role: "The closing craft pass on every screen: spacing, hierarchy, type, contrast, and every state (hover, disabled, loading, error, empty)." },
    { skill: "software-factory", role: "Split the accepted features into Backlog cards (one PR under ~400 lines each), run super-board; a human approves every merge." },
    { skill: "claude-security", role: "Deep scan before launch or handoff; fix every high/critical finding in its own PR." },
    { skill: "website-build-checklist", role: "Hold every screen to the owner's one build checklist; cite the codes in each card." },
  ];
}

/** The checklist lines this build is held to. */
export function checklistLines(p: Pick<BuilderProject, "answers" | "features" | "understanding" | "edit">) {
  if (p.edit) return CHECKLIST.filter((c) => EDIT_CHECKLIST.includes(c.id));
  const ids = new Set(["R1", "R2", "R3", "R4", "R6", "D5", "U1", "U9", "U2", "S1", "S4", "O1", "O6", "O7", "U4", "U6", "A1", "R5"]);
  const touches = asText(p.answers.touches).toLowerCase();
  const audience = p.understanding?.audience ?? asText(p.answers.audience);
  if (touches.includes("account") || audience !== "Just me / my team") ["L1", "S2", "S3", "D4"].forEach((c) => ids.add(c));
  if (touches.includes("payment") || /subscription|upgrade|purchase|fee/i.test(p.understanding?.model ?? "")) ["S5", "S7"].forEach((c) => ids.add(c));
  if (touches.includes("ai")) ids.add("S5");
  if (touches.includes("offline")) ids.add("D3");
  if (p.understanding?.appType === "website") ["P1", "P2", "P3", "U3", "S6"].forEach((c) => ids.add(c));
  for (const f of p.features) if (f.status === "accepted") (f.checklist ?? []).forEach((c) => ids.add(c));
  return CHECKLIST.filter((c) => ids.has(c.id));
}

const byImpact = (a: Feature, b: Feature) => b.impact - a.impact || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);

/**
 * The last thing the build does: post the deployed app to its Client Review
 * link, so it lands somewhere the owner (or whoever they send the link to) can
 * tap the page and ask for changes — and those changes come back to App Builder
 * as an edit. Nobody pastes a URL by hand (R6, C6).
 */
export function reviewBrief(p: BuilderProject): string {
  const r = p.handoff?.review;
  if (!r) return "";
  const who = r.clientName ? ` (${r.clientName})` : "";
  return [
    "<client_review>",
    `This app has a Client Review link waiting for it${who}: review_id=${r.id}, version_id=${r.versionId}, ${r.number}.`,
    "The LAST step of the build, after it is deployed and you have tested it live: call the jarvis-memory connector's `client_review_preview` with that review_id and version_id, the deployed URL as preview_url, the pull request as pr_url and the branch, and a summary of one plain-English line per feature built.",
    "That puts the app on the review link, tells whoever is reviewing it, and means their edit requests come straight back to App Builder. Do not paste the URL anywhere by hand.",
    "If it answers that the version is not being built any more, say so in the queue note and stop — a newer version replaced it.",
    "</client_review>",
  ].join("\n");
}

/**
 * The master build prompt: Felix + prompt-enhancer shape (goal and why first,
 * context, the owner's features their way, the bar, the pipeline, the judge).
 */
/** The main surface, said in words a build brief can act on. */
const SHAPE_WORD: Record<Shape, string> = {
  board: "a board with columns the things move between",
  grid: "a grid of cards",
  list: "a list of rows",
  feed: "a feed, newest first",
  table: "a dense table with a row per record",
  canvas: "one stage with a single primary action on it",
};

/** How the approved mockup's main surface is described to the build. */
function shapeWord(p: BuilderProject, u: Understanding): string {
  const accepted = p.features.filter((f) => f.status === "accepted");
  return SHAPE_WORD[shapeOf(u.appType, accepted.length ? accepted : p.features)];
}

/**
 * The look the build is held to.
 *
 * `understanding.designSkill` is the agent's guess from the idea. `p.look` is
 * the owner having looked at three drawn mockups and chosen. The second beats
 * the first, so everything downstream — the pipeline, the brief, the queue
 * line — reads this rather than the understanding directly.
 */
export function lookOf(p: BuilderProject, u: Understanding): Understanding {
  const picked = p.look?.skill?.trim();
  if (!picked || picked === u.designSkill) return u;
  return {
    ...u,
    designSkill: picked,
    designWhy: `the ${p.look?.by === "client" ? "client" : "owner"} picked this direction from the mockups, over ${u.designSkill}`,
  };
}

export function masterPrompt(p: BuilderProject): string {
  if (p.edit) return editMasterPrompt(p);
  const base = p.understanding ?? understand(p.idea, p.answers);
  const u = lookOf(p, base);
  const { depth, why: depthWhy } = depthOf(p);
  const accepted = p.features.filter((f) => f.status === "accepted").sort(byImpact);
  const denied = p.features.filter((f) => f.status === "denied");
  const lines = checklistLines(p);
  const answers = Object.entries(p.answers)
    .map(([k, v]) => [k, asText(v)] as const)
    .filter(([, v]) => v);
  const parts = [
    `<role>\nA senior product team in one: product lead, ${APP_TYPE_LABEL[u.appType].toLowerCase()} engineer, interaction designer, growth lead and security reviewer, building ${u.name} to the standard of the best commercial products in its category.\n</role>`,
    `<goal>\n${u.endGoal || u.purpose}\nFor: ${u.audience}.\nThe goal beyond the goal: ${u.beyond}.\n</goal>`,
    `<context>\n- App: ${u.name} — ${u.oneLiner}\n- Kind: ${APP_TYPE_LABEL[u.appType]}\n- Purpose: ${u.purpose}\n- How it makes money: ${u.model}\n${answers.map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n</context>`,
    `<request>\n${clean(p.idea)}\n</request>`,
    p.redesign
      ? redesignBrief(p.redesign)
      : p.teardown
      ? `<reverse_engineered>\nThe owner attached ${p.sources?.length ?? 1} recording${(p.sources?.length ?? 1) === 1 ? "" : "s"}/picture${(p.sources?.length ?? 1) === 1 ? "" : "s"} of an app or workflow (frames are attached to the In Queue request). This is what was taken apart from it:\n${teardownText(p.teardown)}\n${p.teardown.mode === "recreate" ? "Recreate the workflow and behaviour it shows" : "Rebuild it with the owner's changes"}, in original code and original design — never copy another product's name, logo, branding or proprietary assets.\n</reverse_engineered>`
      : p.sources?.length
        ? `<reverse_engineered>\nThe owner attached ${p.sources.length} recording${p.sources.length === 1 ? "" : "s"}/picture${p.sources.length === 1 ? "" : "s"} of an app or workflow that hasn't been watched yet (frames are attached to the In Queue request; ask the owner for the full file if they aren't enough). Watch it with video-analyzer, take it apart with rea — every screen, step, state and the data behind it — then ${modeOf(p.idea, asText(p.answers.mode)) === "recreate" ? "recreate the workflow and behaviour it shows" : "rebuild it with the owner's changes"}, in original code and original design — never copy another product's name, logo, branding or proprietary assets.\n</reverse_engineered>`
        : "",
    `<features>\nBuild these, the way they are described — they were reviewed and accepted (or written) by the owner:\n${accepted
      .map(
        (f, i) =>
          `${i + 1}. ${f.title} [${KIND_LABEL[f.kind]}, impact ${f.impact}/3, effort ${f.effort}]${f.source === "you" || f.edited ? " (owner's own words)" : ""}\n   ${f.detail}${f.why ? `\n   Why: ${f.why}` : ""}${(f.scenarios ?? [])
            .map((s) => `\n   ${s.id} [${s.proof}${s.source === "you" ? ", owner's own" : ""}] ${scenarioLine(s)}`)
            .join("")}`,
      )
      .join("\n")}\n</features>`,
    denied.length ? `<declined>\nThe owner declined these; leave them out:\n${denied.map((f) => `- ${f.title}`).join("\n")}\n</declined>` : "",
    `<depth>\n${depthBrief(depth, u.appType)}\nWhy this depth: ${depthWhy}.\n</depth>`,
    `<skills_pipeline>\nRun these skills, in this order, for this build — every time:\n${pipeline(u, p.teardown, Boolean(p.sources?.length), false, depth, p.redesign)
      .map((s, i) => `${i + 1}. ${s.skill} — ${s.role}`)
      .join("\n")}\n</skills_pipeline>`,
    p.look
      ? `<look>\nThe owner was shown three directions drawn as working mockups and ${
          p.look.by === "client" ? "the client approved" : "chose"
        } this one: ${p.look.skill}.\nThis is a DECISION, not a suggestion — build the app in that direction. Run ${p.look.skill} before any UI code and let it own the surface, the type voices, the corner radius and the density. Do not substitute another design skill because it would suit the content better; if you believe it is wrong, say so in your report and build it as chosen anyway.\nThe mockup they approved was drawn from the accepted features, with ${u.name}'s own nav and rows. Treat it as the structural brief: the main surface is ${shapeWord(p, u)}, and the sections are ${(p.teardown?.screens ?? []).length ? (p.teardown?.screens ?? []).map((s) => s.name).join(", ") : "the accepted features above"}.\n</look>`
      : "",
    designIntelligenceBlock({
      mode: p.redesign ? "redesign" : "build",
      skill: p.look?.skill ?? u.designSkill,
      surface: u.appType === "website" ? "website" : "app",
      beforeUrl: p.redesign?.url,
    }),
    reviewBrief(p),
    `<standard>\nGo beyond the basics: a fully featured, production-quality, commercial-grade product with a distinctive design, purposeful motion and interactivity — the standard a top product team would ship. Better, not bigger: raise the quality around the accepted features rather than adding unrequested ones.\nHold it to these checklist lines:\n${lines.map((c) => `- ${c.id} (${c.level}): ${c.text}`).join("\n")}\n</standard>`,
    `<success_criteria>\n${u.judge.map((j) => `- ${j}`).join("\n")}\n${scenarioCriteria(p)}\nReport honestly against these with real numbers, including anything that missed.\n</success_criteria>`,
    planNotesBlock(p),
    `<constraints>\nAct freely on local, reversible steps. Ask before anything that spends money, deletes data or can't be undone. If something needed is missing (a key, access, data), say exactly what and what it would unlock — never fake it. Commit and push finished work.\n</constraints>`,
  ].filter(Boolean);
  return parts.join("\n\n");
}

/** In Queue holds at most this many characters per request. */
export const QUEUE_LIMIT = 4000;

/** The short brief the PC/VPS Claude Code picks up from In Queue. Always under QUEUE_LIMIT. */
export function queueText(p: BuilderProject): string {
  if (p.edit) return editQueueText(p);
  const u = lookOf(p, p.understanding ?? understand(p.idea, p.answers));
  const { depth } = depthOf(p);
  const accepted = p.features.filter((f) => f.status === "accepted").sort(byImpact);
  const denied = p.features.filter((f) => f.status === "denied");
  const r = p.handoff?.review;
  const head = [
    `App Builder: build ${u.name} (${APP_TYPE_LABEL[u.appType]}).`,
    `Run skills in order: ${p.redesign ? "website-redesigner → redesign-skill → " : p.teardown || p.sources?.length ? "video-analyzer → reverse-engineer-anything (rea) → " : ""}felix → prompt-enhancer${
      depth === "plain" ? "" : ` → ${depth === "commercial-2x" ? "commercial 2x" : "commercial"} (Steps ${depthSteps(depth, u.appType).join(", ")})`
    } → design-intelligence → ${u.designSkill} → impeccable → software-factory → claude-security, held to website-build-checklist.`,
    designIntelligenceLine(p.redesign ? "redesign" : "build"),
    p.look
      ? `Look: ${p.look.skill} — ${p.look.by === "client" ? "approved by the client" : "picked by the owner"} from three drawn mockups. A decision, not a suggestion: build it in that direction, main surface ${shapeWord(p, u)}.`
      : "",
    depthBrief(depth, u.appType),
    `End goal: ${u.endGoal || u.purpose}. For: ${u.audience}. Money: ${u.model}.`,
    `Beyond: ${u.beyond}.`,
    `Idea as typed: ${clean(p.idea)}`,
    r
      ? `Client Review: when it is deployed and tested live, call the connector's client_review_preview with review_id=${r.id} version_id=${r.versionId} preview_url=<the deployed URL> pr_url=<the PR> branch=<the branch> and one plain line per feature as the summary. That posts ${r.number} to the review link${
          r.clientName ? ` for ${r.clientName}` : ""
        } so edit requests come back to App Builder. Never paste the URL by hand.`
      : "",
  ].filter(Boolean);
  const re = p.redesign
    ? [redesignBrief(p.redesign).replace(/<\/?redesign>\n?/g, "").slice(0, 1_300)]
    : p.teardown
    ? [`Recording (${p.teardown.mode === "recreate" ? "recreate it" : "change it"}; frames attached — ask the owner for the full video if needed; original code and design, no copied branding):`, teardownText(p.teardown, 1_100)]
    : p.sources?.length
      ? [`Recording attached but not watched yet (frames attached): watch it with video-analyzer, take it apart with rea, then ${modeOf(p.idea, asText(p.answers.mode)) === "recreate" ? "recreate it" : "change it as asked"} — original code and design, no copied branding.`]
      : [];
  const tail = [
    denied.length ? `Declined (leave out): ${denied.map((f) => f.title).join("; ")}.` : "",
    `Judge: ${u.judge.join("; ")}.`,
    `Checklist: ${checklistLines(p).map((c) => c.id).join(" ")}.`,
    scenariosOf(p.features).length
      ? `Every check above needs a test whose NAME starts with its id (unit → Vitest, browser → Playwright, manual → before/after screenshots). End with a table: scenario id → test → pass/fail. A check with no test is a miss — say so, never widen another test to cover it.`
      : "",
    `New project unless it clearly belongs in the hub. Commit + push; report against the judge with real numbers.`,
  ].filter(Boolean);
  // Scenarios shrink LAST, after feature detail: the names and the checks are
  // the skeleton of the plan, and the detail is the flesh. A brief that keeps
  // every "f3.s1 valid enquiry" and loses a sentence of prose is still
  // buildable; the other way round is not.
  for (const detail of [220, 180, 140, 100, 60, 0]) {
    const feats = accepted.map((f, i) => {
      const said = detail === 0 ? "" : `: ${f.detail.length > detail ? `${f.detail.slice(0, detail - 1)}…` : f.detail}`;
      const sc = (f.scenarios ?? []).length
        ? `\n   checks: ${(f.scenarios ?? []).map((s) => `${s.id} ${s.name.toLowerCase()}`).join(" · ")}`
        : "";
      return `${i + 1}. ${f.title}${said}${sc}`;
    });
    const text = [...head, ...re, "Features (accepted, owner's words kept):", ...feats, ...tail].join("\n");
    if (text.length <= QUEUE_LIMIT) return text;
  }
  // Even with no prose it is too long: keep the head and as many features as
  // fit rather than cutting mid-word in the middle of a check.
  const bare = accepted.map((f, i) => `${i + 1}. ${f.title}${(f.scenarios ?? []).length ? ` (${(f.scenarios ?? []).map((s) => s.id).join(" ")})` : ""}`);
  const text = [...head, ...re, "Features (accepted, owner's words kept):", ...bare, ...tail].join("\n");
  return text.length <= QUEUE_LIMIT ? text : `${text.slice(0, QUEUE_LIMIT - 1)}…`;
}

/** One super-board card per accepted feature, Felix format, so the factory can build them. */
export function featureTickets(p: BuilderProject): BoardTicket[] {
  const u = lookOf(p, p.understanding ?? understand(p.idea, p.answers));
  return p.features
    .filter((f) => f.status === "accepted")
    .sort(byImpact)
    .map((f) => {
      const emoji = { core: "✨", experience: "🎛️", growth: "📈", money: "💳", automation: "🤖", trust: "🛡️" }[f.kind];
      const labels = ["feature", "felix", "app-builder"];
      if (f.kind === "money") labels.push("money");
      if ((f.checklist ?? []).some((c) => c === "L1" || c === "S3")) labels.push("auth");
      const codes = f.checklist?.length ? f.checklist : ["R1", "R2", "U1"];
      const checks = codes
        .map((code) => CHECKLIST.find((c) => c.id === code))
        .filter(Boolean)
        .slice(0, 2)
        .map((c) => `${c!.id}: ${c!.text}`);
      const head = `${emoji} [feature] ${u.name.toLowerCase()}: `;
      const room = 70 - head.length;
      const body = [
        `## Problem\n${f.why || u.purpose}\n\nGoal beyond the goal: ${u.beyond}.`,
        `## Context\n- **App:** ${u.name} — ${u.oneLiner}\n- **Who:** ${u.audience}\n- **Checklist:** ${codes.join(", ")}\n- **Skills:** felix → prompt-enhancer → ${u.designSkill} → claude-security before launch`,
        `## Fix\n${f.detail}${f.source === "you" || f.edited ? "\n\n_The owner's own words — keep it the way it's described._" : ""}`,
        // The feature's OWN scenarios are the criteria. Every card used to
        // carry the same generic line, so a login form and a pricing table
        // were "done" by the same standard — the fastest way to get a build
        // that passes its ticket and still isn't what was asked for.
        `## Acceptance Criteria\n${(f.scenarios ?? [])
          .map((s) => `- [ ] ${s.id} ${scenarioLine(s)} — proven by ${s.proof === "unit" ? "a Vitest test" : s.proof === "browser" ? "a Playwright test" : "before/after screenshots"}, named with its id`)
          .join("\n")}${f.scenarios?.length ? "\n" : ""}${checks.map((c) => `- [ ] ${c}`).join("\n")}\n- [ ] Typecheck and tests pass, with a test covering the new behaviour\n- [ ] Works on a 390 px phone and on desktop, shown with screenshots`,
        `## Risk\n${labels.includes("money") || labels.includes("auth") ? "🟡 **Medium** · touches payments or sign-in — the merge goes to the owner" : "🟢 **Low** · contained feature"}`,
        `## Blocked by\n- None.`,
      ].join("\n\n");
      return { title: head + (f.title.length > room ? `${f.title.slice(0, room - 1)}…` : f.title), body, labels };
    });
}

// ----- the project ------------------------------------------------------------------------

export function newProject(idea: string, now = new Date(), id = newId("ab_")): BuilderProject {
  const at = now.toISOString();
  return {
    id,
    createdAt: at,
    updatedAt: at,
    idea: clean(idea),
    stage: "idea",
    questions: [],
    answers: {},
    understanding: firstRead(idea),
    features: [],
    chat: [],
  };
}

export function chatMsg(role: ChatMsg["role"], text: string, changes?: string[], now = new Date()): ChatMsg {
  return { id: newId("m_"), role, text, at: now.toISOString(), ...(changes?.length ? { changes } : {}) };
}

/** Counts for the header and the pipeline. */
export function tally(features: Feature[]) {
  return {
    proposed: features.filter((f) => f.status === "proposed").length,
    accepted: features.filter((f) => f.status === "accepted").length,
    denied: features.filter((f) => f.status === "denied").length,
  };
}

/** Projects newest first, no duplicates by id (the newer copy wins). */
export function mergeProjects(list: BuilderProject[]): BuilderProject[] {
  const map = new Map<string, BuilderProject>();
  for (const p of list) {
    const had = map.get(p.id);
    if (!had || had.updatedAt < p.updatedAt) map.set(p.id, p);
  }
  return [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
