#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Continuity diagnostics for a film built out of generated clips.
//
//   node continuity.mjs report   a.mp4 b.mp4 c.mp4   the diagnostic table
//   node continuity.mjs handover a.mp4               where the clip really ends
//   node continuity.mjs plan     a.mp4 b.mp4 c.mp4   trims + exposure gains, as JSON
//
// Node >= 18, and ffmpeg + ffprobe on PATH (or FFMPEG_PATH / FFPROBE_PATH).
// No dependencies, so it can be copied straight into a render pipeline.
//
// Everything is measured from one small decode per clip. Small is the point: at
// 192px a real gesture still shows and the model's per-pixel shimmer does not,
// which is the difference between detecting a landing and detecting noise.
//
// The landing detector is a port of Auto Handover from Herrgott Margott's H3
// Infinite Continuation Suite (github.com/HerrgottMargott/Herrgotts-H3-Infinite-
// Continuation-Suite, GPL-3.0), which works on ComfyUI latents; this works on
// decoded MP4s, and keeps the part that matters: a clip is landing when its
// trailing frames both match a robust MEDIAN of the final frames AND have
// stopped moving relative to each other. Plain low-motion detection cuts far too
// early, because these models decelerate long before they lock.
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

/** Longest edge of the analysis decode. The thresholds below are tuned to it. */
const EDGE = 192;

export const DEFAULTS = {
  /** Only trust the presence signal when the shot opened this "skinny" — i.e.
   *  somebody was genuinely close to camera. Measured: an empty room is ~0.013. */
  skinConfident: 0.08,
  /** The end has lost the subject when it falls below this share of the opening. */
  skinLostShare: 0.35,
  /** Never pull the handover back past this share of the clip. */
  presenceFloor: 0.5,
  // --- the landing ---------------------------------------------------------
  analysisWindow: 96,
  /** A landing must run this long to count, so a held beat is not a lock. */
  freezeHold: 12,
  /** Dropped before the lock, because the deceleration starts earlier. */
  safetyMargin: 3,
  /**
   * When nothing locks: the ending still counts as a landing while it runs
   * below this share of the clip's own body speed.
   *
   * The original suite trims a flat 11 frames here, which is right for FL2VA,
   * where a landing is always present because the model is converging on a
   * supplied last frame. Clips generated from a start frame alone often end at
   * full speed — measured, four of seven on a real film — and trimming those
   * throws away half a second of good film per shot for nothing. So the trim
   * follows the evidence instead of a constant.
   */
  decelRatio: 0.35,
  /** A deceleration shorter than this is a held beat, not a landing. */
  minTailTrim: 4,
  /** Beyond this the shot ended early; that is a re-render, not a trim. */
  maxTailTrim: 26,
  /** Frames at the end that define "the final state", as a robust median. */
  finalReferenceFrames: 15,
  finalMeanDiff: 0.012,
  finalActivePixel: 0.025,
  maxFinalActiveArea: 0.03,
  minFinalMatch: 0.75,
  maxConsecutiveFinalOutliers: 3,
  transitionMeanDiff: 0.002,
  transitionActivePixel: 0.01,
  maxTransitionActiveArea: 0.01,
  minStaticTransitions: 0.7,
  maxConsecutiveMotionOutliers: 2,
  // --- the warm-up ---------------------------------------------------------
  /** The head is warm-up until motion reaches this share of the clip's median. */
  warmupReaches: 0.5,
  /** Never trim more head than this — beyond it, the shot itself is the problem. */
  maxHeadTrim: 14,
  // --- a dead shot ---------------------------------------------------------
  /** Below this the clip is not moving at all. */
  deadMotion: 0.004,
  /** ...and if its liveliest stretch is barely livelier, nothing is happening. */
  deadFlatness: 1.6,
  // --- exposure ------------------------------------------------------------
  /** A bigger correction than this means the shot is wrong, not mis-exposed. */
  maxGain: 0.1,
};

