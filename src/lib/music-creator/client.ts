"use client";

// ---------------------------------------------------------------------------
// Music Creator — talking to the GPU server.
//
// Everything goes through this site's own `/api/music-creator/*` proxy rather
// than the browser calling the GPU box directly. Realtime Lucy does the
// opposite because WebRTC needs a direct peer connection anyway; here the
// payloads are ordinary JSON and audio files, so proxying is simply better: the
// server's address and token stay server-side, and a plain-http box on a LAN or
// at a rented host is reachable from an https page without a mixed-content
// error.
//
// Nothing in here fabricates a result. When the server is missing, every call
// fails with the reason, and the tools show that reason.
// ---------------------------------------------------------------------------

import type { Job, PodInfo, ServerHealth, ServerState, VoiceProfile } from "./types";

const BASE = "/api/music-creator";

/** How often a running job is asked for progress. */
const POLL_MS = 1500;

async function parse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(String(body.error ?? `Server returned ${res.status}`));
  return body;
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parse(res);
}

/**
 * Ask the server how it is.
 *
 * Never throws: an unreachable server is an ordinary state of this app, not an
 * error condition, and every tool renders differently rather than breaking.
 */
export async function checkServer(): Promise<ServerState> {
  const [health, pod] = await Promise.all([checkHealth(), gpuState()]);
  return pod.managed ? { ...health, pod } : health;
}

async function checkHealth(): Promise<ServerState> {
  try {
    const res = await fetch(`${BASE}/health`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { reachable: false, reason: String(body?.error ?? `Server returned ${res.status}`), checkedAt: Date.now() };
    }
    // RunPod's proxy serves an HTML "waiting for service" page while the pod
    // boots; only the music server's own JSON counts as up.
    if ((body as ServerHealth)?.ok !== true) {
      return { reachable: false, reason: "The GPU is up but the music server is still starting.", checkedAt: Date.now() };
    }
    return { reachable: true, health: body as ServerHealth, checkedAt: Date.now() };
  } catch (err) {
    return { reachable: false, reason: (err as Error).message, checkedAt: Date.now() };
  }
}

// ----- waking the GPU ------------------------------------------------------
//
// The GPU is a RunPod pod that is stopped most of the time (it bills per
// second while running, and stops itself when idle). So "the server is not
// answering" is usually "the GPU is asleep", and the right response to a
// Render press is to wake it and wait, not to fail.

export async function gpuState(): Promise<PodInfo> {
  try {
    const res = await fetch(`${BASE}/gpu`, { cache: "no-store" });
    return (await res.json()) as PodInfo;
  } catch {
    return { managed: false };
  }
}

export async function wakeGpu(): Promise<PodInfo> {
  const res = await fetch(`${BASE}/gpu`, { method: "POST" });
  return (await res.json()) as PodInfo;
}

/** A cold start re-installs the Pythons (a few minutes) and loads YuE2. */
const WAKE_LIMIT_MS = 20 * 60_000;
const WAKE_POLL_MS = 10_000;

/**
 * Make sure the GPU server is answering, waking the pod if the site manages
 * one. Resolves when /health answers; throws with the reason otherwise.
 */
export async function ensureServer(opts: { onStage?: (stage: string) => void; signal?: AbortSignal } = {}): Promise<ServerState> {
  let state = await checkServer();
  if (state.reachable) return state;
  if (!state.pod?.managed) throw new Error(state.reason ?? "The music GPU server is not reachable.");
  if (state.pod.error) throw new Error(state.pod.error);

  if (state.pod.status !== "RUNNING") {
    opts.onStage?.("waking the GPU");
    const woke = await wakeGpu();
    if (woke.error) throw new Error(woke.error);
  }

  const started = Date.now();
  while (Date.now() - started < WAKE_LIMIT_MS) {
    if (opts.signal?.aborted) throw new DOMException("Stopped waiting for the GPU.", "AbortError");
    const mins = Math.floor((Date.now() - started) / 60_000);
    opts.onStage?.(
      state.pod?.status === "RUNNING"
        ? `GPU is up — starting the music server (${mins} min)`
        : `waking the GPU (${mins} min, usually 3-8)`,
    );
    await new Promise((r) => setTimeout(r, WAKE_POLL_MS));
    state = await checkServer();
    if (state.reachable) return state;
    if (state.pod?.error) throw new Error(state.pod.error);
    if (state.pod?.status === "EXITED" || state.pod?.status === "TERMINATED") {
      throw new Error(`The GPU pod went to ${state.pod.status} while starting. Check it on runpod.io.`);
    }
  }
  throw new Error(
    "The GPU pod is running but the music server never answered (20 min). Its log is /workspace/autostart.log on the pod.",
  );
}

/** True when the named engine is installed on the server this hub points at. */
export function hasEngine(state: ServerState | null, engine: "yue2" | "auk" | "sheetsage"): boolean {
  return !!state?.reachable && !!state.health?.engines?.[engine]?.available;
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
  return (await parse(res)) as unknown as Job;
}

