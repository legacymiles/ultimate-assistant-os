import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiFetch, aiKey } from "@/lib/ai/provider";
import { cleanOps } from "@/lib/bible/clean";
import { CHAT_SYSTEM } from "@/lib/bible/prompts";
import type { HomeBase, Message, Plan } from "@/lib/bible/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The plan as the model sees it: ids included, because every op it may return
 * names one; owner-only fields left out, because `done`, `note` and `skipped`
 * are not the agent's business and `ops.ts` would overrule it anyway.
 */
function planForModel(plan: Plan) {
  return {
    version: plan.version,
    summary: plan.summary,
    assumptions: plan.assumptions,
    unit: plan.unit,
    phases: plan.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      goal: phase.goal,
      days: phase.days,
      steps: phase.steps.map((step) => ({
        id: step.id,
        title: step.title,
        detail: step.detail,
        cost: step.cost,
        costNote: step.costNote,
        hours: step.hours,
        materials: step.materials.map((m) => ({
          name: m.name,
          qty: m.qty,
          unit: m.unit,
          unitCost: m.unitCost,
          // So it knows not to argue with a price the owner set himself.
          ownerSet: m.provenance === "user" || undefined,
        })),
        suppliers: step.suppliers.map((s) => ({ name: s.name, what: s.what, where: s.where })),
        check: step.check,
        legal: step.legal,
      })),
    })),
  };
}

// POST /api/bible/chat
// Body: { message, plan, history?: Message[], homeBase?: HomeBase | null }
// Returns { reply, ops, why } — ops may legitimately be empty.
export async function POST(req: Request) {
  let body: { message?: string; plan?: Plan; history?: Message[]; homeBase?: HomeBase | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  const plan = body.plan;
  if (!message) return NextResponse.json({ error: "Say something first" }, { status: 400 });
  if (!plan?.phases?.length) {
    return NextResponse.json({ error: "Generate a plan before talking about it" }, { status: 400 });
  }

  if (!aiKey()) {
    return NextResponse.json(
      { error: "No AI provider is configured, so the agent cannot answer. Set OPENROUTER_API_KEY in .env.local." },
      { status: 503 },
    );
  }

  const currency = body.homeBase?.currency || "USD";
  const model = process.env.AI_MODEL || DEFAULT_MODEL;

  // The last few turns only. A long argument about materials does not need to
  // be re-read in full to answer "and in oak?", and the plan itself carries the
  // state that matters.
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-6)
    .map((m) => ({
      role: m.role === "agent" ? ("assistant" as const) : ("user" as const),
      content: (m.text ?? "").slice(0, 4000),
    }))
    .filter((m) => m.content);

  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CHAT_SYSTEM },
          { role: "user", content: `The plan as it stands:\n${JSON.stringify(planForModel(plan))}` },
          ...history,
          { role: "user", content: message },
        ],
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("bible/chat provider refused:", res.status, detail.slice(0, 400));
      return NextResponse.json({ error: `The AI provider refused this (${res.status}).` }, { status: 502 });
    }

    const json = await res.json();
    const parsed = JSON.parse(json?.choices?.[0]?.message?.content ?? "{}");
    const reply = typeof parsed?.reply === "string" ? parsed.reply.trim() : "";
    if (!reply) {
      return NextResponse.json(
        { error: "The answer came back empty. Nothing was changed — ask again." },
        { status: 502 },
      );
    }
    return NextResponse.json({
      reply,
      ops: cleanOps(parsed?.ops, currency),
      why: typeof parsed?.why === "string" ? parsed.why.slice(0, 400) : "",
    });
  } catch (err) {
    console.error("bible/chat failed:", err);
    return NextResponse.json(
      { error: "That took too long or the connection dropped. The plan is untouched." },
      { status: 502 },
    );
  }
}
