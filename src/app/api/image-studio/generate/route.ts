import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/ai/provider";
import { aspectRatio, extractResult, generationText, placeholderImage, userContent } from "@/lib/image-studio/prompt";
import { chat, parseBody } from "@/lib/image-studio/server";
import { drawFreeFirst, sizeForAspect } from "@/lib/images/server/draw";
import { handOffPicture } from "@/lib/images/server/handoff";
import { browserUid } from "@/lib/new-jarvis/server/requestsAuth";

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

  // The free lanes come first. When the owner's PC is on, WanGP draws this on
  // their own card with Flux 2 Klein — no key, no spend, no watermark — and
  // the paid model below is never reached. `purpose: "branded"` is deliberate:
  // these are pictures the owner keeps, so the watermarked public lane is not
  // offered for them, only the local one.
  //
  // This sits ABOVE the `aiConfigured()` check on purpose. With no keys at all
  // the hub used to fall back to a drawn placeholder; now it can return a real
  // picture instead, which is what R4 asks for.
  const free = await drawFreeFirst({
    prompt: generationText(agent, prompt, refs),
    purpose: "branded",
    ...sizeForAspect(aspectRatio(agent.aspect)),
    seed: variant,
    refs,
  });
  if (free) {
    return NextResponse.json({
      image: free.image,
      model: free.lane === "local" ? "wangp/flux2_klein_4b" : "free",
      lane: free.lane,
      note: free.note,
      free: true,
    });
  }

  if (!aiConfigured()) {
    // Nothing could draw it: the PC is asleep and there is no key. Rather
    // than handing back a drawn placeholder and calling it a day, the
    // picture becomes a 24/7 agent and gets drawn free on the owner's own
    // card the next time the laptop is open. The placeholder still comes
    // back so the screen has something to show in the meantime.
    const size = sizeForAspect(aspectRatio(agent.aspect));
    const uid = await browserUid();
    const handed = uid
      ? await handOffPicture({
          uid,
          prompt: generationText(agent, prompt, refs),
          width: size.width,
          height: size.height,
          app: "Image Studio",
        })
      : null;
    return NextResponse.json({
      image: placeholderImage(agent, prompt, variant),
      offline: true,
      model: "placeholder",
      ...(handed ? { agentId: handed.id, note: handed.note } : {}),
    });
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