function run(bin, args, { binary = false } = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(bin, args, { windowsHide: true });
    const out = [];
    let err = "";
    p.stdout.on("data", (c) => out.push(c));
    p.stderr.on("data", (c) => (err += c.toString().slice(0, 4000)));
    p.on("error", (e) => fail(new Error(e.code === "ENOENT" ? `${bin} is not on PATH.` : e.message)));
    p.on("close", (code) =>
      code === 0
        ? ok(binary ? Buffer.concat(out) : Buffer.concat(out).toString())
        : fail(new Error(`${bin} failed (${code}): ${err.trim().split("\n").pop() || "no output"}`)),
    );
  });
}

/** Frame count, size and fps. Packets are counted because these MP4s carry no nb_frames. */
export async function probeClip(clip) {
  const out = await run(FFPROBE, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=nb_frames,nb_read_packets,avg_frame_rate,width,height",
    "-count_packets", "-of", "default=nw=1:nk=0", clip,
  ]);
  const get = (k) => (new RegExp(`^${k}=(.+)$`, "m").exec(out)?.[1] ?? "").trim();
  const [num, den] = get("avg_frame_rate").split("/");
  return {
    frames: Number(get("nb_frames")) || Number(get("nb_read_packets")) || 0,
    fps: Number(num) / (Number(den) || 1) || 24,
    width: Number(get("width")) || 0,
    height: Number(get("height")) || 0,
  };
}

async function decodeSmall(clip, probe) {
  const scale = EDGE / Math.max(probe.width || EDGE, probe.height || EDGE, 1);
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const width = even((probe.width || EDGE) * scale);
  const height = even((probe.height || EDGE) * scale);
  const raw = await run(
    FFMPEG,
    ["-v", "error", "-i", clip, "-vf", `scale=${width}:${height},boxblur=1:1`,
      "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
    { binary: true },
  );
  const per = width * height * 3;
  if (raw.length < per) throw new Error(`Couldn't decode ${clip} for analysis.`);
  return { raw, width, height, per, count: Math.floor(raw.length / per) };
}

/** Pixel-wise median of the last N frames — one odd decoded frame cannot move it. */
function medianReference(raw, per, count, n) {
  const take = Math.min(n, count);
  const start = count - take;
  const ref = new Float32Array(per);
  const bucket = new Array(take);
  for (let p = 0; p < per; p++) {
    for (let f = 0; f < take; f++) bucket[f] = raw[(start + f) * per + p];
    bucket.sort((a, b) => a - b);
    ref[p] = bucket[take >> 1] / 255;
  }
  return { ref, used: take };
}

const longestFalseRun = (flags) => {
  let best = 0;
  let cur = 0;
  for (const f of flags) {
    cur = f ? 0 : cur + 1;
    if (cur > best) best = cur;
  }
  return best;
};
const mean = (a, from = 0, to = a.length) => {
  let s = 0;
  let c = 0;
  for (let i = Math.max(0, from); i < Math.min(a.length, to); i++) {
    s += a[i];
    c++;
  }
  return c ? s / c : 0;
};
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
};

/**
 * Everything measurable about one clip, from a single decode.
 *
 * Returns per-frame motion and luma alongside the verdicts, because a verdict
 * you cannot argue with is a verdict nobody will trust the day a film still
 * looks wrong.
 */
