// ---------------------------------------------------------------------------
// Everything the sheet displays about a plan, computed on the spot.
//
// Nothing here is stored. A stored total drifts the moment a step is edited,
// and a wrong total is the single error that makes the whole sheet worthless —
// so the total is a function of the steps and can never disagree with them.
//
// Two decisions worth knowing:
//
//   1. A step's `cost` INCLUDES its materials. Materials are summed only for a
//      step with no cost of its own. Any other rule double-counts.
//   2. Mixed currencies are REFUSED, not converted. Inventing an exchange rate
//      inside a cost total is a way to be confidently wrong, and the owner can
//      see two currencies on the sheet and decide what he wants done about it.
// ---------------------------------------------------------------------------

import type { Money, Plan, Step } from "./types";

export interface Totals {
  /** Null when nothing is costed, or when currencies disagree. */
  cost: Money | null;
  /** True when two currencies were seen; the sheet says so instead of a total. */
  mixed: boolean;
  costedSteps: number;
  uncostedSteps: number;
}

/** What one step costs, or null when it costs nothing countable. */
export function stepCost(step: Step): Money | null {
  if (step.skipped) return null;
  if (step.cost) return step.cost;

  let low = 0;
  let high = 0;
  let currency = "";
  let seen = false;
  for (const m of step.materials) {
    if (!m.unitCost) continue;
    if (currency && m.unitCost.currency !== currency) return null;
    currency = m.unitCost.currency;
    low += m.unitCost.low * m.qty;
    high += m.unitCost.high * m.qty;
    seen = true;
  }
  return seen ? { low, high, currency } : null;
}

function everyStep(plan: Plan): Step[] {
  return plan.phases.flatMap((p) => p.steps);
}

export function totals(plan: Plan): Totals {
  let low = 0;
  let high = 0;
  let currency = "";
  let mixed = false;
  let costedSteps = 0;
  let uncostedSteps = 0;

  for (const step of everyStep(plan)) {
    if (step.skipped) continue;
    const cost = stepCost(step);
    if (!cost) {
      uncostedSteps += 1;
      continue;
    }
    costedSteps += 1;
    if (currency && cost.currency !== currency) {
      mixed = true;
      continue;
    }
    currency = cost.currency;
    low += cost.low;
    high += cost.high;
  }

  return {
    cost: mixed || !costedSteps ? null : { low, high, currency },
    mixed,
    costedSteps,
    uncostedSteps,
  };
}

export function progress(plan: Plan): { done: number; total: number } {
  const live = everyStep(plan).filter((s) => !s.skipped);
  return { done: live.filter((s) => s.done).length, total: live.length };
}

export function timeline(plan: Plan): { days: number; hours: number } {
  const days = plan.phases.reduce((sum, p) => sum + (p.days ?? 0), 0);
  const hours = everyStep(plan)
    .filter((s) => !s.skipped)
    .reduce((sum, s) => sum + (s.hours ?? 0), 0);
  return { days, hours };
}

/** How much of what this plan claims has actually been checked. 0 when nothing is costed. */
export function verifiedShare(plan: Plan): number {
  const costed = everyStep(plan).filter((s) => !s.skipped && stepCost(s));
  if (!costed.length) return 0;
  return costed.filter((s) => s.provenance === "verified").length / costed.length;
}

const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", CAD: "C$", AUD: "A$" };

function one(amount: number, currency: string): string {
  const symbol = SYMBOL[currency] ?? "";
  const n = Math.round(amount).toLocaleString("en-US");
  return symbol ? `${symbol}${n}` : `${n} ${currency}`;
}

/** A range reads as a range; an exact figure should not pretend to be one. */
export function fmtMoney(money: Money | null): string {
  if (!money) return "—";
  const low = one(money.low, money.currency);
  if (Math.round(money.low) === Math.round(money.high)) return low;
  return `${low}–${one(money.high, money.currency)}`;
}
