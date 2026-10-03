// ---------------------------------------------------------------------------
// Tempo — a number that only means something once you can see where it sits.
//
// "Set it myself" used to be a number box, which quietly assumes you already
// know the answer. A tempo is something you feel your way to, so the control is
// a slider with real landmarks on it: 92 is boom-bap, 124 is house, 140 is
// drill. The marks are the knowledge, the slider is the instrument, and the
// number box stays for the times you do know exactly what you want.
//
// Pure, so the landmarks and the readout can be tested without a browser.
// ---------------------------------------------------------------------------

/** The range a song generator can actually be asked for. */
export const BPM_MIN = 40;
export const BPM_MAX = 220;

/** Landmarks under the slider. Each is a real tempo for a real style. */
export const BPM_MARKS: { bpm: number; label: string }[] = [
  { bpm: 72, label: "slowed" },
  { bpm: 92, label: "boom-bap" },
  { bpm: 112, label: "amapiano" },
  { bpm: 124, label: "house" },
  { bpm: 140, label: "drill" },
  { bpm: 174, label: "d&b" },
];

export function clampBpm(value: number): number {
  if (!Number.isFinite(value)) return 120;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(value)));
}

/**
 * What this tempo is, in words.
 *
 * Deliberately names styles rather than adjectives: "moderate" tells you
 * nothing, and "the pocket most hip-hop and soul sits in" tells you whether
 * you have the right number. The halftime note matters because a drill record
 * at 140 is counted as 70 by most listeners, and that catches people out.
 */
export function tempoFeel(bpm: number): string {
  const n = clampBpm(bpm);
  const half = Math.round(n / 2);
  if (n < 70) return `${n} BPM — ballad and slowed-down territory. Very few drum patterns stay interesting down here.`;
  if (n < 85) return `${n} BPM — slow and heavy: trap counted straight, soul, slowed-and-reverbed edits.`;
  if (n < 100) return `${n} BPM — the pocket most hip-hop, boom-bap and mid-tempo pop sits in.`;
  if (n < 118) return `${n} BPM — amapiano, afrobeats and relaxed pop. Fast enough to dance to, slow enough to sing over.`;
  if (n < 132) return `${n} BPM — four-on-the-floor country: house, disco, club pop.`;
  if (n < 150) return `${n} BPM — drill and trap, which a listener counts as ${half}. Write the vocal to ${half}, not to ${n}.`;
  if (n < 165) return `${n} BPM — hyperpop, hard dance, footwork. Everything has to be short up here.`;
  return `${n} BPM — drum and bass and jungle. The kit carries the record; a sung line has to float above it.`;
}