export async function analyzeClip(clip, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const probe = await probeClip(clip);
  const { raw, width, height, per, count } = await decodeSmall(clip, probe);
  const fps = probe.fps || 24;
  const pixels = width * height;

  // Grey and luma for every frame, once.
  const gray = new Float64Array(count * pixels);
  const luma = new Float64Array(count);
  for (let f = 0; f < count; f++) {
    const base = f * per;
    let sum = 0;
    for (let p = 0; p < pixels; p++) {
      const i = base + p * 3;
      const g = (0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2]) / 255;
      gray[f * pixels + p] = g;
      sum += g;
    }
    luma[f] = sum / pixels;
  }

  // Frame-to-frame motion across the whole clip.
  const motion = new Float64Array(Math.max(0, count - 1));
  const motionArea = new Float64Array(Math.max(0, count - 1));
  for (let f = 1; f < count; f++) {
    let sum = 0;
    let active = 0;
    for (let p = 0; p < pixels; p++) {
      const d = Math.abs(gray[f * pixels + p] - gray[(f - 1) * pixels + p]);
      sum += d;
      if (d >= o.transitionActivePixel) active++;
    }
    motion[f - 1] = sum / pixels;
    motionArea[f - 1] = active / pixels;
  }

  // ---- the landing -------------------------------------------------------
  const { ref, used } = medianReference(raw, per, count, o.finalReferenceFrames);
  const start = Math.max(0, count - Math.max(2, Math.min(count, o.analysisWindow)));
  const n = count - start;
  const finalMean = new Float64Array(n);
  const finalArea = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const base = (start + f) * per;
    let sum = 0;
    let active = 0;
    for (let p = 0; p < pixels; p++) {
      const i = base + p * 3;
      const d = (Math.abs(raw[i] / 255 - ref[p * 3])
        + Math.abs(raw[i + 1] / 255 - ref[p * 3 + 1])
        + Math.abs(raw[i + 2] / 255 - ref[p * 3 + 2])) / 3;
      sum += d;
      if (d >= o.finalActivePixel) active++;
    }
    finalMean[f] = sum / pixels;
    finalArea[f] = active / pixels;
  }
  const finalMatch = Array.from({ length: n }, (_, f) =>
    finalMean[f] <= o.finalMeanDiff && finalArea[f] <= o.maxFinalActiveArea);
  const transStatic = Array.from({ length: Math.max(0, n - 1) }, (_, i) => {
    const j = start + i;
    return motion[j] <= o.transitionMeanDiff && motionArea[j] <= o.maxTransitionActiveArea;
  });

  // A landing, not a lull: the run must START inside the final state, mostly
  // stay there, and never wander off it for long.
  const finalGate = (from) => {
    const flags = finalMatch.slice(from);
    if (!flags.length) return { passed: false, ratio: 0 };
    const ratio = flags.filter(Boolean).length / flags.length;
    return {
      passed: flags[0] && ratio >= o.minFinalMatch && longestFalseRun(flags) <= o.maxConsecutiveFinalOutliers,
      ratio,
    };
  };
  const motionGate = (from) => {
    const flags = transStatic.slice(from);
    if (!flags.length) return { passed: true, ratio: 1 };
    const ratio = flags.filter(Boolean).length / flags.length;
    return {
      passed: ratio >= o.minStaticTransitions && longestFalseRun(flags) <= o.maxConsecutiveMotionOutliers,
      ratio,
    };
  };

  let lockIdx = -1;
  let softIdx = -1;
  let lockRatio = 0;
  for (let from = 0; from <= n - o.freezeHold; from++) {
    const fg = finalGate(from);
    if (!fg.passed) continue;
    if (softIdx < 0) softIdx = from;
    if (motionGate(from).passed) {
      lockIdx = from;
      lockRatio = fg.ratio;
      break;
    }
  }
  const frozen = lockIdx >= 0;
  const lockStartFrame = frozen ? start + lockIdx : -1;
  const diag = frozen ? lockIdx : Math.max(0, n - o.freezeHold);
  const confidence = frozen
    ? Math.max(0, Math.min(1,
      0.35 * (1 - Math.min(1, mean(finalMean, diag) / o.finalMeanDiff))
      + 0.2 * (1 - Math.min(1, mean(finalArea, diag) / o.maxFinalActiveArea))
      + 0.1 * (1 - Math.min(1, mean(motion, start + diag) / o.transitionMeanDiff))
      + 0.1 * (1 - Math.min(1, mean(motionArea, start + diag) / o.maxTransitionActiveArea))
      + 0.1 * Math.min(1, (n - lockIdx) / (o.freezeHold * 2))
      + 0.15 * lockRatio))
    : 0;

  // ---- where the clip really ends ----------------------------------------
  // The clip's own usual speed, which both trims are measured against. The
  // median ignores the ends, so a warm-up and a landing cannot define "normal".
  const body = median(Array.from(motion));

  // Locked, decelerating, or still going — three different endings, three
  // different answers. Anything else is a constant pretending to be a decision.
  let tailTrim;
  let reason;
  if (frozen) {
    reason = "locked";
    tailTrim = Math.max(0, count - 1 - (lockStartFrame - 1 - o.safetyMargin));
  } else {
    const quiet = body * o.decelRatio;
    let t = 0;
    while (t < Math.min(o.maxTailTrim, Math.max(0, motion.length - 12))
      && mean(motion, motion.length - t - 6, motion.length - t) < quiet) t++;
    tailTrim = t >= o.minTailTrim ? t : 0;
    reason = tailTrim ? "settling" : "running";
  }
  tailTrim = Math.min(tailTrim, Math.max(0, count - 1 - o.freezeHold));
  const settledEndFrame = count - 1 - tailTrim;

  // ---- is anyone still in the frame? -------------------------------------
  //
  // The whole point of a handover is that the next shot inherits the CAST,
  // and a continued shot takes no reference pictures — so whoever is in these
  // frames is the only thing holding identity. Measured the hard way: a shot
  // whose camera drifted off the child and settled on an empty living room
  // handed over 1.5 s of furniture, and the next shot, with nothing to
  // inherit and no photographs, invented an entirely different family.
  //
  // Motion cannot see this. An empty room with a moving camera measures as a
  // perfectly healthy shot, which is exactly why the old detector passed it.
  //
  // So: count skin. In YCbCr, skin of every tone falls in a narrow Cb/Cr
  // window while almost nothing else in a room does — it is angle-independent
  // and needs no model, no extra asset and no alignment. It is a heuristic,
  // not a face detector: it answers "is there a person on screen", not "is it
  // the right person".
  const skin = new Float64Array(count);
  for (let f = 0; f < count; f++) {
    const base = f * per;
    let hits = 0;
    for (let p = 0; p < pixels; p++) {
      const i = base + p * 3;
      const r = raw[i], g = raw[i + 1], b = raw[i + 2];
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) hits++;
    }
    skin[f] = hits / pixels;
  }

  // Calibration, measured, and the reason this only ever fires when it is sure:
  // an EMPTY room in a real house reads about 0.013 here, because warm wood,
  // lamp shades and carpet sit inside the same Cb/Cr window as skin. A close-up
  // of three faces reads 0.19 — fourteen times that, unmistakable. But a small
  // child in a WIDE shot reads 0.022, which is indistinguishable from the
  // furniture. So this signal can prove a close-up emptied out; it cannot see a
  // toddler across a living room, and pretending otherwise would pull good
  // handovers backwards for no reason.
  //
  // Therefore: act only on a clip that clearly HAD somebody close and clearly
  // lost them. Anything less confident is reported and left alone.
  const openingPeak = Math.max(...skin.slice(0, Math.max(1, Math.floor(count * 0.25))));
  const confidentSubject = openingPeak >= o.skinConfident;
  const endLost = skin[settledEndFrame] < openingPeak * o.skinLostShare;

  let presenceEndFrame = settledEndFrame;
  if (confidentSubject && endLost) {
    const floorFrame = Math.floor(count * o.presenceFloor);
    while (presenceEndFrame > floorFrame
      && skin[presenceEndFrame] < openingPeak * o.skinLostShare) presenceEndFrame--;
  }

  const drifted = presenceEndFrame < settledEndFrame;
  // Nobody recoverable in the back half of a clip that definitely had someone.
  const noCast = confidentSubject && endLost && !drifted;
  const handoverEndFrame = presenceEndFrame;

  // ---- the warm-up -------------------------------------------------------
  // The head is warm-up for as long as the clip has not yet reached a fair
  // share of that usual speed. Measured over a small window so one lively
  // frame does not end it.
  const target = body * o.warmupReaches;
  let headTrim = 0;
  while (headTrim < Math.min(o.maxHeadTrim, motion.length - 1)
    && mean(motion, headTrim, headTrim + 6) < target) headTrim++;

  // ---- is this a shot at all? --------------------------------------------
  const sections = [mean(motion, 0, 12), mean(motion, 12, motion.length - 12), mean(motion, motion.length - 12)];
  const liveliest = Math.max(...sections);
  const quietest = Math.min(...sections.filter((v) => v > 0)) || 1e-9;
  const dead = mean(motion) < o.deadMotion && liveliest / quietest < o.deadFlatness;

  return {
    clip,
    frames: count,
    fps,
    meanLuma: Number(mean(luma).toFixed(4)),
    motion: {
      first6: Number(mean(motion, 0, 6).toFixed(4)),
      first12: Number(mean(motion, 0, 12).toFixed(4)),
      middle: Number(mean(motion, 12, motion.length - 12).toFixed(4)),
      last12: Number(mean(motion, motion.length - 12).toFixed(4)),
      last6: Number(mean(motion, motion.length - 6).toFixed(4)),
      whole: Number(mean(motion).toFixed(4)),
    },
    dead,
    headTrim,
    frozen,
    lockStartFrame,
    /** Where the clip really ends, and where the next shot takes its cue from. */
    handoverEndFrame,
    /** Where it would have ended on motion alone, ignoring who is in frame. */
    settledEndFrame,
    /** Fraction of the handover frame that reads as skin — the presence signal. */
    skinAtHandover: Number(skin[handoverEndFrame].toFixed(4)),
    /** The camera drifted off the cast, so the handover was pulled back to find them. */
    drifted,
    /**
     * Nobody is in the back half of this clip at all. A continued shot chained
     * off it inherits an empty room and will invent its own cast, so the
     * caller must re-render rather than chain.
     */
    noCast,
    tailFrames: tailTrim,
    tailSeconds: Number((tailTrim / fps).toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    /** "locked" | "settling" | "running" — what kind of ending this clip has. */
    reason,
    /** A settled tail that never quite stopped moving. Reported, not acted on. */
    softLockStartFrame: softIdx >= 0 ? start + softIdx : -1,
    /** Kept so callers can measure the join themselves. */
    _firstFrameGray: gray.slice(0, pixels),
    _lastFrameGray: gray.slice((count - 1) * pixels, count * pixels),
  };
}

