import { caller, errorResponse, HttpError, newId, readJson, requireUser, str } from "@/lib/image-studio/inspire/server/access";
import { visibleImage } from "@/lib/image-studio/inspire/server/gallery";
import { deleteImage, deleteLibraryItem, getImage, getLibraryItem, listCollections, listLibrary, listOwnImages, putLibraryItem } from "@/lib/image-studio/inspire/server/store";
import * as v from "@/lib/image-studio/inspire/server/validate";
import type { InspireImage, LibraryItem, PromptOrigin } from "@/lib/image-studio/inspire/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGINS: PromptOrigin[] = ["saved", "reverse", "remix", "builder", "enhanced"];

// GET /api/image-studio/inspire/library
// Everything in the caller's private workspace: saved items, collections,
// their own images (uploads, generations, references), and every image a
// saved item points at — resolved, so a saved public image keeps its
// original creator and prompt exactly.
export async function GET() {
  try {
    const who = await caller();
    if (!who) return Response.json({ signedIn: false, items: [], collections: [], ownImages: [], images: {} });
    const [items, collections, ownImages] = await Promise.all([listLibrary(who.id), listCollections(who.id), listOwnImages(who.id)]);
    const images: Record<string, InspireImage> = {};
    for (const img of ownImages) images[img.id] = img;
    const wanted = new Set(items.flatMap((i) => ("imageId" in i && i.imageId ? [i.imageId] : [])));
    await Promise.all(
      [...wanted]
        .filter((id) => !images[id])
        .map(async (id) => {
          const img = await visibleImage(id, who.id).catch(() => null);
          if (img) images[id] = img;
        }),
    );
    return Response.json({ signedIn: true, items, collections, ownImages, images }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

async function validCollections(userId: string, raw: unknown): Promise<string[]> {
  if (!Array.isArray(raw)) return [];
  const mine = new Set((await listCollections(userId)).map((c) => c.id));
  return [...new Set(raw.filter((x): x is string => typeof x === "string" && mine.has(x)))];
}

// POST /api/image-studio/inspire/library — save one item.
// { kind: "image", imageId } · { kind: "prompt", title, text, chips, origin, imageId? }
// { kind: "chip", chip, favorite?, custom? } · { kind: "reference", imageId, purpose, name }
export async function POST(req: Request) {
  try {
    const who = await requireUser("save to your library");
    const body = await readJson(req);
    const now = new Date().toISOString();
    const collectionIds = await validCollections(who.id, body.collectionIds);
    const base = { id: newId("lib"), collectionIds, createdAt: now, updatedAt: now };
    let item: LibraryItem;

    if (body.kind === "image" || body.kind === "reference") {
      const imageId = str(body.imageId, 80);
      const img = imageId ? await visibleImage(imageId, who.id) : null;
      if (!img) throw new HttpError(404, "That image isn't available to save.");
      const existing = (await listLibrary(who.id)).find((i) => i.kind === body.kind && "imageId" in i && i.imageId === imageId);
      if (existing && body.kind === "image") {
        // Saving twice adds the collections instead of a duplicate.
        const merged = { ...existing, collectionIds: [...new Set([...existing.collectionIds, ...collectionIds])], updatedAt: now };
        await putLibraryItem(who.id, merged);
        return Response.json({ item: merged, existed: true });
      }
      item =
        body.kind === "image"
          ? { ...base, kind: "image", imageId }
          : { ...base, kind: "reference", imageId, purpose: v.purpose(body.purpose), name: str(body.name, 80) || img.title };
    } else if (body.kind === "prompt") {
      const text = v.prompt(body.text);
      if (!text) throw new HttpError(400, "There's no prompt to save.");
      const origin = ORIGINS.includes(body.origin as PromptOrigin) ? (body.origin as PromptOrigin) : "saved";
      const imageId = str(body.imageId, 80) || undefined;
      item = {
        ...base,
        kind: "prompt",
        title: str(body.title, 90) || text.slice(0, 60),
        text,
        chips: v.chips(body.chips),
        origin,
        ...(imageId ? { imageId } : {}),
        versions: [],
      };
    } else if (body.kind === "chip") {
      const [chip] = v.chips([body.chip]);
      if (!chip) throw new HttpError(400, "That chip is empty.");
      const all = await listLibrary(who.id);
      const existing = all.find((i) => i.kind === "chip" && i.chip.text.toLowerCase() === chip.text.toLowerCase());
      if (existing && existing.kind === "chip") {
        const merged = {
          ...existing,
          favorite: existing.favorite || body.favorite === true,
          collectionIds: [...new Set([...existing.collectionIds, ...collectionIds])],
          updatedAt: now,
        };
        await putLibraryItem(who.id, merged);
        return Response.json({ item: merged, existed: true });
      }
      item = { ...base, kind: "chip", chip, favorite: body.favorite === true, custom: body.custom === true };
    } else {
      throw new HttpError(400, "Unknown kind of item.");
    }
    await putLibraryItem(who.id, item);
    return Response.json({ item });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/image-studio/inspire/library
// { id, collectionIds?, title?, text?, chips?, favorite?, purpose?, name?, versionNote? }
// Changing a prompt's text keeps the old wording as a version.
export async function PATCH(req: Request) {
  try {
    const who = await requireUser("edit your library");
    const body = await readJson(req);
    const item = await getLibraryItem(who.id, str(body.id, 80));
    if (!item) throw new HttpError(404, "That item isn't in your library.");
    const now = new Date().toISOString();
    const next = { ...item, updatedAt: now } as LibraryItem;
    if ("collectionIds" in body) next.collectionIds = await validCollections(who.id, body.collectionIds);
    if (next.kind === "prompt") {
      if ("title" in body) next.title = str(body.title, 90) || next.title;
      if ("chips" in body) next.chips = v.chips(body.chips);
      if ("text" in body) {
        const text = v.prompt(body.text);
        if (text && text !== next.text) {
          next.versions = [{ text: next.text, at: next.updatedAt, note: str(body.versionNote, 80) || undefined }, ...next.versions].slice(0, 30);
          next.text = text;
        }
      }
    }
    if (next.kind === "chip") {
      if ("favorite" in body) next.favorite = body.favorite === true;
      if ("chip" in body) {
        const [chip] = v.chips([body.chip]);
        if (chip) next.chip = chip;
      }
    }
    if (next.kind === "reference") {
      if ("purpose" in body) next.purpose = v.purpose(body.purpose);
      if ("name" in body) next.name = str(body.name, 80) || next.name;
    }
    await putLibraryItem(who.id, next);
    return Response.json({ item: next });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/image-studio/inspire/library?id=…
// Removes a saved item. A reference also removes its private image file.
export async function DELETE(req: Request) {
  try {
    const who = await requireUser("edit your library");
    const id = str(new URL(req.url).searchParams.get("id"), 80);
    const item = await getLibraryItem(who.id, id);
    if (item?.kind === "reference") {
      const img = await getImage(item.imageId);
      if (img && img.ownerId === who.id && img.source === "reference") await deleteImage(img.id);
    }
    if (item) await deleteLibraryItem(who.id, id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
