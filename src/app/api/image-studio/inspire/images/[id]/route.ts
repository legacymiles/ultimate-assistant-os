import { relatedImages, type Facet } from "@/lib/image-studio/inspire/discover";
import { caller, errorResponse, HttpError, readJson, requireUser, str } from "@/lib/image-studio/inspire/server/access";
import { visibleImage, visibleImages } from "@/lib/image-studio/inspire/server/gallery";
import { isSeedId } from "@/lib/image-studio/inspire/server/images";
import { deleteImage, getImage, putImage } from "@/lib/image-studio/inspire/server/store";
import * as v from "@/lib/image-studio/inspire/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const FACETS: Facet[] = ["all", "style", "lighting", "composition", "texture", "color", "mood"];

// GET /api/image-studio/inspire/images/:id?facet=lighting
// The image, plus images that share its visual DNA (Style Discovery).
export async function GET(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const who = await caller();
    const img = await visibleImage(id, who?.id ?? null, !!who?.owner);
    if (!img) throw new HttpError(404, "That image isn't here any more, or it's private.");
    const f = new URL(req.url).searchParams.get("facet") as Facet;
    const facet = FACETS.includes(f) ? f : "all";
    const pool = (await visibleImages(who?.id ?? null)).filter((i) => i.visibility === "public");
    return Response.json({ image: img, related: relatedImages(img, pool, facet, 12), mine: !!who && img.ownerId === who.id });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/image-studio/inspire/images/:id
// The creator edits details, chips or visibility. The original prompt is
// immutable once the image is public; an AI rewrite goes to enhancedPrompt.
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const who = await requireUser("edit images");
    if (isSeedId(id)) throw new HttpError(403, "Starter images can't be edited.");
    const img = await getImage(id);
    if (!img || img.ownerId !== who.id) throw new HttpError(404, "That image isn't yours to edit.");
    const body = await readJson(req);
    const next = { ...img };
    if ("title" in body) next.title = str(body.title, 90) || img.title;
    if ("description" in body) next.description = str(body.description, 600);
    if ("model" in body) next.model = str(body.model, 60);
    if ("style" in body) next.style = v.style(body.style);
    if ("subject" in body) next.subject = v.subject(body.subject);
    if ("category" in body) next.category = v.category(body.category, img.category);
    if ("chips" in body) next.chips = v.chips(body.chips);
    if ("creator" in body) next.creator = str(body.creator, 40) || img.creator;
    if ("enhancedPrompt" in body) next.enhancedPrompt = v.prompt(body.enhancedPrompt) || undefined;
    if ("prompt" in body) {
      if (img.visibility === "public") throw new HttpError(409, "A published prompt stays exactly as it was shared. Unpublish it first to change it.");
      next.prompt = v.prompt(body.prompt);
    }
    if ("visibility" in body) {
      next.visibility = img.source === "reference" ? "private" : v.visibility(body.visibility);
      if (next.visibility === "public") {
        if (!next.prompt) throw new HttpError(400, "Publishing shares the prompt behind the image — add it first.");
        if (!next.title || next.title === "Untitled") throw new HttpError(400, "Give it a title before publishing.");
      }
    }
    await putImage(next);
    return Response.json({ image: next });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/image-studio/inspire/images/:id — the creator, or the studio owner moderating.
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const who = await requireUser("delete images");
    if (isSeedId(id)) throw new HttpError(403, "Starter images can't be deleted.");
    const img = await getImage(id);
    if (!img) return Response.json({ ok: true });
    if (img.ownerId !== who.id && !who.owner) throw new HttpError(403, "That image isn't yours to delete.");
    await deleteImage(id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
