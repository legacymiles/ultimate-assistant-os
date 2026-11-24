"use client";

// Thin fetch helpers for Inspire's routes. Every error comes back as a thrown
// Error with the route's plain-English message.

const BASE = "/api/image-studio/inspire";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    if (res.status === 413) throw new ApiError(413, "That image is too large. Try a smaller one.");
    throw new ApiError(res.status, `The server answered ${res.status} with something unreadable.`);
  }
  if (!res.ok || typeof json.error === "string") throw new ApiError(res.status, String(json.error ?? `Request failed (${res.status}).`));
  return json as T;
}

export const api = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, body: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => call<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => call<T>(path, { method: "DELETE" }),
};

/** Read a file or blob as a downscaled JPEG/WebP data URL (max side `max`). */
export async function fileToDataUrl(file: Blob, max = 1600, quality = 0.88): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file couldn't be opened as an image."));
      el.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't process images.");
    ctx.drawImage(img, 0, 0, w, h);
    const webp = canvas.toDataURL("image/webp", quality);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fetch an image the app serves and return it as a data URL (for references). */
export async function urlToDataUrl(src: string, max = 1280): Promise<string> {
  const res = await fetch(src);
  if (!res.ok) throw new Error("That reference image couldn't be loaded.");
  return fileToDataUrl(await res.blob(), max);
}

/** Image files from a drop, a paste or a picker; ignores everything else. */
export function imageFiles(list: FileList | DataTransferItemList | File[] | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const it of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file = it instanceof File ? it : it.kind === "file" ? it.getAsFile() : null;
    if (file && (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name))) out.push(file);
  }
  return out;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
