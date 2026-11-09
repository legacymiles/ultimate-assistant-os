// ---------------------------------------------------------------------------
// Client Review's list rules: what state a project is in, and how the owner
// finds one among many.
//
// This exists because App Builder now opens a review project for every build.
// A list that was a handful of client sites becomes every app the owner has
// ever made, so "newest first, and let me search it" stops being a nicety.
//
// Pure, so the admin list, the client list and the tests cannot disagree about
// what "being created" means.
// ---------------------------------------------------------------------------

import { isSentToClient } from "./logic";
import type { ClientProject } from "./types";

export type SortMode = "newest" | "oldest" | "az" | "za" | "updated";

export const SORTS: { id: SortMode; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "az", label: "A–Z" },
  { id: "za", label: "Z–A" },
  { id: "updated", label: "Recently changed" },
];

export const DEFAULT_SORT: SortMode = "newest";

export function isSortMode(v: unknown): v is SortMode {
  return SORTS.some((s) => s.id === v);
}

/**
 * Has this never been anywhere yet?
 *
 * A version being built is not interesting on its own — v3 of a live site is
 * also "building". What the owner needs to tell apart is an app that does not
 * exist anywhere yet, because that one has no address to open, nothing to
 * review, and nothing to send. So: something is building AND nothing has ever
 * shipped.
 */
export function isBeingCreated(p: ClientProject): boolean {
  const building = p.versions.some((v) => v.status === "building");
  const everShipped = p.versions.some((v) => Boolean(v.siteUrl));
  return building && !everShipped;
}

/** The version being built, whether it is the first or the fifth. */
export function buildingVersionNumber(p: ClientProject): string | null {
  return p.versions.find((v) => v.status === "building")?.number ?? null;
}

export type ProjectState = "archived" | "being-created" | "building" | "waiting" | "unsent" | "live";

/**
 * One word for where a project stands, in the order that matters to the owner:
 * what is archived, what does not exist yet, what is mid-build, what is waiting
 * on them, what has not been sent, and what is simply live.
 */
export function projectState(p: ClientProject): ProjectState {
  if (p.archived) return "archived";
  if (isBeingCreated(p)) return "being-created";
  if (p.versions.some((v) => v.status === "building")) return "building";
  if (p.batches.some((b) => b.status === "pending")) return "waiting";
  if (!isSentToClient(p)) return "unsent";
  return "live";
}

export const STATE_LABEL: Record<ProjectState, string> = {
  archived: "Archived",
  "being-created": "Being created",
  building: "Building",
  waiting: "Waiting on you",
  unsent: "Not sent",
  live: "With the client",
};

/** When this project came into existence — what "newest" sorts on. */
export function createdAt(p: ClientProject): number {
  const t = Date.parse(p.createdAt);
  return Number.isFinite(t) ? t : 0;
}

function updatedAt(p: ClientProject): number {
  const t = Date.parse(p.updatedAt);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Name match across the things the owner would actually type: the project's
 * name and the client's. Case- and punctuation-insensitive, so "glow spa"
 * finds "Glow-Spa" and "O'Brien" is reachable without the apostrophe.
 */
export function searchProjects(list: ClientProject[], query: string): ClientProject[] {
  const q = norm(query);
  if (!q) return list;
  return list.filter((p) => norm(`${p.name} ${p.clientName ?? ""}`).includes(q));
}

function norm(s: string): string {
  return (
    s
      .toLowerCase()
      // An apostrophe JOINS rather than separates: dropping it turns O'Brien
      // into "obrien", which is how someone types it when searching. Treating
      // it as punctuation gives "o brien", which that search then misses.
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}

/** A stable order: the chosen key, then name, then id, so rows never shuffle. */
export function sortProjects(list: ClientProject[], mode: SortMode = DEFAULT_SORT): ClientProject[] {
  const byName = (a: ClientProject, b: ClientProject) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const tie = (a: ClientProject, b: ClientProject) => byName(a, b) || a.id.localeCompare(b.id);
  const out = [...list];
  switch (mode) {
    case "oldest":
      return out.sort((a, b) => createdAt(a) - createdAt(b) || tie(a, b));
    case "az":
      return out.sort((a, b) => byName(a, b) || a.id.localeCompare(b.id));
    case "za":
      return out.sort((a, b) => byName(b, a) || a.id.localeCompare(b.id));
    case "updated":
      return out.sort((a, b) => updatedAt(b) - updatedAt(a) || tie(a, b));
    case "newest":
    default:
      return out.sort((a, b) => createdAt(b) - createdAt(a) || tie(a, b));
  }
}

/** Search then sort, which is the only order the list is ever built in. */
export function listProjects(list: ClientProject[], { query = "", sort = DEFAULT_SORT }: { query?: string; sort?: SortMode } = {}): ClientProject[] {
  return sortProjects(searchProjects(list, query), sort);
}
