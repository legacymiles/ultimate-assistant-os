import { errorResponse, HttpError, readJson, requireOwner, str } from "@/lib/image-studio/inspire/server/access";
import { deleteImage, getImage, listImages, putImage } from "@/lib/image-studio/inspire/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/image-studio/inspire/admin — the studio owner's moderation queue:
// every member-published image, newest first, with a few totals.
export async function GET() {
  try {
    await requireOwner();
    const images = (await listImages({ publicOnly: true, limit: 1000 })).filter((i) => i.source !== "seed");
    const creators = new Set(images.map((i) => i.ownerId)).size;
    const week = Date.now() - 7 * 86_400_000;
    return Response.json({
      images,
      totals: { published: images.length, creators, thisWeek: images.filter((i) => Date.parse(i.createdAt) > week).length },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/image-studio/inspire/admin  { id, action: "unpublish" | "delete" }
export async function POST(req: Request) {
  try {
    await requireOwner();
    const body = await readJson(req);
    const id = str(body.id, 80);
    const img = await getImage(id);
    if (!img) throw new HttpError(404, "That image is already gone.");
    if (body.action === "unpublish") {
      await putImage({ ...img, visibility: "private" });
      return Response.json({ ok: true });
    }
    if (body.action === "delete") {
      await deleteImage(id);
      return Response.json({ ok: true });
    }
    throw new HttpError(400, "Unknown moderation action.");
  } catch (err) {
    return errorResponse(err);
  }
}
