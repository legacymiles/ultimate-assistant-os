// ---------------------------------------------------------------------------
// Folder tile colours.
// A folder keeps its tint across sessions (hashed from its id), but a pure hash
// happily puts three golds in a row. So we hash, then walk the list and nudge
// any tile that matches its neighbour — stable AND visually varied.
// ---------------------------------------------------------------------------

export interface Accent {
  tile: string;
  ink: string;
}

/** Big home tiles — a soft radial wash with a visible edge. */
export const HOME_ACCENTS: Accent[] = [
  { tile: "from-rose-500/35 via-rose-500/10 to-transparent border-rose-400/30", ink: "text-rose-200" },
  { tile: "from-violet-500/35 via-violet-500/10 to-transparent border-violet-400/30", ink: "text-violet-200" },
  { tile: "from-sky-500/35 via-sky-500/10 to-transparent border-sky-400/30", ink: "text-sky-200" },
  { tile: "from-emerald-500/35 via-emerald-500/10 to-transparent border-emerald-400/30", ink: "text-emerald-200" },
  { tile: "from-amber-500/35 via-amber-500/10 to-transparent border-amber-400/30", ink: "text-amber-200" },
  { tile: "from-fuchsia-500/35 via-fuchsia-500/10 to-transparent border-fuchsia-400/30", ink: "text-fuchsia-200" },
];

/** Small sub-folder tiles — same hues, dialled back. */
export const SUB_ACCENTS: Accent[] = [
  { tile: "from-rose-500/30 to-rose-500/[0.06] border-rose-400/35", ink: "text-rose-200" },
  { tile: "from-violet-500/30 to-violet-500/[0.06] border-violet-400/35", ink: "text-violet-200" },
  { tile: "from-sky-500/30 to-sky-500/[0.06] border-sky-400/35", ink: "text-sky-200" },
  { tile: "from-emerald-500/30 to-emerald-500/[0.06] border-emerald-400/35", ink: "text-emerald-200" },
  { tile: "from-amber-500/30 to-amber-500/[0.06] border-amber-400/35", ink: "text-amber-200" },
  { tile: "from-fuchsia-500/30 to-fuchsia-500/[0.06] border-fuchsia-400/35", ink: "text-fuchsia-200" },
];

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * One accent per id, in order, with no two neighbours sharing a hue.
 * On a 3-across grid we also avoid a clash with the tile directly above.
 */
export function accentsFor(ids: string[], palette: Accent[], columns = 3): Accent[] {
  const n = palette.length;
  const picked: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    let idx = hash(ids[i]) % n;
    const left = i > 0 ? picked[i - 1] : -1;
    const above = i >= columns ? picked[i - columns] : -1;
    let guard = 0;
    while ((idx === left || idx === above) && guard < n) {
      idx = (idx + 1) % n;
      guard++;
    }
    picked.push(idx);
  }
  return picked.map((i) => palette[i]);
}
