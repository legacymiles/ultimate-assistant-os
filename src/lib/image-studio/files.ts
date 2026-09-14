// ---------------------------------------------------------------------------
// Image Studio — deciding which added files are usable reference photos.
//
// Pure, so it can be tested without a browser. The rule is permissive on
// purpose: Windows pickers and some phone share sheets hand over real photos
// with an EMPTY MIME type, and silently dropping those made uploads look
// broken. Anything that might be an image is accepted here and the decoder
// gets the final say, with a visible error if it can't read the file.
// ---------------------------------------------------------------------------

const IMAGE_EXT = /\.(jpe?g|jfif|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i;

export interface PickedFiles {
  accepted: File[];
  skipped: { name: string; reason: string }[];
}

function mightBeImage(f: File): boolean {
  if (f.type.startsWith("image/")) return true;
  if (IMAGE_EXT.test(f.name)) return true;
  // No type at all: let the decoder try rather than guess.
  return f.type === "";
}

export function pickImageFiles(files: File[], room: number, limit = 6): PickedFiles {
  const accepted: File[] = [];
  const skipped: PickedFiles["skipped"] = [];
  for (const f of files) {
    if (!mightBeImage(f)) skipped.push({ name: f.name, reason: "is not an image" });
    else if (accepted.length >= room) skipped.push({ name: f.name, reason: `is over the limit of ${limit} photos` });
    else accepted.push(f);
  }
  return { accepted, skipped };
}

export function isHeic(f: File): boolean {
  return /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);
}

/**
 * The image URL carried by a drag from another web page (which brings a link,
 * not a file). Only http(s) and inline data images are returned.
 */
export function imageUrlFromDrop(uriList: string, html: string): string | null {
  const ok = (u: string) => /^https?:\/\//i.test(u) || /^data:image\//i.test(u);
  for (const line of uriList.split(/\r?\n/)) {
    const u = line.trim();
    if (u && !u.startsWith("#") && ok(u)) return u;
  }
  const src = html.match(/<img[^>]*\ssrc=["']([^"']+)["']/i)?.[1]?.trim();
  return src && ok(src) ? src : null;
}
