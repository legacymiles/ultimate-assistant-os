// ---------------------------------------------------------------------------
// Browser side of Dance Studio: API calls, uploads, and media preprocessing.
//
// Preprocessing happens here, not on the server, for two reasons: the server
// has no ffmpeg (and Vercel functions shouldn't carry one), and cutting a
// 40-second TikTok down to the model's 15 s is a choice only the user can make
// — which 15 s has the dance in it.
//
// Cutting uses the browser's own encoder: play the chosen span into
// MediaRecorder as MP4 (Chrome, Edge and Safari record MP4; Firefox does not,
// and says so). Character images are redrawn to a JPEG inside the model's
// size and aspect limits.
// ---------------------------------------------------------------------------

import { CHARACTER_MAX_PX, CHARACTER_MIN_PX } from "./limits";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status}).`);
  return json as T;
}

export function sendJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  return api<T>(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export function mediaUrl(key: string): string {
  return `/api/dance-studio/media?key=${encodeURIComponent(key)}`;
}

export type UploadFolder = "sources" | "clips" | "chars" | "posters";

/** Uploads straight to storage (or the local route) and returns the media key. */
export async function uploadMedia(folder: UploadFolder, blob: Blob, contentType: string): Promise<string> {
  const target = await sendJson<{ key: string; url: string; method: string; headers: Record<string, string> }>(
    "/api/dance-studio/upload",
    { folder, contentType },
  );
  const res = await fetch(target.url, { method: target.method, headers: target.headers, body: blob });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Upload failed (${res.status})${/exceeded|too large|size/i.test(detail) ? " — the file is larger than storage allows" : ""}.`);
  }
  return target.key;
}

// --- video ------------------------------------------------------------------

export interface VideoProbe {
  durationSec: number;
  width: number;
  height: number;
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error("This browser can't read that video. Try an MP4."));
    v.src = src;
  });
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.01 && v.readyState >= 2) return resolve();
    v.onseeked = () => resolve();
    v.currentTime = t;
  });
}

export async function probeVideo(src: string): Promise<VideoProbe> {
  const v = await loadVideo(src);
  const out = { durationSec: Number.isFinite(v.duration) ? v.duration : 0, width: v.videoWidth, height: v.videoHeight };
  v.removeAttribute("src");
  v.load();
  return out;
}

/** One frame as a JPEG, for the library thumbnail. Null if the browser won't draw it. */
export async function capturePoster(src: string, atSec: number): Promise<Blob | null> {
  try {
    const v = await loadVideo(src);
    await seek(v, Math.min(atSec, Math.max(0, v.duration - 0.1)));
    const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    return await new Promise((r) => canvas.toBlob((b) => r(b), "image/jpeg", 0.85));
  } catch {
    return null;
  }
}

const MP4_TYPES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1",
  "video/mp4",
];

export function canCutClips(): boolean {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return false;
  const v = document.createElement("video") as HTMLVideoElement & { captureStream?: () => MediaStream };
  return typeof v.captureStream === "function" && MP4_TYPES.some((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Re-encode [startSec, startSec + lengthSec) of a video to MP4 by playing it
 * into MediaRecorder. Takes about as long as the clip. The element is kept
 * in the DOM (invisibly) because some browsers stop decoding detached video.
 */
export async function cutClip(src: string, startSec: number, lengthSec: number, onProgress: (p: number) => void): Promise<Blob> {
  const mimeType = MP4_TYPES.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
  if (!mimeType) throw new Error("This browser can't record MP4. Use Chrome, Edge or Safari — or upload a clip that's already 15 seconds or shorter.");

  const v = (await loadVideo(src)) as HTMLVideoElement & { captureStream?: () => MediaStream };
  if (typeof v.captureStream !== "function") throw new Error("This browser can't cut video. Use Chrome or Edge — or upload a clip that's already 15 seconds or shorter.");
  Object.assign(v.style, { position: "fixed", left: "-9999px", top: "0", width: "2px", height: "2px", opacity: "0" });
  document.body.appendChild(v);

  try {
    await seek(v, startSec);
    const stream = v.captureStream();
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));

    recorder.start(500);
    await v.play();
    // setInterval, not requestAnimationFrame: rAF stalls in background tabs.
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const t = v.currentTime - startSec;
        onProgress(Math.max(0, Math.min(1, t / lengthSec)));
        if (t >= lengthSec || v.ended) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
    v.pause();
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: "video/mp4" });
    if (!blob.size) throw new Error("Recording produced an empty clip.");
    return blob;
  } finally {
    v.remove();
  }
}

// --- images -----------------------------------------------------------------

export const CHARACTER_IMAGE_ACCEPT = "image/*,.heic,.heif";

function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/** Two decoders, because each browser refuses different files. Null when neither can open it. */
async function decodeImage(blob: Blob): Promise<Decoded | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    // Fall through to <img>, which also honours EXIF rotation and, in Safari, HEIC.
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth) throw new Error("empty");
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

/**
 * Any picture → a JPEG the model accepts: longest side ≤ 2048, shortest side
 * ≥ 256, aspect between 2:5 and 5:2 (padded with dark bars rather than cropped,
 * so no part of the character is lost).
 *
 * iPhone photos are HEIC, which Chrome and Edge can't decode at all; those go
 * through heic2any first. It is ~2.7 MB, so it loads only when a HEIC appears.
 */
export async function prepareCharacterImage(file: File): Promise<Blob> {
  if (file.size > 40 * 1024 * 1024) throw new Error(`${file.name} is over 40 MB — pick a smaller image.`);

  let decoded = await decodeImage(file);
  if (!decoded && isHeic(file)) {
    try {
      const { default: heic2any } = await import("heic2any");
      const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
      decoded = await decodeImage(Array.isArray(out) ? out[0] : out);
    } catch {
      decoded = null;
    }
  }
  if (!decoded) {
    throw new Error(`Couldn't open ${file.name || "that file"}. Use a JPG, PNG, WebP or iPhone (HEIC) photo.`);
  }

  try {
    const scale = Math.min(1, CHARACTER_MAX_PX / Math.max(decoded.width, decoded.height));
    const w = Math.round(decoded.width * scale);
    const h = Math.round(decoded.height * scale);
    if (Math.min(w, h) < CHARACTER_MIN_PX) {
      throw new Error(`${file.name} is too small (${decoded.width}×${decoded.height}). The model needs at least ${CHARACTER_MIN_PX}px on each side.`);
    }
    const canvasW = h / w > 2.5 ? Math.ceil(h / 2.5) : w;
    const canvasH = w / h > 2.5 ? Math.ceil(w / 2.5) : h;
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.drawImage(decoded.source, Math.round((canvasW - w) / 2), Math.round((canvasH - h) / 2), w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), "image/jpeg", 0.92));
    if (!blob) throw new Error("Couldn't convert the image.");
    return blob;
  } finally {
    decoded.release();
  }
}
