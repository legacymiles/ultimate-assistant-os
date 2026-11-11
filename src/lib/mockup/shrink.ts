"use client";

// ---------------------------------------------------------------------------
// Make a painted mockup small enough to keep on a project or post to the
// queue: at most `maxWidth` wide, JPEG. A Flux picture arrives at ~150-300 KB;
// a 960 px JPEG at 0.74 is ~70-120 KB and still reads every word.
//
// createImageBitmap, not <img>.decode(): measured in the hub's own browser
// pane, decode() on an image that isn't in the page never settled, so the
// shrink hung and Client Review never saved the client's mockups. And a
// deadline on top, because a picture that can't be shrunk must still be sent
// as it is rather than block the save.
// ---------------------------------------------------------------------------

const DEADLINE_MS = 8000;

async function shrink(dataUrl: string, maxWidth: number, quality: number): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxWidth / (bmp.width || maxWidth));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", quality);
    return out.length < dataUrl.length ? out : dataUrl;
  } finally {
    bmp.close();
  }
}

export async function shrinkImage(dataUrl: string, maxWidth = 960, quality = 0.74): Promise<string> {
  if (!dataUrl.startsWith("data:image/") || typeof createImageBitmap !== "function") return dataUrl;
  try {
    return await Promise.race([
      shrink(dataUrl, maxWidth, quality),
      new Promise<string>((resolve) => setTimeout(() => resolve(dataUrl), DEADLINE_MS)),
    ]);
  } catch {
    return dataUrl;
  }
}
