// ---------------------------------------------------------------------------
// PNG physical-size metadata.
//
// A canvas PNG carries no DPI, so ColorboxRIP would open a 3307 px file at
// whatever its default is (often 72 DPI → a metre-wide print). Writing the
// pHYs chunk makes the file open at its true physical size. Pure byte work,
// no dependencies, tested in png.test.ts.
// ---------------------------------------------------------------------------

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Pixels per metre for a DPI. */
export const dpiToPpm = (dpi: number) => Math.round(dpi / 0.0254);

/**
 * Return a copy of `png` with a pHYs chunk (replacing any existing one),
 * inserted right after IHDR.
 */
export function withPhys(png: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(png)) throw new Error("Not a PNG");
  const ppm = dpiToPpm(dpi);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)));

  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let off = 8;
  let inserted = false;
  while (off + 8 <= png.length) {
    const len = new DataView(png.buffer, png.byteOffset + off, 4).getUint32(0);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    const end = off + 12 + len;
    if (type !== "pHYs") parts.push(png.subarray(off, end));
    if (type === "IHDR" && !inserted) {
      parts.push(chunk);
      inserted = true;
    }
    off = end;
    if (type === "IEND") break;
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Read width, height and DPI (if present) from a PNG. */
export function readPngInfo(png: Uint8Array): { width: number; height: number; dpi: number | null; hasAlpha: boolean } | null {
  if (!isPng(png) || png.length < 33) return null;
  const v = new DataView(png.buffer, png.byteOffset);
  const width = v.getUint32(16);
  const height = v.getUint32(20);
  const colorType = png[25];
  let dpi: number | null = null;
  let off = 8;
  while (off + 8 <= png.length) {
    const len = v.getUint32(off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    if (type === "pHYs" && png[off + 16] === 1) {
      dpi = Math.round(v.getUint32(off + 8) * 0.0254);
    }
    if (type === "IDAT" || type === "IEND") break;
    off += 12 + len;
  }
  return { width, height, dpi, hasAlpha: colorType === 6 || colorType === 4 };
}
