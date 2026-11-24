// ---------------------------------------------------------------------------
// Plans. Billing is wired and switched off: everyone is on Free, Free has a
// daily allowance of AI actions (chip extraction, reverse prompt, enhance,
// translate, generate) so one account cannot spend the owner's credits without
// limit, and there are no prices anywhere. `commercial 2x` turns the paid
// plan on by flipping MONETIZATION_ENABLED and adding a checkout.
// ---------------------------------------------------------------------------

export const MONETIZATION_ENABLED = false;

export interface Plan {
  id: "free" | "pro" | "owner";
  label: string;
  /** null = unlimited. */
  aiPerDay: number | null;
}

export const PLANS: Record<Plan["id"], Plan> = {
  free: { id: "free", label: "Free", aiPerDay: 40 },
  // Present so the switch is one line; never offered while monetization is off.
  pro: { id: "pro", label: "Pro", aiPerDay: 500 },
  owner: { id: "owner", label: "Owner", aiPerDay: null },
};

/** What each AI action costs against the daily allowance. */
export const AI_COST = {
  extract: 1,
  reverse: 2,
  enhance: 1,
  translate: 1,
  generate: 2,
} as const;

export type AiAction = keyof typeof AI_COST;

export function planFor(owner: boolean): Plan {
  return owner ? PLANS.owner : PLANS.free;
}

/** "2026-11-24" in UTC — the allowance resets at midnight UTC. */
export function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function allowed(plan: Plan, usedToday: number, cost: number): boolean {
  return plan.aiPerDay === null || usedToday + cost <= plan.aiPerDay;
}
