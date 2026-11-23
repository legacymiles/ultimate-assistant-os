// ---------------------------------------------------------------------------
// What a file REALLY is, from its bytes. An upload's name and declared type
// are the customer's browser talking; these headers are the file. Pure — no
// image library, no decoding — so it is cheap to run on every upload.
// ---------------------------------------------------------------------------

import { readPngInfo } from "../png";

export interface ImageInfo {
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  width: number;
  height: number;
  hasAlpha: boolean;
}

export function sniffImage(buf: Uint8Array): ImageInfo | null {
  if (buf.length < 12) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const info = readPngInfo(buf);
    return info ? { mime: "image/png", width: info.width, height: info.height, hasAlpha: info.hasAlpha } : null;
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const dims = jpegSize(buf);
    return dims ? { mime: "image/jpeg", ...dims, hasAlpha: false } : null;
  }
  // WebP
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP") {
    const dims = webpSize(buf);
    return dims ? { mime: "image/webp", width: dims.width, height: dims.height, hasAlpha: dims.alpha } : null;
  }
  // SVG (text)
  const head = new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, Math.min(buf.length, 4096))).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    const full = new TextDecoder().decode(buf);
    const dims = svgSize(full);
    return dims ? { mime: "image/svg+xml", ...dims, hasAlpha: true } : null;
  }
  return null;
}

function ascii(b: Uint8Array, at: number, n: number): string {
  return String.fromCharCode(...b.subarray(at, at + n));
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width && height ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number; alpha: boolean } | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X" && b.length >= 30) {
    const alpha = (b[20] & 0x10) !== 0;
    const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { width, height, alpha };
  }
  if (chunk === "VP8L" && b.length >= 25) {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff), alpha: ((bits >> 28) & 1) === 1 };
  }
  if (chunk === "VP8 " && b.length >= 30) {
    const width = (b[26] | (b[27] << 8)) & 0x3fff;
    const height = (b[28] | (b[29] << 8)) & 0x3fff;
    return { width, height, alpha: false };
  }
  return null;
}

/** Intrinsic size of an SVG from width/height or its viewBox (in px-ish units). */
export function svgSize(svg: string): { width: number; height: number } | null {
  const tag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;
  const vb = tag.match(/viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)\s*["']/i);
  const num = (attr: string) => {
    const m = tag.match(new RegExp(`\\b${attr}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, "i"));
    return m ? parseFloat(m[1]) : null;
  };
  const w = num("width");
  const h = num("height");
  if (w && h) return { width: Math.round(w), height: Math.round(h) };
  if (vb) {
    const vw = parseFloat(vb[3]);
    const vh = parseFloat(vb[4]);
    if (vw > 0 && vh > 0) return { width: Math.round(vw), height: Math.round(vh) };
  }
  return null;
}
