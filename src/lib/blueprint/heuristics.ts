// ---------------------------------------------------------------------------
// Blueprint — offline heuristic engine.
//
// Runs entirely on the server (or client) with no external calls. Produces a
// usable first draft for each stage when no AI Gateway key is configured, so
// the app is fully functional offline. The AI path (see /api/blueprint) is
// preferred when a key exists and falls back to these.
// ---------------------------------------------------------------------------

import { routeSkills } from "./skill-router";
import {
  type Brief,
  type Clarify2Result,
  type ClarifyingQuestion,
  type Overview,
  type OverviewFeature,
} from "./types";

// ----- Stage: clarify ------------------------------------------------------

const CLARIFY_BANK: Record<Brief["kind"], ClarifyingQuestion[]> = {
  website: [
    { id: "aud", question: "Who is this for, and what's the one action you want them to take?", hint: "The single most important outcome." },
    { id: "sections", question: "What are the 3–5 must-have sections or pages?" },
    { id: "vibe", question: "What visual vibe fits — minimal, bold, playful, editorial, luxury?" },
    { id: "brand", question: "Any brand colours, fonts, or reference sites to match?" },
    { id: "dynamic", question: "Do you need dynamic pieces — forms, auth, CMS, payments, a blog?" },
  ],
  webapp: [
    { id: "job", question: "Who are the users and what's the core job they'll do in the app?" },
    { id: "actions", question: "What are the 3 most important actions a user must be able to do?" },
    { id: "data", question: "What data does the app create, store or manage?" },
    { id: "auth", question: "Does it need accounts / login and saved data across sessions?" },
    { id: "integrations", question: "Any external services or APIs it must connect to?" },
  ],
  workflow: [
    { id: "trigger", question: "What kicks the workflow off, and what's the end result?", hint: "Trigger → outcome." },
    { id: "steps", question: "What are the steps, in order?" },
    { id: "tools", question: "What tools or services must it connect to?" },
    { id: "runtime", question: "Where does it run — on a schedule, on demand, or on an event?" },
    { id: "failure", question: "What should happen when a step fails?" },
  ],
};

export function heuristicClarify(brief: Brief): ClarifyingQuestion[] {
  const bank = CLARIFY_BANK[brief.kind] ?? CLARIFY_BANK.website;
  // Drop the audience question if they've already told us who it's for.
  const filtered = brief.audience.trim()
    ? bank.filter((q) => q.id !== "aud" && q.id !== "job")
    : bank;
  return filtered.slice(0, 3);
}

// ----- Stage: clarify (round 2 — adaptive follow-ups + the bar) -------------

const CLARIFY2_BANK: Record<Brief["kind"], ClarifyingQuestion[]> = {
  website: [
    { id: "wow", question: "What's the one moment a visitor should screenshot or remember?", hint: "The signature interaction or hero." },
    { id: "diff", question: "What should this do better than every similar site out there?" },
    { id: "constraints", question: "Any hard constraints — brand, tech, timeline, or must-use tools?" },
  ],
  webapp: [
    { id: "wow", question: "What's the single moment that should make a user go 'oh, nice'?" },
    { id: "diff", question: "Where do existing tools frustrate these users in a way yours won't?" },
    { id: "constraints", question: "Any hard constraints — integrations, data model, tech, or timeline?" },
  ],
  workflow: [
    { id: "volume", question: "How often does this run, and at what volume?" },
    { id: "edge", question: "What's the trickiest edge case or failure it must handle gracefully?" },
    { id: "constraints", question: "Any fixed tools, credentials, or systems it must use?" },
  ],
};

/** Suggest a Named + Fetchable + Comparable quality bar from the idea's vibe. */
export function suggestQualityBar(brief: Brief): string {
  const t = `${brief.idea} ${brief.answers.map((a) => a.answer).join(" ")}`.toLowerCase();
  if (/portfolio|personal site|designer|creative/.test(t)) return "bruno-simon.com";
  if (/shop|store|ecommerce|e-commerce|checkout|product page/.test(t)) return "stripe.com";
  if (/agency|studio|brand|marketing/.test(t)) return "igloo.inc";
  if (/docs|documentation|developer|api|saas|dashboard|tool/.test(t)) return "linear.app";
  if (brief.kind === "workflow") return "raycast.com";
  return "linear.app";
}

export function heuristicClarify2(brief: Brief): Clarify2Result {
  const bank = CLARIFY2_BANK[brief.kind] ?? CLARIFY2_BANK.website;
  return { questions: bank.slice(0, 3), quality_bar: suggestQualityBar(brief) };
}

