/**
 * Client-side photo resizing (P5).
 *
 * A phone camera file is 4–12 MB. We decode it in the browser, scale the long
 * edge to 1280px, re-encode as WebP under a byte ceiling, and only then upload.
 * So a big camera file never stalls an upload or hits a size limit, and the
 * user's data allowance isn't spent on pixels the model won't use.
 *
 * Returns a plain-English error instead of throwing, because this runs on
 * whatever the user picked from their camera roll.
 */

export const MAX_EDGE = 1280;
export const TARGET_BYTES = 420_000;
export const HARD_CEILING = 2_400_000;

export interface ResizedImage {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  /** Local object URL for an instant preview. Revoke when done. */
  previewUrl: string;
  name: string;
}

export async function resizeImage(file: File): Promise<
  { ok: true; image: ResizedImage } | { ok: false; error: string }
> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: `“${file.name}” isn't an image.` };
  }
  if (file.size > 40_000_000) {
    return {
      ok: false,
      error: `“${file.name}” is ${(file.size / 1e6).toFixed(0)} MB — too big even to open. Try a screenshot of it.`,
    };
  }

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await decode(file);
  } catch {
    return {
      ok: false,
      error: `We couldn't read “${file.name}”. HEIC photos sometimes need converting — a screenshot works.`,
    };
  }

  const sw = "width" in bitmap ? bitmap.width : 0;
  const sh = "height" in bitmap ? bitmap.height : 0;
  if (!sw || !sh) return { ok: false, error: `“${file.name}” had no readable size.` };

  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, error: "This browser couldn't resize that photo." };
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
  if ("close" in bitmap) bitmap.close();

  // Walk the quality down until it fits the target, then stop.
  const type = supportsWebp() ? "image/webp" : "image/jpeg";
  let dataUrl = "";
  for (const quality of [0.82, 0.72, 0.62, 0.5, 0.4]) {
    dataUrl = canvas.toDataURL(type, quality);
    if (approxBytes(dataUrl) <= TARGET_BYTES) break;
  }
  const bytes = approxBytes(dataUrl);
  if (bytes > HARD_CEILING) {
    return {
      ok: false,
      error: `“${file.name}” wouldn't compress small enough. Try a smaller photo.`,
    };
  }

  return {
    ok: true,
    image: {
      dataUrl,
      width: w,
      height: h,
      bytes,
      previewUrl: dataUrl,
      name: file.name,
    },
  };
}

function approxBytes(dataUrl: string) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor(base64.length * 0.75);
}

function supportsWebp() {
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    return c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to the <img> path for formats the bitmap decoder refuses */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    return img;
  } finally {
    // The canvas has the pixels by now.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
