import { calibrationFactor, estimateAccuracy, recostMaterials } from "../calc";
import type { Project } from "../types";
import { keys, listAllByPrefix, serviceStore, userStore } from "./store";

/** Project reads and writes. Newest first, always (U6). */

export async function listProjects(userId: string): Promise<Project[]> {
  const store = await userStore(userId);
  if (!store) return [];
  const rows = await store.list<Project>(keys.projectPrefix());
  return rows
    .map((r) => r.data)
    .filter((p): p is Project => Boolean(p && p.id))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export async function getProject(
  userId: string,
  projectId: string,
): Promise<Project | null> {
  const store = await userStore(userId);
  if (!store) return null;
  return store.get<Project>(keys.project(projectId));
}

export class StaleWriteError extends Error {
  constructor() {
    super("That plan changed somewhere else while you were editing it.");
    this.name = "StaleWriteError";
  }
}

/**
 * Save a plan, optionally guarding against a concurrent write.
 *
 * Pass `expectedRev` and the write is refused if the stored record has moved
 * on since it was read. The caller re-reads and replays rather than silently
 * clobbering whatever the other write changed.
 */
export async function saveProject(
  project: Project,
  expectedRev?: number,
): Promise<Project> {
  const store = await userStore(project.ownerId);

  if (store && expectedRev !== undefined) {
    const current = await store.get<Project>(keys.project(project.id));
    if (current && (current.rev ?? 0) !== expectedRev) throw new StaleWriteError();
  }

  const next: Project = {
    ...project,
    materials: recostMaterials(project.materials, project.dimensions),
    rev: (project.rev ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  if (store) await store.set(keys.project(project.id), next);
  return next;
}

/** Service-role save, used by the streaming generator which owns the row. */
export async function saveProjectAsService(project: Project): Promise<Project> {
  const next: Project = {
    ...project,
    materials: recostMaterials(project.materials, project.dimensions),
    updatedAt: new Date().toISOString(),
  };
  await serviceStore(project.ownerId).set(keys.project(project.id), next);
  return next;
}

export async function deleteProject(userId: string, projectId: string): Promise<void> {
  const store = await userStore(userId);
  if (!store) return;
  const project = await store.get<Project>(keys.project(projectId));
  if (project?.share?.token) {
    await store.del(keys.share(project.share.token)).catch(() => {});
  }
  await store.del(keys.project(projectId));
}

/* ---------------------------------------------------------------- the loop */

/**
 * The goal beyond the goal: real receipts make future estimates sharper.
 *
 * Pools every finished build of a type ACROSS ALL USERS (ids and titles are
 * never read — only the estimate/actual pair) and returns a correction factor
 * for the next plan of that type. Needs three finished builds before it will
 * touch a number, and clamps hard. See calc.calibrationFactor.
 */
export async function calibrationForBuildType(
  buildType: string,
): Promise<{ factor: number; sampleSize: number } | null> {
  if (!buildType || buildType === "other") return null;
  try {
    const rows = await listAllByPrefix<Project>(keys.projectPrefix(), 600);
    const samples: { estimate: number; actual: number }[] = [];
    for (const row of rows) {
      const p = row.data;
      if (!p || p.buildType !== buildType) continue;
      if (!p.receipts?.length) continue;
      const acc = estimateAccuracy(p);
      if (!acc) continue;
      // Only builds where most of the list was actually bought teach us anything.
      if (acc.coverage < 0.6 && p.stage !== "sold") continue;
      samples.push({ estimate: acc.estimate, actual: acc.actual });
    }
    return calibrationFactor(samples);
  } catch {
    return null;
  }
}

/** How accurate this user's own estimates have been — shown on the board. */
export function userAccuracy(projects: Project[]): {
  builds: number;
  medianErrorPct: number;
  within15: number;
} | null {
  const errs: number[] = [];
  let within = 0;
  for (const p of projects) {
    const acc = estimateAccuracy(p);
    if (!acc || acc.coverage < 0.6) continue;
    errs.push(Math.abs(acc.deltaPct));
    if (acc.within15) within++;
  }
  if (errs.length === 0) return null;
  errs.sort((a, b) => a - b);
  const mid = errs[Math.floor(errs.length / 2)]!;
  return { builds: errs.length, medianErrorPct: mid, within15: within };
}
