// ---------------------------------------------------------------------------
// The clock inside a song.
//
// Soundprint's analyzer already measures what a stretch of audio IS — tempo,
// key, brightness, percussion, dynamics. It does not say WHEN anything happens,
// and "when" is the whole of an audio-driven edit: a shot that lands 200 ms off
// the downbeat reads as a mistake no amount of prompt writing can fix.
//
// So this file is the other half: an onset envelope over the whole track, and
// from it a beat grid, bars, sections and the handful of moments that are
// genuinely louder than their neighbours. Everything here is MEASURED. Nothing
// guesses at meaning — an energy peak is an energy peak, and only the director
// stage is allowed to call it a chorus.
//
// It is deliberately time-domain and dependency-free. The FFT in
// soundprint/audio-analysis.ts is the right tool for spectra, but a beat phase
// only needs to know where the energy jumps, and a difference-filtered RMS
// envelope finds that on a four-minute track in a fraction of the time. Pure
// functions over a `number[]` envelope, so the grid can be tested against a
// synthetic click track with no Web Audio at all.
// ---------------------------------------------------------------------------

/** Envelope resolution. 86 fps at 22.05 kHz — ~11.6 ms, well inside a beat. */
export const ENVELOPE_HOP = 256;

export interface Envelope {
  /** Half-wave rectified energy flux, one value per hop, normalised 0–1. */
  curve: number[];
  /** Values per second. */
  frameRate: number;
}

/**
 * Where the energy jumps, over the whole track.
 *
 * A first-order difference filter before the RMS is what makes this an ONSET
 * envelope rather than a loudness envelope: a sustained pad is loud but has no
 * flux, and a kick drum is a step change. Rectifying the frame-to-frame
 * difference then keeps only the attacks, which is what a beat is made of.
 */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): Envelope {
  const hop = ENVELOPE_HOP;
  const frames = Math.max(0, Math.floor(samples.length / hop));
  const rms = new Float64Array(frames);
  let energy = 0;
  for (let f = 0; f < frames; f++) {
    const from = f * hop;
    const to = Math.min(samples.length, from + hop);
    let sum = 0;
    // The difference filter is applied inline: x[n] - x[n-1] emphasises the
    // attacks and removes the DC and low rumble that would otherwise dominate.
    for (let i = from + 1; i < to; i++) {
      const d = samples[i] - samples[i - 1];
      sum += d * d;
      energy += samples[i] * samples[i];
    }
    rms[f] = Math.sqrt(sum / Math.max(1, to - from - 1));
  }

  /**
   * A noise floor, proportional to how loud the track actually is.
   *
   * Without it the normalisation below is a trap: a sustained tone has no
   * attacks, only the numerical ripple of an RMS window that does not divide
   * evenly into its period — and dividing that ripple by its own maximum
   * rescales a rounding error into a full-scale beat. Measured against the RAW
   * signal rather than the differenced one, so the floor tracks loudness and
   * not the very flux it is meant to qualify.
   */
  const level = Math.sqrt(energy / Math.max(1, samples.length));
  const floor = level * 0.01;

  // Flux: only the rises, and only those above the floor. A decay carries no
  // onset, and a ripple is not a rise.
  const curve = new Array<number>(frames).fill(0);
  for (let f = 1; f < frames; f++) {
    const d = rms[f] - rms[f - 1] - floor;
    if (d > 0) curve[f] = d;
  }
  const max = curve.reduce((a, b) => (b > a ? b : a), 0);
  return {
    curve: max > 0 ? curve.map((v) => v / max) : curve,
    frameRate: sampleRate / hop,
  };
}

/** Mean of a slice, guarding the empty case so a short track cannot divide by zero. */
function mean(values: ArrayLike<number>, from = 0, to = values.length): number {
  const lo = Math.max(0, from);
  const hi = Math.min(values.length, to);
  if (hi <= lo) return 0;
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += values[i];
  return sum / (hi - lo);
}

