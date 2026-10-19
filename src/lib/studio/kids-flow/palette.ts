// ---------------------------------------------------------------------------
// The colours of the character, measured from the picture.
//
// The skill's rule is "sample colours with code, not by eye" — so the
// Character stage does exactly that, in the browser, the moment a picture is
// dropped: the hero's skin, hair and clothes come back as real hex values the
// renderer can use, and the owner can see them before anything is sent.
//
// `quantize` is pure (a coarse colour histogram, merged by distance, with the
// background — the colour of the picture's border — removed); `samplePalette`
// is the thin browser wrapper that reads the pixels.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function hex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function dist(a: RGB, b: RGB): number {
  // Weighted toward green, the way the eye weighs it.
  return Math.sqrt(2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2);
}

/**
 * The dominant colours of an RGBA pixel buffer, most common first.
 *
 * `border` pixels (the outer ring of the image) decide the background, which
 * is dropped so a character drawn on white does not come back as "white".
 */
export function quantize(
  data: ArrayLike<number>,
  width: number,
  height: number,
  count = 6,
): string[] {
  const bins = new Map<number, { n: number; sum: RGB }>();
  const borderBins = new Map<number, number>();
  const ring = Math.max(1, Math.round(Math.min(width, height) * 0.03));
  const key = (r: number, g: number, b: number) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) continue; // transparent — not part of him
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const k = key(r, g, b);
      const bin = bins.get(k) ?? { n: 0, sum: [0, 0, 0] as RGB };
      bin.n += 1;
      bin.sum[0] += r;
      bin.sum[1] += g;
      bin.sum[2] += b;
      bins.set(k, bin);
      if (x < ring || y < ring || x >= width - ring || y >= height - ring) {
        borderBins.set(k, (borderBins.get(k) ?? 0) + 1);
      }
    }
  }

  // The background: whatever bin dominates the border, if it really dominates.
  let bg: RGB | null = null;
  const borderTotal = [...borderBins.values()].reduce((a, b) => a + b, 0);
  const top = [...borderBins.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > borderTotal * 0.35) {
    const b = bins.get(top[0])!;
    bg = [b.sum[0] / b.n, b.sum[1] / b.n, b.sum[2] / b.n];
  }

  const total = [...bins.values()].reduce((a, b) => a + b.n, 0) || 1;
  const merged: { c: RGB; n: number }[] = [];
  for (const b of [...bins.values()].sort((x, y) => y.n - x.n)) {
    const c: RGB = [b.sum[0] / b.n, b.sum[1] / b.n, b.sum[2] / b.n];
    if (bg && dist(c, bg) < 60) continue;
    const near = merged.find((m) => dist(m.c, c) < 70);
    if (near) {
      const n = near.n + b.n;
      near.c = [(near.c[0] * near.n + c[0] * b.n) / n, (near.c[1] * near.n + c[1] * b.n) / n, (near.c[2] * near.n + c[2] * b.n) / n];
      near.n = n;
    } else {
      merged.push({ c, n: b.n });
    }
  }
  return merged
    .filter((m) => m.n / total > 0.004) // stray anti-aliasing is not a colour
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((m) => hex(m.c));
}

/** Read a picture (data URL or blob URL) and return its dominant colours. */
export async function samplePalette(src: string, count = 6): Promise<string[]> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("That picture couldn't be read."));
    el.src = src;
  });
  const side = 96; // plenty for a palette, cheap on a phone
  const scale = side / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d", { willReadFrequently: true });
  if (!c) return [];
  c.drawImage(img, 0, 0, w, h);
  return quantize(c.getImageData(0, 0, w, h).data, w, h, count);
}
