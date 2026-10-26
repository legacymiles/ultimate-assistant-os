import "server-only";

// ---------------------------------------------------------------------------
// Jev model routing for skills.
//
// When a Jarvis skill or Studio workflow runs and the router (not the owner)
// is choosing the model, this asks Jev which tier the run needs — free, a
// cheap model, or the best one — before the call goes out. The owner's pin
// and the skill's weekly cap outrank Jev; an unsure or missing answer leaves
// the router's own plan alone. Jev routes; it never acts.
//
// Fast by construction: a 1.5 s ceiling, and a skill that is pinned or over
// its cap never calls Jev at all.
// ---------------------------------------------------------------------------

import { decide } from "@/lib/ai/decide";
import { confidentChoice, JEV } from "@/lib/ai/decisions";
import { capable, ROUTER_MODELS, type RoutePlan, type RouteRequest } from "@/lib/ai/router";
import { chooseTier, cheaper, tierQuestion, type RouteTier, type RouteWhy } from "../spend";
import { noteJev, readSpend } from "./spendStore";

const JEV_TIMEOUT_MS = 1_500;

export interface SkillRoute {
  /** The models to try, in order. */
  models: string[];
  tier: RouteTier | null;
  why: RouteWhy;
  /** Jev (or a cap) sent it somewhere cheaper than the router would have. */
  saved: boolean;
}

/** The last thing the owner said, which is what the tier depends on. */
function lastUserText(body: Record<string, unknown>): string {
  const msgs = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role !== "user") continue;
    const c = msgs[i].content;
    if (typeof c === "string") return c.slice(0, 2000);
    if (Array.isArray(c)) return c.map((p) => (typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join(" ").slice(0, 2000);
  }
  return "";
}

export async function routeSkill(skill: string, body: Record<string, unknown>, req: RouteRequest, plan: RoutePlan): Promise<SkillRoute> {
  const keep: SkillRoute = { models: plan.models, tier: null, why: "router", saved: false };
  try {
    const doc = await readSpend();
    // Pins and caps decide without Jev.
    let choice = chooseTier(doc, skill, null);
    if (choice.why === "router") {
      const started = Date.now();
      const res = await decide(
        { model: JEV, state: { skill, request: lastUserText(body) }, questions: { tier: tierQuestion() } },
        { timeoutMs: JEV_TIMEOUT_MS, app: "Jev skill routing" },
      );
      const pick = confidentChoice(res, "tier");
      noteJev({ used: Boolean(pick), cost: res?.cost ?? 0, ms: res?.ms ?? Date.now() - started });
      choice = chooseTier(doc, skill, pick);
    }
    if (!choice.tier) return keep;
    const target = ROUTER_MODELS.find((m) => m.tier === choice.tier);
    // A tier whose model cannot read this request (a video to a text model) is
    // not a saving, it is a failure: keep the router's plan.
    if (!target || !capable(target, req)) return keep;
    const models = [target.id, ...plan.models.filter((m) => m !== target.id)];
    return { models, tier: choice.tier, why: choice.why, saved: cheaper(choice.tier, plan.tier) };
  } catch {
    return keep;
  }
}
