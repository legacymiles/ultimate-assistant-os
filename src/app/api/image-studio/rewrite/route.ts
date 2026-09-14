import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/ai/provider";
import { REWRITE_MODEL } from "@/lib/image-studio/agents";
import { cleanRewrite, extractResult, fallbackPrompt, rewriteSystem, rewriteUser } from "@/lib/image-studio/prompt";
import { chat, parseBody } from "@/lib/image-studio/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/image-studio/rewrite
// Body: { agentId, prompt, refs: [{ role, dataUrl }], soften? }
// Returns: { prompt, offline?, warning? }
//
// The agent's brief turns a short request into a detailed image prompt. With
// no key, or when the model fails, the raw prompt plus the agent's style block
// comes back instead, so Generate always has something to work with.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = parseBody(body);
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  const { agent, prompt, refs, soften } = parsed;

  if (!aiConfigured()) return NextResponse.json({ prompt: fallbackPrompt(agent, prompt), offline: true });

  try {
    const json = await chat(
      process.env.IMAGE_STUDIO_REWRITE_MODEL || REWRITE_MODEL,
      [
        { role: "system", content: rewriteSystem(agent, soften) },
        { role: "user", content: rewriteUser(prompt, refs) },
      ],
      { temperature: 0.8, max_tokens: 1200 },
    );
    const text = cleanRewrite(extractResult(json).text);
    if (text.length < 20) throw new Error("empty rewrite");
    return NextResponse.json({ prompt: text });
  } catch (err) {
    console.error("[image-studio] rewrite failed:", err);
    return NextResponse.json({
      prompt: fallbackPrompt(agent, prompt),
      warning: "The rewrite model didn't answer, so the agent's style was added to your prompt instead.",
    });
  }
}
