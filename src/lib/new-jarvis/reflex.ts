// ---------------------------------------------------------------------------
// The reflex — what can be decided before the model is woken up.
//
// Jarvis already made several of these judgements, scattered: wake.ts decides
// whether a sentence has finished and whether it is an echo, rank.ts scores how
// well something matches what is known, actions.ts decides whether a step has
// an effect. This is those judgements gathered into one pass that runs BEFORE
// the round trip, on data already in memory.
//
// The walkthrough this came from shows a row of probability bars and a 200ms
// figure. Bars are decoration unless they are attached to a decision that
// actually happened — so this one does not merely predict, it SHORT-CIRCUITS:
//
//   wait     the sentence is not finished, or was not addressed to it
//   answer   it is already in the vault; show it now, for nothing
//   cannot   it needs the PC, and the PC is not there — say so instantly
//            rather than spending a round trip to be told
//   think    hand it to the model, which is the normal path
//
// And it is local, so it is microseconds rather than 200 milliseconds. The
// video's number is the cost of asking a small model; copying it would be
// copying a limitation.
//
// Conservative by construction. `answer` needs a very strong match and no verb,
// `cannot` needs a capability that is definitely absent, and every short
// circuit is offered with a way past it. A reflex that is wrong and cannot be
// overridden is worse than no reflex.
// ---------------------------------------------------------------------------

import { keywordScore, tokens } from "@/lib/jarvis/rank";
import { excerpt as readable, parseFrontmatter } from "@/lib/jarvis/vault/parse";
import { isEcho } from "./wake";
import type { Mode } from "./types";

export type Route = "wait" | "answer" | "cannot" | "think";

export interface Signal {
  id: string;
  /** Two or three words, for the bar's label. */
  label: string;
  /** 0..1. */
  value: number;
  /** What this number means, for the row that explains it. */
  note: string;
}

export interface Candidate {
  /** Vault path or memory id. */
  key: string;
  title: string;
  /** Enough to answer from, when there is any. */
  excerpt?: string;
  score: number;
}

export interface Reflex {
  route: Route;
  signals: Signal[];
  /** One sentence naming why this route was taken. */
  because: string;
  /** For `answer`: what it would show. */
  best: Candidate | null;
  /** For `cannot`: the capability that is missing. */
  missing?: "browser" | "shell" | "files" | "system";
  /** Microseconds. Real, measured by the caller. */
  micros: number;
}

export interface ReflexInput {
  text: string;
  mode: Mode;
  /** What the local agent can do right now. */
  capabilities: Partial<Record<"browser" | "shell" | "files" | "system", boolean>>;
  bridgeReady: boolean;
  /** Everything searchable, already in memory. Titles and a little content. */
  known: { key: string; title: string; content?: string; tags?: string[] }[];
  /** What Jarvis last said aloud, for the echo test. */
  speaking?: string;
}

// --- the signals -----------------------------------------------------------

/** Verbs that mean "do something", not "tell me something". */
const ACTION_VERBS =
  /\b(open|run|launch|start|stop|click|type|fill|send|email|post|publish|book|buy|pay|order|delete|remove|rename|move|copy|download|install|write|save|create|add|set|change|update|close|refresh|sync|deploy|push|commit)\b/i;

/** Phrases that mean the machine itself, rather than a question about the world. */
const MACHINE =
  /\b(my (pc|computer|machine|desktop|laptop|screen|browser|files?|folder)|this (pc|computer|machine)|terminal|command line|shell|window|clipboard)\b/i;

const BROWSER_WORDS = /\b(open|browse|website|url|page|tab|log ?in|sign ?in|click|chrome|browser|https?:\/\/|\.com|\.co\.uk)\b/i;
const SHELL_WORDS = /\b(run|command|shell|terminal|npm|git|node|python|process|ps|kill|install)\b/i;
const FILE_WORDS = /\b(file|folder|directory|read|write|save|path|\.md|\.txt|\.json|\.ts)\b/i;

/** A fragment, not a request. */
const TRAILING = /\b(and|or|but|the|a|an|to|for|with|of|in|on|at|my|is|was|if|when|because|that|so)\s*$/i;

function addressed(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  // A question or an imperative is addressed. A bare noun is a note to self.
  if (/[?]$/.test(t)) return 0.97;
  if (ACTION_VERBS.test(t)) return 0.93;
  if (/^(what|who|where|when|why|how|which|can|could|do|does|did|is|are|should|tell|show|find|remind)\b/i.test(t)) {
    return 0.95;
  }
  const words = tokens(t).length;
  if (words >= 4) return 0.7;
  if (words >= 2) return 0.45;
  return 0.2;
}

function complete(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  // Ending on a conjunction or an article is someone still typing.
  if (TRAILING.test(t)) return 0.15;
  if (/[.?!]$/.test(t)) return 0.98;
  const words = tokens(t).length;
  if (words >= 5) return 0.85;
  if (words >= 3) return 0.6;
  return 0.35;
}

function wantsAction(text: string, mode: Mode): number {
  // The mode is the owner saying so outright, which beats any guess at the text.
  if (mode === "do" || mode === "browse" || mode === "run") return 0.96;
  return ACTION_VERBS.test(text) ? 0.8 : 0.08;
}