// ----- Stage: synthesize ---------------------------------------------------

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "should", "be", "is", "are", "to", "of",
  "on", "in", "for", "with", "that", "this", "it", "as", "at", "by", "we", "i",
  "they", "them", "their", "our", "can", "could", "also", "want", "need", "like",
  "make", "add", "build", "create", "app", "website", "site", "using", "use",
]);

const CORE_RE = /\b(core|main|primary|must|key|central|engine|system|dashboard|editor|feed|search|map|chat|upload|generate|track|manage|calculate|book|checkout|payment|auth|login|account|profile)\b/i;
const SUPPORT_RE = /\b(dark mode|theme|animation|polish|nice|later|optional|export|share|settings|onboarding|tooltip|notification|analytics|filter|sort|responsive|accessib|seo)\b/i;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|[\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4);
}

function titleize(clause: string): string {
  const words = clause
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()));
  const keep = words.slice(0, 5);
  if (!keep.length) return clause.slice(0, 42);
  const t = keep.map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
  return t.length > 60 ? t.slice(0, 57) + "…" : t;
}

function dedupe(items: OverviewFeature[]): OverviewFeature[] {
  const seen = new Set<string>();
  const out: OverviewFeature[] = [];
  for (const it of items) {
    const key = it.title.toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

const STACK_BY_KIND: Record<Brief["kind"], string[]> = {
  website: ["Next.js (App Router) + React + TypeScript", "Tailwind CSS for styling", "Deployed on Vercel"],
  webapp: ["Next.js (App Router) + React + TypeScript", "Tailwind CSS", "A database for persistence (e.g. Postgres via the Vercel Marketplace)"],
  workflow: ["Node.js + TypeScript", "Runs on Vercel (Functions / Cron)", "Typed config and structured logging"],
};

export function heuristicSynthesize(brief: Brief): Overview {
  const answerText = brief.answers.map((a) => a.answer).filter(Boolean).join(". ");
  const corpus = `${brief.idea}. ${answerText}`.trim();
  const clauses = sentences(corpus);

  const core: OverviewFeature[] = [];
  const support: OverviewFeature[] = [];

  for (const c of clauses) {
    const feature: OverviewFeature = { title: titleize(c), description: c };
    if (SUPPORT_RE.test(c)) support.push(feature);
    else if (CORE_RE.test(c)) core.push(feature);
    else core.push(feature); // default meaningful clauses to core; the user re-sorts
  }

  // Guarantee at least one core feature so the canvas is never empty.
  if (core.length === 0 && clauses.length) {
    core.push({ title: titleize(clauses[0]), description: clauses[0] });
  }

  const core_features = dedupe(core).slice(0, 8);
  const supporting_features = dedupe(support).slice(0, 10);

  const firstSentence = sentences(brief.idea)[0] ?? brief.idea.trim();
  const one_liner =
    (firstSentence || "A new project").slice(0, 120) +
    (firstSentence.length > 120 ? "…" : "");

  const audienceClause = brief.audience.trim()
    ? ` It is aimed at ${brief.audience.trim()}.`
    : "";
  const purpose =
    (brief.idea.trim() || "A project to be defined.").slice(0, 500) + audienceClause;

  const open_questions = brief.answers
    .filter((a) => !a.answer.trim())
    .map((a) => a.question);

  return {
    one_liner,
    purpose,
    design_direction: deriveDirection(corpus, brief),
    quality_bar: brief.quality_bar?.trim() || suggestQualityBar(brief),
    recommended_skills: routeSkills(corpus, brief.kind),
    core_features,
    supporting_features,
    stack: STACK_BY_KIND[brief.kind] ?? STACK_BY_KIND.website,
    open_questions,
  };
}

/** A one-line design direction inferred from the idea's vibe words. */
function deriveDirection(corpus: string, brief: Brief): string {
  const t = corpus.toLowerCase();
  const vibes: string[] = [];
  for (const [re, word] of [
    [/minimal|clean|simple/, "minimal"],
    [/bold|striking|loud|punchy/, "bold"],
    [/playful|fun|quirky/, "playful"],
    [/editorial|magazine|type[- ]?driven/, "editorial"],
    [/luxur|premium|high[- ]end|elegant/, "premium"],
    [/dark|neon|cyber/, "dark, high-contrast"],
    [/cinematic|immersive|3d|webgl|animated|interactive/, "cinematic and interactive"],
  ] as [RegExp, string][]) {
    if (re.test(t)) vibes.push(word);
  }
  const kindWord =
    brief.kind === "workflow" ? "tool" : brief.kind === "webapp" ? "app" : "site";
  const feel = vibes.length ? vibes.slice(0, 2).join(", ") : "clean, modern and polished";
  return `A ${feel} ${kindWord} with considered typography and motion, held to a high craft bar.`;
}
