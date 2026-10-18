// ---------------------------------------------------------------------------
// Checking what a client's edit request asks for, before any model builds it.
//
// routing.ts decides which LANE writes a brief (Claude, or the uncensored
// models when Claude refuses). This file answers the question underneath it,
// per request, and adds the one thing a lane cannot: a line no model crosses.
//
//   standard    an ordinary edit
//   uncensored  explicit adult content — in "auto" lane the brief goes
//               straight to the uncensored models instead of spending a
//               Claude call to be refused first
//   blocked     sexual content involving anyone under 18, or presenting sex
//               as non-consensual. Can't be sent, never reaches any model.
//
// Decided by a word list: free, instant, and it runs with no key. The owner
// chose not to put a decision model (Jev, Span) here — sends wait for their
// approval anyway, so speed buys nothing. decideRoute still takes optional
// model answers in case that changes; a model saying "no" would never clear
// what the word list found.
//
// Pure. contentCheckServer.ts runs it over a batch.
// ---------------------------------------------------------------------------

import type { DecisionRequest, DecisionResult } from "@/lib/ai/decisions";
import { confidentChoice, yesNo } from "@/lib/ai/decisions";

const EXPLICIT = [
  /\bnsfw\b/i,
  /\bporn\w*/i,
  /\bxxx\b/i,
  /\bnud(e|es|ity)\b/i,
  /\bnaked\b/i,
  /\btopless\b/i,
  /\bexplicit\b/i,
  /\berotic\w*/i,
  /\bsex(y|ual|ually)?\b/i,
  /\bfetish\w*/i,
  /\bonlyfans\b/i,
  /\bescort\w*\b/i,
  /\bstrip(per|club|tease)\w*/i,
  /\badult (content|site|entertainment|toys?|videos?)\b/i,
  /\b18\s*\+/,
  /\bx[- ]rated\b/i,
  /\blingerie\b/i,
  /\bboudoir\b/i,
  /\bkink\w*/i,
  /\bbdsm\b/i,
  /\bcam ?(girl|boy|model)s?\b/i,
];

/** Anything here plus any sexual signal is blocked outright. */
const MINOR = [
  /\b(child|children|kid|kids|minor|minors|underage|under[- ]age|preteen|pre-teen|teen|teens|teenage\w*|schoolgirl|schoolboy|loli\w*|shota\w*|jailbait)\b/i,
  /\b(1[0-7]|[1-9])\s*(yo|y\/o|years?\s*old)\b/i,
  /\bhigh ?school(er)?s?\b/i,
];

const NONCONSENT = [/\b(rape|raping|non[- ]?consensual|drugged|unconscious)\b/i];

export interface WordFlags {
  explicit: boolean;
  minor: boolean;
  nonconsent: boolean;
}

export function wordFlags(text: string): WordFlags {
  return {
    explicit: EXPLICIT.some((r) => r.test(text)),
    minor: MINOR.some((r) => r.test(text)),
    nonconsent: NONCONSENT.some((r) => r.test(text)),
  };
}

/** The decision-model questions for one request. Span answers the noul ones; Jev answers all three. */
export function routingQuestions(text: string, projectName: string): Omit<DecisionRequest, "model"> {
  return {
    state: { website: projectName, edit_request: text },
    questions: {
      explicit: {
        type: "noul",
        instructions: "Does this website edit request ask for sexually explicit or adult content (nudity, sex, porn, erotic material)?",
        criteria: {
          true: "It asks for sexual, nude, pornographic or otherwise explicit adult content to be added or changed.",
          false: "It is an ordinary edit with no sexual or explicit adult content.",
        },
      },
      minor: {
        type: "noul",
        instructions: "Does this request involve anyone who is or appears to be under 18, in any sexual or suggestive way?",
        criteria: {
          true: "It sexualises or suggestively depicts a minor, or someone presented as a child or teenager.",
          false: "No minors are involved in any sexual or suggestive way.",
        },
      },
      kind: {
        type: "choice",
        instructions: "What kind of website edit is this?",
        criteria: {
          copy: "Change words: headlines, text, prices, names, typos.",
          design: "Change look: colours, fonts, spacing, style, animation.",
          layout: "Move, add, remove or reorder sections or elements.",
          images: "Add, swap or remove photos, videos or graphics.",
          feature: "Add new functionality: forms, booking, checkout, logins, integrations.",
          fix: "Something is broken or behaves wrongly.",
          other: "None of the above.",
        },
      },
    },
  };
}

const KINDS = new Set<EditKind>(["copy", "design", "layout", "images", "feature", "fix", "other"]);

export interface RouteDecision {
  route: "standard" | "uncensored" | "blocked";
  why: string;
  /** Who decided: a decision model or the word list. */
  by: "span" | "jev" | "words";
  confidence?: number;
  kind?: EditKind;
}

export type EditKind = "copy" | "design" | "layout" | "images" | "feature" | "fix" | "other";

/**
 * Combine the word list with whatever the decision models answered (either
 * may be null — no key, timeout, failure).
 */
export function decideRoute(text: string, span: DecisionResult | null, jev: DecisionResult | null): RouteDecision {
  const words = wordFlags(text);
  const kindRaw = confidentChoice(jev, "kind", 0.5);
  const kind = kindRaw && KINDS.has(kindRaw as EditKind) ? (kindRaw as EditKind) : undefined;

  // Two models may answer the same yes/no; the more worried one counts.
  const pick = (name: "explicit" | "minor"): "yes" | "no" | "unsure" => {
    const a = yesNo(span, name);
    const b = yesNo(jev, name);
    if (a === "yes" || b === "yes") return "yes";
    if (a === "no" || b === "no") return "no";
    return "unsure";
  };
  const explicitAns = pick("explicit");
  const minorAns = pick("minor");
  const by: RouteDecision["by"] = span ? "span" : jev ? "jev" : "words";
  const confidence = (() => {
    const a = span?.answers.explicit ?? jev?.answers.explicit;
    return a && a.type === "noul" ? a.yes : undefined;
  })();

  const sexual = words.explicit || explicitAns === "yes";

  // The line. Any sign of a minor alongside any sexual signal, a model saying
  // yes outright, or non-consent framed sexually: blocked, whatever else said.
  if (minorAns === "yes" || (sexual && words.minor) || (sexual && words.nonconsent)) {
    return {
      route: "blocked",
      by: minorAns === "yes" ? by : "words",
      why: "This asks for sexual content involving a minor or non-consent. Jarvis won't build that with any model.",
      kind,
    };
  }

  if (sexual) {
    return {
      route: "uncensored",
      by: explicitAns === "yes" ? by : "words",
      confidence,
      why: "It asks for explicit adult content, which the standard models refuse — so it goes to the uncensored model.",
      kind,
    };
  }

  return {
    route: "standard",
    by,
    confidence,
    why: explicitAns === "no" ? "Ordinary edit — the standard models can build it." : "Nothing in it needs special handling.",
    kind,
  };
}

/** The batch's verdict: one blocked request blocks it, one explicit request routes it. */
export function batchVerdict(decisions: RouteDecision[]): RouteDecision {
  return (
    decisions.find((d) => d.route === "blocked") ??
    decisions.find((d) => d.route === "uncensored") ??
    decisions[0] ?? { route: "standard", why: "Nothing in it needs special handling.", by: "words" }
  );
}
