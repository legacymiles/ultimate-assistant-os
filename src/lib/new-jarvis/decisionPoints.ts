// ---------------------------------------------------------------------------
// Where Jarvis makes quick decisions — and which of them a decision model
// (Jev, Span) should be making.
//
// The owner asked for the self-improving side of Jarvis to know about Jev and
// to keep pushing it into the right places. "The right places" are not
// everywhere: Jev cannot write a word, so it never replaces Claude or DeepSeek
// as the brain. It belongs at the moments where Jarvis is DECIDING rather than
// WRITING — triage, flags, sorting, yes/no checks — because those are where a
// chat model is slow and expensive for what is really a multiple-choice
// question.
//
// This file is the map of those moments. Each entry says what is decided,
// which model fits, and whether it is wired yet. Two readers use it:
//
//   - the self-audit (improve.ts → auditDecisionPoints) files one proposal per
//     spot that is NOT wired, with the code location as its evidence;
//   - the Improvements engine (/api/new-jarvis/ideas) is told about the
//     models and the open spots, so a "Jarvis" idea about speed or cost can
//     point at a real place instead of saying "use AI more".
//
// When a spot gets wired, flip `wired` and name the model. That is the whole
// upkeep, and it is what makes the proposal go away.
// ---------------------------------------------------------------------------

import type { DecisionModelId } from "@/lib/ai/decisions";

export interface DecisionPoint {
  id: string;
  /** What the owner would call it. */
  label: string;
  /** The question being decided, as a decision model would be asked it. */
  decides: string;
  /** Where in the code the decision happens today. */
  where: string;
  /** What answers it today. */
  today: string;
  /** The model that fits. */
  model: DecisionModelId | "typesafe/jev-router";
  /** Why a decision model is better here, in one line. */
  gain: string;
  wired: boolean;
  effort: "minutes" | "hours" | "a session";
}

export const DECISION_POINTS: DecisionPoint[] = [
  {
    id: "long-tasks",
    label: "Very long or open-ended tasks",
    decides: "Which model and how much reasoning a big job gets",
    where: "src/lib/ai/router.ts (tier \"long\")",
    today: "Jev Router",
    model: "typesafe/jev-router",
    gain: "Jev picks the model and the effort itself and has a million tokens of room.",
    wired: true,
    effort: "minutes",
  },
  {
    id: "chat-triage",
    label: "Chat front door",
    decides: "Is this message a quick answer, a coding job for the harness, a browser task, or a photo/audio job?",
    where: "src/app/api/new-jarvis/agent/route.ts + src/lib/new-jarvis/triage.ts",
    today: "Jev picks quick / remember / computer / build on the first step of a Do or Ask turn",
    model: "typesafe/jev-1.14",
    gain: "A 70–500 ms triage sends simple messages down the fast path before the big model starts.",
    wired: true,
    effort: "hours",
  },
  {
    id: "browser-steps",
    label: "Browser agent: the next click",
    decides: "Given this page and the goal: which link, button or box next — and for a box, which words (saved detail, the person's own words, or new ones)?",
    where: "src/lib/new-jarvis/browserFast.ts (called from src/app/api/new-jarvis/agent/route.ts)",
    today: "Jev picks clicks and boxes from the page's own controls and which words go in; saved details fill from the Record in the owner's tab; a small model writes only when new words are needed; a read after every step needs no model",
    model: "typesafe/jev-1.14",
    gain: "Each navigation step takes well under a second instead of a full chat-model call.",
    wired: true,
    effort: "minutes",
  },
  {
    id: "action-confirm",
    label: "Browser agent safety check",
    decides: "Does this step need the person to say yes before Jarvis does it?",
    where: "src/lib/jarvis/tools.ts",
    today: "A fixed list: anything not known read-only asks",
    model: "typesafe/jev-1.14",
    gain: "A second opinion with a probability, so low-risk steps stop asking — the fixed list still wins when unsure.",
    wired: false,
    effort: "a session",
  },
  {
    id: "notification-urgency",
    label: "Notification urgency",
    decides: "How urgent is this update: can wait, today, or right now?",
    where: "src/lib/jarvis/updates.ts (byUrgency)",
    today: "Fixed ordering by source and time",
    model: "typesafe/jev-1.14",
    gain: "Puts the update that actually matters at the top instead of the newest one.",
    wired: false,
    effort: "hours",
  },
  {
    id: "memory-worth",
    label: "Shared memory: worth saving?",
    decides: "Is this message a durable fact worth remembering, and which kind?",
    where: "src/lib/jarvis/server/agent.ts (propose_memory tool)",
    today: "The chat model decides mid-answer, every turn",
    model: "typesafe/jev-1.14",
    gain: "Most messages are not memories; a cheap yes/no skips the expensive call for them.",
    wired: false,
    effort: "hours",
  },
  {
    id: "photo-sort",
    label: "Camera Autopilot photo sorting",
    decides: "Which folder does this photo belong in, and is it a song screenshot for the classifier?",
    where: "src/lib/recall/photos/vision.ts",
    today: "A vision chat-model call per photo, answered as JSON to parse",
    model: "respan/span-02",
    gain: "Span-02 reads pictures and answers as a choice, so sorting stops being a written reply to parse.",
    wired: false,
    effort: "hours",
  },
];

/** The flat facts the self-audit is given. */
export interface DecisionPointFact {
  id: string;
  label: string;
  decides: string;
  where: string;
  today: string;
  model: string;
  gain: string;
  wired: boolean;
  effort: "minutes" | "hours" | "a session";
}

export function decisionPointFacts(): DecisionPointFact[] {
  return DECISION_POINTS.map((p) => ({ ...p }));
}

/**
 * What the Improvements engine is told, as plain text for its system prompt.
 * Knowledge, not evidence: an idea still has to cite something the person said.
 */
export function decisionModelBrief(models: { id: string; label: string; goodFor: string; notFor: string; latency: string; price: string }[]): string {
  const lines = [
    "## Fast decision models Jarvis can use (knowledge, not evidence)",
    "These models never write text; they pick an option, answer yes/no with a probability, or score on a scale. They fit where Jarvis is DECIDING, not writing.",
    ...models.map((m) => `- ${m.label} (${m.id}): ${m.goodFor} Not for: ${m.notFor} Speed: ${m.latency}. Price: ${m.price}.`),
    "",
    "## Places in Jarvis that could use one and do not yet",
    ...DECISION_POINTS.filter((p) => !p.wired).map(
      (p) => `- ${p.label}: decides "${p.decides}". Today: ${p.today}. Fits: ${p.model} — ${p.gain}`,
    ),
    "",
    "## Already wired",
    ...DECISION_POINTS.filter((p) => p.wired).map((p) => `- ${p.label}: ${p.today}`),
  ];
  return lines.join("\n");
}
