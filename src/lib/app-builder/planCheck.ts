// ---------------------------------------------------------------------------
// App Builder — the plan check, run before Build it.
//
// Pressing Build it used to hand the PC whatever was on the list. A feature
// saying "Make it user-friendly" was handed over exactly like a sharp one, and
// the build came back "not what I meant" — which read as the build being bad
// when the PLAN was the thing that was wrong.
//
// So this is `openspec validate` for a feature list: every accepted feature
// must say how anyone would know it works, and every THEN must be something a
// person or a test can actually see. A "block" disables Build it; a "warn"
// never does — the owner's judgement outranks a heuristic, and a check that
// cries wolf is a check people learn to click past.
//
// Pure: no fetch, no storage, no model. The panel shows these, and the brief
// prints them, so the PC is told what was waved through.
// ---------------------------------------------------------------------------

import { checkDeltas } from "./spec";
import type { BuilderProject, Feature, Scenario } from "./types";

// Deliberately no import from ./engine: the engine's brief writers import THIS
// file (so a build is told what was waved through), and a cycle between the two
// is the kind of thing that only shows up as an undefined function at runtime.
const accepted = (p: BuilderProject) => p.features.filter((f) => f.status === "accepted");
const allScenarios = (p: BuilderProject) => accepted(p).flatMap((f) => f.scenarios ?? []);

export type FindingLevel = "block" | "warn";

export interface PlanFinding {
  /** The feature it is about, when it is about one. */
  featureId?: string;
  /** The scenario it is about, when it is about one. */
  scenarioId?: string;
  level: FindingLevel;
  /** What is wrong, in the owner's language. */
  text: string;
  /** What to do about it — becomes the chat message when they press Fix with AI. */
  fix?: string;
}

/**
 * Words that make a THEN uncheckable.
 *
 * Every one of these is a judgement with no observation in it: two people can
 * read "works properly" and both be right. If a THEN leans on one of these,
 * nobody can write the test, so the build agent decides for itself what done
 * means — which is the whole failure this check exists to stop.
 */
const VAGUE = [
  "works well",
  "works properly",
  "works correctly",
  "works as expected",
  "works smoothly",
  "works fine",
  "it works",
  "functions correctly",
  "behaves correctly",
  "is correct",
  "as expected",
  "properly",
  "seamless",
  "seamlessly",
  "intuitive",
  "user-friendly",
  "user friendly",
  "easy to use",
  "looks good",
  "looks great",
  "looks nice",
  "feels premium",
  "feels fast",
  "is fast",
  "is responsive",
  "is reliable",
  "is secure",
  "no issues",
  "no problems",
  "everything works",
  "is improved",
  "is better",
  "is optimized",
  "is optimised",
  "high quality",
  "best practices",
];

/**
 * The vague phrase a THEN leans on, or "".
 *
 * Longest match wins, so the message names the whole problem ("works
 * properly") rather than a fragment of it. The bare word "works" is
 * deliberately NOT on the list: "the network works out the shortest route and
 * draws it" is a perfectly checkable THEN, and a check that blocks that is a
 * check the owner learns to route around.
 */
export function vaguePhrase(then: string): string {
  const t = ` ${then.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ")} `;
  let found = "";
  for (const v of VAGUE) {
    // Whole phrase only: "it works" is vague, "network works out the route" is not.
    if (t.includes(` ${v} `) && v.length > found.length) found = v;
  }
  return found;
}

/** Does this feature take input a person could get wrong? */
export function takesInput(f: Feature): boolean {
  const t = `${f.title} ${f.detail}`.toLowerCase();
  return /\b(form|field|submit|sign[- ]?up|sign[- ]?in|log[- ]?in|upload|search|enquir|inquir|contact|book|checkout|pay|payment|card|invite|comment|review|message|import|paste|type|enter)\b/.test(t);
}

