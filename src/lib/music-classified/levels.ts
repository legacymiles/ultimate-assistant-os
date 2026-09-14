// ---------------------------------------------------------------------------
// The fixed vocabulary: the 1–10 energy ladder and the description lenses.
//
// The ladder is energy, not tempo alone. A 70 BPM trap song with 808s hitting
// in double-time is not a 2, and a 130 BPM acoustic ballad is not an 8. Tempo
// is one input; how hard it pushes is the number.
// ---------------------------------------------------------------------------

import type { Lens, LensId } from "./types";

export interface Level {
  n: number;
  name: string;
  /** Written for the model as much as for the sidebar tooltip. */
  feel: string;
  /** Typical, not a rule. */
  bpm: string;
  hue: number;
}

export const LEVELS: Level[] = [
  { n: 1, name: "Still", feel: "ambient, beatless or near-beatless, drifting; sleep and focus music", bpm: "under 70 or no pulse", hue: 230 },
  { n: 2, name: "Slow & smooth", feel: "slow jams, quiet ballads, soft R&B, lo-fi; laid back, intimate", bpm: "60–80", hue: 250 },
  { n: 3, name: "Mellow", feel: "relaxed but moving — neo-soul, chill hip-hop, soft pop, acoustic with a groove", bpm: "75–95", hue: 270 },
  { n: 4, name: "Easy groove", feel: "head-nod mid-tempo; cruising, steady pocket, not asking you to dance yet", bpm: "85–100", hue: 290 },
  { n: 5, name: "Mid", feel: "the middle — mid-tempo pop, R&B bops, rock with a steady drive", bpm: "95–115", hue: 320 },
  { n: 6, name: "Upbeat", feel: "bright and moving; you tap your foot — upbeat pop, funk, afrobeats", bpm: "100–120", hue: 345 },
  { n: 7, name: "Danceable", feel: "built to move to — dance-pop, house, club R&B, bouncy rap", bpm: "115–128", hue: 10 },
  { n: 8, name: "Driving", feel: "high energy, hard-hitting; turn-up rap, big-room, pop-punk, workout", bpm: "120–140 (or trap double-time)", hue: 25 },
  { n: 9, name: "Hype", feel: "aggressive, crowd-moving; drill, rage, hard EDM drops, metalcore", bpm: "130–160", hue: 40 },
  { n: 10, name: "Maximum", feel: "all-out — mosh pit, festival peak, hardstyle, drum & bass, speed", bpm: "150+", hue: 55 },
];

export function levelInfo(n: number): Level {
  return LEVELS[Math.min(10, Math.max(1, Math.round(n))) - 1];
}

export function clampLevel(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(10, Math.max(1, Math.round(v))) : 5;
}

export const LENSES: Lens[] = [
  {
    id: "listener",
    label: "Plain English",
    hint: "How it sounds, no jargon",
    brief: "Describe how the song sounds to an ordinary listener in plain words — no technical terms.",
  },
  {
    id: "producer",
    label: "Producer",
    hint: "Drums, sounds, mix",
    brief:
      "Break the beat down like a producer: drum pattern and kit sounds, bass, chords/pads, melodic elements, sound design, effects, mix character and space.",
  },
  {
    id: "songwriter",
    label: "Songwriter",
    hint: "Structure, hooks, lyrics",
    brief:
      "Describe the song as a songwriter: structure (intro/verse/pre/hook/bridge), how the hook works, melodic contour, lyrical themes and point of view, rhyme and flow.",
  },
  {
    id: "theory",
    label: "Music theory",
    hint: "Key, chords, rhythm",
    brief:
      "Describe the harmony and rhythm: key and mode, likely chord movement, time feel (straight/swung/half-time), syncopation, tempo. Be honest where you are estimating.",
  },
  {
    id: "dj",
    label: "DJ",
    hint: "BPM, energy, mixing",
    brief:
      "Describe it for a DJ: BPM and key for mixing, energy curve through the track, intro/outro mixability, what it transitions well into and out of, when in a set it belongs.",
  },
  {
    id: "mood",
    label: "Vibe & moment",
    hint: "Feeling, setting, when to play it",
    brief:
      "Describe the emotional vibe and the moment it belongs to — the setting, time of day, activity and feeling it creates.",
  },
  {
    id: "dancer",
    label: "Dancer",
    hint: "Groove, counts, movement",
    brief:
      "Describe it for a dancer: the groove, where the accents land, counts and phrasing, how the body wants to move, styles it suits.",
  },
  {
    id: "recreate",
    label: "Make one like it",
    hint: "A recipe + Suno-style prompt",
    brief:
      "Give a practical recipe for making an original song in this style: tempo, key area, drum and instrument choices, vocal approach, arrangement, and the signature moves that make it sound like this. End with one line starting 'Style prompt:' — a comma-separated style prompt usable in Suno, naming no artists.",
  },
];

export const LENS_IDS = LENSES.map((l) => l.id);

export function isLens(v: unknown): v is LensId {
  return typeof v === "string" && (LENS_IDS as string[]).includes(v);
}

/** What a fresh library ticks before you have a habit of your own. */
export const STARTER_LENSES: LensId[] = ["listener", "producer", "recreate"];
