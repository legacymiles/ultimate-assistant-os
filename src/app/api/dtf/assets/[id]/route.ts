import { caller, errorResponse, HttpError } from "@/lib/dtf/server/access";
import { assetBytes, assetSignedUrl, getAsset } from "@/lib/dtf/server/store";

export const dynamic = "force-dynamic";

/**
 * Serve one stored file to the customer who owns it, or to the shop owner.
 * Nobody else — not by guessing an id, not by sharing a link.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const who = await caller();
    if (!who) throw new HttpError(401, "Sign in to view this file.");
    const asset = await getAsset(id).catch(() => null);
    if (!asset || (asset.userId !== who.id && !who.owner)) throw new HttpError(404, "File not found.");
    // Cloud storage: hand the browser a short-lived direct link instead of
    // streaming the bytes through a function (bodies over 4.5 MB fail there).
    // An SVG is served through the route instead so its sandbox header holds.
    if (asset.mime !== "image/svg+xml") {
      const signed = await assetSignedUrl(asset, 3600);
      if (signed) return Response.redirect(signed, 302);
    }
    const bytes = await assetBytes(asset);
    if (!bytes) throw new HttpError(404, "File not found.");
    const headers: Record<string, string> = {
      "Content-Type": asset.mime,
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(bytes.byteLength),
    };
    // An SVG is a document. Opened directly it must not be able to run anything.
    if (asset.mime === "image/svg+xml") headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    return new Response(new Uint8Array(bytes), { headers });
  } catch (e) {
    return errorResponse(e);
  }
}
