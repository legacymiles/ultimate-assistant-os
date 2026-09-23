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

/**
 * A person (or thing) from the owner's Photos tab that this conversation named,
 * carrying the reference faces the library already holds. Nothing was uploaded
 * for these — not having to is the entire point of @-mentioning someone.
 */
export interface CharacterRef {
  token: string;
  name: string;
  images: string[];
}

/**
 * Everything the jobs of one render can be shown. Uploads keep their
 * conversation-wide numbers; characters are named, because "Brandy" is not the
 * third file somebody dragged into a box.
 */
export interface RefPool {
  subjects: string[];
  characters: CharacterRef[];
}

export interface RenderState {
  id: string;
  title: string;
  medium: "video" | "image";
  status: "rendering" | "done" | "error";
  note?: string;
  url?: string;
  error?: string;
  /** The prompt that made it, carried through so the gallery can keep it. */
  prompt?: string;
  /** The finished bytes. A blob URL dies with the tab; these are filed. */
  blob?: Blob;
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

/** The most reference images one render is given. */
const MAX_JOB_REFS = 6;

/**
 * Everything one job should see.
 *
 * CHARACTERS COME FIRST, and attaching them is not conditional on the job's
 * text. A prompt that names someone from the library carries their DESCRIPTION
 * rather than their @token — that is what makes it renderable at all — so by the
 * time a job arrives here there is nothing in its words to match them by.
 * Attaching the faces of everyone the conversation named is therefore the only
 * behaviour that keeps them the same person from clip to clip, which is the
 * whole reason to mention them.
 *
 * Then the uploads, keeping their conversation-wide numbers ("Subject 3" is
 * always the third picture the owner attached): the Subjects the job lists, else
 * the Subjects its prompt names, else the first few.
 */
export function pick(
  job: RenderJob,
  refs: string[],
  characters: CharacterRef[] = [],
): { label: string; dataUrl: string }[] {
  if (!job.useReferences) return [];
  const out: { label: string; dataUrl: string }[] = [];

  // A job may still narrow the cast by naming tokens; most do not, and then
  // everyone the owner named is in the shot.
  const cast = characters.filter((c) => tokenNamed(job.prompt, c.token));
  const wantedCast = cast.length ? cast : characters;
  // Two angles of one face, or one each in a crowd: a third shot of the same
  // person would crowd out the second person in a two-hander.
  const perCharacter = wantedCast.length > 2 ? 1 : 2;
  for (const c of wantedCast) {
    for (const url of c.images.slice(0, perCharacter)) {
      if (out.length < MAX_JOB_REFS) out.push({ label: c.name, dataUrl: url });
    }
  }

  if (refs.length) {
    const numbers = [...job.prompt.matchAll(/@?\bSubject[\s-]*(\d+)\b/gi)].map((m) => Number(m[1]));
    const wanted = job.references?.length
      ? job.references
      : numbers.length
        ? numbers
        : refs.slice(0, 4).map((_, i) => i + 1);
    for (const n of [...new Set(wanted)]) {
      if (refs[n - 1] && out.length < MAX_JOB_REFS) {
        out.push({ label: `Subject ${n}`, dataUrl: refs[n - 1] });
      }
    }
  }
  return out;
}

/** Does this prompt name "@Brandy"? Tokens are owner-typed, so they are escaped. */
function tokenNamed(prompt: string, token: string): boolean {
  const safe = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@${safe}(?![\\p{L}\\p{N}-])`, "iu").test(prompt);
}

const VIDEO_ASPECTS = ["16:9", "9:16", "1:1"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function base64ToBlob(b64: string, type: string): Blob {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}

/** Hand a finished blob to the caller as both a playable URL and the bytes. */
function finished(blob: Blob): Partial<RenderState> {
  return { status: "done", url: URL.createObjectURL(blob), blob };
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

async function renderVideoLocal(job: RenderJob, pool: RefPool, update: (p: Partial<RenderState>) => void): Promise<void> {
  if (!(await bridgeStatus()).ok) {
    throw new Error(
      "The free local renderer isn't running on this PC. Double-click "
        + "tools/studio-bridge/install-autostart.cmd once — it starts the renderer now and again every time "
        + "you sign in — then press Make it again.",
    );
  }
  const res = await fetch(`${BRIDGE}/video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: job.prompt,
      refs: pick(job, pool.subjects, pool.characters),
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
      update(finished(await file.blob()));
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

async function renderVideo(job: RenderJob, pool: RefPool, update: (p: Partial<RenderState>) => void): Promise<void> {
  const res = await post("/api/auteur/generate", {
    action: "create",
    prompt: job.prompt,
    durationSec: Math.min(15, Math.max(4, Math.round(job.durationSec ?? 10))),
    aspectRatio: VIDEO_ASPECTS.includes(job.aspectRatio ?? "") ? job.aspectRatio : "16:9",
    references: pick(job, pool.subjects, pool.characters).map((r) => ({ ...r, kind: "image" })),
  });
  const data = (await res.json().catch(() => ({}))) as {
    mode?: string;
    taskId?: string;
    videoBase64?: string;
    error?: string;
  };
  if (!res.ok || data.error) throw new Error(data.error ?? `The video service failed (${res.status}).`);
  if (data.mode === "inline" && data.videoBase64) {
    update(finished(base64ToBlob(data.videoBase64, "video/mp4")));
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
        update(finished(base64ToBlob(view.videoBase64, "video/mp4")));
        return;
      }
      const file = await post("/api/auteur/generate", { action: "download", taskId: data.taskId });
      if (!file.ok) throw new Error("The clip finished but couldn't be downloaded.");
      update(finished(await file.blob()));
      return;
    }
    update({ note: view.note || (view.status === "queued" ? "queued" : "rendering") });
  }
  throw new Error("Still not finished after 20 minutes — try again later.");
}

async function renderImage(job: RenderJob, pool: RefPool, update: (p: Partial<RenderState>) => void): Promise<void> {
  const res = await post("/api/studio/image", {
    prompt: job.prompt,
    aspectRatio: job.aspectRatio,
    refs: pick(job, pool.subjects, pool.characters),
  });
  const data = (await res.json().catch(() => ({}))) as { image?: string; refusal?: string; error?: string };
  if (data.image) {
    // A data URL cannot be filed, so keep the bytes as well as the preview.
    const blob = await fetch(data.image)
      .then((r) => r.blob())
      .catch(() => null);
    update(blob ? { status: "done", url: data.image, blob } : { status: "done", url: data.image });
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
  pool: RefPool,
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
    prompt: j.prompt,
  }));
  onChange(states);
  const update = (i: number) => (p: Partial<RenderState>) => {
    states = states.map((s, k) => (k === i ? { ...s, ...p } : s));
    onChange(states);
  };
  await Promise.all(
    jobs.map(async (job, i) => {
      try {
        await (medium === "video" ? video : renderImage)(job, pool, update(i));
      } catch (e) {
        update(i)({ status: "error", error: e instanceof Error ? e.message : "It failed." });
      }
    }),
  );
  const done = states.filter((s) => s.status === "done").length;
  return `${done} of ${states.length} ${medium === "video" ? "clip" : "image"}${states.length === 1 ? "" : "s"} rendered.`;
}
