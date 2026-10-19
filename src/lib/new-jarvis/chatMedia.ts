"use client";

// ---------------------------------------------------------------------------
// Pictures, clips and recordings for the Chat's super agent.
//
// What reaches the model is what it can actually perceive, and each kind is
// turned into that in the browser before anything is sent:
//
//   picture    the picture, shrunk to the size vision models tile at
//   clip       three frames across it (start, middle, end) AND its sound,
//              because a phone video is half what is said in it
//   recording  the sound itself (16 kHz mono WAV, the first 60 s), plus the
//              measured facts — length, tempo, key — as words
//
// Sound goes up as real audio. A model that cannot hear (or see) is fine to
// pick anyway: the provider re-routes a request carrying audio or pictures to
// a model that can perceive them, so the owner never has to know which can.
//
// Everything rides in ONE request, and Vercel carries about 4.5 MB per
// request, so the whole attachment set has a budget. Over it, the sound is
// dropped first (its measured note stays) and then later pictures, and the
// thumbnail row says so.
// ---------------------------------------------------------------------------

import { toAttachment } from "@/lib/jarvis/chatImages";
import { bytesToBase64, encodeWav, resampleLinear } from "@/lib/music-classified/wav";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: "wav" | "mp3" } };

export interface ChatMedia {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  /** Small preview for the composer and the block. */
  thumb: string;
  /** What the model receives. */
  parts: ContentPart[];
  /** Words for what it cannot perceive directly, numbered in the prompt. */
  note: string;
  /** Set when part of it had to be left out to fit. */
  trimmed?: string;
}

export const ACCEPT_CHAT_MEDIA = "image/*,video/*,audio/*";
export const MAX_CHAT_MEDIA = 6;
/** Base64 characters across every attachment in one message. */
export const MEDIA_BUDGET = 3_400_000;

const AUDIO_RATE = 16_000;
const AUDIO_SECONDS = 60;
const FRAME_EDGE = 1024;

let seq = 0;
const nextId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** The sound of a file (a recording or a clip's soundtrack) as WAV base64, or "". */
export async function soundOf(file: File): Promise<string> {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    void ctx.close();
    const ch = decoded.getChannelData(0);
    const take = Math.min(ch.length, Math.round(AUDIO_SECONDS * decoded.sampleRate));
    // Mono: average the channels the file has.
    const mono = new Float32Array(take);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < take; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    return bytesToBase64(encodeWav(resampleLinear(mono, decoded.sampleRate, AUDIO_RATE), AUDIO_RATE));
  } catch {
    // A clip with no soundtrack, or a codec this browser will not decode.
    return "";
  }
}

/** Frames at the given fractions of a clip, as JPEG data URLs. */
export function framesOf(
  file: File,
  at: number[],
  edge = FRAME_EDGE,
  quality = 0.8,
): Promise<{ frames: string[]; duration: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const frames: string[] = [];
    let i = 0;
    const finish = () => {
      URL.revokeObjectURL(url);
      resolve({ frames, duration: Number.isFinite(video.duration) ? video.duration : 0 });
    };
    const grab = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) {
        const scale = Math.min(1, edge / Math.max(w, h));
        const c = document.createElement("canvas");
        c.width = Math.round(w * scale);
        c.height = Math.round(h * scale);
        c.getContext("2d")?.drawImage(video, 0, 0, c.width, c.height);
        frames.push(c.toDataURL("image/jpeg", quality));
      }
      i += 1;
      if (i >= at.length) return finish();
      video.currentTime = Math.max(0.1, video.duration * at[i]);
    };
    video.onseeked = grab;
    video.onerror = finish;
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || !video.duration) return finish();
      video.currentTime = Math.max(0.1, video.duration * at[0]);
    };
    setTimeout(finish, 15_000);
    video.src = url;
  });
}

/** One dropped, pasted or picked file, ready to send. */
export async function prepareMedia(file: File): Promise<ChatMedia> {
  const id = nextId();
  const name = file.name || (file.type.startsWith("audio/") ? "recording" : file.type.startsWith("video/") ? "clip" : "picture");

  if (file.type.startsWith("video/")) {
    const [{ frames, duration }, sound, base] = await Promise.all([
      framesOf(file, [0.1, 0.5, 0.9]),
      soundOf(file),
      toAttachment(file, id).catch(() => null),
    ]);
    if (!frames.length && !base) throw new Error(`${name} isn't a video this browser can read.`);
    const shots = frames.length ? frames : [base!.full];
    const secs = duration ? `${Math.round(duration)} s` : "a";
    return {
      id,
      kind: "video",
      name,
      thumb: base?.thumb ?? shots[0],
      parts: [
        ...shots.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ...(sound ? [{ type: "input_audio" as const, input_audio: { data: sound, format: "wav" as const } }] : []),
      ],
      note: `"${name}" is ${secs} video: the pictures are ${shots.length} frames from its start, middle and end${
        sound ? `, and the audio is its soundtrack (first ${AUDIO_SECONDS} s)` : " (it has no sound I could read)"
      }.`,
    };
  }

  if (file.type.startsWith("audio/")) {
    const [base, sound] = await Promise.all([toAttachment(file, id), soundOf(file)]);
    return {
      id,
      kind: "audio",
      name,
      thumb: base.thumb,
      parts: sound ? [{ type: "input_audio", input_audio: { data: sound, format: "wav" } }] : [],
      note: `${base.note ?? `"${name}"`}${sound ? `\nThe audio is attached (first ${AUDIO_SECONDS} s) — listen to it.` : ""}`,
    };
  }

  const base = await toAttachment(file, id);
  return { id, kind: "image", name, thumb: base.thumb, parts: [{ type: "image_url", image_url: { url: base.full } }], note: "" };
}

const sizeOf = (p: ContentPart) => (p.type === "image_url" ? p.image_url.url.length : p.type === "input_audio" ? p.input_audio.data.length : 0);

/**
 * The user turn, as the model receives it: the words (with a numbered line for
 * each attachment), then the media — trimmed to the budget, sound first.
 */
export function buildUserContent(text: string, media: ChatMedia[]): { content: string | ContentPart[]; trimmed: string[] } {
  if (!media.length) return { content: text, trimmed: [] };
  const all = media.flatMap((m) => m.parts.map((p) => ({ m, p })));
  let total = all.reduce((s, x) => s + sizeOf(x.p), 0);
  const drop = new Set<ContentPart>();
  const trimmed: string[] = [];
  // Sound is the biggest and the one with a fallback (its note), so it goes first.
  for (const kind of ["input_audio", "image_url"] as const) {
    for (const x of [...all].reverse()) {
      if (total <= MEDIA_BUDGET) break;
      if (x.p.type !== kind || drop.has(x.p)) continue;
      drop.add(x.p);
      total -= sizeOf(x.p);
      trimmed.push(`${x.m.name}: ${kind === "input_audio" ? "sound" : "a picture"} left out to fit`);
    }
  }
  const lines = media.map((m, i) => `[Attachment ${i + 1}: ${m.kind} "${m.name}"]${m.note ? ` ${m.note}` : ""}`);
  const words = [text.trim() || "Look at what I attached.", "", ...lines, ...(trimmed.length ? [`(Too big to send whole: ${trimmed.join("; ")}.)`] : [])].join("\n");
  return {
    content: [{ type: "text", text: words }, ...all.map((x) => x.p).filter((p) => !drop.has(p))],
    trimmed,
  };
}
