import { NextResponse } from "next/server";
import { aiConfigured, aiKey, aiUrl } from "@/lib/ai/provider";
import { placeholderPanel } from "@/lib/smart-shot/placeholder";
import type { PanelKind } from "@/lib/smart-shot/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const KINDS: PanelKind[] = ["character", "product", "environment", "floorplan", "elevation", "cut", "lighting"];
const ASPECTS = new Set(["16:9", "9:16", "1:1", "3:4", "4:3"]);

// POST /api/smart-shot/panel
// Body: { kind, prompt, aspect, refs: [{ role, label, dataUrl }], caption }
// Returns: { image } | { image, placeholder: true } | { refusal } | { error }
//
// ONE image per request: a generated PNG is 1–2 MB of base64 and Vercel caps
// a response at 4.5 MB, so the client draws the sheet as parallel requests.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const kind = KINDS.includes(body.kind as PanelKind) ? (body.kind as PanelKind) : null;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const aspect = ASPECTS.has(String(body.aspect)) ? String(body.aspect) : "16:9";
  const caption = typeof body.caption === "string" ? body.caption.slice(0, 200) : "";
  if (!kind || !prompt) return NextResponse.json({ error: "kind and prompt required" }, { status: 400 });
  const refs = (Array.isArray(body.refs) ? body.refs : [])
    .map((r) => (r as { dataUrl?: unknown })?.dataUrl)
    .filter((u): u is string => typeof u === "string" && u.startsWith("data:image/"))
    .slice(0, 8);

  if (!aiConfigured()) {
    return NextResponse.json({ image: placeholderPanel(kind, aspect, caption), placeholder: true });
  }

  const model = process.env.SMART_SHOT_IMAGE_MODEL || "google/gemini-3.1-flash-image";
  try {
    const res = await fetch(aiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${aiKey()}` },
      body: JSON.stringify({
        model,
        modalities: ["image", "text"],
        image_config: { aspect_ratio: aspect },
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }, ...refs.map((url) => ({ type: "image_url", image_url: { url } }))],
          },
        ],
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    const message = json?.choices?.[0]?.message ?? {};
    let image: string | null = null;
    for (const im of Array.isArray(message.images) ? message.images : []) {
      const url = im?.image_url?.url;
      if (typeof url === "string" && url) {
        image = url;
        break;
      }
    }
    if (!image && Array.isArray(message.content)) {
      for (const part of message.content) {
        const url = part?.image_url?.url;
        if (part?.type === "image_url" && typeof url === "string") {
          image = url;
          break;
        }
      }
    }
    if (image) return NextResponse.json({ image, model });
    const text = typeof message.content === "string" ? message.content : "";
    return NextResponse.json({ refusal: text.slice(0, 300) || "The image model returned no image for this panel." });
  } catch (err) {
    console.error("[smart-shot] panel failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = /timeout|aborted/i.test(message);
    return NextResponse.json(
      { error: timedOut ? "The image model took too long. Redraw this panel." : `Drawing failed (${message.slice(0, 160)}).` },
      { status: 502 },
    );
  }
}
