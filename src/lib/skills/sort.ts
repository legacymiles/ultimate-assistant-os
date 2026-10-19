// ---------------------------------------------------------------------------
// Skills Library — sort order and the "Added" date filter.
//
// Pure, so the page and the tests share it. Dates are the skill's createdAt:
// when it was added by hand, or first synced in from Claude Code (a re-sync
// keeps the original date). Built-ins carry the date they shipped.
// A skill with a missing or broken date always sorts last and only shows
// under "Any time" — it is never hidden by "Newest".
// ---------------------------------------------------------------------------

import type { Skill } from "./types";

export type SkillSort = "recommended" | "newest" | "oldest" | "updated" | "az";
export type AddedWithin = "any" | "7d" | "30d" | "year";

export const SORTS: { id: SkillSort; label: string }[] = [
  { id: "recommended", label: "Recommended" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "updated", label: "Recently updated" },
  { id: "az", label: "A–Z" },
];

export const ADDED: { id: AddedWithin; label: string }[] = [
  { id: "any", label: "Any time" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "year", label: "This year" },
];

const DAY = 86_400_000;

/** Milliseconds, or null when the date is missing or unreadable. */
export function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Featured, hand-added (newest), Studio agents, Personal, plugins A–Z. */
function rank(s: Skill): number {
  if (s.source === "featured") return 0;
  if (s.source === "manual") return 1;
  if (s.source === "studio") return 2;
  return s.origin === "Personal" ? 3 : 4;
}

function byTitle(a: Skill, b: Skill): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

/** Newer first (dir 1) or older first (dir -1); undated always last, then A–Z. */
function byDate(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir * (b - a);
}

export function sortSkills(list: Skill[], sort: SkillSort = "recommended"): Skill[] {
  return [...list].sort((a, b) => {
    switch (sort) {
      case "newest":
        return byDate(timeOf(a.createdAt), timeOf(b.createdAt), 1) || byTitle(a, b);
      case "oldest":
        return byDate(timeOf(a.createdAt), timeOf(b.createdAt), -1) || byTitle(a, b);
      case "updated":
        return byDate(timeOf(a.updatedAt) ?? timeOf(a.createdAt), timeOf(b.updatedAt) ?? timeOf(b.createdAt), 1) || byTitle(a, b);
      case "az":
        return byTitle(a, b);
      default: {
        const r = rank(a) - rank(b);
        if (r !== 0) return r;
        if (rank(a) <= 1) return byDate(timeOf(a.createdAt), timeOf(b.createdAt), 1) || byTitle(a, b);
        const o = (a.origin ?? "").localeCompare(b.origin ?? "");
        return o !== 0 ? o : byTitle(a, b);
      }
    }
  });
}

/** Whether a skill was added inside the chosen window. */
export function addedWithin(s: Skill, within: AddedWithin, now = Date.now()): boolean {
  if (within === "any") return true;
  const t = timeOf(s.createdAt);
  if (t === null) return false;
  if (within === "7d") return now - t <= 7 * DAY;
  if (within === "30d") return now - t <= 30 * DAY;
  return new Date(t).getFullYear() === new Date(now).getFullYear();
}

/** "Added today", "Added 3 days ago", "Added Oct 2, 2026" — or "" with no date. */
export function addedLabel(iso: string | null | undefined, now = Date.now()): string {
  const t = timeOf(iso);
  if (t === null) return "";
  const days = Math.floor((startOfDay(now) - startOfDay(t)) / DAY);
  if (days <= 0) return "Added today";
  if (days === 1) return "Added yesterday";
  if (days < 7) return `Added ${days} days ago`;
  return `Added ${new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isSort(v: unknown): v is SkillSort {
  return SORTS.some((s) => s.id === v);
}
export function isAdded(v: unknown): v is AddedWithin {
  return ADDED.some((a) => a.id === v);
}
