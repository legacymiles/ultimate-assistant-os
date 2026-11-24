// ---------------------------------------------------------------------------
// Scoring and evidence.
//
// 1. measuredScores: what ffmpeg evidence says about a clip, per dimension,
//    with the measurement written into the evidence line.
// 2. combineScores: owner > vision judge > measurement for judged dimensions;
//    for measured dimensions, a confidence-weighted blend of judge and meter.
// 3. techniqueStats: paired deltas (experiment vs master, same scenario + seed)
//    credited to the techniques that differ, with the Personas Studio
//    discipline: additive back-fitting so co-occurring techniques split the
//    credit, shrinkage toward zero (K=4), pooled variance, a 90% interval, and
//    n=1 widened to span zero — ranking uses the LOWER bound, never the mean.
// ---------------------------------------------------------------------------

import type {
  CameraMove,
  ClipMetrics,
  Dimension,
  DimensionScore,
  Generation,
  GenreId,
  Scores,
  ShotSpec,
  Strategy,
  TechniqueId,
} from "./model";
import { DIMENSIONS, MEASURED_DIMENSIONS } from "./model";
import { weightOf } from "./genres";
import { differingTechniques } from "./strategy";

const clamp = (v: number, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

// ----- measured ---------------------------------------------------------------------

const FAMILY: Record<string, CameraMove[]> = {
  in: ["push-in", "dolly-in", "zoom-in"],
  out: ["pull-out", "zoom-out"],
  still: ["static", "pov"],
  lateral: ["pan-left", "pan-right", "track", "arc", "orbit"],
  vertical: ["tilt-up", "tilt-down", "crane-up", "crane-down"],
  shaky: ["handheld", "shake"],
};

function familyOf(m: CameraMove | "unknown"): string | null {
  for (const [f, list] of Object.entries(FAMILY)) if ((list as string[]).includes(m)) return f;
  return null;
}

export function cameraMatch(requested: CameraMove, measured: CameraMove | "unknown"): { value: number; why: string } | null {
  if (measured === "unknown") return null;
  if (requested === measured) return { value: 9, why: `measured ${measured}, as requested` };
  const a = familyOf(requested);
  const b = familyOf(measured);
  if (a && a === b) return { value: 7.5, why: `measured ${measured}; requested ${requested} (same family)` };
  // Arc/orbit read as lateral translation; a small handheld wobble reads as static.
  if ((a === "still" && b === "shaky") || (a === "shaky" && b === "still")) return { value: 6, why: `measured ${measured}; requested ${requested} (close)` };
  return { value: 3, why: `measured ${measured}; requested ${requested}` };
}

export function measuredScores(m: ClipMetrics, spec: ShotSpec, structure: Strategy["structure"]): Scores {
  const out: Scores = {};
  const dur = Math.max(0.1, m.durationSec);

  // Continuity: an unintended cut inside a single shot, or a sudden frame jump (morph).
  const cutsAllowed = structure === "timed-cuts" ? Math.max(0, spec.beats.length - 1) : 0;
  const extraCuts = Math.max(0, m.cuts.length - cutsAllowed);
  const jump = m.ssimMin;
  // A moving camera lowers frame-to-frame similarity everywhere (a fast push
  // measured 0.15-0.3 throughout), so the defect is a SPIKE: one pair far
  // below the clip's own baseline, not a low number on its own.
  const spike = suddenDrop(m);
  let cont = 10 - extraCuts * 3;
  if (spike >= 0.75) cont -= 4;
  else if (spike >= 0.5) cont -= 2.5;
  else if (spike >= 0.3) cont -= 1;
  out.continuity = {
    value: r1(clamp(cont)),
    confidence: 0.7,
    source: "measured",
    evidence: `${m.cuts.length} scene change${m.cuts.length === 1 ? "" : "s"} detected (${cutsAllowed} intended); lowest frame-to-frame SSIM ${jump.toFixed(2)} at ${m.ssimMinAt.toFixed(1)}s vs the clip's mean ${m.ssimAdjacent.toFixed(2)}`,
  };

  // Camera: what the motion estimate says vs what was asked.
  const cam = cameraMatch(spec.camera.move, m.measuredMove);
  if (cam) out.camera = { value: cam.value, confidence: 0.55, source: "measured", evidence: cam.why + (m.motion ? ` (net shift ${m.motion.dx.toFixed(0)},${m.motion.dy.toFixed(0)} px, zoom ${m.motion.zoom.toFixed(1)}%)` : "") };

  // Movement: frozen stretches and dead shots.
  const frozen = m.freezes.reduce((s, f) => s + Math.max(0, f.end - f.start), 0);
  const frozenShare = frozen / dur;
  const energy = m.motion?.energy ?? null;
  let mov = 9 - frozenShare * 12;
  if (energy !== null && energy < 1.2 && spec.action.trim()) mov -= 2.5;
  out.movement = {
    value: r1(clamp(mov)),
    confidence: energy === null ? 0.5 : 0.65,
    source: "measured",
    evidence: `${(frozenShare * 100).toFixed(0)}% of the clip frozen${energy !== null ? `; subject motion energy ${energy.toFixed(1)}` : ""}`,
  };

  // Environment: only meaningful when the camera should hold still — then the frame should too.
  const stillCam = FAMILY.still.includes(spec.camera.move);
  if (stillCam && !spec.intentionalChanges.includes("environment")) {
    const ff = m.ssimFirstLast;
    out.environment = {
      value: r1(clamp(ff * 11 - 0.5)),
      confidence: 0.45,
      source: "measured",
      evidence: `static camera: first-vs-last frame SSIM ${ff.toFixed(2)} (people moving also lowers this)`,
    };
  }

  // Visual: exposure drift and clipping.
  if (m.luma.length) {
    const mean = m.luma.reduce((s, v) => s + v, 0) / m.luma.length;
    const sd = Math.sqrt(m.luma.reduce((s, v) => s + (v - mean) ** 2, 0) / m.luma.length);
    const intended = spec.intentionalChanges.includes("lighting");
    let vis = 9;
    if (mean < 18 || mean > 238) vis -= 4;
    if (!intended && sd > 18) vis -= 3;
    else if (!intended && sd > 10) vis -= 1.5;
    out.visual = {
      value: r1(clamp(vis)),
      confidence: 0.4,
      source: "measured",
      evidence: `mean luma ${mean.toFixed(0)}/255, drift σ ${sd.toFixed(1)}${intended ? " (lighting change intended)" : ""}`,
    };
  }
  return out;
}

/**
 * How sudden the worst frame-to-frame change is, 0 (none) .. 1 (total), judged
 * against the clip's own mean similarity: min/mean of 0.5 → 0.5.
 */
export function suddenDrop(m: Pick<ClipMetrics, "ssimMin" | "ssimAdjacent">): number {
  if (!(m.ssimAdjacent > 0)) return 0;
  const ratio = m.ssimMin / m.ssimAdjacent;
  return Math.max(0, Math.min(1, 1 - ratio));
}

// ----- combine ------------------------------------------------------------------------

export function combineScores(measured: Scores, vision: Scores, owner: Partial<Record<Dimension, number>> = {}): Scores {
  const out: Scores = {};
  for (const d of DIMENSIONS) {
    const o = owner[d];
    if (typeof o === "number") {
      out[d] = { value: clamp(o), confidence: 1, source: "owner", evidence: "Owner's rating" };
      continue;
    }
    const m = measured[d];
    const v = vision[d];
    if (m && v && MEASURED_DIMENSIONS.includes(d)) {
      const w = m.confidence + v.confidence;
      out[d] = {
        value: r1((m.value * m.confidence + v.value * v.confidence) / w),
        confidence: Math.min(1, Math.max(m.confidence, v.confidence) + 0.1),
        source: v.confidence >= m.confidence ? "vision" : "measured",
        evidence: `${m.evidence} · judge: ${v.evidence}`,
      };
    } else if (v) out[d] = v;
    else if (m) out[d] = m;
  }
  return out;
}

/** Genre-weighted overall, 0..10. Confidence scales each dimension's weight. */
export function overallScore(scores: Scores, genre: GenreId): number | null {
  let num = 0;
  let den = 0;
  for (const d of DIMENSIONS) {
    const s = scores[d];
    if (!s) continue;
    const w = weightOf(genre, d) * s.confidence;
    num += s.value * w;
    den += w;
  }
  return den > 0 ? r1(num / den) : null;
}

// ----- technique statistics --------------------------------------------------------------

export interface Pair {
  pairKey: string;
  genre: GenreId;
  experimentId: string;
  master: Generation;
  experiment: Generation;
  techniques: TechniqueId[];
}

/** Every finished master/experiment pair with scores on both sides. */
export function pairsOf(gens: Generation[]): Pair[] {
  const byKey = new Map<string, { master?: Generation; experiment?: Generation }>();
  for (const g of gens) {
    if (g.status !== "done" || !g.scores) continue;
    const slot = byKey.get(g.pairKey) ?? {};
    if (g.arm === "master") slot.master = g;
    else slot.experiment = g;
    byKey.set(g.pairKey, slot);
  }
  const out: Pair[] = [];
  for (const [pairKey, { master, experiment }] of byKey) {
    if (!master || !experiment || !experiment.experimentId) continue;
    const techniques = differingTechniques(master.strategy, experiment.strategy);
    if (!techniques.length) continue;
    out.push({ pairKey, genre: experiment.genre, experimentId: experiment.experimentId, master, experiment, techniques });
  }
  return out;
}

export interface TechniqueStat {
  technique: TechniqueId;
  dimension: Dimension | "overall";
  genre: GenreId | "all";
  n: number;
  /** Raw mean of credited deltas. */
  mean: number;
  /** Shrunk toward zero. */
  effect: number;
  ciLo: number;
  ciHi: number;
  pairKeys: string[];
}

const K_SHRINK = 4;
const Z90 = 1.645;

function pairDelta(p: Pair, d: Dimension | "overall"): number | null {
  if (d === "overall") {
    const a = overallScore(p.master.scores ?? {}, p.genre);
    const b = overallScore(p.experiment.scores ?? {}, p.genre);
    return a === null || b === null ? null : b - a;
  }
  const a = p.master.scores?.[d];
  const b = p.experiment.scores?.[d];
  return a && b ? b.value - a.value : null;
}

/**
 * Credit each pair's delta to the techniques that differed in it, splitting it
 * by additive back-fitting (3 passes), then shrink and bound.
 */
export function techniqueStats(pairs: Pair[], dimension: Dimension | "overall", genre: GenreId | "all" = "all"): TechniqueStat[] {
  const rows = pairs
    .filter((p) => genre === "all" || p.genre === genre)
    .map((p) => ({ p, delta: pairDelta(p, dimension) }))
    .filter((r): r is { p: Pair; delta: number } => r.delta !== null);
  if (!rows.length) return [];

  const techs = [...new Set(rows.flatMap((r) => r.p.techniques))];
  const effect = new Map<TechniqueId, number>(techs.map((t) => [t, 0]));
  const credited = new Map<TechniqueId, { pairKey: string; value: number }[]>();

  for (let pass = 0; pass < 3; pass++) {
    for (const t of techs) {
      const xs: number[] = [];
      for (const { p, delta } of rows) {
        if (!p.techniques.includes(t)) continue;
        const others = p.techniques.filter((o) => o !== t).reduce((s, o) => s + (effect.get(o) ?? 0), 0);
        xs.push(delta - others);
      }
      effect.set(t, xs.reduce((s, v) => s + v, 0) / (xs.length + K_SHRINK));
    }
  }
  for (const t of techs) {
    const list: { pairKey: string; value: number }[] = [];
    for (const { p, delta } of rows) {
      if (!p.techniques.includes(t)) continue;
      const others = p.techniques.filter((o) => o !== t).reduce((s, o) => s + (effect.get(o) ?? 0), 0);
      list.push({ pairKey: p.pairKey, value: delta - others });
    }
    credited.set(t, list);
  }

  // Pooled variance over every credited residual: one cell's own sd at n=2 can
  // collapse to zero and hand a fluke a confident-looking interval.
  const all = [...credited.values()].flat().map((c) => c.value);
  const mu = all.reduce((s, v) => s + v, 0) / all.length;
  const pooledVar = Math.max(1, all.reduce((s, v) => s + (v - mu) ** 2, 0) / Math.max(1, all.length - 1));

  return techs
    .map((t) => {
      const list = credited.get(t) ?? [];
      const n = list.length;
      const mean = list.reduce((s, c) => s + c.value, 0) / Math.max(1, n);
      const eff = effect.get(t) ?? 0;
      const se = Math.sqrt(pooledVar / (n + K_SHRINK));
      let lo = eff - Z90 * se;
      let hi = eff + Z90 * se;
      // n=1 cannot separate "this technique works" from "that render was lucky".
      if (n <= 1) {
        lo = Math.min(lo, -Math.abs(eff) - 0.1);
        hi = Math.max(hi, Math.abs(eff) + 0.1);
      }
      return {
        technique: t,
        dimension,
        genre,
        n,
        mean: r1(mean),
        effect: Math.round(eff * 100) / 100,
        ciLo: Math.round(lo * 100) / 100,
        ciHi: Math.round(hi * 100) / 100,
        pairKeys: list.map((c) => c.pairKey),
      };
    })
    .sort((a, b) => b.ciLo - a.ciLo);
}

export interface Discovery extends TechniqueStat {
  confidence: "strong" | "likely" | "weak";
}

export function discoveries(stats: TechniqueStat[], minPairs: number, minLowerBound: number): Discovery[] {
  return stats
    .filter((s) => s.n >= minPairs && s.ciLo > minLowerBound)
    .map((s) => ({ ...s, confidence: s.ciLo > 1 ? "strong" : s.ciLo > 0.4 ? "likely" : "weak" }));
}

/** Mean score per dimension across a set of generations — where is the guide weakest? */
export function dimensionMeans(gens: Generation[]): { dimension: Dimension; mean: number; n: number }[] {
  return DIMENSIONS.map((d) => {
    const vals = gens.map((g) => g.scores?.[d]?.value).filter((v): v is number => typeof v === "number");
    return { dimension: d, mean: vals.length ? r1(vals.reduce((s, v) => s + v, 0) / vals.length) : NaN, n: vals.length };
  }).filter((x) => x.n > 0);
}

export function weakestDimensions(gens: Generation[], genre?: GenreId): { dimension: Dimension; mean: number; n: number; weight: number }[] {
  const pool = gens.filter((g) => g.status === "done" && g.arm === "master" && (!genre || g.genre === genre));
  return dimensionMeans(pool)
    .map((x) => ({ ...x, weight: genre ? weightOf(genre, x.dimension) : 0.5 }))
    // Weakest first: the score's shortfall from 10, scaled up when the genre cares about it.
    .sort((a, b) => (10 - b.mean) * (0.5 + b.weight) - (10 - a.mean) * (0.5 + a.weight));
}

export function scoreLine(s: DimensionScore | undefined): string {
  return s ? `${s.value.toFixed(1)} (${s.source}, ${(s.confidence * 100).toFixed(0)}%)` : "—";
}
