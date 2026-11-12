import { nanoid } from "nanoid";
import { fail, guardRate, requireUser } from "@/lib/buildflip-2/api";
import { STORAGE_BUCKET, capabilities } from "@/lib/buildflip-2/flags";
import { withLogging } from "@/lib/buildflip-2/log";
import { supabaseService } from "@/lib/buildflip-2/supabase/service";
import { MAX_IMAGE_BYTES, readJson, uploadInput } from "@/lib/buildflip-2/validate";

export const runtime = "nodejs";

/**
 * POST /api/upload — one reference photo at a time.
 *
 * The browser resizes and re-encodes every photo to WebP before it gets here
 * (P5), so a 12 MP camera file arrives as a few hundred KB. The server still
 * checks the real decoded byte length and the real magic bytes, because the
 * browser is never trusted (S4). Files land in a PRIVATE bucket under the
 * user's own id, and are only ever read through a short-lived signed URL.
 */
export const POST = withLogging("upload", async (req: Request) => {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  if (!capabilities().storage) {
    return fail(
      503,
      "Photo upload isn't connected on this deployment. Your description and a pasted link still work.",
      { demo: true },
    );
  }

  const limited = await guardRate(auth.ctx.user.id, "upload");
  if (limited) return limited;

  const parsed = await readJson(req, uploadInput, MAX_IMAGE_BYTES * 2);
  if (!parsed.ok) return fail(400, parsed.error);

  const match = parsed.data.dataUrl.match(/^data:(image\/(webp|jpeg|png));base64,(.+)$/);
  if (!match) return fail(400, "Only JPEG, PNG or WebP photos, please.");

  const declaredType = match[1]!;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[3]!, "base64");
  } catch {
    return fail(400, "That photo didn't arrive in one piece. Try picking it again.");
  }

  if (bytes.byteLength === 0) return fail(400, "That photo was empty.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return fail(
      413,
      `That photo is still ${(bytes.byteLength / 1_000_000).toFixed(1)} MB after resizing. Try a different one.`,
    );
  }

  // Check the real file signature, not the label the browser put on it.
  const sniffed = sniff(bytes);
  if (!sniffed) return fail(400, "That file isn't actually an image.");
  if (sniffed !== declaredType) {
    return fail(400, "That photo's type didn't match its contents.");
  }

  const ext = sniffed === "image/webp" ? "webp" : sniffed === "image/png" ? "png" : "jpg";
  const path = `${auth.ctx.user.id}/${nanoid(16)}.${ext}`;

  const sb = supabaseService()!;
  const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, bytes, {
    contentType: sniffed,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) {
    return fail(502, "We couldn't store that photo. Try again, or skip the photos.");
  }

  const { data: signed } = await sb.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, 3600);

  return Response.json({ path, previewUrl: signed?.signedUrl ?? null });
});

/** Real magic-byte sniffing. */
function sniff(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return "image/png";
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}
