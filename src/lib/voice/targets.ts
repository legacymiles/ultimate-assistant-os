// ---------------------------------------------------------------------------
// Where a spoken sentence goes.
//
// One microphone serves the whole hub (owner, Nov 2026: "the real time voice
// should be connected to every chat and every harness so users can talk to it
// from most pages"). Every chat box and every open harness thread registers
// itself as a TARGET; when the owner says "Jarvis, …", the sentence goes to the
// one they are most plainly using:
//
//   1. the target they last touched (typed in, clicked, focused) — a person
//      talking to a page talks to the box they were just in;
//   2. otherwise the highest priority one on screen (a harness thread outranks
//      a page's quick bar, the main Jarvis chat outranks both on its own page);
//   3. otherwise the newest to appear.
//
// With no target at all, the hub falls back (see VoiceProvider): type into the
// focused text box, or hand it to Jarvis's agent.
//
// Pure: no React, no DOM, so the choice is tested rather than debugged by
// talking to a laptop.
// ---------------------------------------------------------------------------

export type TargetKind = "chat" | "harness";

export interface VoiceTarget {
  id: string;
  /** Said and shown: "Profiles", "Harness · App Builder". */
  label: string;
  kind: TargetKind;
  /** Higher wins when nothing was touched. Main Jarvis chat 30, harness 20, page chats 10. */
  priority: number;
  /**
   * Deliver the sentence. Resolve with the words to speak back, or nothing
   * when the target speaks for itself or has nothing worth reading aloud.
   */
  send: (text: string) => Promise<string | void> | string | void;
  /**
   * The target drives the voice itself (Jarvis's main chat marks the round
   * trip and reads its own answer), so the hub must not speak or reset it.
   */
  speaksForItself?: boolean;
}

export interface Registered extends VoiceTarget {
  /** When it registered. */
  addedAt: number;
  /** When the owner last used it (typed, clicked, focused). 0 = never. */
  touchedAt: number;
}

export type Registry = ReadonlyMap<string, Registered>;

export function register(reg: Registry, t: VoiceTarget, now: number): Map<string, Registered> {
  const next = new Map(reg);
  const prev = reg.get(t.id);
  next.set(t.id, { ...t, addedAt: prev?.addedAt ?? now, touchedAt: prev?.touchedAt ?? 0 });
  return next;
}

export function unregister(reg: Registry, id: string): Map<string, Registered> {
  const next = new Map(reg);
  next.delete(id);
  return next;
}

export function touch(reg: Registry, id: string, now: number): Map<string, Registered> {
  const t = reg.get(id);
  if (!t) return new Map(reg);
  const next = new Map(reg);
  next.set(id, { ...t, touchedAt: now });
  return next;
}

/** The target a spoken sentence should go to, or null when nothing is registered. */
export function pickTarget(reg: Registry): Registered | null {
  let best: Registered | null = null;
  for (const t of reg.values()) {
    if (!best) {
      best = t;
      continue;
    }
    if (t.touchedAt !== best.touchedAt) {
      if (t.touchedAt > best.touchedAt) best = t;
      continue;
    }
    if (t.priority !== best.priority) {
      if (t.priority > best.priority) best = t;
      continue;
    }
    if (t.addedAt > best.addedAt) best = t;
  }
  return best;
}

/**
 * Words worth reading aloud from a model's reply: no code blocks, no markdown
 * marks, no URLs spelled out, and not a page-long essay.
 */
export function speakable(text: string, max = 600): string {
  let s = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    s = (end > max * 0.4 ? cut.slice(0, end + 1) : cut) + " There's more on screen.";
  }
  return s;
}

/**
 * Start/stop, not always-on: after one request (it heard, thought, or spoke
 * and is now back to waiting for its name), the microphone goes off — unless
 * the owner switched Hands-free on. Starting up (off → waiting) never stops it.
 */
export function shouldStopListening(prev: string, next: string, handsFree: boolean): boolean {
  if (handsFree) return false;
  return next === "waiting" && (prev === "hearing" || prev === "thinking" || prev === "speaking");
}