/**
 * Submit a job and wait for it, reporting progress on the way.
 *
 * Generation takes minutes, so the caller gets `onProgress` for every poll and
 * an AbortSignal to give up with. Giving up stops the polling, not the job —
 * the GPU keeps working and the result is still collectable by id, which is
 * what makes a page refresh mid-render survivable.
 */
export async function runJob(
  path: "jobs/song" | "jobs/transcribe" | "jobs/speak" | "jobs/separate",
  body: unknown,
  opts: { onProgress?: (job: Job, jobId: string) => void; signal?: AbortSignal } = {},
): Promise<{ jobId: string; job: Job }> {
  const submitted = await post(path, body);
  const jobId = String(submitted.job_id ?? "");
  if (!jobId) throw new Error("The server accepted the request but returned no job id.");

  for (;;) {
    if (opts.signal?.aborted) throw new DOMException("Stopped watching this render.", "AbortError");
    const job = await getJob(jobId);
    opts.onProgress?.(job, jobId);
    if (job.status === "done") return { jobId, job };
    if (job.status === "error") throw new Error(job.error || "The render failed without a message.");
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** Where a produced file can be played from or downloaded. */
export function fileUrl(fileId: string): string {
  return `${BASE}/files/${encodeURIComponent(fileId)}`;
}

// ----- the Voice Library's server side -------------------------------------
//
// The library itself lives in the browser (see store.ts). These calls only
// manage the server's copy of each reference clip, which is a cache: a voice
// whose `serverRefId` the server no longer knows is simply re-registered from
// the clip kept locally.

export async function registerVoice(input: {
  name: string;
  audioDataUrl: string;
  transcript?: string;
}): Promise<{ voiceRefId: string; durationS?: number }> {
  const body = await post("voices", {
    name: input.name,
    audio_b64: input.audioDataUrl,
    transcript: input.transcript ?? "",
  });
  return { voiceRefId: String(body.voice_ref_id ?? ""), durationS: Number(body.duration_s) || undefined };
}

export async function deleteServerVoice(voiceRefId: string): Promise<void> {
  await fetch(`${BASE}/voices/${encodeURIComponent(voiceRefId)}`, { method: "DELETE" });
}

/**
 * Make sure the server holds this voice's reference clip, and return its id.
 *
 * This is the one function that makes "never process the artist again" true
 * across a server rebuild: the clip is in the library, so a missing server-side
 * copy costs one upload rather than another trip through search and separation.
 */
export async function ensureVoiceOnServer(voice: VoiceProfile): Promise<string> {
  if (voice.serverRefId) {
    const res = await fetch(`${BASE}/voices`, { cache: "no-store" });
    if (res.ok) {
      // The server answers with a bare array; tolerate a wrapped object too so
      // a future server that wraps it does not silently re-upload every clip.
      const body = (await res.json().catch(() => null)) as { voices?: unknown } | unknown[] | null;
      const list = (Array.isArray(body) ? body : Array.isArray(body?.voices) ? body.voices : []) as {
        voice_ref_id?: string;
      }[];
      if (list.some((v) => v.voice_ref_id === voice.serverRefId)) return voice.serverRefId;
    }
  }
  if (!voice.clipDataUrl) {
    throw new Error(
      `"${voice.name}" has no reference clip stored on this device, and the server no longer has its copy. ` +
        "Re-clone the voice from its source clip.",
    );
  }
  const { voiceRefId } = await registerVoice({
    name: voice.name,
    audioDataUrl: voice.clipDataUrl,
    transcript: voice.transcript,
  });
  return voiceRefId;
}

/** Mix a vocal over music, server-side with ffmpeg. */
export async function mix(input: {
  musicFileId: string;
  vocalFileId: string;
  vocalGainDb?: number;
  musicGainDb?: number;
  offsetS?: number;
}): Promise<string> {
  const body = await post("mix", {
    music_file_id: input.musicFileId,
    vocal_file_id: input.vocalFileId,
    vocal_gain_db: input.vocalGainDb ?? 0,
    music_gain_db: input.musicGainDb ?? -3,
    offset_s: input.offsetS ?? 0,
  });
  return String(body.file_id ?? "");
}

// ----- the writing layer ---------------------------------------------------
//
// This one does not touch the GPU at all. It runs on the hub's ordinary AI key,
// which is why the studio is useful on a laptop with no server configured.

export type WriteTask = "lyrics" | "style" | "hooks" | "mashup" | "rewrite" | "vocal-direction";

export async function write(task: WriteTask, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return post("write", { task, input });
}

/** Search the public music catalogue for an artist's recordings. */
export async function searchArtist(query: string): Promise<{ tracks: import("./types").ArtistTrack[] }> {
  const res = await fetch(`${BASE}/artist?q=${encodeURIComponent(query)}`, { cache: "no-store" });
  return (await parse(res)) as unknown as { tracks: import("./types").ArtistTrack[] };
}
