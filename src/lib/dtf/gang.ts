// ---------------------------------------------------------------------------
// Gang sheets: several transfers arranged on one strip of DTF film.
//
// Shelf packing, tallest first, with an optional 90° turn when a design only
// fits the film sideways. Pure geometry in mm — the dashboard draws the
// result and the export composites the real PNGs at the same positions.
// ---------------------------------------------------------------------------

export interface GangItem {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  copies: number;
}

export interface Placed {
  id: string;
  copy: number;
  label: string;
  x: number;
  y: number;
  /** Footprint on the sheet (after any rotation). */
  w: number;
  h: number;
  rotated: boolean;
}

export interface GangLayout {
  widthMm: number;
  /** Used length of film (roll) or the sheet height. */
  lengthMm: number;
  placed: Placed[];
  /** Items that cannot fit at all (wider than the film both ways) or overflow a fixed sheet. */
  unplaced: { id: string; label: string; reason: string }[];
  /** Fraction of the used area covered by artwork. */
  efficiency: number;
}

export interface GangOptions {
  widthMm: number;
  /** Fixed sheet height, or omit for roll mode. */
  heightMm?: number;
  maxLengthMm: number;
  gapMm: number;
  marginMm: number;
}

export function packGang(items: GangItem[], opts: GangOptions): GangLayout {
  const usable = opts.widthMm - 2 * opts.marginMm;
  const limit = (opts.heightMm ?? opts.maxLengthMm) - opts.marginMm;
  const pieces: { id: string; label: string; copy: number; w: number; h: number; rotated: boolean }[] = [];
  const unplaced: GangLayout["unplaced"] = [];

  for (const it of items) {
    for (let c = 0; c < Math.max(1, it.copies); c++) {
      let w = it.widthMm;
      let h = it.heightMm;
      let rotated = false;
      if (w > usable && h <= usable) {
        [w, h] = [h, w];
        rotated = true;
      }
      if (w > usable) {
        if (c === 0) unplaced.push({ id: it.id, label: it.label, reason: `${Math.round(Math.min(it.widthMm, it.heightMm))} mm is wider than the ${Math.round(usable)} mm usable film width.` });
        break;
      }
      pieces.push({ id: it.id, label: it.label, copy: c, w, h, rotated });
    }
  }

  // Tallest first keeps shelves tight.
  pieces.sort((a, b) => b.h - a.h || b.w - a.w);
  const placed: Placed[] = [];
  let shelfY = opts.marginMm;
  let shelfH = 0;
  let cursorX = opts.marginMm;
  for (const p of pieces) {
    if (cursorX + p.w > opts.marginMm + usable + 0.001) {
      shelfY += shelfH + opts.gapMm;
      shelfH = 0;
      cursorX = opts.marginMm;
    }
    if (shelfY + p.h > limit + 0.001) {
      unplaced.push({ id: p.id, label: p.label, reason: opts.heightMm ? "Doesn't fit on this sheet — start another." : "Past the maximum roll length — start another strip." });
      continue;
    }
    placed.push({ id: p.id, copy: p.copy, label: p.label, x: cursorX, y: shelfY, w: p.w, h: p.h, rotated: p.rotated });
    cursorX += p.w + opts.gapMm;
    shelfH = Math.max(shelfH, p.h);
  }
  const used = placed.length ? Math.max(...placed.map((p) => p.y + p.h)) + opts.marginMm : 0;
  const lengthMm = opts.heightMm ?? Math.ceil(used);
  const area = placed.reduce((s, p) => s + p.w * p.h, 0);
  return { widthMm: opts.widthMm, lengthMm, placed, unplaced, efficiency: lengthMm ? area / (opts.widthMm * lengthMm) : 0 };
}
