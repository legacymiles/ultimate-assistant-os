// ---------------------------------------------------------------------------
// Soundprint — named performers.
//
// There's an important distinction here, and getting it right is what makes
// the app useful rather than annoying:
//
//   "the intro of The Reason by Hoobastank"  → identifying WHICH SONG.
//                                              Totally fine. Left alone.
//   "make it sound like Chris sings it"      → asking a platform to IMITATE
//                                              a real performer's voice.
//
// The second one we translate. Not just because voice-likeness law is real
// (Tennessee's ELVIS Act, California AB 1836, the proposed NO FAKES Act), but
// because it's the weaker prompt: platforms filter artist names outright, and
// a name carries far less information than a description of the actual voice.
// "strained tenor, rasp on the pushed notes, breathy consonants" beats a name
// on every platform, every time.
// ---------------------------------------------------------------------------

import type { PerformerSwap } from "./types";

/** Triggers where the performer's name FOLLOWS the phrase. */
const NAME_AFTER =
  /(?:sung by|performed by|vocals by|vocal by|voice of|in the voice of|featuring|feat\.|ft\.|sounds like|sound like|make it|have)\s+([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,3})/g;

/** Triggers where the performer's name PRECEDES the phrase. */
const NAME_BEFORE =
  /\b([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,3})\s+(?:singing|sings|rapping|raps|performing|on vocals|on the vocals)\b/g;

/** Possessive form: "Drake's voice", "Adele's tone". */
const POSSESSIVE =
  /\b([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,2})['’]s\s+(?:voice|vocals|tone|delivery|flow|timbre)\b/g;

/** Words that start a sentence and get mistaken for names. */
const NOT_NAMES = new Set([
  "a", "an", "the", "i", "it", "this", "that", "make", "just", "only", "but",
  "and", "or", "so", "then", "when", "with", "without", "like", "before",
  "after", "song", "songs", "track", "intro", "verse", "chorus", "bridge",
  "outro", "beat", "drums", "guitar", "piano", "vocals", "voice", "style",
  "suno", "treblo", "please", "want", "need", "should", "would", "could",
  "he", "she", "they", "we", "you", "someone", "somebody", "him", "her",
]);

function clean(raw: string): string | null {
  const name = raw.trim().replace(/[.,;:]$/, "");
  if (!name) return null;

  const words = name.split(/\s+/);
  // Drop leading filler ("It Sounds Like Drake" → "Drake").
  while (words.length && NOT_NAMES.has(words[0].toLowerCase())) words.shift();
  if (!words.length) return null;

  const result = words.join(" ");
  // A single lowercase-ish token is almost never a performer.
  if (result.length < 2) return null;
  if (NOT_NAMES.has(result.toLowerCase())) return null;
  return result;
}

/**
 * Finds performers the user is asking to have PERFORM the song. Deliberately
 * ignores the reference field — naming the song you're chasing is not a
 * request to clone anybody.
 */
export function detectPerformanceRequest(request: string): string[] {
  const found = new Set<string>();

  for (const re of [NAME_AFTER, NAME_BEFORE, POSSESSIVE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(request)) !== null) {
      const name = clean(m[1]);
      if (name) found.add(name);
    }
  }

  return [...found].slice(0, 4);
}

/**
 * Offline scaffold used when there's no API key. The AI path replaces this
 * with a real, specific description of how that voice actually sounds.
 */
export function scaffoldSwap(name: string): PerformerSwap {
  return {
    name,
    profile:
      "Describe the voice instead of naming them — range (tenor / alto / baritone), " +
      "texture (raspy, breathy, smoky, clean), delivery (restrained, belted, " +
      "conversational, behind the beat) and treatment (doubled, reverb-soaked, dry). " +
      "Pick the traits from the Vocal chips and they'll be written into the style prompt.",
  };
}

/** The line shown in the UI when a swap happened. */
export function swapNotice(count: number): string {
  return count === 1
    ? "You named a performer — it's been translated into a voice profile that works on every platform and won't get filtered."
    : "You named performers — they've been translated into voice profiles that work on every platform and won't get filtered.";
}
