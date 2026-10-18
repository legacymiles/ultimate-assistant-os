/**
 * How the galaxy "talks": voice loudness turned into the drive that brightens
 * it and squeezes it with each syllable.
 *
 * `loudness` (0..1, from spectrum.ts) sits around 0.02 for a quiet room and
 * 0.15–0.4 for speech; this maps that onto 0..1 with a floor (so room noise
 * never twitches the galaxy) and a soft top (so a shout doesn't blow it out).
 */
export function talkDrive(loudness: number): number {
  if (!Number.isFinite(loudness)) return 0;
  const x = Math.max(0, (loudness - 0.03) / 0.3);
  return Math.min(1, 1 - Math.exp(-2.4 * x));
}

/** Who is talking, as the galaxy shows it: Jarvis warms, you cool. */
export type TalkVoice = "jarvis" | "you" | "none";

/** Hue offset (radians of hue rotation) for whoever is talking. */
export function talkHue(who: TalkVoice): number {
  return who === "jarvis" ? 0.45 : who === "you" ? -0.35 : 0;
}
