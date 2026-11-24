import { errorResponse, HttpError, newId, readJson, requireUser, str } from "@/lib/image-studio/inspire/server/access";
import { listCollections, listLibrary, putLibraryItem, saveCollections } from "@/lib/image-studio/inspire/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 100;

// POST /api/image-studio/inspire/collections  { name }
export async function POST(req: Request) {
  try {
    const who = await requireUser("make collections");
    const name = str((await readJson(req)).name, 60);
    if (!name) throw new HttpError(400, "Name the collection.");
    const list = await listCollections(who.id);
    if (list.length >= MAX) throw new HttpError(400, `You can have up to ${MAX} collections.`);
    if (list.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, `You already have a collection called "${name}".`);
    const collection = { id: newId("col"), name, createdAt: new Date().toISOString() };
    await saveCollections(who.id, [...list, collection]);
    return Response.json({ collection });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/image-studio/inspire/collections  { id, name }
export async function PATCH(req: Request) {
  try {
    const who = await requireUser("rename collections");
    const body = await readJson(req);
    const id = str(body.id, 80);
    const name = str(body.name, 60);
    if (!name) throw new HttpError(400, "Name the collection.");
    const list = await listCollections(who.id);
    if (!list.some((c) => c.id === id)) throw new HttpError(404, "That collection isn't yours.");
    if (list.some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, `You already have a collection called "${name}".`);
    const next = list.map((c) => (c.id === id ? { ...c, name } : c));
    await saveCollections(who.id, next);
    return Response.json({ collection: next.find((c) => c.id === id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/image-studio/inspire/collections?id=…
// Deletes the folder only. Everything in it stays in the library.
export async function DELETE(req: Request) {
  try {
    const who = await requireUser("delete collections");
    const id = str(new URL(req.url).searchParams.get("id"), 80);
    const list = await listCollections(who.id);
    if (!list.some((c) => c.id === id)) return Response.json({ ok: true });
    const items = await listLibrary(who.id);
    await Promise.all(
      items
        .filter((i) => i.collectionIds.includes(id))
        .map((i) => putLibraryItem(who.id, { ...i, collectionIds: i.collectionIds.filter((c) => c !== id) })),
    );
    await saveCollections(
      who.id,
      list.filter((c) => c.id !== id),
      [id],
    );
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
