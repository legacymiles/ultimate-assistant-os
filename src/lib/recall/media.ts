// ---------------------------------------------------------------------------
// Recall — capture helpers (client-side).
// Read text files, downscale images to compact data URLs (localStorage-safe),
// detect links, and enrich a link's readable text via the /api/recall "link"
// stage (a plain server fetch — no AI key required).
// ---------------------------------------------------------------------------

const IMAGE_MAX_DIM = 1280;
const IMAGE_QUALITY = 0.82;

export function isProbablyUrl(text: string): boolean {
  const t = text.trim();
  if (/\s/.test(t)) return false;
  return /^https?:\/\/[^\s]+\.[^\s]+/i.test(t) || /^www\.[^\s]+\.[^\s]+/i.test(t);
}

export function normalizeUrl(text: string): string {
  const t = text.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function domainOf(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsText(file);
  });
}

/** Downscale + re-encode an image file into a compact JPEG/PNG data URL. */
export function imageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("Could not decode image."));
      img.onload = () => {
        const scale = Math.min(1, IMAGE_MAX_DIM / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(String(reader.result ?? ""));
        ctx.drawImage(img, 0, 0, w, h);
        const type = file.type === "image/png" ? "image/png" : "image/jpeg";
        resolve(canvas.toDataURL(type, IMAGE_QUALITY));
      };
      img.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  });
}

export interface LinkMeta {
  title: string;
  text: string;
  url: string;
}

/**
 * Fetch a link's title + readable text through the server. Never throws — on
 * failure (offline, blocked, CORS) it returns just the URL + domain title so
 * capture still works.
 */
export async function fetchLinkMeta(url: string): Promise<LinkMeta> {
  const clean = normalizeUrl(url);
  const fallback: LinkMeta = { title: domainOf(clean), text: clean, url: clean };
  try {
    const res = await fetch("/api/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "link", url: clean }),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { title?: string; text?: string };
    return {
      title: (data.title || fallback.title).trim(),
      text: (data.text || clean).trim(),
      url: clean,
    };
  } catch {
    return fallback;
  }
}
