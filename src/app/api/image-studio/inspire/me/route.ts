import { aiConfigured } from "@/lib/ai/provider";
import { dayKey, planFor } from "@/lib/image-studio/inspire/plan";
import { caller } from "@/lib/image-studio/inspire/server/access";
import { usedToday } from "@/lib/image-studio/inspire/server/store";
import type { Me } from "@/lib/image-studio/inspire/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/image-studio/inspire/me — who is looking, their plan and today's AI use.
export async function GET() {
  const who = await caller();
  const plan = planFor(!!who?.owner);
  let used = 0;
  if (who && plan.aiPerDay !== null) {
    try {
      used = await usedToday(who.id, dayKey());
    } catch {
      used = 0;
    }
  }
  const me: Me = {
    signedIn: !!who,
    id: who?.id ?? null,
    email: who?.email ?? null,
    owner: !!who?.owner,
    local: !!who?.local,
    ai: aiConfigured(),
    plan: { id: plan.id, label: plan.label, aiPerDay: plan.aiPerDay, aiUsedToday: used },
  };
  return Response.json(me, { headers: { "Cache-Control": "no-store" } });
}