/** Does this scenario describe something going wrong? */
export function isFailureCase(s: Scenario): boolean {
  const t = `${s.name} ${s.when} ${s.then}`.toLowerCase();
  return /\b(empty|blank|invalid|wrong|bad|missing|too (long|short|large|big)|no |without|refus|reject|fail|error|declin|duplicate|expired|offline|unauthori[sz]ed|not allowed|cannot|can't)\b/.test(t);
}

/** The same moment described twice, as a comparable key. */
const momentKey = (s: Scenario) =>
  `${s.given ?? ""} ${s.when}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["they", "their", "them", "that", "this", "with", "from", "when", "then", "someone", "visitor", "user"].includes(w))
    .sort()
    .join(" ");

/**
 * Everything wrong with this plan, worst first.
 *
 * Only accepted features are judged: a proposed feature is still an idea, and
 * a denied one is not being built. A redesign is judged harder, because
 * "everything it does today keeps working" is the promise the whole job rests
 * on — an unchecked must-keep is how a redesign quietly drops a form.
 */
export function planCheck(p: BuilderProject): PlanFinding[] {
  const list = accepted(p);
  const blocks: PlanFinding[] = [];
  const warns: PlanFinding[] = [];

  for (const f of list) {
    const own = f.scenarios ?? [];
    if (!own.length) {
      blocks.push({
        featureId: f.id,
        level: "block",
        text: `“${f.title}” has no way to tell it works.`,
        fix: `Add a WHEN/THEN check to ${f.id} (“${f.title}”): when someone does something, what can you SEE as a result?`,
      });
      continue;
    }
    for (const s of own) {
      const vague = vaguePhrase(s.then);
      if (vague) {
        blocks.push({
          featureId: f.id,
          scenarioId: s.id,
          level: "block",
          text: `${s.id}'s THEN says “${vague}”, which nobody can check.`,
          fix: `Rewrite ${s.id} on ${f.id} (“${f.title}”): its THEN says “${vague}”. Say what actually appears — words on screen, a row in a list, an email sent, a number that changed.`,
        });
      }
    }
    if (takesInput(f) && !own.some(isFailureCase)) {
      warns.push({
        featureId: f.id,
        level: "warn",
        text: `“${f.title}” takes input but nothing checks the wrong-input case.`,
        fix: `Add a failure check to ${f.id} (“${f.title}”): what happens when the input is empty, wrong or too long?`,
      });
    }
  }

  // The same moment checked twice is usually two features that are one.
  const byMoment = new Map<string, { featureId: string; scenarioId: string }[]>();
  for (const f of list) {
    for (const s of f.scenarios ?? []) {
      const key = momentKey(s);
      if (key.split(" ").length < 3) continue;
      byMoment.set(key, [...(byMoment.get(key) ?? []), { featureId: f.id, scenarioId: s.id }]);
    }
  }
  for (const hits of byMoment.values()) {
    const ids = [...new Set(hits.map((h) => h.featureId))];
    if (ids.length > 1) {
      warns.push({
        featureId: ids[0],
        level: "warn",
        text: `${ids.join(" and ")} describe the same moment.`,
        fix: `${ids.join(" and ")} have checks for the same moment. Are they one feature? Merge them, or make each check a different thing.`,
      });
    }
  }

  // A redesign's deal is that nothing the site does today gets lost.
  if (p.redesign) {
    const checked = allScenarios(p).length;
    const keeps = p.features.filter((f) => f.status === "accepted" && /^keep:/i.test(f.title));
    for (const f of keeps) {
      if (!(f.scenarios ?? []).length) {
        blocks.push({
          featureId: f.id,
          level: "block",
          text: `The live site's “${f.title.replace(/^keep:\s*/i, "")}” isn't checked after the redesign.`,
          fix: `Add a check to ${f.id}: how do we prove “${f.title.replace(/^keep:\s*/i, "")}” still works on the new site exactly as it does now?`,
        });
      }
    }
    if (!checked) {
      warns.push({
        level: "warn",
        text: "Nothing on this redesign is checked yet, so “keeps everything it does” is only a promise.",
        fix: "Write a keep-check for each thing the live site does today.",
      });
    }
  }

  // A shipped feature cannot quietly disappear between versions: OpenSpec's
  // rule, and the one that saves the "why did this go?" conversation later.
  for (const text of checkDeltas(p)) {
    blocks.push({
      level: "block",
      text,
      fix: `${text} Set its Why to the reason it is going.`,
    });
  }

  if (!p.edit && (p.understanding?.judge ?? []).length < 2) {
    warns.push({
      level: "warn",
      text: "The app has fewer than two judge lines, so there is little to report against.",
      fix: "Add two or three checkable outcomes an outside judge could verify for the whole app.",
    });
  }

  return [...blocks, ...warns];
}

/** Is the plan good enough to build? Warnings never stop a build; blocks do. */
export function canBuild(p: BuilderProject): boolean {
  return !planCheck(p).some((f) => f.level === "block");
}

/** The counts the panel and the button read. */
export function planSummary(p: BuilderProject): { blocks: number; warns: number; scenarios: number; features: number } {
  const findings = planCheck(p);
  return {
    blocks: findings.filter((f) => f.level === "block").length,
    warns: findings.filter((f) => f.level === "warn").length,
    scenarios: allScenarios(p).length,
    features: accepted(p).length,
  };
}

/**
 * The findings as a message to the agent chat, for the Fix with AI button.
 *
 * The chat already turns a message into ops, so the fix is a conversation the
 * owner can read and argue with rather than a silent rewrite of their plan.
 */
export function fixMessage(findings: PlanFinding[]): string {
  const blocks = findings.filter((f) => f.level === "block");
  const warns = findings.filter((f) => f.level === "warn");
  const lines = [...blocks, ...warns].map((f) => `- ${f.fix ?? f.text}`);
  if (!lines.length) return "";
  return [
    blocks.length
      ? `The plan check is blocking the build on ${blocks.length} thing${blocks.length === 1 ? "" : "s"}. Fix ${blocks.length === 1 ? "it" : "them"} with scenario and edit ops:`
      : "The plan check has some suggestions. Apply the ones that make the plan more checkable:",
    ...lines,
    "Keep every check the owner wrote (source \"you\") exactly as it is, and keep the features themselves — this is about how we tell they work, not what they are.",
  ].join("\n");
}

/**
 * What the build is told about the state of its own plan.
 *
 * A warning the owner chose to ship is information the builder needs: it says
 * where to be careful and what to ask about, instead of discovering it late.
 */
export function planNotesBlock(p: BuilderProject): string {
  const warns = planCheck(p).filter((f) => f.level === "warn");
  if (!warns.length) return "";
  return [
    "<plan_notes>",
    "The owner shipped this plan with these open notes — treat each as something to watch, and say in your report what you did about it:",
    ...warns.map((w) => `- ${w.text}${w.fix ? ` (${w.fix})` : ""}`),
    "</plan_notes>",
  ].join("\n");
}
