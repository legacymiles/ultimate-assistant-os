// ---------------------------------------------------------------------------
// Auteur — browser-side calls to the two routes, plus the upload flow.
//
// Everything here degrades: a failed director call returns the heuristic
// result computed locally, a failed render becomes an error take the user can
// retry, and a reference whose bytes cannot be stored still exists as words.
// ---------------------------------------------------------------------------

"use client";

import { uid, nowIso } from "@/lib/utils";
import { composeH3Prompt } from "./director/h3prompt";
import { heuristicBreakdown, heuristicDevelop } from "./director/heuristic";
import { heuristicRetake } from "./director/retake";
import { blobToDataUrl, getMedia, makeThumb, mediaDuration, putMedia, videoPoster } from "./media";
import { findShot } from "./repo";
import type {
  Development,
  DirectorEngine,
  H3Prompt,
  Project,
  Reference,
  ReferenceKind,
  ReferenceScope,
  Scene,
  Shot,
  ShotPatch,
} from "./types";

async function director<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/auteur/director", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`director ${res.status}`);
  return (await res.json()) as T;
}

/** The project without anything heavy: thumbnails are dropped for the wire. */
function light(p: Project): Project {
  return { ...p, references: p.references.map((r) => ({ ...r, thumb: undefined })) };
}

export async function develop(p: Project): Promise<{ development: Development; engine: DirectorEngine }> {
  try {
    return await director({ stage: "develop", project: light(p) });
  } catch {
    return { development: heuristicDevelop(p), engine: "heuristic" };
  }
}

export async function breakdown(p: Project): Promise<{ scenes: Scene[]; engine: DirectorEngine }> {
  try {
    return await director({ stage: "breakdown", project: light(p) });
  } catch {
    return { scenes: heuristicBreakdown(p), engine: "heuristic" };
  }
}

export async function buildPrompt(p: Project, shotId: string): Promise<{ prompt: H3Prompt; engine: DirectorEngine }> {
  const hit = findShot(p, shotId);
  if (!hit) throw new Error("shot not found");
  const composed = composeH3Prompt(p, hit.scene, hit.shot);
  try {
    const out = await director<{ prompt: H3Prompt; engine: DirectorEngine }>({ stage: "prompt", project: light(p), shotId });
    // The label order is authoritative on the client; the server only polishes text.
    return { prompt: { ...composed, text: out.prompt.text || composed.text }, engine: out.engine };
  } catch {
    return { prompt: composed, engine: "heuristic" };
  }
}

export async function retake(p: Project, shotId: string, instruction: string): Promise<{ patch: ShotPatch; engine: DirectorEngine }> {
  const hit = findShot(p, shotId);
  if (!hit) throw new Error("shot not found");
  try {
    return await director({ stage: "retake", project: light(p), shotId, instruction });
  } catch {
    return { patch: heuristicRetake(instruction, hit.shot, p.characters), engine: "heuristic" };
  }
}

export interface Described {
  description: string;
  tags: string[];
  suggestedKind: "character" | "location" | "object" | "style" | "image";
}

export async function describeImage(dataUrl: string, hint: string): Promise<Described | null> {
  try {
    const out = await director<{ described: Described | null }>({ stage: "describe", image: dataUrl, hint });
    return out.described;
  } catch {
    return null;
  }
}

// ----- references ----------------------------------------------------------

function guessKind(file: File): ReferenceKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "image";
}

/**
 * Store a file's bytes and build its Reference. The vision description is
 * requested separately (describeReference) so the card appears instantly.
 */
export async function importReference(file: File, scope: ReferenceScope, kind?: ReferenceKind): Promise<Reference> {
  const k = kind ?? guessKind(file);
  const mediaId = (await putMedia(file)) ?? undefined;
  const thumb = file.type.startsWith("image/")
    ? (await makeThumb(file)) ?? undefined
    : file.type.startsWith("video/")
      ? (await videoPoster(file)) ?? undefined
      : undefined;
  return {
    id: uid("ref"),
    kind: k,
    name: file.name,
    mime: file.type,
    mediaId,
    thumb,
    scope,
    description: "",
    described: false,
    tags: [],
    createdAt: nowIso(),
  };
}

/** Ask the vision model what an image reference shows. Null when unavailable. */
export async function describeReference(ref: Reference): Promise<Described | null> {
  if (!ref.mediaId || !ref.mime.startsWith("image/")) return null;
  const blob = await getMedia(ref.mediaId);
  if (!blob) return null;
  // Send a reduced copy: the model needs the content, not 30 MB of pixels.
  const small = (await makeThumb(blob, 1024)) ?? (await blobToDataUrl(blob));
  return describeImage(small, `${ref.kind}: ${ref.name}`);
}

