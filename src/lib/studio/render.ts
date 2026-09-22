// ---------------------------------------------------------------------------
// Running an approved `studio_generate` in the browser.
//
// The browser holds the owner's reference photos, so the jobs start here:
// video through /api/auteur/generate (the owner's H3 on RunPod first, then
// MiniMax, then the gateway), images through /api/studio/image. Every job runs
// in parallel and reports its own progress; a finished clip becomes a blob URL
// for this session (the conversation keeps the prompts, not the media).
// ---------------------------------------------------------------------------

export interface RenderJob {
  title: string;
  prompt: string;
  durationSec?: number;
  aspectRatio?: string;
  useReferences?: boolean;
  /** 1-based Subject numbers this job gets; absent = every upload. */
  references?: number[];
}

export interface RenderState {
  id: string;
  title: string;
  medium: "video" | "image";
  status: "rendering" | "done" | "error";
  note?: string;
  url?: string;
  error?: string;
}

/** The loose tool arguments, made safe to run. */
export function jobsFrom(args: Record<string, unknown>): { medium: "video" | "image"; jobs: RenderJob[] } {
  const medium = args.medium === "image" ? "image" : "video";
  const jobs = (Array.isArray(args.jobs) ? args.jobs : [])
    .slice(0, 12)
    .map((j, i) => {
      const o = (j ?? {}) as Record<string, unknown>;
      return {
        title: typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 80) : `Take ${i + 1}`,
        prompt: typeof o.prompt === "string" ? o.prompt.trim() : "",
        durationSec: typeof o.duration_sec === "number" ? o.duration_sec : undefined,
        aspectRatio: typeof o.aspect_ratio === "string" ? o.aspect_ratio : undefined,
        useReferences: o.use_references !== false,
        references: Array.isArray(o.references)
          ? o.references.map(Number).filter((n) => Number.isInteger(n) && n >= 1).slice(0, 6)
          : undefined,
      };
    })
    .filter((j) => j.prompt);
  return { medium, jobs };
}

/**
 * The uploads one job should see, keeping their conversation-wide numbers
 * ("Subject 3" is always the third picture the owner attached): the Subjects
 * the job lists, else the Subjects its prompt names, else the first four.
 */
export function pick(job: RenderJob, refs: string[]): { label: string; dataUrl: string }[] {
  if (!job.useReferences || !refs.length) return [];
  const named = [...job.prompt.matchAll(/Subject\s+(\d+)/gi)].map((m) => Number(m[1]));
  const wanted = job.references?.length ? job.references : named.length ? named : refs.slice(0, 4).map((_, i) => i + 1);
  return [...new Set(wanted)]
    .filter((n) => refs[n - 1])
    .slice(0, 6)
    .map((n) => ({ label: `Subject ${n}`, dataUrl: refs[n - 1] }));
}

const VIDEO_ASPECTS = ["16:9", "9:16", "1:1"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function base64ToUrl(b64: string, type: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type }));
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** The owner's free local renderer (tools/studio-bridge → WanGP on Pinokio). */
export const BRIDGE = "http://127.0.0.1:42010";

/** Is the local bridge running on this PC? */
export async function bridgeStatus(): Promise<{ ok: boolean; wangp?: boolean; queue?: number }> {
  try {
    const res = await fetch(`${BRIDGE}/health`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()) as { ok: boolean; wangp?: boolean; queue?: number };
  } catch {
    return { ok: false };
  }
}

async function renderVideoLocal(job: RenderJob, refs: string[], update: (p: Partial<RenderState>) => void): Promise<void> {
  if (!(await bridgeStatus()).ok) {
    throw new Error(
      "The free local renderer isn't running on this PC. Double-click tools/studio-bridge/start.cmd, then press Make it again.",
    );
  }
  const res = await fetch(`${BRIDGE}/video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: job.prompt,
      refs: pick(job, refs),
      durationSec: Math.min(15, Math.max(4, Math.round(job.durationSec ?? 5))),
      aspectRatio: VIDEO_ASPECTS.includes(job.aspectRatio ?? "") ? job.aspectRatio : "16:9",
    }),
  });
  const { id, error } = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!id) throw new Error(error ?? "The local renderer refused the job.");
  // ~6 minutes per 5 s clip on the RTX 3050, and jobs queue behind each other.
  for (let i = 0; i < 1080; i += 1) {
    await sleep(5000);
    const view = (await (await fetch(`${BRIDGE}/job/${id}`)).json().catch(() => ({}))) as {
      status?: string;
      position?: number;
      seconds?: number;
      error?: string;
    };
    if (view.status === "error") throw new Error(view.error ?? "The local render failed.");
    if (view.status === "done") {
      const file = await fetch(`${BRIDGE}/file/${id}`);
      if (!file.ok) throw new Error("The clip finished but couldn't be fetched from the local renderer.");
      update({ status: "done", url: URL.createObjectURL(await file.blob()) });
      return;
    }
    update({
      note:
        view.status === "queued"
          ? `local · #${view.position ?? "?"} in line`
          : `local · ${Math.floor((view.seconds ?? 0) / 60)}m ${(view.seconds ?? 0) % 60}s`,
    });
  }
  throw new Error("The local render has been going for 90 minutes — check the bridge window.");
}