const grayDistance = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

/** Trims and exposure gains for a whole film, ready to hand to the stitch. */
export async function planFilm(clips, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const shots = [];
  for (const c of clips) shots.push(await analyzeClip(c, o));
  const joins = [];
  for (let i = 1; i < shots.length; i++) {
    const cut = grayDistance(shots[i - 1]._lastFrameGray, shots[i]._firstFrameGray);
    joins.push({
      after: i - 1,
      cutMotion: Number(cut.toFixed(4)),
      kind: cut < 0.02 ? "continuous" : "cut",
      endMotion: shots[i - 1].motion.last6,
      startMotion: shots[i].motion.first6,
      motionRatio: Number((shots[i].motion.first6 / (shots[i - 1].motion.last6 || 1e-9)).toFixed(2)),
      lumaFrom: shots[i - 1].meanLuma,
      lumaTo: shots[i].meanLuma,
    });
  }
  // One gain per continuous RUN, never per shot. Matching exposure stops the
  // film pumping at its cuts, but a per-shot gain would put a step in the middle
  // of a join that was already seamless — measured here, two continuous shots
  // wanted +10% and −10%, which would have opened a 22% hole in an unbroken
  // take. Only real cuts get matched against each other.
  const runs = [];
  shots.forEach((s, i) => {
    if (i === 0 || joins[i - 1].kind !== "continuous") runs.push([]);
    runs[runs.length - 1].push(i);
  });
  const lumaOf = (run) => run.reduce((t, i) => t + shots[i].meanLuma, 0) / run.length;
  const target = median(runs.map(lumaOf));
  const gains = new Array(shots.length).fill(1);
  if (runs.length > 1) {
    for (const run of runs) {
      const g = Math.min(1 + o.maxGain, Math.max(1 - o.maxGain, target / (lumaOf(run) || target)));
      for (const i of run) gains[i] = Number(g.toFixed(4));
    }
  }

  return {
    targetLuma: Number(target.toFixed(4)),
    shots: shots.map((s, i) => ({
      clip: s.clip,
      frames: s.frames,
      dead: s.dead,
      // A continued shot opens on frames it was handed; trimming its head would
      // cut into the join itself, so the warm-up trim is only for shots that
      // start something.
      headTrim: joins[i - 1]?.kind === "continuous" ? 0 : s.headTrim,
      tailTrim: s.tailFrames,
      handoverEndFrame: s.handoverEndFrame,
      landing: s.reason,
      gain: gains[i],
    })),
    joins,
  };
}

