import { aiConfigured } from "@/lib/ai/provider";
import { DEFAULT_IMAGE_MODEL } from "@/lib/image-studio/agents";
import { extractResult, type Part } from "@/lib/image-studio/prompt";
import { chat } from "@/lib/image-studio/server";
import { assemble } from "@/lib/image-studio/inspire/assemble";
import { errorResponse, HttpError, newId, readJson, str } from "@/lib/image-studio/inspire/server/access";
import { fileUrl, ingest } from "@/lib/image-studio/inspire/server/images";
import { spendGate } from "@/lib/image-studio/inspire/server/quota";
import { putImage } from "@/lib/image-studio/inspire/server/store";
import * as v from "@/lib/image-studio/inspire/server/validate";
import { drawFreeFirst } from "@/lib/images/server/draw";
import type { InspireImage, ReferencePurpose } from "@/lib/image-studio/inspire/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_REFS = 6;

// POST /api/image-studio/inspire/generate
// Body: { chips, freeText?, override?, deliverable, refs: [{ dataUrl, purpose, name, imageId? }],
//         variant, history?: string[], category?, style?, subject? }
// Returns: { image: InspireImage, lane } | { error }
//
// ONE image per request (a generated PNG is 1–2 MB; several would pass the
// response limit). The prompt is assembled HERE from the chips, so the
// technical layer the person never sees is applied the same way every time.
//
// Lanes, cheapest first: the owner's own PC (WanGP + Flux 2 Klein, free),
// then the paid image model through the hub's provider. References need the
// paid lane — WanGP's reference path is not wired (src/lib/images/server/draw.ts).
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const chips = v.chips(body.chips, 40);
    const deliverable = str(body.deliverable, 20) || "custom";
    const rawRefs = Array.isArray(body.refs) ? (body.refs as Record<string, unknown>[]) : [];
    if (rawRefs.length > MAX_REFS) throw new HttpError(400, `Use up to ${MAX_REFS} reference images.`);
    const refs = rawRefs
      .map((r) => ({ dataUrl: typeof r?.dataUrl === "string" ? r.dataUrl : "", purpose: v.purpose(r?.purpose) as ReferencePurpose, name: str(r?.name, 80), imageId: str(r?.imageId, 80) || undefined }))
      .filter((r) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(r.dataUrl));
    const a = assemble({ chips, freeText: str(body.freeText, 1000), override: v.prompt(body.override) || null, deliverable, refs });
    if (!a.visible) throw new HttpError(400, "Add some ingredients or write a prompt first.");
    const variant = Math.max(0, Math.min(16, Number(body.variant) || 0));

    const gate = await spendGate("generate");
    const size = { width: a.deliverable.width, height: a.deliverable.height };

    let image: string | null = null;
    let lane = "";
    const free = await drawFreeFirst({ prompt: a.final, purpose: "branded", ...size, seed: Date.now() % 100000 + variant, refs: refs.map((r) => r.dataUrl) });
    if (free) {
      image = free.image;
      lane = free.lane === "local" ? "Flux 2 Klein on your PC" : "free lane";
    } else if (aiConfigured()) {
      const model = process.env.IMAGE_STUDIO_INSPIRE_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
      const content: Part[] = [
        { type: "text", text: a.final + (variant ? `\n\n(Variation ${variant + 1}: a distinct take on the same brief.)` : "") },
        ...refs.flatMap((r) => [
          { type: "text" as const, text: `Reference image — ${r.purpose}: ${r.name || "reference"}` },
          { type: "image_url" as const, image_url: { url: r.dataUrl } },
        ]),
      ];
      const json = await chat(model, [{ role: "user", content }], { modalities: ["image", "text"], image_config: { aspect_ratio: a.deliverable.aspect } }, 200_000);
      const out = extractResult(json);
      if (!out.image) throw new HttpError(422, out.text || "The image model returned no image. It may have declined this prompt — try rewording it.");
      image = out.image;
      lane = model;
      await gate.charge();
    } else {
      throw new HttpError(
        503,
        refs.length
          ? "Reference images need the AI image model, and no AI key is set. Remove the references to draw free on your PC, or add OPENROUTER_API_KEY."
          : "Nothing can draw right now: the PC drawer (WanGP in Pinokio) isn't running and no AI key is set. Start WanGP, or add OPENROUTER_API_KEY.",
      );
    }

    const id = newId("gen");
    const stored = await ingest(id, image);
    const history = Array.isArray(body.history) ? (body.history as unknown[]).filter((h): h is string => typeof h === "string").map((h) => h.slice(0, 4000)).slice(0, 10) : [];
    const img: InspireImage = {
      id,
      ownerId: gate.who.id,
      creator: gate.who.local ? "you" : gate.who.email.split("@")[0] || "creator",
      title: str(body.title, 90) || a.visible.slice(0, 60),
      description: "",
      prompt: a.visible,
      model: lane,
      style: v.style(body.style),
      subject: v.subject(body.subject),
      category: v.category(body.category),
      chips,
      visibility: "private",
      source: "generated",
      width: stored.width,
      height: stored.height,
      src: fileUrl(id),
      thumb: fileUrl(id, true),
      tint: stored.tint,
      createdAt: new Date().toISOString(),
      generation: {
        deliverable: a.deliverable.id,
        chips,
        visiblePrompt: a.visible,
        technicalPrompt: a.technical.join("; "),
        references: refs.map((r) => ({ purpose: r.purpose, name: r.name, ...(r.imageId ? { imageId: r.imageId } : {}) })),
        settings: { aspect: a.deliverable.aspect, ...size, variant },
        lane,
        history,
      },
    };
    await putImage(img);
    return Response.json({ image: img, lane });
  } catch (err) {
    if (err instanceof Error && /timeout|aborted/i.test(err.message)) {
      return Response.json({ error: "The image model took too long. Try again." }, { status: 504 });
    }
    // A provider failure arrives as "402: {json}". Say what happened in a line.
    const m = err instanceof Error ? /^(\d{3}): ([\s\S]*)$/.exec(err.message) : null;
    if (m) {
      console.error("[inspire] image model failed:", err);
      let detail = m[2];
      try {
        const j = JSON.parse(detail) as { error?: { message?: string } | string };
        detail = typeof j.error === "string" ? j.error : (j.error?.message ?? detail);
      } catch {
        /* not JSON */
      }
      const credit = /credit|balance|402/i.test(detail);
      return Response.json(
        {
          error: credit
            ? "The paid image model is out of credit, and the free PC drawer (WanGP) didn't answer. Start WanGP in Pinokio to draw free, or top up OpenRouter."
            : `The image model couldn't draw this (${detail.replace(/\s+/g, " ").slice(0, 160)}).`,
        },
        { status: 502 },
      );
    }
    return errorResponse(err);
  }
}
