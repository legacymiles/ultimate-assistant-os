// ---------------------------------------------------------------------------
// Which permission cards are the SAME question.
//
// The bridge keeps its own copy of this (harness-gate.mjs `familyOf`) because
// it is plain .mjs and cannot import TypeScript. The two must agree: the
// bridge decides what an "Always" covers, and this decides which button the
// page offers first. If they drift, the page promises something the bridge
// will not honour — so the list lives in one shape in both, and the test below
// this file is what notices.
// ---------------------------------------------------------------------------

import type { GateCard, ThreadView } from "./types";

/** Tools that are one act wearing several names. */
const FAMILIES: Record<string, string> = {
  Write: "write-a-file",
  Edit: "write-a-file",
  MultiEdit: "write-a-file",
  NotebookEdit: "write-a-file",
};

/**
 * The key an "Always" answer is remembered under.
 *
 * Anything not in the table is its own family, because for an MCP tool the
 * name IS the unit of risk — `browser_navigate` tells you nothing about what
 * `browser_evaluate` will do.
 */
export function familyOf(name: string): string {
  return FAMILIES[name] ?? name;
}

/**
 * Has this build already asked about this act?
 *
 * The second time a tool asks, the answer is not in doubt — somebody has
 * already read the card and said yes. That is the moment "Always" stops being
 * the cautious option and starts being the obvious one, so it is the moment
 * the page should offer it first. Measured on answered cards only: a card
 * still on screen is the question being asked, not evidence about it.
 */
export function askedBefore(view: ThreadView, gate: GateCard): boolean {
  const family = familyOf(gate.name);
  return view.turns.some((t) =>
    t.gates.some((g) => g.gateId !== gate.gateId && g.answered && g.allowed && familyOf(g.name) === family),
  );
}