export interface BeatGrid {
  bpm: number;
  /** Every beat, in seconds from the start of the track. */
  beats: number[];
  /** Indices into `beats` that start a bar. */
  downbeats: number[];
  beatsPerBar: number;
  /** Seconds per beat. */
  period: number;
  /**
   * How much better the chosen phase scored than an average one, 0–1.
   *
   * Low means the track has no steady pulse to lock to — spoken word, free
   * time, ambience — and the caller should cut on meaning rather than on beats
   * rather than snapping to a grid that is not there.
   */
  confidence: number;
}

/**
 * The beat grid for a known tempo.
 *
 * The tempo comes from Soundprint's autocorrelation; what is missing is PHASE,
 * and phase is found by trying every offset inside one beat and keeping the one
 * whose beat positions sit on the most onset energy. That is the whole trick,
 * and it is why the envelope has to be an onset envelope: against a loudness
 * curve every phase scores about the same.
 */
export function beatGrid(
  env: Envelope,
  bpm: number,
  opts: { beatsPerBar?: number; durationSec?: number } = {},
): BeatGrid {
  const beatsPerBar = opts.beatsPerBar ?? 4;
  const blank: BeatGrid = { bpm: 0, beats: [], downbeats: [], beatsPerBar, period: 0, confidence: 0 };
  if (!Number.isFinite(bpm) || bpm <= 0 || env.curve.length < 8) return blank;

  const period = 60 / bpm;
  const periodFrames = period * env.frameRate;
  if (periodFrames < 2) return blank;

  // Score every phase inside one beat. A whole-frame step is finer than the
  // ear's own tolerance at this hop size, so there is nothing to gain from
  // sub-frame interpolation here.
  const span = Math.max(1, Math.round(periodFrames));
  const scores: number[] = [];
  let bestPhase = 0;
  let bestScore = -Infinity;
  for (let phase = 0; phase < span; phase++) {
    let score = 0;
    let landed = 0;
    for (let f = phase; f < env.curve.length; f += periodFrames) {
      // A beat is an instant, but an attack is smeared across a couple of
      // frames, so the frame either side counts too — otherwise the score is
      // decided by where the rounding happened to land.
      const i = Math.round(f);
      score += env.curve[i] + 0.5 * ((env.curve[i - 1] ?? 0) + (env.curve[i + 1] ?? 0));
      landed++;
    }
    const avg = landed ? score / landed : 0;
    scores.push(avg);
    if (avg > bestScore) {
      bestScore = avg;
      bestPhase = phase;
    }
  }

  const duration = opts.durationSec ?? env.curve.length / env.frameRate;
  const beats: number[] = [];
  for (let f = bestPhase; ; f += periodFrames) {
    const t = f / env.frameRate;
    if (t > duration) break;
    beats.push(Math.round(t * 1000) / 1000);
  }

  /**
   * Confidence is two questions, because either one alone is fooled.
   *
   * CONTRAST asks whether the winning phase is genuinely better than the rest,
   * and it has to be asked as significance rather than as a ratio: a phase
   * score is an average over only as many beats as the track has, so on eight
   * seconds of white noise the best of forty-odd phases beats the mean by 40%
   * for no reason but the small sample. Measured against the SPREAD of the
   * other phases — and with the winner excluded from that spread, or it
   * inflates the very deviation it is being judged against — noise sits two or
   * three deviations out, which is what the best of forty draws should do,
   * while a click track sits twenty out.
   *
   * COVERAGE asks whether MOST beats landed on an onset rather than a lucky
   * few. Multiplying them means a grid is only trusted when the phase won AND
   * the track kept the beat.
   */
  // The phases either side of the winner are the SAME beat, one frame out —
  // an attack is smeared over a couple of frames and the scoring counts its
  // shoulders deliberately. Left in, they are the largest values in the
  // "others" and they inflate the spread the winner is measured against, which
  // is how a click track ends up looking only half-convincing. Excluded
  // cyclically, because phase wraps.
  const shoulder = Math.min(3, Math.floor(span / 4));
  const others = scores.filter((_, i) => {
    const d = Math.abs(i - bestPhase);
    return Math.min(d, span - d) > shoulder;
  });
  const rest = mean(others);
  const spread = Math.sqrt(mean(others.map((s) => (s - rest) ** 2)));
  // Below this many deviations the winner is what the best of N draws looks
  // like on noise; above the ceiling it is unambiguous.
  const z = spread > 0 ? (bestScore - rest) / spread : others.length ? Infinity : 0;
  const contrast = Math.max(0, Math.min(1, (z - 3) / 8));
  const floor = mean(env.curve);
  const landed = beats.filter((t) => {
    const i = Math.round(t * env.frameRate);
    return Math.max(env.curve[i] ?? 0, env.curve[i - 1] ?? 0, env.curve[i + 1] ?? 0) > floor;
  }).length;
  const coverage = beats.length ? landed / beats.length : 0;
  const confidence = Math.round(contrast * coverage * 1000) / 1000;

  return {
    bpm: Math.round(bpm),
    beats,
    downbeats: downbeatsOf(beats, env, beatsPerBar),
    beatsPerBar,
    period,
    confidence,
  };
}

