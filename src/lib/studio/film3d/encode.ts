// ---------------------------------------------------------------------------
// Render a Film3D to an MP4 file, in the browser.
//
// Frame by frame and deterministic: the player draws frame i at t = i/fps,
// WebCodecs encodes it to H.264, the score is rendered offline and encoded to
// AAC (Opus if the browser has no AAC encoder), and mp4-muxer writes a
// fast-start MP4. Nothing is real-time, so a slow laptop makes the same film
// as a fast one — only slower.
//
// Browsers without WebCodecs (older Safari) fall back to recording the canvas
// in real time with MediaRecorder; the film plays once while it records.
// ---------------------------------------------------------------------------

import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import type { Film3D } from "./plan";
import { durationOf, sizeFor } from "./director";
import { FilmPlayer } from "./player";
import { renderScore } from "./score";

export interface RenderProgress {
  stage: "music" | "frames" | "finishing";
  done: number;
  total: number;
}

export interface RenderOptions {
  /** Short edge in pixels: 720 (default) or 1080. */
  short?: number;
  fps?: number;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  blob: Blob;
  type: string;
  width: number;
  height: number;
  seconds: number;
  method: "webcodecs" | "recorder";
}

const yieldUI = () => new Promise<void>((r) => setTimeout(r, 0));

async function pickVideoCodec(width: number, height: number, fps: number, bitrate: number): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42002a", "avc1.42001f"]) {
    const cfg: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps, avc: { format: "avc" } };
    try {
      const s = await VideoEncoder.isConfigSupported(cfg);
      if (s.supported) return cfg;
    } catch {
      /* try the next */
    }
  }
  return null;
}

async function pickAudioCodec(sampleRate: number): Promise<{ cfg: AudioEncoderConfig; mux: "aac" | "opus" } | null> {
  if (typeof AudioEncoder === "undefined") return null;
  const tries: { cfg: AudioEncoderConfig; mux: "aac" | "opus" }[] = [
    { cfg: { codec: "mp4a.40.2", sampleRate, numberOfChannels: 2, bitrate: 160_000 }, mux: "aac" },
    { cfg: { codec: "opus", sampleRate, numberOfChannels: 2, bitrate: 128_000 }, mux: "opus" },
  ];
  for (const t of tries) {
    try {
      const s = await AudioEncoder.isConfigSupported(t.cfg);
      if (s.supported) return t;
    } catch {
      /* next */
    }
  }
  return null;
}

/** True when this browser can make the MP4 frame by frame (WebCodecs). */
export function canEncodeFrames(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

export async function renderFilmToMp4(film: Film3D, opts: RenderOptions = {}): Promise<RenderResult> {
  const fps = opts.fps ?? 30;
  const { width, height } = sizeFor(film.aspect, opts.short ?? 720);
  const seconds = durationOf(film);
  if (seconds <= 0) throw new Error("The storyboard has no beats yet.");

  opts.onProgress?.({ stage: "music", done: 0, total: 1 });
  const sampleRate = 48000;
  const audio = await renderScore(film, sampleRate);
  opts.onProgress?.({ stage: "music", done: 1, total: 1 });

  const bitrate = Math.round(width * height * fps * 0.12);
  const vcfg = await pickVideoCodec(width, height, fps, bitrate);
  const acodec = await pickAudioCodec(sampleRate);
  const player = new FilmPlayer({ width, height, quality: "final" });
  try {
    await player.setFilm(film);
    if (vcfg && acodec) return await encodeFrames(player, film, { width, height, fps, seconds, vcfg, acodec, audio, opts });
    return await recordRealtime(player, { width, height, fps, seconds, audio, opts });
  } finally {
    player.dispose();
  }
}

async function encodeFrames(
  player: FilmPlayer,
  film: Film3D,
  a: {
    width: number;
    height: number;
    fps: number;
    seconds: number;
    vcfg: VideoEncoderConfig;
    acodec: { cfg: AudioEncoderConfig; mux: "aac" | "opus" };
    audio: AudioBuffer;
    opts: RenderOptions;
  },
): Promise<RenderResult> {
  const { width, height, fps, seconds, opts } = a;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height, frameRate: fps },
    audio: { codec: a.acodec.mux, sampleRate: a.audio.sampleRate, numberOfChannels: 2 },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let failure: Error | null = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e instanceof Error ? e : new Error(String(e))),
  });
  venc.configure(a.vcfg);
  const aenc = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => (failure = e instanceof Error ? e : new Error(String(e))),
  });
  aenc.configure(a.acodec.cfg);

  // Audio first — it is quick, and then the frames own the progress bar.
  const block = 1024;
  const left = a.audio.getChannelData(0);
  const right = a.audio.numberOfChannels > 1 ? a.audio.getChannelData(1) : left;
  for (let i = 0; i < a.audio.length; i += block) {
    const n = Math.min(block, a.audio.length - i);
    const planar = new Float32Array(n * 2);
    planar.set(left.subarray(i, i + n), 0);
    planar.set(right.subarray(i, i + n), n);
    const data = new AudioData({ format: "f32-planar", sampleRate: a.audio.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / a.audio.sampleRate) * 1e6), data: planar });
    aenc.encode(data);
    data.close();
  }

  const frames = Math.round(seconds * fps);
  const dur = Math.round(1e6 / fps);
  for (let i = 0; i < frames; i++) {
    if (opts.signal?.aborted) throw new DOMException("Render cancelled.", "AbortError");
    if (failure) throw failure;
    player.render(i / fps);
    const frame = new VideoFrame(player.canvas, { timestamp: i * dur, duration: dur });
    venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    if (i % 3 === 0) {
      opts.onProgress?.({ stage: "frames", done: i + 1, total: frames });
      await yieldUI();
    }
  }
  opts.onProgress?.({ stage: "finishing", done: frames, total: frames });
  await venc.flush();
  await aenc.flush();
  if (failure) throw failure;
  venc.close();
  aenc.close();
  muxer.finalize();
  const buf = (muxer.target as ArrayBufferTarget).buffer;
  void film;
  return { blob: new Blob([buf], { type: "video/mp4" }), type: "video/mp4", width, height, seconds, method: "webcodecs" };
}

async function recordRealtime(
  player: FilmPlayer,
  a: { width: number; height: number; fps: number; seconds: number; audio: AudioBuffer; opts: RenderOptions },
): Promise<RenderResult> {
  if (typeof MediaRecorder === "undefined" || !player.canvas.captureStream) {
    throw new Error("This browser can't make video files. Try Chrome or Edge, or use “Render on my PC”.");
  }
  const type = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource();
  src.buffer = a.audio;
  src.connect(dest);
  const stream = new MediaStream([...player.canvas.captureStream(a.fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  player.render(0);
  rec.start(250);
  const t0 = ac.currentTime + 0.05;
  src.start(t0);
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (a.opts.signal?.aborted) return reject(new DOMException("Render cancelled.", "AbortError"));
      const t = ac.currentTime - t0;
      player.render(Math.max(0, t));
      a.opts.onProgress?.({ stage: "frames", done: Math.min(a.seconds, Math.max(0, t)), total: a.seconds });
      if (t >= a.seconds) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).finally(() => {
    rec.stop();
    void ac.close();
  });
  await stopped;
  const mime = (type.split(";")[0] || "video/webm") as string;
  return { blob: new Blob(chunks, { type: mime }), type: mime, width: a.width, height: a.height, seconds: a.seconds, method: "recorder" };
}
