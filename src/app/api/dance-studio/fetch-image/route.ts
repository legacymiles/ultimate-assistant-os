// POST /api/dance-studio/fetch-image  { url } → the image bytes
//
// For adding a character picture without a file picker (embedded browsers
// that can't open one, or an image that lives online). Accepts a direct image
// link or a page/post link, in which case the page's og:image is used. The
// browser then prepares the bytes exactly like an uploaded file.

import { NextResponse } from "next/server";

import { fail, readJson, requireUid } from "@/lib/dance-studio/server/http";
import { metaTags } from "@/lib/social-import/jsonld";
import { parseLink } from "@/lib/social-import/platform";
import { BlockedUrlError, assertPublic, fetchBytes, fetchText } from "@/lib/social-import/safeFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;

function looksLikeImage(bytes: Buffer, type: string): boolean {
  if (type.startsWith("image/")) return true;
  const head = bytes.subarray(0, 12);
  return (
    (head[0] === 0xff && head[1] === 0xd8) || // jpeg
    head.subarray(1, 4).toString("latin1") === "PNG" ||
    head.subarray(8, 12).toString("latin1") === "WEBP" ||
    /^ftyp(heic|heix|mif1|avif)/.test(head.subarray(4, 12).toString("latin1"))
  );
}

export async function POST(req: Request) {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;
  const link = parseLink(String((await readJson<{ url?: string }>(req))?.url ?? ""));
  if (!link) return fail("Paste a link to an image.");
  try {
    await assertPublic(link.url);
  } catch (err) {
    return fail(err instanceof BlockedUrlError ? err.message : "That link can't be reached.");
  }

  let got = await fetchBytes(link.url.href, { maxBytes: MAX_BYTES, accept: "image/*,text/html;q=0.8" });
  if (got && !looksLikeImage(got.bytes, got.type) && got.type.includes("html")) {
    // A page or post link: use the picture it advertises.
    const meta = metaTags(got.bytes.toString("utf8"));
    const og = meta["og:image:secure_url"] ?? meta["og:image"] ?? meta["twitter:image"];
    got = og ? await fetchBytes(new URL(og, link.url).href, { maxBytes: MAX_BYTES, accept: "image/*" }) : null;
  } else if (!got) {
    const html = await fetchText(link.url.href);
    const og = html ? metaTags(html)["og:image"] : undefined;
    got = og ? await fetchBytes(new URL(og, link.url).href, { maxBytes: MAX_BYTES, accept: "image/*" }) : null;
  }

  if (!got || !looksLikeImage(got.bytes, got.type)) {
    return fail("Couldn't get an image from that link. Use a direct image link (ending in .jpg, .png…), or copy the image and paste it here.", 422);
  }
  return new Response(new Uint8Array(got.bytes), {
    headers: { "content-type": got.type.startsWith("image/") ? got.type : "application/octet-stream", "cache-control": "no-store" },
  });
}
