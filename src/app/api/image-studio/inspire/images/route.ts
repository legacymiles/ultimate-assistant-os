import { searchGallery } from "@/lib/image-studio/inspire/discover";
import { extractChips } from "@/lib/image-studio/inspire/extract";
import { caller, errorResponse, HttpError, newId, readJson, requireUser, str } from "@/lib/image-studio/inspire/server/access";
import { visibleImages } from "@/lib/image-studio/inspire/server/gallery";
import { fileUrl, ingest } from "@/lib/image-studio/inspire/server/images";
import { putImage } from "@/lib/image-studio/inspire/server/store";
import * as v from "@/lib/image-studio/inspire/server/validate";
import type { ImageSource, InspireImage } from "@/lib/image-studio/inspire/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/image-studio/inspire/images?q=&category=&style=&subject=&sort=
// Public images (the starter set included) plus the caller's own private ones.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const who = await caller();
    const all = await visibleImages(who?.id ?? null);
    const scope = url.searchParams.get("scope");
    const pool = scope === "public" ? all.filter((i) => i.visibility === "public") : all;
    const images = searchGallery(pool, {
      q: url.searchParams.get("q") ?? "",
      category: url.searchParams.get("category") ?? "all",
      style: url.searchParams.get("style") ?? "all",
      subject: url.searchParams.get("subject") ?? "all",
      sort: url.searchParams.get("sort") === "oldest" ? "oldest" : "newest",
    });
    return Response.json({ images }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

const SOURCES: ImageSource[] = ["upload", "reverse", "reference"];

// POST /api/image-studio/inspire/images
// Body: { image: dataUrl, title, description, prompt, model, style, subject,
//         category, chips, visibility, source }
// Uploads an image to the caller's library, optionally publishing it.
export async function POST(req: Request) {
  try {
    const who = await requireUser("upload images");
    const body = await readJson(req);
    const dataUrl = typeof body.image === "string" ? body.image : "";
    if (!dataUrl) throw new HttpError(400, "Add an image first.");
    const source: ImageSource = SOURCES.includes(body.source as ImageSource) ? (body.source as ImageSource) : "upload";
    const visibility = source === "reference" ? "private" : v.visibility(body.visibility);
    const prompt = v.prompt(body.prompt);
    const title = str(body.title, 90);
    if (visibility === "public") {
      if (!title) throw new HttpError(400, "Give it a title before publishing.");
      if (!prompt) throw new HttpError(400, "Publishing shares the prompt behind the image — add it first.");
    }
    const id = newId("img");
    const stored = await ingest(id, dataUrl);
    const chips = v.chips(body.chips);
    const now = new Date().toISOString();
    const img: InspireImage = {
      id,
      ownerId: who.id,
      creator: str(body.creator, 40) || (who.local ? "you" : who.email.split("@")[0] || "creator"),
      title: title || (source === "reference" ? str(body.name, 90) || "Reference" : "Untitled"),
      description: str(body.description, 600),
      prompt,
      model: str(body.model, 60),
      style: v.style(body.style),
      subject: v.subject(body.subject),
      category: v.category(body.category),
      chips: chips.length ? chips : prompt ? extractChips(prompt) : [],
      visibility,
      source,
      width: stored.width,
      height: stored.height,
      src: fileUrl(id),
      thumb: fileUrl(id, true),
      tint: stored.tint,
      createdAt: now,
    };
    await putImage(img);
    return Response.json({ image: img });
  } catch (err) {
    return errorResponse(err);
  }
}
