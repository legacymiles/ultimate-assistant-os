import { NextResponse } from "next/server";
import type { GenerateResult } from "@/lib/seedance/types";

export const runtime = "nodejs";
// Video generation is long-running; allow the platform max.
export const maxDuration = 300;

interface GenerateBody {
  stage?: string;
  prompt?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  durationSec?: number;
  image?: string | null;
  moodHue?: number;
}

// POST /api/seedance  { stage: "generate", prompt, aspectRatio, durationSec, image?, moodHue }
// Renders one clip with Seedance 2.0 via the Vercel AI Gateway when
// AI_GATEWAY_API_KEY is set; otherwise returns a deterministic placeholder so
// the editor is fully usable offline.
export async function POST(req: Request) {
  let body: GenerateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (body.stage !== "generate") {
    return NextResponse.json({ error: "unknown stage" }, { status: 400 });
  }

  const hue = clampHue(body.moodHue);
  const placeholder: GenerateResult = { status: "done", engine: "placeholder", posterHue: hue };

  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    // Simulate a short render so the UI's "generating" state is visible.
    await sleep(900);
    return NextResponse.json(placeholder);
  }

  try {
    const dataUrl = await renderWithSeedance(body, apiKey);
    return NextResponse.json({ status: "done", engine: "seedance", videoUrl: dataUrl });
  } catch (err) {
    console.error("Seedance render failed, using placeholder:", err);
    return NextResponse.json(placeholder);
  }
}

async function renderWithSeedance(body: GenerateBody, apiKey: string): Promise<string> {
  // Dynamic import so the placeholder path never needs the AI SDK loaded, and a
  // missing dependency degrades gracefully rather than crashing the route.
  const { experimental_generateVideo: generateVideo } = await import("ai");

  const model = process.env.AI_VIDEO_MODEL || "bytedance/seedance-2.0";
  const duration = clampDuration(body.durationSec);
  const text = (body.prompt ?? "").trim() || "A cinematic moment";

  // Image-to-video when a reference image was supplied, else text-to-video.
  const prompt = body.image ? { image: body.image, text } : text;

  const result = await generateVideo({
    // The AI Gateway resolves bare "provider/model" strings using AI_GATEWAY_API_KEY.
    model,
    prompt: prompt as never,
    aspectRatio: (body.aspectRatio ?? "16:9") as never,
    duration,
  });

  const first = result.videos?.[0] as { uint8Array?: Uint8Array; base64?: string } | undefined;
  if (first?.base64) return `data:video/mp4;base64,${first.base64}`;
  if (first?.uint8Array) {
    const base64 = Buffer.from(first.uint8Array).toString("base64");
    return `data:video/mp4;base64,${base64}`;
  }
  throw new Error("No video returned from Seedance");
}

function clampDuration(d: number | undefined): number {
  if (typeof d !== "number" || !Number.isFinite(d)) return 5;
  return Math.min(10, Math.max(5, Math.round(d)));
}

function clampHue(h: number | undefined): number {
  if (typeof h !== "number" || !Number.isFinite(h)) return 195;
  return ((Math.round(h) % 360) + 360) % 360;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
