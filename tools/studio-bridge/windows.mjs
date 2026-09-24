// ---------------------------------------------------------------------------
// What to use of each finished clip.
//
// Pure arithmetic, kept out of the server so it can be tested: getting a frame
// count wrong here does not throw, it just quietly puts a stutter or a stall in
// the film, which is the hardest kind of bug to see and the slowest to prove.
// ---------------------------------------------------------------------------

/**
 * One exposure gain per continuous RUN of shots, never per shot.
 *
 * Separately generated clips drift in brightness, and matching them stops the
 * film pumping at every cut — measured on a real film, consecutive shots ran
 * 0.24 → 0.40 → 0.28 mean luma. But a per-shot gain would put a step in the
 * middle of a join that was already seamless, which is the one thing this
 * pipeline exists to protect. So shots that run together share a correction and
 * only real cuts are matched against each other.
 */
export function exposureGains(shots, maxGain = 0.1) {
  const runs = [];
  shots.forEach((s, i) => {
    if (i === 0 || !s.chained) runs.push([]);
    runs[runs.length - 1].push(i);
  });
  const lumaOf = (run) => run.reduce((t, i) => t + (shots[i].read?.meanLuma || 0), 0) / run.length;
  const gains = new Array(shots.length).fill(1);
  const levels = runs.map(lumaOf).filter((l) => l > 0).sort((a, b) => a - b);
  // One run is the whole film: there is nothing to match it against, and
  // pulling it toward its own average would only be a pointless re-encode.
  if (levels.length < 2) return gains;
  const target = levels[levels.length >> 1];
  for (const run of runs) {
    const luma = lumaOf(run);
    if (!luma) continue;
    const gain = Math.min(1 + maxGain, Math.max(1 - maxGain, target / luma));
    for (const i of run) gains[i] = gain;
  }
  return gains;
}

/**
 * Hand the last `blendAfter` frames of a window over to the seam.
 *
 * They are not dropped — they come back as a blended segment of the same
 * length — so `frames + blendAfter` is what the shot still occupies. A window
 * too short to give any up keeps them all rather than disappearing.
 */
function split(frames, blendAfter) {
  const give = frames > blendAfter + 1 ? blendAfter : 0;
  return { frames: frames - give, blendAfter: give };
}

/**
 * The window to take out of every clip, in frames.
 *
 * `shots` are the ones that actually rendered, in cut order, each with the
 * reading handover.mjs took of it. `slotFrames(shot)` returns the exact length
 * a shot must come out as, or 0 when it may run to its natural end.
 */
export function stitchWindows(shots, { slotFrames = () => 0, maxGain = 0.1, blendFrames = 0 } = {}) {
  const gains = exposureGains(shots, maxGain);
  const last = shots.length - 1;
  return shots.map((s, i) => {
    const read = s.read ?? {};
    const total = read.frames || 0;
    // A continued shot comes back with the handover frames at its head — the
    // same frames the previous shot is still showing — so those are duplicated
    // film and come off whatever else happens.
    const continued = i > 0 && Boolean(s.chained);
    const duplicated = continued ? (s.overlap || 0) : 0;
    // A shot that starts something loses its warm-up instead: H3 establishes
    // before it moves, and cutting to a picture that has not started yet is
    // what makes a film stall at every join. Unlike the duplicated head, this
    // is a preference rather than a correction.
    const warmUp = continued ? 0 : (read.headTrim || 0);
    const slot = Math.max(0, Math.round(slotFrames(s, i) || 0));
    // The suite's Stitch Ready / Final Clip distinction: an intermediate shot is
    // trimmed at its handover boundary, but the LAST shot keeps its complete
    // landing. Nothing follows it, so there is no seam to protect — and a film
    // that ends by cutting away mid-gesture reads as a file that ran out.
    const tail = i === last ? 0 : (read.tailFrames || 0);
    // The last few frames of this shot are replaced by a blend with the next
    // clip's copy of the same moments, so they leave this shot's own body and
    // come back as their own segment. The timeline length does not change.
    const nextContinued = i < last && Boolean(shots[i + 1]?.chained);
    const blendAfter = nextContinued
      ? Math.max(0, Math.min(blendFrames, (shots[i + 1]?.overlap || 0)))
      : 0;

    if (slot) {
      // A film cut to a song has no spare frames: a clip that comes up short
      // drags the picture off the music and every later shot inherits the
      // drift. So the slot is filled first, and the warm-up is trimmed only out
      // of whatever surplus H3 happened to hand us.
      const spare = Math.max(0, total - duplicated - slot);
      const from = duplicated + Math.min(warmUp, spare);
      const frames = Math.min(slot, Math.max(1, total - from));
      return { from, ...split(frames, blendAfter), gain: gains[i] };
    }
    // Otherwise the shot ends where it really ends — the same boundary the next
    // shot continued from, so both halves of the join agree about where it was.
    const from = duplicated + warmUp;
    const frames = Math.max(1, total - from - tail);
    return { from, ...split(frames, blendAfter), gain: gains[i] };
  });
}
