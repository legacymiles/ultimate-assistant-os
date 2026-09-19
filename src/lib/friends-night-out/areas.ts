// A city catalogue is built once per area and shared. A new user reuses an
// existing area when they are close to its center and their radius fits inside
// what was built; otherwise a new area is built for them.
import { distanceMi } from "./geo";
import type { Coords } from "./types";

export const AREA_REUSE_MAX_CENTER_MI = 10;

export interface AreaLike extends Coords {
  id: string;
  builtRadiusMi: number;
}

export function findReusableArea<A extends AreaLike>(
  areas: readonly A[],
  center: Coords,
  radiusMi: number,
): A | null {
  let best: A | null = null;
  let bestD = Infinity;
  for (const a of areas) {
    const d = distanceMi(a, center);
    if (d > AREA_REUSE_MAX_CENTER_MI) continue;
    if (d + radiusMi > a.builtRadiusMi) continue;
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}
