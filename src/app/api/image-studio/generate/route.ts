import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/ai/provider";
import { aspectRatio, extractResult, generationText, placeholderImage, userContent } from "@/lib/image-studio/prompt";
import { chat, parseBody } from "@/lib/image-studio/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/image-studio/generate
// Body: { agentId, prompt, refs: [{ role, dataUrl }], variant? }
// Returns: { image, model } | { refusal } | { image, offline: true } | { error }
//
// ONE image per request. A generated PNG is 1–2 MB of base64, so four in one
// response would pass Vercel's 4.5 MB response limit; the client runs the
// variations as parallel requests instead.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = parseBody(body);
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  const { agent, prompt, refs } = parsed;
  const variant = Number((body as { variant?: unknown }).variant) || 0;

  if (!aiConfigured()) {
    return NextResponse.json({ image: placeholderImage(agent, prompt, variant), offline: true, model: "placeholder" });
  }

  try {
    const json = await chat(
      agent.model,
      [{ role: "user", content: userContent(generationText(agent, prompt, refs), refs) }],
      { modalities: ["image", "text"], image_config: { aspect_ratio: aspectRatio(agent.aspect) } },
      110_000,
    );
    const { image, text } = extractResult(json);
    if (image) return NextResponse.json({ image, model: agent.model });
    return NextResponse.json({
      refusal: text || "The image model returned no image. It may have declined this prompt.",
    });
  } catch (err) {
    console.error("[image-studio] generate failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = /timeout|aborted/i.test(message);
    return NextResponse.json(
      { error: timedOut ? "The image model took too long. Try again." : `Image generation failed (${message.slice(0, 160)}).` },
      { status: 502 },
    );
  }
}
