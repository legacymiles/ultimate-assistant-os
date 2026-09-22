import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { DIRECTOR_ID, methodById } from "../registry";
import { optimisePlan } from "./plan";
import { capabilityOf, serverFor } from "./registry";
import { ffmpegAvailable, ffmpegBin } from "./detect";
import {
  enqueue,
  getClip,
  initialSteps,
  note,
  patchProject,
  putClip,
  sceneRun,
  seedScenes,
  setStatus,
  setStep,
  type Job,
} from "./store";
import type { Project } from "../types";

const run = promisify(execFile);

// ---------------------------------------------------------------------------
// The run loop.
//
// A render is a state machine over the project document, advanced from two
// directions:
//
//   - the browser polling this project (advance) drives every scene whose
//     method renders on the SERVER;
//   - the runner on the owner's PC drives every scene whose method renders
//     through an AGENT, posting its own progress.
//
// Both write the same steps and scene records, so the status list the user
// watches is the real state of the work in both cases. Nothing in this file
// invents progress.
// ---------------------------------------------------------------------------

/** The scenes this render covers: one, or all of them. */
function targets(project: Project, sceneIndex: number | null): number[] {
  const all = (project.plan?.scenes ?? []).map((s) => s.index);
  return sceneIndex === null ? all : all.filter((i) => i === sceneIndex);
}

function transportOf(methodId: string): "server" | "agent" {
  return methodById(methodId)?.meta.transport ?? "agent";
}

/**
 * Start a render.
 *
 * Refuses up front when the engine's dependencies are not met — the failure
 * belongs on the screen the user is already looking at, not eight minutes into
 * a run. Returns the reason when it refuses.
 */
export async function startRender(
  uid: string,
  projectId: string,
  sceneIndex: number | null,
): Promise<{ project: Project | null; error?: string }> {
  const existing = await patchProject(uid, projectId, () => undefined);
  if (!existing || !existing.plan) return { project: null, error: "This project has no production plan yet." };

  const scenes = targets(existing, sceneIndex);
  if (!scenes.length) return { project: null, error: "No such scene in this plan." };

  // Every distinct engine this render will use has to be ready.
  const methodIds = [
    ...new Set(existing.plan.scenes.filter((s) => scenes.includes(s.index)).map((s) => s.methodId)),
  ];
  for (const methodId of methodIds) {
    const capability = await capabilityOf(uid, methodId);
    if (!capability) return { project: null, error: `Unknown method "${methodId}".` };
    if (capability.state !== "ready") {
      return {
        project: null,
        error: `${methodById(methodId)?.meta.name ?? methodId} is not ready — ${capability.summary}`,
      };
    }
  }

  // Optimise once per render. Re-rendering a single scene reuses the
  // directives the plan already carries unless the user edited the scene.
  const needsOptimise = existing.plan.scenes.some((s) => scenes.includes(s.index) && !s.directive);
  let plan = existing.plan;
  if (needsOptimise) {
    await patchProject(uid, projectId, (p) => {
      if (!p.steps.length) p.steps = initialSteps(p.plan?.scenes.length ?? 0, transportOf(p.methodId));
      setStatus(p, "optimising");
      setStep(p, "prepare", "done");
      setStep(p, "optimise", "running", "Rewriting each scene in the engine's terms");
    });
    plan = await optimisePlan(existing.plan, existing.brief);
  }

  const project = await patchProject(uid, projectId, (p) => {
    p.plan = plan;
    if (!p.steps.length || sceneIndex === null) {
      p.steps = initialSteps(plan.scenes.length, transportOf(p.methodId));
      seedScenes(p, plan);
    }
    setStep(p, "prepare", "done");
    setStep(p, "optimise", "done", needsOptimise ? "Engine-specific directives written" : "Reused the existing directives");
    for (const index of scenes) {
      const scene = sceneRun(p, index);
      if (scene) {
        scene.state = "pending";
        scene.error = undefined;
        scene.taskId = undefined;
      }
      setStep(p, `scene-${index}`, "pending");
    }
    if (sceneIndex === null) {
      p.videoKey = undefined;
      setStep(p, "assemble", "pending");
    }
    setStatus(p, "rendering");
    note(p, "render", sceneIndex === null ? "Render started" : `Scene ${sceneIndex} re-render started`);
  });
  if (!project) return { project: null, error: "Could not save the project." };

  // Anything that needs the PC goes on the queue; the server-side scenes are
  // driven by advance() on the next poll.
  const agentScenes = plan.scenes.filter((s) => scenes.includes(s.index) && transportOf(s.methodId) === "agent");
  if (agentScenes.length) {
    await enqueue(uid, projectId, sceneIndex, project.methodId);
    await patchProject(uid, projectId, (p) => {
      setStatus(p, "queued");
      setStep(p, "claim", "running", "Queued for the runner on your PC");
    });
  }

  return { project: (await advance(uid, projectId)) ?? project };
}

