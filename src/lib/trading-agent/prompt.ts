// ---------------------------------------------------------------------------
// What the trading agent is asked, and what it is not allowed to answer.
//
// The agent reads a setup the owner brought and argues with the REASONING. It
// never recommends taking or avoiding a trade, never predicts a price, and
// never touches execution — not because a model would be bad at the first two
// (though it would) but because this app has no business doing them. A tool
// that says "yes, take it" is a tool you stop thinking next to, and the thinking
// is the only part of this that has value.
//
// The arithmetic is not asked for either. It arrives already computed from
// setup.ts and is handed to the model as fact, so the model cannot get the one
// part of this that is decidable wrong.
// ---------------------------------------------------------------------------

import type { Numbers, Setup } from "./setup";
import { describe, precisionOf } from "./setup";

/** The shape the model is asked to answer in, so the UI can render sections. */
export interface Read {
  /** The bet as the agent understands it, in the agent's own words. */
  restated: string;
  /** What has to be true about the world for the thesis to hold. */
  assumes: string[];
  /** Observations that would kill the thesis before the stop is hit. */
  invalidatedBy: string[];
  /** Where the agent thinks the reasoning is weakest. */
  pushback: string[];
  /** What the setup does not say, and should. */
  unanswered: string[];
}

export const READ_MODEL = "anthropic/claude-opus-5";

export function readSystem(): string {
  return [
    "You read trade setups and argue with the reasoning behind them. The person has already",
    "decided what they are doing; your job is to make their reasoning visible to them, including",
    "the parts of it they have not noticed they are relying on.",
    "",
    "Hard limits, which you hold even if asked directly to break them:",
    "- Never recommend taking, avoiding, sizing up or sizing down a trade. No verdicts.",
    "- Never predict a price, a direction or a probability of either. You have no market data and",
    "  no edge; a number you invent would be read as a forecast.",
    "- Never discuss placing, modifying or closing orders, or any broker, platform or API.",
    "- Do not restate the arithmetic you were given. It is already correct and already on screen.",
    "",
    "What you are actually good for: naming the assumptions the thesis rests on, the observations",
    "that would falsify it before the stop is reached, the weakest link in the argument, and the",
    "questions the setup leaves open. Be specific to THIS instrument, timeframe and thesis —",
    "generic risk-management advice is worthless here and the person has heard all of it.",
    "",
    "Answer as JSON only, no prose around it, matching exactly:",
    '{"restated": string, "assumes": string[], "invalidatedBy": string[], "pushback": string[], "unanswered": string[]}',
    "",
    "Each array holds 2 to 4 entries. Each entry is one sentence, under 220 characters, written to",
    "the person as 'you'. `restated` is one or two sentences: the bet as you understand it,",
    "stripped of the reasons given for it.",
  ].join("\n");
}

export function readUser(setup: Setup, n: Numbers | null): string {
  const p = precisionOf(setup);
  const lines = [
    `Setup: ${describe(setup, n)}`,
    `Instrument: ${setup.instrument || "(not named)"}`,
    `Direction: ${setup.direction}`,
    `Timeframe: ${setup.timeframe || "(not stated)"}`,
    `Entry ${setup.entry.toFixed(p)} · stop ${setup.stop.toFixed(p)} · target ${setup.target.toFixed(p)}`,
  ];
  if (n) {
    lines.push(
      `Already computed, do not recompute or restate: ${n.rr.toFixed(2)}:1, breakeven win rate `
        + `${Math.round(n.breakevenWinRate * 100)}%.`,
    );
  }
  lines.push("", "Their thesis, verbatim:", setup.thesis.trim() || "(they wrote none)");
  return lines.join("\n");
}

const MAX_ENTRY = 400;

function strings(v: unknown, cap = 4): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().slice(0, MAX_ENTRY))
    .filter((x) => x.length > 0)
    .slice(0, cap);
}

/**
 * The model's answer, or null when it did not produce one this UI can show.
 *
 * Null rather than a half-filled Read: a section that silently comes back empty
 * reads as "the agent had nothing to say about your assumptions", which is a
 * different and much more flattering claim than "the call failed".
 */
export function parseRead(text: string): Read | null {
  // Models wrap JSON in prose and fences however they like; take the outermost
  // braces rather than trusting the response to be bare.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  const restated = typeof o.restated === "string" ? o.restated.trim().slice(0, 600) : "";
  const read: Read = {
    restated,
    assumes: strings(o.assumes),
    invalidatedBy: strings(o.invalidatedBy),
    pushback: strings(o.pushback),
    unanswered: strings(o.unanswered),
  };
  // One filled section is not a read. Requiring the restatement plus two of the
  // four lists is what distinguishes an answer from a model that gave up.
  const filled = [read.assumes, read.invalidatedBy, read.pushback, read.unanswered].filter(
    (a) => a.length > 0,
  ).length;
  if (!read.restated || filled < 2) return null;
  return read;
}

/** The text of the first message of the chat the model is handed. */
export function offlineNote(): string {
  return (
    "No AI key is set, so the reasoning half of this is offline. The arithmetic on the left is "
    + "computed on this machine and is unaffected — it never needed a model."
  );
}
