import { NextResponse } from "next/server";
import { AGENT_MODELS, runAgent, type AgentContext, type AgentModel, type ChatTurn } from "@/lib/gods-eye/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// POST /api/gods-eye/agent — one voice-agent turn.
// Body: { history: ChatTurn[], context: AgentContext, model: "std" | "mini" }
// Returns: { reply, actions } — the browser speaks the reply and applies the actions.
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  let body: { history?: ChatTurn[]; context?: AgentContext; model?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const history = (body.history ?? []).filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string");
  if (!history.length || history[history.length - 1].role !== "user" || !body.context?.view) {
    return NextResponse.json({ error: "Need a user message and the globe context" }, { status: 400 });
  }
  const model: AgentModel = body.model && body.model in AGENT_MODELS ? (body.model as AgentModel) : "std";
  try {
    return NextResponse.json(await runAgent(history, body.context, model));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Agent failed" }, { status: 502 });
  }
}