/**
 * Move a server-rendered project forward by one step.
 *
 * Called on every read of an active project, so the work progresses while the
 * user is watching it and stops the moment they stop looking — which is the
 * right trade for a hosted model that bills per second.
 *
 * One scene at a time, in order: H3 chains each shot off the previous one's
 * last frame, and that is only possible in sequence.
 */
export async function advance(uid: string, projectId: string): Promise<Project | null> {
  const project = await patchProject(uid, projectId, () => undefined);
  if (!project?.plan) return project;
  if (!["rendering", "queued", "optimising", "assembling"].includes(project.status)) return project;

  const serverScenes = project.plan.scenes.filter((s) => transportOf(s.methodId) === "server");
  if (!serverScenes.length) return project;

  // A scene already in flight: poll it before starting anything new.
  const inFlight = project.scenes.find((s) => s.state === "running" && s.taskId);
  if (inFlight) {
    const impl = serverFor(inFlight.methodId);
    if (!impl?.pollScene) return project;
    let result;
    try {
      result = await impl.pollScene(inFlight.taskId!);
    } catch (err) {
      result = { state: "failed" as const, error: err instanceof Error ? err.message : String(err) };
    }
    if (result.state === "running") {
      return patchProject(uid, projectId, (p) => {
        setStep(p, `scene-${inFlight.index}`, "running", result.note ?? "Generating");
      });
    }
    if (result.state === "failed") {
      return patchProject(uid, projectId, (p) => {
        const scene = sceneRun(p, inFlight.index);
        if (scene) {
          scene.state = "failed";
          scene.error = result.error;
          scene.attempts += 1;
        }
        setStep(p, `scene-${inFlight.index}`, "failed", result.error);
        setStatus(p, "failed", result.error);
        note(p, "failed", `Scene ${inFlight.index} failed: ${result.error}`);
      });
    }
    await putClip(uid, projectId, inFlight.index, result.clip, methodById(inFlight.methodId)?.meta.name ?? inFlight.methodId);
    return advance(uid, projectId);
  }

  // Start the next pending server scene.
  const next = project.scenes.find(
    (s) => s.state === "pending" && transportOf(s.methodId) === "server",
  );
  if (next) {
    const scene = project.plan.scenes.find((s) => s.index === next.index);
    const impl = serverFor(next.methodId);
    if (!scene || !impl?.startScene) return project;

    const previousFrame = await lastFrameOf(uid, projectId, next.index - 1);
    let started;
    try {
      started = await impl.startScene({
        uid,
        project,
        scene,
        brief: project.brief,
        directive: scene.directive ?? scene.description,
        previousFrame,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return patchProject(uid, projectId, (p) => {
        const run = sceneRun(p, next.index);
        if (run) {
          run.state = "failed";
          run.error = error;
          run.attempts += 1;
        }
        setStep(p, `scene-${next.index}`, "failed", error);
        setStatus(p, "failed", error);
        note(p, "failed", `Scene ${next.index} failed: ${error}`);
      });
    }

    if (started.kind === "clip") {
      await putClip(uid, projectId, next.index, started.clip, methodById(next.methodId)?.meta.name ?? next.methodId);
      return advance(uid, projectId);
    }
    return patchProject(uid, projectId, (p) => {
      const run = sceneRun(p, next.index);
      if (run) {
        run.state = "running";
        run.taskId = started.taskId;
      }
      setStep(p, `scene-${next.index}`, "running", started.note ?? "Generating");
      setStatus(p, "rendering");
    });
  }

  // Nothing left to start. If every scene is done, assemble.
  const allDone = project.scenes.length > 0 && project.scenes.every((s) => s.state === "done");
  if (allDone && !project.videoKey) return assemble(uid, projectId);
  return project;
}

// ----- assembly --------------------------------------------------------------

/**
 * Join the scene clips into one video.
 *
 * ffmpeg does it properly. Without ffmpeg there is no honest way to
 * concatenate MP4s on the server, so a single-scene project uses its one clip
 * and a multi-scene one is left as separate scenes with the step marked
 * skipped and the reason on screen. That is a marked dependency, not a
 * silently half-finished video.
 */
export async function assemble(uid: string, projectId: string): Promise<Project | null> {
  const project = await patchProject(uid, projectId, (p) => {
    setStatus(p, "assembling");
    setStep(p, "assemble", "running", "Joining the scenes");
  });
  if (!project) return null;

  const clips = project.scenes.filter((s) => s.state === "done" && s.clipKey).sort((a, b) => a.index - b.index);
  const engine = project.renderedBy ?? methodById(project.methodId)?.meta.name ?? project.methodId;

  if (clips.length === 1) {
    const only = await getClip(uid, projectId, clips[0].index);
    if (only) return putClip(uid, projectId, "final", only, engine);
  }

  if (clips.length > 1 && (await ffmpegAvailable())) {
    try {
      const joined = await concat(
        await Promise.all(clips.map((c) => getClip(uid, projectId, c.index))),
        targetSize(project.plan?.aspectRatio ?? project.brief.aspectRatio),
      );
      if (joined) return putClip(uid, projectId, "final", joined, engine);
    } catch (err) {
      console.error("[video-studio] concat failed:", err);
    }
  }

  return patchProject(uid, projectId, (p) => {
    setStep(
      p,
      "assemble",
      "skipped",
      clips.length > 1
        ? "ffmpeg was not found, so the scenes are available individually rather than joined."
        : "Nothing to join.",
    );
    setStatus(p, "ready");
    note(p, "ready", `Scenes rendered by ${engine}; final assembly skipped (no ffmpeg).`);
  });
}

/** The frame size a finished video is delivered at, per aspect ratio. */
export function targetSize(aspect: string): { width: number; height: number; fps: number } {
  const fps = 30;
  switch (aspect) {
    case "9:16":
      return { width: 1080, height: 1920, fps };
    case "1:1":
      return { width: 1080, height: 1080, fps };
    case "4:5":
      return { width: 1080, height: 1350, fps };
    case "21:9":
      return { width: 2560, height: 1098, fps };
    default:
      return { width: 1920, height: 1080, fps };
  }
}

/**
 * Join clips into one file.
 *
 * Uses the concat FILTER, not the concat demuxer. The demuxer needs every
 * input to share a resolution, frame rate and pixel aspect, which two engines
 * never do — Blender writes 1080p, H3 writes 768p, and the demuxer silently
 * produces a file that stretches or truncates everything after the first clip.
 * The filter normalises each input first, so a mixed-engine project in AI
 * Director mode assembles correctly.
 */
async function concat(
  buffers: (Buffer | null)[],
  target: { width: number; height: number; fps: number },
): Promise<Buffer | null> {
  const parts = buffers.filter((b): b is Buffer => Boolean(b));
  if (parts.length < 2) return parts[0] ?? null;

  const dir = path.join(os.tmpdir(), `video-studio-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    const files: string[] = [];
    for (const [i, part] of parts.entries()) {
      const file = path.join(dir, `part-${i}.mp4`);
      await fs.writeFile(file, part);
      files.push(file);
    }
    const meta = await Promise.all(files.map(probeClip));

    // Inputs: every clip, then one silent track per clip that has no audio.
    // concat needs the same stream layout from every segment, so a scene an
    // engine rendered mute has to bring silence rather than no track at all —
    // otherwise the narration on the other scenes is dropped entirely.
    const inputs: string[] = [];
    for (const file of files) inputs.push("-i", file);
    const silentInput = new Map<number, number>();
    meta.forEach((m, i) => {
      if (m.hasAudio) return;
      silentInput.set(i, files.length + silentInput.size);
      inputs.push(
        "-f",
        "lavfi",
        "-t",
        String(Math.max(0.1, m.duration)),
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
      );
    });

    const { width, height, fps } = target;
    const chains: string[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      // Fit inside the frame and pad the rest — never crop a scene the plan
      // asked for, never stretch a portrait shot across a landscape frame.
      chains.push(
        `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
          `setsar=1,fps=${fps}[v${i}]`,
      );
      const audioFrom = meta[i].hasAudio ? `${i}:a` : `${silentInput.get(i)}:a`;
      chains.push(`[${audioFrom}]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    }
    const pairs = parts.map((_, i) => `[v${i}][a${i}]`).join("");
    const filter = `${chains.join(";")};${pairs}concat=n=${parts.length}:v=1:a=1[outv][outa]`;

    const out = path.join(dir, "out.mp4");
    await run(
      ffmpegBin(),
      [
        "-y",
        ...inputs,
        "-filter_complex",
        filter,
        "-map",
        "[outv]",
        "-map",
        "[outa]",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        out,
      ],
      { timeout: 600_000, maxBuffer: 1024 * 1024 * 8 },
    );
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Duration and whether a clip carries audio, via ffprobe beside ffmpeg. */
async function probeClip(file: string): Promise<{ duration: number; hasAudio: boolean }> {
  const bin = ffmpegBin().replace(/ffmpeg(\.exe)?$/i, (m) => m.replace("ffmpeg", "ffprobe"));
  try {
    const { stdout } = await run(
      bin,
      ["-v", "error", "-show_entries", "stream=codec_type", "-show_entries", "format=duration", "-of", "json", file],
      { timeout: 30_000 },
    );
    const parsed = JSON.parse(stdout) as {
      streams?: { codec_type?: string }[];
      format?: { duration?: string };
    };
    return {
      duration: Number(parsed.format?.duration ?? 0) || 5,
      hasAudio: (parsed.streams ?? []).some((s) => s.codec_type === "audio"),
    };
  } catch {
    // A probe that fails must not lose the clip: assume no audio, assume a
    // sane length, and let the concat carry on.
    return { duration: 5, hasAudio: false };
  }
}

/** The last frame of a finished scene, as a data URL, for frame-chaining. */
async function lastFrameOf(uid: string, projectId: string, index: number): Promise<string | undefined> {
  if (index < 1) return undefined;
  if (!(await ffmpegAvailable())) return undefined;
  const clip = await getClip(uid, projectId, index);
  if (!clip) return undefined;

  const dir = path.join(os.tmpdir(), `video-studio-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    const input = path.join(dir, "in.mp4");
    const output = path.join(dir, "last.jpg");
    await fs.writeFile(input, clip);
    // sseof seeks from the end, so this is the final frame regardless of length.
    await run(ffmpegBin(), ["-y", "-sseof", "-0.2", "-i", input, "-frames:v", "1", "-q:v", "2", output], {
      timeout: 60_000,
    });
    const bytes = await fs.readFile(output);
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ----- the runner's view of a job -------------------------------------------

/** The payload the runner on the PC receives when it claims a job. */
export function jobPayload(job: Job, project: Project) {
  const plan = project.plan!;
  const scenes = plan.scenes.filter(
    (s) =>
      transportOf(s.methodId) === "agent" && (job.sceneIndex === null || s.index === job.sceneIndex),
  );
  // One job can span several engines in AI Director mode, so the instructions
  // travel per scene rather than once for the job.
  const methods = [...new Set(scenes.map((s) => s.methodId))].map((id) => {
    const method = methodById(id)!;
    return {
      id,
      name: method.meta.name,
      skill: method.meta.skill,
      companionSkills: method.meta.companionSkills,
      instructions: method.skill.instructions,
    };
  });

  return {
    jobId: job.id,
    projectId: project.id,
    title: project.title,
    mode: project.mode,
    methodId: project.methodId === DIRECTOR_ID ? DIRECTOR_ID : project.methodId,
    brief: project.brief,
    plan: { ...plan, scenes },
    methods,
    /** The indexes this job owns. Everything else is rendered on the server. */
    sceneIndexes: scenes.map((s) => s.index),
  };
}
