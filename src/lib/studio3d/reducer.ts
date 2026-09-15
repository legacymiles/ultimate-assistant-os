// Pure state transitions for one owner's list of video projects. No I/O: the
// store loads the list, runs one of these, and saves the result, so every rule
// about how a project moves through the pipeline is testable on its own.

import {
  MAX_LOG_LINES,
  MAX_STILLS,
  type Brief,
  type DirectorPlan,
  type Media,
  type ProgressUpdate,
  type ProjectStatus,
  type VideoProject,
} from "./types";

const FINISHED = new Set<ProjectStatus>(["ready", "failed"]);
/** Statuses the owner may edit and (re)queue from. */
const EDITABLE = new Set<ProjectStatus>(["storyboard", "ready", "failed"]);

function update(list: VideoProject[], id: string, fn: (p: VideoProject) => VideoProject): VideoProject[] {
  let hit = false;
  const next = list.map((p) => {
    if (p.id !== id) return p;
    hit = true;
    return fn(p);
  });
  return hit ? next : list;
}

export function addProject(
  list: VideoProject[],
  input: { id: string; ownerId: string; prompt: string; brief: Brief; plan: DirectorPlan; now: string },
): VideoProject[] {
  const project: VideoProject = {
    id: input.id,
    ownerId: input.ownerId,
    prompt: input.prompt.trim(),
    brief: input.brief,
    plan: input.plan,
    status: "storyboard",
    note: "Review the storyboard, then send it to your PC to render.",
    createdAt: input.now,
    updatedAt: input.now,
    log: [],
    stills: [],
  };
  return [project, ...list];
}

export function canEdit(p: VideoProject): boolean {
  return EDITABLE.has(p.status);
}

/** Replace the plan. Only while nothing is rendering; a finished project goes back to storyboard. */
export function setPlan(list: VideoProject[], id: string, plan: DirectorPlan, now: string, brief?: Brief): VideoProject[] {
  return update(list, id, (p) => {
    if (!canEdit(p)) return p;
    return { ...p, plan, ...(brief ? { brief } : {}), status: "storyboard", note: "Storyboard updated.", updatedAt: now };
  });
}

/** Send the storyboard to the PC. Keeps any previous video until a new one arrives. */
export function queueRender(list: VideoProject[], id: string, now: string): VideoProject[] {
  return update(list, id, (p) => {
    if (!canEdit(p)) return p;
    const { error: _e, finishedAt: _f, startedAt: _s, ...rest } = p;
    return { ...rest, status: "queued", note: "Queued for your PC", queuedAt: now, updatedAt: now };
  });
}

/** Take a queued project back out of the queue. */
export function cancelQueued(list: VideoProject[], id: string, now: string): VideoProject[] {
  return update(list, id, (p) => (p.status === "queued" ? { ...p, status: "storyboard", note: "Removed from the queue.", updatedAt: now } : p));
}

/** The oldest queued project starts building. First come, first rendered. */
export function claimNext(list: VideoProject[], now: string): { list: VideoProject[]; project: VideoProject | null } {
  const target = list
    .filter((p) => p.status === "queued")
    .sort((a, b) => (a.queuedAt ?? a.createdAt).localeCompare(b.queuedAt ?? b.createdAt))[0];
  if (!target) return { list, project: null };
  const next = update(list, target.id, (p) => ({
    ...p,
    status: "building",
    note: "Picked up by your PC",
    startedAt: now,
    updatedAt: now,
    log: [],
    report: undefined,
  }));
  return { list: next, project: next.find((p) => p.id === target.id) ?? null };
}

export function applyProgress(list: VideoProject[], id: string, u: ProgressUpdate, now: string): VideoProject[] {
  return update(list, id, (p) => {
    const next: VideoProject = { ...p, updatedAt: now };
    // Progress only moves an in-flight project. A late "rendering" from a
    // builder shutting down must not resurrect a finished or edited project.
    const inFlight = !FINISHED.has(p.status) && p.status !== "storyboard";
    if (u.status && inFlight && u.status !== "storyboard" && u.status !== "queued") {
      next.status = u.status;
      if (u.status === "ready" || u.status === "failed") next.finishedAt = now;
    }
    if (u.note !== undefined && inFlight) next.note = u.note;
    if (u.lines?.length) next.log = [...p.log, ...u.lines.map((line) => ({ t: now, line }))].slice(-MAX_LOG_LINES);
    if (u.report) next.report = u.report;
    return next;
  });
}

export function failProject(list: VideoProject[], id: string, error: string, now: string): VideoProject[] {
  return update(list, id, (p) =>
    p.status === "storyboard" ? p : { ...p, status: "failed", error, note: "Render stopped", finishedAt: now, updatedAt: now },
  );
}

export function removeProject(list: VideoProject[], id: string): VideoProject[] {
  return list.filter((p) => p.id !== id);
}

export function addStill(list: VideoProject[], id: string, still: Omit<Media, "at">, now: string): VideoProject[] {
  return update(list, id, (p) => {
    if (still.file && p.stills.some((s) => s.file === still.file)) return p;
    return { ...p, stills: [...p.stills, { ...still, at: now }].slice(-MAX_STILLS), updatedAt: now };
  });
}

/** Attach the rendered video. Returns the replaced media so the store can delete its bytes. */
export function setVideo(list: VideoProject[], id: string, video: Omit<Media, "at">, now: string): { list: VideoProject[]; replaced: Media | null } {
  let replaced: Media | null = null;
  const next = update(list, id, (p) => {
    if (p.video && p.video.key !== video.key) replaced = p.video;
    return { ...p, video: { ...video, at: now }, updatedAt: now };
  });
  return { list: next, replaced };
}
