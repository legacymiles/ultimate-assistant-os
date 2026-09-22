import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/ai/provider";
import { DEFAULT_IMAGE_MODEL } from "@/lib/image-studio/agents";
import { extractResult, userContent } from "@/lib/image-studio/prompt";
import { chat } from "@/lib/image-studio/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/studio/image — one image for a Studio skill's approved prompt.
// Body: { prompt, aspectRatio?, refs?: dataUrl[] }
// Returns: { image, model } | { refusal } | { error }
//
// ONE image per request (a generated PNG is 1–2 MB of base64; several would
// pass Vercel's 4.5 MB response limit). The browser runs a set in parallel.

const ASPECTS = ["1:1", "4:5", "3:4", "2:3", "9:16", "16:9", "3:2", "4:3", "21:9"];
const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

export async function POST(req: Request) {
  let body: { prompt?: unknown; aspectRatio?: unknown; refs?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 6000) : "";
  if (!prompt) return NextResponse.json({ error: "A prompt is required." }, { status: 400 });
  const aspect = typeof body.aspectRatio === "string" && ASPECTS.includes(body.aspectRatio) ? body.aspectRatio : "1:1";
  // Each ref is { label: "Subject 3", dataUrl } — the label is the number the prompt uses.
  const refs = (Array.isArray(body.refs) ? body.refs : [])
    .map((r) => (r ?? {}) as { label?: unknown; dataUrl?: unknown })
    .filter((r) => typeof r.dataUrl === "string" && r.dataUrl.length < 2_000_000 && DATA_URL.test(r.dataUrl))
    .slice(0, 6)
    .map((r, i) => ({
      role: "person" as const,
      dataUrl: r.dataUrl as string,
      label: typeof r.label === "string" && /^Subject \d+$/.test(r.label) ? r.label : `Subject ${i + 1}`,
    }));

  if (!aiConfigured()) {
    return NextResponse.json({ error: "No AI key is set on this deployment, so nothing can be rendered." }, { status: 503 });
  }

  const guide = refs.length
    ? `\n\nAttached reference images, in order: ${refs.map((r, i) => `image ${i + 1} = ${r.label}`).join(", ")}. Keep every subject's identity, features and product details exactly as in their reference.`
    : "";

  try {
    const json = await chat(
      DEFAULT_IMAGE_MODEL,
      [{ role: "user", content: userContent(`${prompt}${guide}`, refs.map(({ role, dataUrl }) => ({ role, dataUrl }))) }],
      { modalities: ["image", "text"], image_config: { aspect_ratio: aspect } },
      110_000,
    );
    const { image, text } = extractResult(json);
    if (image) return NextResponse.json({ image, model: DEFAULT_IMAGE_MODEL });
    return NextResponse.json({ refusal: text || "The image model returned no image. It may have declined this prompt." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: /timeout|aborted/i.test(message) ? "The image model took too long. Try again." : `Image generation failed (${message.slice(0, 160)}).` },
      { status: 502 },
    );
  }
}
