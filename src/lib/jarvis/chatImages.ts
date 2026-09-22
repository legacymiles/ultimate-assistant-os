// ---------------------------------------------------------------------------
// References attached to a chat turn — pictures and now clips.
//
// Each image is shrunk in the browser twice: a full copy the model reads
// (long edge 1568 px, the size vision models tile at) and a thumbnail that is
// saved in the conversation. Only the thumbnail syncs across devices; the full
// copy lives for this session, so a follow-up question can still see it.
//
// A video is handled honestly: no model here reads video, so what the model
// receives is a FRAME grabbed from it, and the attachment is labelled a clip so
// the prompt can say "the person in this clip" rather than pretending the
// motion was understood. The clip's own bytes stay in the browser for the
// render step, which can pass a real video reference on to engines that take
// one.
// ---------------------------------------------------------------------------

export const MAX_ATTACHMENTS = 8;
const FULL_EDGE = 1568;
const THUMB_EDGE = 240;

export interface Attachment {
  id: string;
  /** What the model reads: the picture, or a frame out of the clip. */
  full: string;
  /** What the conversation keeps. */
  thumb: string;
  name: string;
  kind: "image" | "video";
  /** Clips only: the file itself, for this session. */
  file?: File;
  /** Clips only, in seconds, when the browser could read it. */
  durationSec?: number;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't an image I can read."));
    };
    img.src = url;
  });
}

function shrink(source: CanvasImageSource, sw: number, sh: number, edge: number, quality: number): string {
  const scale = Math.min(1, edge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize images.");
  // JPEG has no alpha: paint white first so transparent screenshots stay legible.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

/** A drawable frame out of a clip, a little past the start so it isn't black. */
function grabFrame(file: File): Promise<{ video: HTMLVideoElement; duration: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    const fail = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name || "That clip"} isn't a video this browser can read.`));
    };
    const done = () => {
      if (!video.videoWidth) return fail();
      URL.revokeObjectURL(url);
      resolve({ video, duration: Number.isFinite(video.duration) ? video.duration : 0 });
    };
    video.onseeked = done;
    video.onerror = fail;
    video.onloadeddata = () => {
      // Seeking fires onseeked; if the clip is shorter than the seek, use what
      // is already decoded.
      if (video.duration && video.duration > 0.5) video.currentTime = 0.4;
      else done();
    };
    video.src = url;
    setTimeout(() => (video.videoWidth ? done() : fail()), 6000);
  });
}

export async function toAttachment(file: File, id: string): Promise<Attachment> {
  if (file.type.startsWith("video/")) {
    const { video, duration } = await grabFrame(file);
    const w = video.videoWidth;
    const h = video.videoHeight;
    return {
      id,
      full: shrink(video, w, h, FULL_EDGE, 0.85),
      thumb: shrink(video, w, h, THUMB_EDGE, 0.7),
      name: file.name || "clip",
      kind: "video",
      file,
      ...(duration ? { durationSec: Math.round(duration * 10) / 10 } : {}),
    };
  }
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name || "That file"} isn't an image or a video.`);
  }
  const img = await loadImage(file);
  return {
    id,
    full: shrink(img, img.naturalWidth, img.naturalHeight, FULL_EDGE, 0.85),
    thumb: shrink(img, img.naturalWidth, img.naturalHeight, THUMB_EDGE, 0.7),
    name: file.name || "pasted image",
    kind: "image",
  };
}

/** Reference files out of a paste or drop, in order. */
export function imageFiles(list: DataTransfer | null): File[] {
  if (!list) return [];
  return Array.from(list.files).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
}

/** What the file picker accepts. */
export const ACCEPT_REFERENCES = "image/*,video/*";
