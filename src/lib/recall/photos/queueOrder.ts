// ---------------------------------------------------------------------------
// The order photos wait in: newest first, always.
//
// The owner reads Camera Autopilot top-down and expects the picture they just
// took to be the first thing there. The queue used to keep arrival order with
// new photos appended, so a fresh batch landed below everything already
// waiting — "in the middle". Now the newest photo (by when it was taken, or
// when it arrived if the phone sent no date) sorts to the top.
// ---------------------------------------------------------------------------

import type { PendingPhoto } from "./types";

function when(p: Pick<PendingPhoto, "takenAt" | "addedAt">): number {
  const taken = p.takenAt ? Date.parse(p.takenAt) : NaN;
  if (!Number.isNaN(taken)) return taken;
  const added = Date.parse(p.addedAt);
  return Number.isNaN(added) ? 0 : added;
}

/** Newest first. Ties (same moment) put the later arrival on top. */
export function compareNewestFirst(
  a: Pick<PendingPhoto, "takenAt" | "addedAt">,
  b: Pick<PendingPhoto, "takenAt" | "addedAt">,
): number {
  return when(b) - when(a) || (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0);
}

/** A sorted copy; the input is left alone. */
export function newestFirst<T extends Pick<PendingPhoto, "takenAt" | "addedAt">>(queue: T[]): T[] {
  return [...queue].sort(compareNewestFirst);
}
