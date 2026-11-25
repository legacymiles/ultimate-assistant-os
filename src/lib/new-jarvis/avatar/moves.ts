// What Alex does when he isn't talking — so the real face never just stares.
//
// LiveTalking only redraws his mouth. Blinking, glancing at chat and the
// expressions are in his quiet loop; the bigger moments (a sip of coffee, a
// laugh, a wave) are short clips LiveTalking plays on command (`/set_audiotype`).
// The clips are rendered by tools/alex-moves (clips.json) and every one starts
// and ends on the same pose, so any can follow any other.
//
// This file is the choreography, kept pure so it can be tested: which move
// fits what he just said, and when to do something on his own while quiet.

export type Mood = "calm" | "happy" | "thinking" | "greeting" | "curious";

export interface Move {
  id: string;
  /** LiveTalking audiotype — the order of the action clips in tools/alex-moves/clips.json, from 2. */
  type: number;
  mood: Mood;
  /** Fine to do unprompted while quiet (a wave or a laugh at nothing would look odd). */
  idle: boolean;
}

export const MOVES: Move[] = [
  { id: "sip", type: 2, mood: "calm", idle: true },
  { id: "laugh", type: 3, mood: "happy", idle: false },
  { id: "think", type: 4, mood: "thinking", idle: true },
  { id: "wave", type: 5, mood: "greeting", idle: false },
  { id: "lean", type: 6, mood: "curious", idle: true },
];

/** How long one action clip plays (124 frames at 24 fps, resampled to 25). */
export const MOVE_MS = 5_200;

/** While quiet, something happens on its own somewhere in this window. */
export const IDLE_MIN_MS = 18_000;
export const IDLE_MAX_MS = 40_000;

const CUES: [Mood, RegExp][] = [
  ["greeting", /\b(hi|hey|hello|welcome|good (morning|afternoon|evening)|what'?s up|bye|see you|later)\b/i],
  ["happy", /\b(ha(ha)+|lol|lmao|funny|hilarious|joke|love (it|that)|awesome|amazing|congrat\w*)\b|😂|🤣/i],
  ["curious", /\b(wow|whoa|really|no way|interesting|surprising|seriously|wait what)\b/i],
  ["thinking", /\b(let me think|hmm+|good question|depends|not sure|maybe|i think|i'?d say|tricky)\b|\?\s*$/i],
];

/** The mood a line carries, or null when nothing in it stands out. */
export function moodOf(text: string): Mood | null {
  const said = String(text ?? "");
  for (const [mood, re] of CUES) if (re.test(said)) return mood;
  return null;
}

const byMood = (mood: Mood) => MOVES.find((m) => m.mood === mood) ?? null;

/**
 * After a line: the move that fits it, often — but not after every sentence,
 * or the reaction becomes a tic. A plain line now and then gets a sip.
 */
export function pickAfterLine(text: string, rand: () => number = Math.random): Move | null {
  const mood = moodOf(text);
  if (mood) return rand() < 0.7 ? byMood(mood) : null;
  return rand() < 0.15 ? byMood("calm") : null;
}

/** Something to do on his own while quiet, never the same thing twice running. */
export function pickIdle(lastId: string | null, rand: () => number = Math.random): Move {
  const pool = MOVES.filter((m) => m.idle && m.id !== lastId);
  const from = pool.length ? pool : MOVES.filter((m) => m.idle);
  return from[Math.min(from.length - 1, Math.floor(rand() * from.length))];
}

/** How long to wait before the next unprompted move. */
export function nextIdleMs(rand: () => number = Math.random): number {
  return Math.round(IDLE_MIN_MS + rand() * (IDLE_MAX_MS - IDLE_MIN_MS));
}