// ----- command line ---------------------------------------------------------

const [cmd, ...files] = process.argv.slice(2);
// Compare URLs rather than filenames, so the module still behaves when a
// pipeline copies it in under a different name.
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  if (!cmd || !files.length) {
    console.log("usage: continuity.mjs report|handover|plan <clip.mp4> [...]");
    process.exit(1);
  }
  const name = (f) => f.split(/[\\/]/).pop();

  if (cmd === "report") {
    const shots = [];
    for (const f of files) shots.push(await analyzeClip(f));
    const p4 = (n) => n.toFixed(4).padStart(8);
    console.log("clip                    n   first6   first12  middle   last12   last6    luma    verdict");
    for (const s of shots) {
      const flags = [
        s.dead ? "DEAD SHOT" : "",
        !s.dead && s.headTrim >= 4 ? `warm-up ${s.headTrim}f` : "",
        s.reason === "locked" ? `landing ${s.tailFrames}f (locked)` : "",
        s.reason === "settling" ? `landing ${s.tailFrames}f` : "",
      ].filter(Boolean).join(", ") || "ok";
      console.log(
        `${name(s.clip).slice(0, 22).padEnd(22)} ${String(s.frames).padStart(3)} `
        + [s.motion.first6, s.motion.first12, s.motion.middle, s.motion.last12, s.motion.last6]
          .map(p4).join(" ")
        + ` ${s.meanLuma.toFixed(4).padStart(7)}  ${flags}`,
      );
    }
    if (shots.length > 1) {
      console.log("\nseam: last frame of A -> first frame of B");
      console.log("join   kind         cut-motion  A end   B start  ratio   luma A→B");
      for (let i = 1; i < shots.length; i++) {
        const cut = grayDistance(shots[i - 1]._lastFrameGray, shots[i]._firstFrameGray);
        const ratio = shots[i].motion.first6 / (shots[i - 1].motion.last6 || 1e-9);
        console.log(
          `${String(i).padEnd(6)} ${(cut < 0.02 ? "continuous" : "cut").padEnd(12)}`
          + ` ${cut.toFixed(4).padStart(10)} ${shots[i - 1].motion.last6.toFixed(4).padStart(7)}`
          + ` ${shots[i].motion.first6.toFixed(4).padStart(8)} ${ratio.toFixed(2).padStart(6)}`
          + `   ${shots[i - 1].meanLuma.toFixed(4)} → ${shots[i].meanLuma.toFixed(4)}`,
        );
      }
    }
  } else if (cmd === "handover") {
    for (const f of files) {
      const { _firstFrameGray, _lastFrameGray, ...rest } = await analyzeClip(f);
      console.log(JSON.stringify(rest, null, 2));
    }
  } else if (cmd === "plan") {
    console.log(JSON.stringify(await planFilm(files), null, 2));
  } else {
    console.log(`unknown command ${cmd}`);
    process.exit(1);
  }
}
