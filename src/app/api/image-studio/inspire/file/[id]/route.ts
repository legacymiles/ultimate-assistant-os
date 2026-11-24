import { caller, errorResponse, HttpError } from "@/lib/image-studio/inspire/server/access";
import { getImage, getImageBytes, safeId } from "@/lib/image-studio/inspire/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/image-studio/inspire/file/:id[?size=thumb]
// Streams the stored webp. Public images to anyone (cached a day); private
// ones only to their owner, never cached by a shared cache.
export async function GET(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    safeId(id);
    const img = await getImage(id);
    if (!img) throw new HttpError(404, "No such image.");
    if (img.visibility !== "public") {
      const who = await caller();
      if (!who || (who.id !== img.ownerId && !who.owner)) throw new HttpError(404, "No such image.");
    }
    const bytes = await getImageBytes(id, new URL(req.url).searchParams.get("size") === "thumb");
    if (!bytes) throw new HttpError(404, "The image file is missing.");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(bytes.length),
        "Cache-Control": img.visibility === "public" ? "public, max-age=86400, stale-while-revalidate=604800" : "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Bad id") return Response.json({ error: "No such image." }, { status: 404 });
    return errorResponse(err);
  }
}