function needsMachine(text: string, mode: Mode): { value: number; which?: Reflex["missing"] } {
  if (mode === "browse") return { value: 0.95, which: "browser" };
  if (mode === "run") return { value: 0.95, which: "shell" };

  const hits: { which: NonNullable<Reflex["missing"]>; hit: boolean }[] = [
    { which: "browser", hit: BROWSER_WORDS.test(text) },
    { which: "shell", hit: SHELL_WORDS.test(text) },
    { which: "files", hit: FILE_WORDS.test(text) },
  ];
  const matched = hits.filter((h) => h.hit);
  if (MACHINE.test(text)) {
    return { value: 0.9, which: matched[0]?.which ?? "system" };
  }
  if (matched.length === 1) return { value: 0.6, which: matched[0].which };
  if (matched.length > 1) return { value: 0.5, which: matched[0].which };
  return { value: 0.05 };
}

/** The best local match, and how good it is. */
export function bestMatch(text: string, known: ReflexInput["known"]): Candidate | null {
  const q = text.trim();
  if (!q || !known.length) return null;

  let best: Candidate | null = null;
  for (const item of known) {
    const score = keywordScore(q, { title: item.title, content: item.content ?? "", tags: item.tags });
    if (score <= 0) continue;
    if (!best || score > best.score) {
      // The note as the owner would read it, not as it sits on disk. Slicing the
      // raw file spends the whole excerpt on YAML frontmatter and the title
      // heading, so the one line meant to answer the question says nothing.
      best = { key: item.key, title: item.title, excerpt: answerFrom(item.content), score };
    }
  }
  return best;
}

/** The body, without the frontmatter or the heading that just repeats the title. */
function answerFrom(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const text = readable(parseFrontmatter(content).body, 400);
  return text || undefined;
}

// --- the pass --------------------------------------------------------------

/** Above this, and with no verb in sight, the answer is already here. */
export const ANSWER_THRESHOLD = 0.62;

/** Below either of these, the sentence is not ready to send. */
export const ADDRESSED_FLOOR = 0.35;
export const COMPLETE_FLOOR = 0.3;

export function reflex(input: ReflexInput): Reflex {
  const started = now();
  const { text, mode, capabilities, bridgeReady, known, speaking } = input;

  const addressedValue = addressed(text);
  const completeValue = complete(text);
  const actsValue = wantsAction(text, mode);
  const machine = needsMachine(text, mode);
  const match = bestMatch(text, known);
  const matchValue = match ? Math.min(1, match.score) : 0;
  const echoing = speaking ? isEcho(text, speaking) : false;

  const signals: Signal[] = [
    { id: "addressed", label: "For me", value: addressedValue, note: "whether this is a request rather than a note to yourself" },
    { id: "complete", label: "Finished", value: completeValue, note: "whether the sentence looks done" },
    { id: "acts", label: "Wants doing", value: actsValue, note: "whether it asks for something to happen, not just an answer" },
    { id: "machine", label: "Needs the PC", value: machine.value, note: "whether it has to touch this computer" },
    { id: "known", label: "Already here", value: matchValue, note: "how well it matches something you have already written" },
  ];

  const settle = (route: Route, because: string, extra: Partial<Reflex> = {}): Reflex => ({
    route,
    signals,
    because,
    best: match,
    micros: Math.round((now() - started) * 1000),
    ...extra,
  });

  // An echo of what it just said aloud is not a request at all.
  if (echoing) return settle("wait", "That is what Jarvis just said — it is hearing itself.");

  if (!text.trim()) return settle("wait", "Nothing to do yet.");

  if (addressedValue < ADDRESSED_FLOOR) {
    return settle("wait", "That reads like a note to yourself rather than a request.");
  }
  if (completeValue < COMPLETE_FLOOR) {
    return settle("wait", "Still mid-sentence.");
  }

  // Fail fast rather than spending a round trip to be told the same thing.
  if (machine.value > 0.6 && machine.which) {
    const able = capabilities[machine.which] === true && bridgeReady;
    if (!able) {
      return settle(
        "cannot",
        bridgeReady
          ? `This needs ${machine.which} on your PC, which the agent says it cannot do.`
          : "This needs your PC, and the local agent is not reachable.",
        { missing: machine.which },
      );
    }
  }

  // Already written down. Shown instantly, for nothing — but only when nothing
  // is being asked FOR, because "open my notes on X" is not answered by X.
  if (match && matchValue >= ANSWER_THRESHOLD && actsValue < 0.5) {
    return settle("answer", `You have already written this down: ${match.title}.`);
  }

  return settle("think", "Nothing could be settled here, so it goes to the model.");
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// --- words -----------------------------------------------------------------

export const ROUTE_LABEL: Record<Route, string> = {
  wait: "waiting",
  answer: "answered here",
  cannot: "cannot",
  think: "asking the model",
};

/** `180 µs`. Microseconds, because this is a local pass and milliseconds would round to zero. */
export function formatMicros(micros: number): string {
  if (micros < 1000) return `${micros} µs`;
  return `${(micros / 1000).toFixed(1)} ms`;
}

/** True when the reflex kept a round trip from happening at all. */
export function savedACall(route: Route): boolean {
  return route === "answer" || route === "cannot";
}
