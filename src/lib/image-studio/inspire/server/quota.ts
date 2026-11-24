// The daily AI allowance — checked before a call, charged after it succeeds.

import "server-only";

import { AI_COST, allowed, dayKey, planFor, type AiAction } from "../plan";
import { HttpError, requireUser, type Caller } from "./access";
import { addUsage, usedToday } from "./store";

export async function spendGate(action: AiAction): Promise<{ who: Caller; charge: () => Promise<void> }> {
  const who = await requireUser("use the AI tools");
  const plan = planFor(who.owner);
  const day = dayKey();
  const cost = AI_COST[action];
  const used = plan.aiPerDay === null ? 0 : await usedToday(who.id, day);
  if (!allowed(plan, used, cost)) {
    throw new HttpError(429, `You've used today's ${plan.aiPerDay} AI actions on the ${plan.label} plan. They reset at midnight UTC.`);
  }
  return {
    who,
    charge: async () => {
      if (plan.aiPerDay === null) return;
      try {
        await addUsage(who.id, day, cost);
      } catch (err) {
        console.error("[inspire] usage not recorded:", err);
      }
    },
  };
}
