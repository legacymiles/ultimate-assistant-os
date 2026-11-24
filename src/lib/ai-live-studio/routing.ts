// Three audio paths that must never cross:
//
//   A. The director's mic   → speech recognition → private instructions. Never
//                             connected to any speaker, never spoken.
//   B. Private talkback     → Alex answering the director, on the director's
//                             headphones. Never on the stream's device.
//   C. Public performance   → Alex's on-air voice, on the device the stream
//                             (OBS) captures.
//
// The browser can send sound to a chosen output device (setSinkId), so B and
// C are two separate audio graphs on two separate devices. These are the pure
// rules that decide when talkback may make a sound at all — and when it must
// fall back to silent text, because it could otherwise leak into the stream.

export type ListenMode = "open" | "push" | "wake";

export const LISTEN_LABEL: Record<ListenMode, string> = {
  open: "Always listening",
  push: "Hold to talk",
  wake: "Only after “Alex”",
};

export interface OutputDevice {
  deviceId: string;
  groupId: string;
  label: string;
}

/**
 * The physical device behind an id. Chrome lists "default" and
 * "communications" as aliases of real devices, so two different ids can be
 * the same speakers — compare the hardware (groupId), never the id.
 * Null when it can't be known (the browser hides devices until the mic is
 * allowed, or the device was unplugged) — and unknown is never "different".
 */
export function physical(id: string, devices: OutputDevice[]): string | null {
  const want = id || "default";
  const d = devices.find((x) => x.deviceId === want);
  return d && (d.groupId || d.deviceId) ? d.groupId || d.deviceId : null;
}

export interface TalkbackInput {
  talkback: boolean;
  /** The browser can route audio to a chosen device (AudioContext.setSinkId). */
  canRoute: boolean;
  publicId: string;
  privateId: string;
  devices: OutputDevice[];
  /** The public voice path: the browser's own voice can't be routed anywhere. */
  voice: "server" | "browser";
}

export type TalkbackMode = "off" | "voice" | "text";

export interface TalkbackVerdict {
  mode: TalkbackMode;
  /** Why it's text-only, in plain words with the fix. */
  why?: string;
}

/**
 * Whether Alex may answer the director out loud. Fails closed: whenever the
 * private voice could reach the stream's device, the answer is shown as text.
 */
export function talkbackVerdict(i: TalkbackInput): TalkbackVerdict {
  if (!i.talkback) return { mode: "off" };
  if (i.voice === "browser") {
    return { mode: "text", why: "The voice server is off, and the browser's own voice can't be kept off the stream — Alex answers in text. Start Phonon to hear him." };
  }
  if (!i.canRoute) {
    return { mode: "text", why: "This browser can't send sound to a separate device — Alex answers in text. Use Chrome or Edge to hear him." };
  }
  const priv = physical(i.privateId, i.devices);
  const pub = physical(i.publicId, i.devices);
  if (priv === null || pub === null) {
    return { mode: "text", why: "Can't tell your outputs apart yet, so he answers in text. Turn the mic on once, then pick your headphones under Change." };
  }
  if (priv === pub) {
    return { mode: "text", why: "Talkback and the stream use the same speakers, so the stream would hear him — he answers in text. Pick your headphones under Change." };
  }

  return { mode: "voice" };
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** Share of the heard words that appear, in order-insensitive bag terms, in the line. */
export function overlap(heard: string, line: string): number {
  const h = words(heard);
  if (!h.length) return 0;
  const bag = new Map<string, number>();
  for (const w of words(line)) bag.set(w, (bag.get(w) ?? 0) + 1);
  let hits = 0;
  for (const w of h) {
    const n = bag.get(w) ?? 0;
    if (n > 0) {
      hits += 1;
      bag.set(w, n - 1);
    }
  }
  return hits / h.length;
}

/**
 * The mic heard Alex, not the director. Without this, a speaker-to-mic leak
 * turns his own on-air line into an "instruction". Short fragments need a
 * near-total match; longer ones a strong majority.
 */
export function isEcho(heard: string, recent: string[]): boolean {
  const n = words(heard).length;
  if (n === 0) return true;
  const bar = n <= 3 ? 1 : n <= 6 ? 0.8 : 0.65;
  return recent.some((line) => overlap(heard, line) >= bar);
}

/**
 * Wake-word mode: only what comes after the character's name counts. Returns
 * the command, or null when the name wasn't said (the speech is ignored).
 */
export function afterWakeWord(text: string, name: string): string | null {
  const n = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(`\\b(?:hey\\s+|ok(?:ay)?\\s+)?${n}\\b[,:]?\\s*(.*)$`, "i"));
  if (!m) return null;
  return m[1].trim();
}

/** Recognition this unsure is shown for a yes/no before anything changes. */
export const CONFIRM_BELOW = 0.45;

export function needsConfirm(confidence: number | undefined): boolean {
  // Chrome reports 0 when it has no estimate — that's "unknown", not "unsure".
  return typeof confidence === "number" && confidence > 0 && confidence < CONFIRM_BELOW;
}
