// ---------------------------------------------------------------------------
// References attached to a chat turn — pictures, clips and now sound.
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
//
// All three kinds are nameable from the prompt. A picture or a clip is a
// "@Subject N" the render attaches; a track is an "@Audio N", numbered by the
// same count that labels the notes below, and it is what gets laid under a cut.
// src/lib/studio/references.ts owns both families.
//
// Audio is the same honesty again, the other way round. Nothing in the chat
// hears it, so sending a picture of a waveform to a vision model would be
// theatre. Instead the browser MEASURES it — tempo, key, brightness,
// percussion, dynamics, via the analysis the Soundprint app already uses — and
// the attachment carries that as a `note` in words. That note is what reaches
// the model and shapes the prompt; the waveform is only for the owner's eyes,
// and the file itself stays here to be laid under a finished film.
// ---------------------------------------------------------------------------

import { analyzeRange, featuresToBrief, fmt, loadAudio } from "@/lib/soundprint/audio-analysis";

export const MAX_ATTACHMENTS = 8;
const FULL_EDGE = 1568;
const THUMB_EDGE = 240;
/** Enough of a track to measure honestly without decoding a whole album. */
const LISTEN_SEC = 45;

export type AttachmentKind = "image" | "video" | "audio";

export interface Attachment {
  id: string;
  /** What the model reads: the picture, or a frame out of the clip. */
  full: string;
  /** What the conversation keeps. */
  thumb: string;
  name: string;
  kind: AttachmentKind;
  /** Clips and audio: the file itself, for this session. */
  file?: File;
  /** Clips and audio, in seconds, when the browser could read it. */
  durationSec?: number;
  /**
   * What the model is told about a reference it cannot perceive. Audio only
   * so far: measured facts, never a guess about the music.
   */
  note?: string;
}

/**
 * Sound cannot be looked at, so it is told to the model in words instead.
 *
 * Written as a type guard rather than a boolean so that skipping it also
 * narrows what is left to the things a render can actually see.
 */
export const isDescribed = (a: Attachment): a is Attachment & { kind: "audio" } => a.kind === "audio";

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

/**
 * A waveform, drawn from the real peaks.
 *
 * It is a tile, not evidence: it tells the owner which track is which at a
 * glance. The dark panel and the ink colours come from the app's tokens so an
 * audio tile sits in the same world as the photo next to it.
 */
function drawWaveform(peaks: Float32Array | number[], w: number, h: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw a waveform.");
  ctx.fillStyle = "#12141c";
  ctx.fillRect(0, 0, w, h);
  const mid = h / 2;
  const bars = Math.max(8, Math.floor(w / 3));
  const step = Math.max(1, Math.floor(peaks.length / bars));
  ctx.fillStyle = "#6b7385";
  for (let i = 0; i < bars; i += 1) {
    let peak = 0;
    for (let k = i * step; k < (i + 1) * step && k < peaks.length; k += 1) {
      peak = Math.max(peak, Math.abs(peaks[k] ?? 0));
    }
    const tall = Math.max(1, peak * (h * 0.82));
    ctx.fillRect(i * 3, mid - tall / 2, 2, tall);
  }
  return canvas.toDataURL("image/jpeg", 0.8);
}

/** The measured truth about a track, in the words the model reads. */
async function listen(file: File): Promise<{ thumb: string; full: string; durationSec: number; note: string }> {
  const audio = await loadAudio(file);
  const thumb = drawWaveform(audio.peaks, THUMB_EDGE, Math.round(THUMB_EDGE * 0.6));
  const head = `Audio reference "${file.name || "track"}" — ${fmt(audio.durationSec)} long.`;
  let note = head;
  try {
    const features = analyzeRange(audio, 0, Math.min(audio.durationSec, LISTEN_SEC));
    note = `${head}\n${featuresToBrief(features)}`;
  } catch {
    // A track that will not analyse is still a track: its length and its name
    // are measured facts, and saying only those is better than inventing more.
  }
  return { thumb, full: thumb, durationSec: Math.round(audio.durationSec * 10) / 10, note };
}

export async function toAttachment(file: File, id: string): Promise<Attachment> {
  if (file.type.startsWith("audio/")) {
    try {
      const { thumb, full, durationSec, note } = await listen(file);
      return { id, full, thumb, name: file.name || "track", kind: "audio", file, durationSec, note };
    } catch {
      throw new Error(`${file.name || "That file"} isn't audio this browser can read.`);
    }
  }
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
    throw new Error(`${file.name || "That file"} isn't a picture, a clip or a piece of audio.`);
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

/** Reference files out of a paste or drop, in order: pictures, clips and tracks. */
export function referenceFiles(list: DataTransfer | null): File[] {
  if (!list) return [];
  return Array.from(list.files).filter(
    (f) => f.type.startsWith("image/") || f.type.startsWith("video/") || f.type.startsWith("audio/"),
  );
}

/** What the file picker accepts. */
export const ACCEPT_REFERENCES = "image/*,video/*,audio/*";

/**
 * Pictures only, out of a paste or a drop.
 *
 * The Chat tab takes these and nothing else: a clip or a track there would be
 * a promise it cannot keep — nothing on that tab watches or listens, and the
 * render that could use them lives on Studio.
 */
export function imageFiles(list: DataTransfer | null): File[] {
  if (!list) return [];
  return Array.from(list.files).filter((f) => f.type.startsWith("image/"));
}

/** What the Chat tab's file picker accepts. */
export const ACCEPT_IMAGES = "image/*";

/**
 * The line a turn carries for every reference the model cannot perceive.
 *
 * It rides in the message text rather than beside it, because that is the only
 * channel that reaches the model unchanged — and it is numbered the same way
 * the uploads are, so "Audio 1" in an answer means the first track attached.
 */
export function describedNotes(attachments: Attachment[], firstNumber = 1): string {
  const described = attachments.filter(isDescribed);
  if (!described.length) return "";
  return described
    .map((a, i) => `[Audio ${firstNumber + i}] ${a.note ?? `"${a.name}" — nothing could be measured from it.`}`)
    .join("\n");
}