export async function audioDuration(mediaId: string): Promise<number | undefined> {
  const blob = await getMedia(mediaId);
  return blob ? mediaDuration(blob) : undefined;
}

// ----- generation ----------------------------------------------------------

export interface RenderOutcome {
  engine: "minimax" | "placeholder";
  /** Present when a real clip was produced. */
  blob?: Blob;
  error?: string;
}

export type RenderState = "uploading" | "queued" | "generating" | "downloading";

export interface RenderOptions {
  resolution: "768P" | "2K";
  /**
   * `note` is free text from the backend, e.g. "Warming up — loading model"
   * during a cold start on a self-hosted endpoint. Worth showing: without it
   * a five-minute model load looks identical to a hang.
   */
  onProgress?: (state: RenderState, note?: string) => void;
  signal?: AbortSignal;
}

const KIND_FOR_WIRE: Record<ReferenceKind, "image" | "video" | "audio"> = {
  image: "image",
  character: "image",
  location: "image",
  object: "image",
  style: "image",
  video: "video",
  audio: "audio",
};

/** Render one shot's prompt into a clip. Never throws; the outcome says what happened. */
export async function renderShot(p: Project, shot: Shot, prompt: H3Prompt, opts: RenderOptions): Promise<RenderOutcome> {
  try {
    opts.onProgress?.("uploading");
    const references: { label: string; kind: "image" | "video" | "audio"; dataUrl: string }[] = [];
    for (const { label, referenceId } of prompt.references) {
      const ref = p.references.find((r) => r.id === referenceId);
      if (!ref?.mediaId) continue;
      const blob = await getMedia(ref.mediaId);
      if (!blob) continue;
      references.push({ label, kind: KIND_FOR_WIRE[ref.kind], dataUrl: await blobToDataUrl(blob) });
    }

    const res = await fetch("/api/auteur/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        prompt: prompt.text,
        durationSec: shot.durationSec,
        aspectRatio: p.aspectRatio,
        resolution: opts.resolution,
        references,
      }),
      signal: opts.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      engine?: "minimax" | "placeholder";
      mode?: "async" | "inline" | "done";
      taskId?: string;
      videoBase64?: string;
      error?: string;
    };
    if (!res.ok || data.error) return { engine: data.engine ?? "minimax", error: data.error ?? `render ${res.status}` };

    if (data.engine === "placeholder") return { engine: "placeholder" };

    if (data.mode === "inline" && data.videoBase64) {
      const bytes = Uint8Array.from(atob(data.videoBase64), (c) => c.charCodeAt(0));
      return { engine: "minimax", blob: new Blob([bytes], { type: "video/mp4" }) };
    }

    if (data.mode === "async" && data.taskId) {
      opts.onProgress?.("queued");
      const outcome = await pollTask(data.taskId, opts);
      return outcome;
    }

    return { engine: "minimax", error: "Unexpected response from the render route" };
  } catch (err) {
    if ((err as Error).name === "AbortError") return { engine: "minimax", error: "Cancelled" };
    return { engine: "minimax", error: (err as Error).message || "Render failed" };
  }
}

/**
 * How long to wait before declaring a render lost.
 *
 * Generous on purpose. A hosted render takes a few minutes, but the FIRST
 * render against a freshly created self-hosted endpoint also downloads ~42 GB
 * of weights onto its volume, which can run well past fifteen minutes. Giving
 * up early there would abandon a job that is both working and being paid for.
 */
const POLL_CEILING_MS = 40 * 60_000;

async function pollTask(taskId: string, opts: RenderOptions): Promise<RenderOutcome> {
  const started = Date.now();
  while (Date.now() - started < POLL_CEILING_MS) {
    if (opts.signal?.aborted) return { engine: "minimax", error: "Cancelled" };
    await new Promise((r) => setTimeout(r, 8000));
    const res = await fetch("/api/auteur/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", taskId }),
      signal: opts.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string; note?: string };
    if (data.status === "error") return { engine: "minimax", error: data.error ?? "Render failed" };
    if (data.status === "queued") opts.onProgress?.("queued", data.note);
    if (data.status === "generating") opts.onProgress?.("generating", data.note);
    if (data.status === "done") {
      opts.onProgress?.("downloading");
      const dl = await fetch("/api/auteur/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download", taskId }),
        signal: opts.signal,
      });
      if (!dl.ok) return { engine: "minimax", error: `download ${dl.status}` };
      return { engine: "minimax", blob: await dl.blob() };
    }
  }
  return {
    engine: "minimax",
    error: `Gave up after ${Math.round(POLL_CEILING_MS / 60_000)} minutes. The job may still be running; check the backend before re-rendering.`,
  };
}