async function renderVideo(job: RenderJob, refs: string[], update: (p: Partial<RenderState>) => void): Promise<void> {
  const res = await post("/api/auteur/generate", {
    action: "create",
    prompt: job.prompt,
    durationSec: Math.min(15, Math.max(4, Math.round(job.durationSec ?? 10))),
    aspectRatio: VIDEO_ASPECTS.includes(job.aspectRatio ?? "") ? job.aspectRatio : "16:9",
    references: pick(job, refs).map((r) => ({ ...r, kind: "image" })),
  });
  const data = (await res.json().catch(() => ({}))) as {
    mode?: string;
    taskId?: string;
    videoBase64?: string;
    error?: string;
  };
  if (!res.ok || data.error) throw new Error(data.error ?? `The video service failed (${res.status}).`);
  if (data.mode === "inline" && data.videoBase64) {
    update({ status: "done", url: base64ToUrl(data.videoBase64, "video/mp4") });
    return;
  }
  if (data.mode === "done") {
    throw new Error("No video model is configured on this deployment (RunPod, MiniMax or the AI Gateway).");
  }
  if (!data.taskId) throw new Error("The video service returned nothing to wait for.");

  // A cold GPU can take minutes; give up after ~20 minutes.
  for (let i = 0; i < 240; i += 1) {
    await sleep(5000);
    const s = await post("/api/auteur/generate", { action: "status", taskId: data.taskId });
    const view = (await s.json().catch(() => ({}))) as { status?: string; note?: string; error?: string; videoBase64?: string; url?: string };
    if (view.status === "error") throw new Error(view.error ?? "The render failed.");
    if (view.status === "done") {
      if (view.videoBase64) {
        update({ status: "done", url: base64ToUrl(view.videoBase64, "video/mp4") });
        return;
      }
      const file = await post("/api/auteur/generate", { action: "download", taskId: data.taskId });
      if (!file.ok) throw new Error("The clip finished but couldn't be downloaded.");
      update({ status: "done", url: URL.createObjectURL(await file.blob()) });
      return;
    }
    update({ note: view.note || (view.status === "queued" ? "queued" : "rendering") });
  }
  throw new Error("Still not finished after 20 minutes — try again later.");
}

async function renderImage(job: RenderJob, refs: string[], update: (p: Partial<RenderState>) => void): Promise<void> {
  const res = await post("/api/studio/image", {
    prompt: job.prompt,
    aspectRatio: job.aspectRatio,
    refs: pick(job, refs),
  });
  const data = (await res.json().catch(() => ({}))) as { image?: string; refusal?: string; error?: string };
  if (data.image) {
    update({ status: "done", url: data.image });
    return;
  }
  throw new Error(data.refusal ?? data.error ?? `The image service failed (${res.status}).`);
}

/**
 * Start every job. `onChange` receives the whole list each time any job moves.
 * Resolves with a one-line summary for the confirm card.
 */
export async function runRender(
  args: Record<string, unknown>,
  refs: string[],
  onChange: (states: RenderState[]) => void,
): Promise<string> {
  const { medium, jobs } = jobsFrom(args);
  if (!jobs.length) throw new Error("There was nothing to render.");
  // Video is free and local unless the owner asked for the paid cloud GPU.
  const cloud = args.engine === "cloud";
  const video = cloud ? renderVideo : renderVideoLocal;
  let states: RenderState[] = jobs.map((j, i) => ({
    id: `${Date.now()}-${i}`,
    title: j.title,
    medium,
    status: "rendering",
  }));
  onChange(states);
  const update = (i: number) => (p: Partial<RenderState>) => {
    states = states.map((s, k) => (k === i ? { ...s, ...p } : s));
    onChange(states);
  };
  await Promise.all(
    jobs.map(async (job, i) => {
      try {
        await (medium === "video" ? video : renderImage)(job, refs, update(i));
      } catch (e) {
        update(i)({ status: "error", error: e instanceof Error ? e.message : "It failed." });
      }
    }),
  );
  const done = states.filter((s) => s.status === "done").length;
  return `${done} of ${states.length} ${medium === "video" ? "clip" : "image"}${states.length === 1 ? "" : "s"} rendered.`;
}
