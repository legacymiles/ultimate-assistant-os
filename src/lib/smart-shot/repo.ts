// ---------------------------------------------------------------------------
// Smart Shot — project persistence. One list of projects in localStorage,
// most recent first. Bytes live in media.ts; a project only carries ids and
// the small upload data URLs.
// ---------------------------------------------------------------------------

"use client";

import { nowIso, uid } from "@/lib/utils";
import type { Brief, Project } from "./types";

const KEY = "smart-shot:v1";

export function defaultBrief(): Brief {
  return { prompt: "", cutCount: 4, totalSec: 15, aspectRatio: "16:9", look: "live-action", quality: "medium" };
}

export function newProject(): Project {
  const now = nowIso();
  return {
    id: uid("ssp"),
    title: "Untitled",
    brief: defaultBrief(),
    uploads: [],
    plan: null,
    panels: [],
    takes: [],
    promptOverrides: {},
    stage: "brief",
    createdAt: now,
    updatedAt: now,
  };
}

export function loadProjects(): Project[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Project[]) : [];
    return Array.isArray(list) ? list.map(normalize) : [];
  } catch {
    return [];
  }
}

export function saveProjects(list: Project[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20)));
  } catch (err) {
    console.warn("[smart-shot] could not save projects", err);
  }
}

/** Interrupted work is settled on load, never on save. */
function normalize(p: Project): Project {
  return {
    ...p,
    panels: (p.panels ?? []).map((x) => (x.status === "drawing" ? { ...x, status: x.mediaId ? "done" : "idle" } : x)),
    takes: (p.takes ?? []).map((t) =>
      t.status === "queued" || t.status === "generating"
        ? t.taskId
          ? t
          : { ...t, status: "error" as const, error: "Interrupted before the render started." }
        : t,
    ),
    promptOverrides: p.promptOverrides ?? {},
    brief: { ...p.brief, totalSec: p.brief?.totalSec ?? 15, quality: p.brief?.quality ?? "medium" },
    plan: p.plan
      ? {
          ...p.plan,
          products: p.plan.products ?? [],
          setNotes: p.plan.setNotes ?? "",
          props: p.plan.props ?? "",
          styleEssence: p.plan.styleEssence ?? "",
          lightingNote: p.plan.lightingNote ?? "",
          lensNote: p.plan.lensNote ?? "",
          cuts: p.plan.cuts.map((c) => ({ ...c, aperture: c.aperture ?? "f/2", productIds: c.productIds ?? [] })),
        }
      : null,
  };
}

export function upsert(list: Project[], p: Project): Project[] {
  const next = { ...p, updatedAt: nowIso() };
  return [next, ...list.filter((x) => x.id !== p.id)];
}
