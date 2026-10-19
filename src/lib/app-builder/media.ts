"use client";

// ---------------------------------------------------------------------------
// App Builder — videos and pictures, ready for the super agent to watch.
//
// A screen recording of an app or a workflow is read in the browser: frames
// spread evenly across it, in order, plus the narration (the first 60 s of its
// sound) — so the agent sees the flow step by step and hears what the person
// says while doing it. Nothing is uploaded raw; only these frames and the
// sound go up, inside Vercel's ~4.5 MB request limit (sound is dropped first
// when it won't fit, then frames are thinned evenly).
// ---------------------------------------------------------------------------

import { framesOf, soundOf } from "@/lib/new-jarvis/chatMedia";
import { shrinkImage } from "@/lib/new-jarvis/useRequests";

export interface PreparedMedia {
  id: string;
  kind: "video" | "image";
  name: string;
  thumb: string;
  /** In order. For a video, evenly spread from start to end. */
  frames: string[];
  /** Seconds into the video for each frame. */
  times?: number[];
  /** 16 kHz mono WAV, base64. */
  sound?: string;
  duration?: number;
}

export const ACCEPT = "video/*,image/*";
export const MAX_ITEMS = 6;
/** Frames across everything in one message. */
export const MAX_FRAMES = 16;
const FRAMES_PER_VIDEO = 12;
/** Base64 characters across everything in one message. */
const BUDGET = 3_300_000;
/** Bigger videos are still watched, but their sound isn't decoded (memory). */
const SOUND_MAX_BYTES = 80 * 1024 * 1024;

let seq = 0;
const nextId = () => `md${Date.now().toString(36)}${(seq++).toString(36)}`;

async function thumbOf(dataUrl: string): Promise<string> {
  try {
    return await shrinkImage(await (await fetch(dataUrl)).blob(), 240, 0.7);
  } catch {
    return dataUrl;
  }
}

/** One picked, dropped or pasted file. Throws a plain-English error for anything unreadable. */
export async function prepare(file: File): Promise<PreparedMedia> {
  const id = nextId();
  if (file.type.startsWith("video/")) {
    const name = file.name || "recording";
    const at = Array.from({ length: FRAMES_PER_VIDEO }, (_, i) => 0.02 + (0.96 * i) / (FRAMES_PER_VIDEO - 1));
    const [{ frames, duration }, sound] = await Promise.all([
      framesOf(file, at, 720, 0.7),
      file.size <= SOUND_MAX_BYTES ? soundOf(file) : Promise.resolve(""),
    ]);
    if (!frames.length) throw new Error(`${name} isn't a video this browser can play. Try an MP4 or MOV.`);
    return {
      id,
      kind: "video",
      name,
      thumb: await thumbOf(frames[0]),
      frames,
      times: duration ? at.slice(0, frames.length).map((f) => Math.round(f * duration * 10) / 10) : undefined,
      sound: sound || undefined,
      duration: duration || undefined,
    };
  }
  if (file.type.startsWith("image/")) {
    const name = file.name || "picture";
    const full = await shrinkImage(file, 1280, 0.8);
    return { id, kind: "image", name, thumb: await thumbOf(full), frames: [full] };
  }
  throw new Error(`${file.name || "That file"} isn't a video or a picture.`);
}

const size = (m: PreparedMedia, withSound: boolean) =>
  m.frames.reduce((n, f) => n + f.length, 0) + (withSound && m.sound ? m.sound.length : 0);

/** Evenly thin a list down to n, keeping the first and last. */
function thin<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  if (n <= 1) return list.slice(0, 1);
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
}

/**
 * What goes over the wire: under the frame cap and the byte budget. Returns a
 * plain note when something had to be left out, for the chat to show.
 */
export function forWire(list: PreparedMedia[]): { media: PreparedMedia[]; note?: string } {
  let items = list.slice(0, MAX_ITEMS).map((m) => ({ ...m }));
  const notes: string[] = [];
  // Frame cap: share it out, pictures first (one frame each), videos split the rest.
  const pics = items.filter((m) => m.kind === "image").length;
  const vids = items.filter((m) => m.kind === "video");
  if (vids.length) {
    const each = Math.max(3, Math.floor((MAX_FRAMES - pics) / vids.length));
    items = items.map((m) => {
      if (m.kind !== "video" || m.frames.length <= each) return m;
      const idx = thin(m.frames.map((_, i) => i), each);
      return { ...m, frames: idx.map((i) => m.frames[i]), times: m.times ? idx.map((i) => m.times![i]) : undefined };
    });
  }
  // Byte budget: sound goes first, then frames thin evenly.
  let total = items.reduce((n, m) => n + size(m, true), 0);
  if (total > BUDGET) {
    items = items.map((m) => ({ ...m, sound: undefined }));
    if (list.some((m) => m.sound)) notes.push("the sound was left out to fit");
    total = items.reduce((n, m) => n + size(m, false), 0);
  }
  while (total > BUDGET) {
    const biggest = items.reduce((a, b) => (b.frames.length > a.frames.length ? b : a));
    if (biggest.frames.length <= 2) break;
    const idx = thin(biggest.frames.map((_, i) => i), biggest.frames.length - 2);
    biggest.frames = idx.map((i) => biggest.frames[i]);
    if (biggest.times) biggest.times = idx.map((i) => biggest.times![i]);
    total = items.reduce((n, m) => n + size(m, false), 0);
    if (!notes.includes("fewer frames were sent to fit")) notes.push("fewer frames were sent to fit");
  }
  if (list.length > MAX_ITEMS) notes.push(`only the first ${MAX_ITEMS} files were sent`);
  return { media: items, note: notes.length ? `Heads up: ${notes.join(", and ")}.` : undefined };
}

/** Up to four frames across everything, for the In Queue hand-off (it takes four pictures). */
export function keyframesOf(list: PreparedMedia[], max = 4): string[] {
  const all = list.flatMap((m) => (m.kind === "video" ? thin(m.frames, 3) : m.frames));
  return thin(all, max);
}