/**
 * Which beats start a bar.
 *
 * Same idea as the phase search, one level up: of the `beatsPerBar` possible
 * bar alignments, the right one is the one whose first beats carry the accent.
 * A bar line in the wrong place puts every cut on the "and", which is audible
 * even to someone who could not name what is wrong.
 */
function downbeatsOf(beats: number[], env: Envelope, beatsPerBar: number): number[] {
  if (beats.length < beatsPerBar) return beats.length ? [0] : [];
  const at = (t: number) => env.curve[Math.round(t * env.frameRate)] ?? 0;
  let bestOffset = 0;
  let bestScore = -Infinity;
  for (let offset = 0; offset < beatsPerBar; offset++) {
    let score = 0;
    for (let i = offset; i < beats.length; i += beatsPerBar) score += at(beats[i]);
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  const out: number[] = [];
  for (let i = bestOffset; i < beats.length; i += beatsPerBar) out.push(i);
  return out;
}

/** The nearest beat to a time, or the time itself when there is no grid. */
export function snapToBeat(grid: BeatGrid, sec: number): number {
  return nearest(grid.beats, sec);
}

/** The nearest bar line — the safe default for a cut. */
export function snapToBar(grid: BeatGrid, sec: number): number {
  return nearest(
    grid.downbeats.map((i) => grid.beats[i]).filter((t) => typeof t === "number"),
    sec,
  );
}

function nearest(times: number[], sec: number): number {
  if (!times.length) return sec;
  let best = times[0];
  for (const t of times) {
    if (Math.abs(t - sec) < Math.abs(best - sec)) best = t;
  }
  return best;
}

// ----- sections --------------------------------------------------------------

/** What a section is, before anything has interpreted it. */
export interface Section {
  startSec: number;
  endSec: number;
  /** Mean onset energy across the section, 0–1. */
  energy: number;
  /**
   * A measured shape, not a musical claim: how this section's energy compares
   * with the track's. The director turns these into verse/chorus.
   */
  level: "quiet" | "low" | "mid" | "high" | "peak";
  /** Bars, when there is a grid to count them on. */
  bars: number;
}

/** Below this share of the track's own peak energy a section reads as a lull. */
const LEVELS: { at: number; level: Section["level"] }[] = [
  { at: 0.22, level: "quiet" },
  { at: 0.45, level: "low" },
  { at: 0.68, level: "mid" },
  { at: 0.87, level: "high" },
  { at: Infinity, level: "peak" },
];

function levelOf(energy: number, peak: number): Section["level"] {
  const share = peak > 0 ? energy / peak : 0;
  return LEVELS.find((l) => share < l.at)!.level;
}

/**
 * Where the arrangement changes.
 *
 * Measured on BAR energy rather than on frames, because a song changes section
 * on a bar line and never between two of them; smoothing at frame resolution
 * finds the snare instead. A boundary is a bar whose energy differs from the
 * running average by more than the track's own typical bar-to-bar change, and
 * sections shorter than `minBars` are merged back into the one before, so a
 * single loud fill cannot become a section of its own.
 */
export function sections(
  env: Envelope,
  grid: BeatGrid,
  opts: { minBars?: number; durationSec?: number } = {},
): Section[] {
  const duration = opts.durationSec ?? env.curve.length / env.frameRate;
  const minBars = opts.minBars ?? 4;

  // A bar line at (or past) the end of the track would make a section of zero
  // length, which is not a section — it is an off-by-one with a start time.
  const barTimes = grid.downbeats
    .map((i) => grid.beats[i])
    .filter((t) => typeof t === "number" && t < duration - 0.05);
  // No usable grid: one section for the whole track is the honest answer.
  if (barTimes.length < minBars * 2) {
    const energy = mean(env.curve);
    return [
      { startSec: 0, endSec: duration, energy, level: levelOf(energy, energy || 1), bars: barTimes.length },
    ];
  }

  const edges = [...barTimes, duration];
  const barEnergy = edges.slice(0, -1).map((t, i) =>
    mean(env.curve, Math.floor(t * env.frameRate), Math.floor(edges[i + 1] * env.frameRate)),
  );

  const change = barEnergy.slice(1).map((e, i) => Math.abs(e - barEnergy[i]));
  const typical = mean(change);
  // 1.8x the typical change: high enough that the ordinary breathing of a bar
  // line is not a boundary, low enough that a real arrangement change is.
  const threshold = typical * 1.8;

  const bounds = [0];
  for (let i = 1; i < barEnergy.length; i++) {
    if (change[i - 1] > threshold && i - bounds[bounds.length - 1] >= minBars) bounds.push(i);
  }
  // The minimum length is enforced going forwards, which leaves the LAST
  // stretch unguarded: a boundary four bars from the end passes the test and
  // then the remainder becomes a section of its own. A tail too short to be a
  // section belongs to the one before it.
  if (bounds.length > 1 && barEnergy.length - bounds[bounds.length - 1] < minBars) bounds.pop();
  bounds.push(barEnergy.length);

  const peak = barEnergy.reduce((a, b) => (b > a ? b : a), 0);
  const out: Section[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const fromBar = bounds[i];
    const toBar = bounds[i + 1];
    const energy = mean(barEnergy, fromBar, toBar);
    out.push({
      startSec: edges[fromBar],
      endSec: edges[toBar],
      energy,
      level: levelOf(energy, peak),
      bars: toBar - fromBar,
    });
  }
  return out;
}

// ----- the loud moments ------------------------------------------------------

export interface Hit {
  atSec: number;
  /**
   * How much bigger than its context this moment is.
   *
   * For an accent it is margins above the neighbouring peaks; for a drop it is
   * the ratio of the energy after to the energy before. Two different
   * measurements, deliberately on one comparable scale — "how many times its
   * surroundings" — because the only thing the number is used for is ranking
   * moments against each other.
   */
  strength: number;
  /** A hit that is also a jump in sustained energy — a drop, not just a snare. */
  drop: boolean;
}

/** How far either side a drop is measured. Long enough that a loud bar cannot fake one. */
const DROP_WINDOW_SEC = 4;
/** The energy after a drop, as a multiple of the energy before it. */
const DROP_LIFT = 1.6;

/**
 * The moments genuinely louder than their neighbours.
 *
 * Every beat is an onset, so a plain peak-picker returns the beat grid again.
 * What makes a moment worth cutting on is being an outlier against its OWN
 * neighbourhood, which is what the local mean and deviation here measure. The
 * `drop` flag separates a big snare from the point the whole arrangement
 * arrives, by asking whether the seconds after are louder than the seconds
 * before — the one test that tells those apart.
 */
export function hits(
  env: Envelope,
  opts: { minGapSec?: number; sigma?: number; limit?: number } = {},
): Hit[] {
  const { curve, frameRate } = env;
  const minGap = opts.minGapSec ?? 0.5;
  const sigma = opts.sigma ?? 3;
  const window = Math.round(frameRate * 2);
  if (curve.length < window * 2) return [];

  // Every onset, before anything has been judged. The comparison that follows
  // has to be peak against PEAK: measured against all frames instead, the
  // silence between beats dominates the average and every single beat of an
  // ordinary drum track comes out a three-sigma outlier.
  const peaks: { frame: number; value: number }[] = [];
  for (let i = 1; i < curve.length - 1; i++) {
    const v = curve[i];
    if (v > 0 && v >= curve[i - 1] && v > curve[i + 1]) peaks.push({ frame: i, value: v });
  }
  if (peaks.length < 3) return [];

  const dropWindow = Math.round(frameRate * DROP_WINDOW_SEC);
  const found: Hit[] = [];
  for (let p = 0; p < peaks.length; p++) {
    const { frame, value } = peaks[p];
    if (frame < window || frame >= curve.length - window) continue;

    // The neighbours, EXCLUDING this peak. Including it lets a genuine outlier
    // drag its own mean and deviation up until it no longer qualifies — the
    // louder the moment, the better it hides.
    const peers = peaks.filter((q) => q !== peaks[p] && Math.abs(q.frame - frame) <= window);
    if (peers.length < 2) continue;
    const local = mean(peers.map((q) => q.value));
    const sd = Math.sqrt(mean(peers.map((q) => (q.value - local) ** 2)));
    // A perfectly even drum machine has no deviation at all, and dividing by it
    // would make every beat infinitely exceptional. The relative floor turns
    // "sigma" into "a clear margin over the neighbours" in that case.
    const margin = Math.max(sd, local * 0.15);
    const accent = margin > 0 && value - local >= sigma * margin;

    // A drop is a different question, asked of the sustained level rather than
    // of one peak: is the music AFTER this moment louder than the music before
    // it? Measured over four seconds either side, not two, because an onset
    // envelope is a sparse thing — across two seconds only a handful of beats
    // land, and the ordinary variation between one handful and the next clears
    // a 1.33x ratio often enough to mark a drop every few bars.
    const before =
      frame >= dropWindow ? mean(curve, frame - dropWindow, frame) : Number.POSITIVE_INFINITY;
    const after =
      frame + dropWindow <= curve.length ? mean(curve, frame, frame + dropWindow) : 0;
    const lift = before > 0 && Number.isFinite(before) ? after / before : 0;
    const drop = lift >= DROP_LIFT;

    if (!accent && !drop) continue;
    found.push({
      atSec: Math.round((frame / frameRate) * 1000) / 1000,
      // Clamped at zero: a drop is reported by its lift, and a peak that only
      // qualified as a drop must not carry a negative accent margin as if that
      // were its size.
      strength:
        Math.round(Math.max(accent ? (value - local) / margin : 0, drop ? lift : 0) * 10) / 10,
      drop,
    });
  }

  // One moment, not a cluster. Suppressing forwards would keep whichever
  // candidate came FIRST and throw away the louder one just behind it — which
  // is precisely backwards, since the loudest frame is the moment itself and
  // the ones around it are its shoulders. So the strongest is taken first and
  // everything inside the gap around it is dropped.
  //
  // Drops need a far wider suppression than accents, and for a reason worth
  // stating: because `after` looks four seconds ahead, the lift starts rising
  // as soon as the window's leading edge touches the loud passage, so a single
  // drop is found as a RAMP of candidates over the four seconds before it,
  // peaking on the moment itself. Collapsing that ramp to its strongest
  // candidate is what turns it back into one event, landing on the beat the
  // arrangement actually arrives on. Accents keep their tight gap, so two
  // separate hits half a second apart are still two hits.
  const kept: Hit[] = [];
  for (const hit of [...found].sort((a, b) => b.strength - a.strength)) {
    if (kept.length >= (opts.limit ?? 24)) break;
    const clash = kept.some((k) => {
      const gap = k.drop && hit.drop ? DROP_WINDOW_SEC : minGap;
      return Math.abs(k.atSec - hit.atSec) < gap;
    });
    if (clash) continue;
    kept.push(hit);
  }
  // Returned in time order, because every consumer reads them as a timeline.
  return kept.sort((a, b) => a.atSec - b.atSec);
}
