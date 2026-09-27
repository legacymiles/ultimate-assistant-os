// ---------------------------------------------------------------------------
// The decisions an always-listening microphone has to make, without React.
//
// Jarvis's old voice was push-to-talk in a modal: you pressed a button, it
// listened, you let go. Always-on is a different problem, and these four
// judgements are the whole of it:
//
//   Did it hear its name, and what came after it?
//   Is what it just heard its OWN voice coming back through the speakers?
//   Has the owner finished the sentence, or only paused mid-thought?
//   Was that an interruption?
//
// All four are pure string and time work, which is why they live here and get
// tested rather than being buried in an event handler where they can only be
// debugged by talking to a laptop.
// ---------------------------------------------------------------------------

export const DEFAULT_WAKE_WORDS = ["jarvis", "hey jarvis", "ok jarvis", "yo jarvis"];

/** Lowercase, no punctuation, single-spaced — the form every compare uses. */
export function normalise(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface WakeHit {
  /** Whether the name was heard at all. */
  woke: boolean;
  /** Everything after the name — the actual instruction, often empty. */
  rest: string;
}

/**
 * Find the wake word and return what followed it.
 *
 * Takes the LAST occurrence, not the first. "Jarvis, no — Jarvis, open my
 * calendar" is one utterance with two names in it, and the instruction is the
 * one attached to the second; starting from the first would hand over "no —
 * jarvis open my calendar" and act on a sentence the owner retracted.
 *
 * Speech recognition also hears "jarvis" as "jarvez", "jervis" and "travis"
 * often enough that refusing those means the assistant ignores its owner, so
 * near-misses count. The cost of a false wake is one discarded turn; the cost
 * of a missed wake is the feature not working.
 */
export function detectWake(text: string, wakeWords: string[] = DEFAULT_WAKE_WORDS): WakeHit {
  const said = normalise(text);
  if (!said) return { woke: false, rest: "" };

  const words = wakeWords.map(normalise).filter(Boolean);
  const alternates = ["jarvis", "jarvez", "jervis", "jarviss", "travis", "javis", "charvis"];
  const all = [...new Set([...words, ...alternates])].sort((a, b) => b.length - a.length);

  let bestEnd = -1;
  let bestStart = -1;
  for (const w of all) {
    // Word boundaries, so "jarvis" is not found inside another word.
    const re = new RegExp(`(^|\\s)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(said)) !== null) {
      const end = m.index + m[0].length;
      if (end > bestEnd) {
        bestEnd = end;
        bestStart = m.index;
      }
      re.lastIndex = m.index + 1;
    }
  }
  if (bestEnd < 0) return { woke: false, rest: "" };

  const rest = said.slice(bestEnd).replace(/^(please|can you|could you|would you)\s+/, "").trim();
  return { woke: true, rest: bestStart >= 0 ? rest : "" };
}

/**
 * Is this the assistant hearing itself?
 *
 * A speaker two feet from a microphone means every spoken reply comes straight
 * back in, and without this the assistant answers its own answer — the failure
 * that makes always-on voice unusable within about three turns.
 *
 * The test is containment in either direction, because recognition returns a
 * fragment of what was said, not the whole of it, and it returns that fragment
 * with different punctuation and often a dropped word.
 */
export function isEcho(heard: string, speaking: string): boolean {
  const h = normalise(heard);
  const s = normalise(speaking);
  if (!h || !s) return false;
  if (h.length < 4) return false;
  if (s.includes(h) || h.includes(s)) return true;

  // Partial overlap: most of what was heard appears in what is being said.
  const hw = h.split(" ").filter((w) => w.length > 2);
  if (hw.length === 0) return false;
  const shared = hw.filter((w) => s.includes(w)).length;
  return shared / hw.length >= 0.6;
}

const STOP_WORDS = [
  "stop", "shut up", "be quiet", "quiet", "cancel", "wait", "hold on",
  "never mind", "nevermind", "forget it", "enough",
];

/**
 * Words that can trail a stop word without turning it into an instruction.
 * "wait a second" is still an interruption; "cancel my four o'clock" is work.
 */
const FILLER = ["it", "that", "please", "jarvis", "now", "there", "up", "a", "second", "sec", "minute", "moment"];

/**
 * Did the owner cut it off?
 *
 * The distinction that matters is whether an OBJECT follows. "Stop" is an
 * interruption; "stop the timer" is the one voice command that would otherwise
 * be impossible to issue, because the interruption test would eat it before
 * anything heard the rest of the sentence. So a stop word counts only when
 * nothing of substance follows it.
 */
export function isInterruption(text: string): boolean {
  const said = normalise(text);
  if (!said) return false;
  for (const w of STOP_WORDS) {
    if (said === w) return true;
    if (!said.startsWith(`${w} `)) continue;
    const trailing = said.slice(w.length).trim().split(" ").filter(Boolean);
    if (trailing.every((t) => FILLER.includes(t))) return true;
  }
  return false;
}

/** Silence after the last new word before the sentence is taken as finished. */
export const ENDPOINT_SILENCE_MS = 1_100;
/** A long instruction still gets cut off eventually rather than never firing. */
export const MAX_UTTERANCE_MS = 25_000;

/**
 * Has the owner finished talking?
 *
 * Endpointing on silence alone strands a turn forever if recognition stops
 * emitting without ending — which Chrome does — so the age of the utterance is
 * a second, independent reason to go.
 */
export function shouldEndpoint(
  { lastWordAt, startedAt, now }: { lastWordAt: number; startedAt: number; now: number },
  silenceMs = ENDPOINT_SILENCE_MS,
): boolean {
  if (now - startedAt >= MAX_UTTERANCE_MS) return true;
  return now - lastWordAt >= silenceMs;
}

/**
 * How long to wait before starting recognition again after it ends.
 *
 * Chrome ends a continuous session on its own every minute or so, and on some
 * errors it ends instantly and repeatedly. Restarting with no delay turns that
 * into a spin that pins a core and floods the console, so failures back off —
 * but a healthy end restarts immediately, because a gap here is a word the
 * owner has to say twice.
 */
export function restartDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(250 * 2 ** (consecutiveFailures - 1), 8_000);
}
