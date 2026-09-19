import { NextResponse } from "next/server";
import { DEFAULT_MODEL, aiConfigured, aiFetch } from "@/lib/ai/provider";
import { readJson } from "@/lib/smart-shot/plan/schema";
import { applyRevision, reviseSystem, reviseUser, type ChatTurn } from "@/lib/smart-shot/plan/revise";
import type { Brief, Plan, Upload } from "@/lib/smart-shot/types";
import { uid } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/smart-shot/revise
// Body: { brief, plan, uploads: [{ id, role, name, description }], history: [{ role, text }], message }
// Returns: { plan, totalSec, cutCount, reply } | { reply, unchanged: true }
//
// Uploads travel without their pixels — the reviser only needs their ids and
// roles to keep a character tied to its photo.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
  const plan = body.plan as Plan | undefined;
  const brief = body.brief as Brief | undefined;
  if (!message) return NextResponse.json({ error: "Say what to change." }, { status: 400 });
  if (!plan || !Array.isArray(plan.cuts) || !brief || typeof brief.prompt !== "string") {
    return NextResponse.json({ error: "Plan the storyboard first." }, { status: 400 });
  }
  const uploads: Upload[] = (Array.isArray(body.uploads) ? body.uploads : []).slice(0, 12).map((u: Record<string, unknown>) => ({
    id: String(u?.id ?? ""),
    role: (u?.role as Upload["role"]) ?? "character",
    name: String(u?.name ?? ""),
    description: String(u?.description ?? ""),
    dataUrl: "",
  }));
  const history: ChatTurn[] = (Array.isArray(body.history) ? body.history : [])
    .filter((t: Record<string, unknown>) => (t?.role === "user" || t?.role === "ai") && typeof t?.text === "string")
    .slice(-10) as ChatTurn[];

  if (!aiConfigured()) {
    return NextResponse.json({
      unchanged: true,
      reply: "AI editing needs an AI key (OPENROUTER_API_KEY). Until then, click any text on the sheet to edit it by hand.",
    });
  }

  try {
    const model = process.env.SMART_SHOT_MODEL || process.env.AI_MODEL || DEFAULT_MODEL;
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: reviseSystem() },
          { role: "user", content: reviseUser(plan, brief, history, message) },
        ],
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "");
    return NextResponse.json(applyRevision(readJson(text), plan, brief, uploads, uid));
  } catch (err) {
    console.error("[smart-shot] revise failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ unchanged: true, reply: `I couldn't apply that (${msg.slice(0, 140)}). The plan is unchanged — try again.` });
  }
}
