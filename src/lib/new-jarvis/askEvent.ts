// ---------------------------------------------------------------------------
// "jarvis:ask" — how any part of Jarvis hands work to the super chat.
//
// Two shapes, both fired as a window CustomEvent:
//   • a string — the Improvements widget's "Start in chat": the text lands in
//     the chat box for the person to read and send. Never sent for them.
//   • an AskRequest — Camera Autopilot's "Do it": the person already said yes
//     on the card, so the job goes straight to the agent with its files
//     attached (the photo the job is about), in Do mode, where it gets the
//     browser, shell, files and app-building tools the super chat has.
//
// Pure: the shell and the senders both import it, and the tests cover it.
// ---------------------------------------------------------------------------

import type { Mode } from "./types";

export const ASK_EVENT = "jarvis:ask";

export interface AskRequest {
  text: string;
  /** Pictures and other media to attach — the shell prepares them like a drop. */
  files?: File[];
  /** True = run it now (the tap was the yes). False = only fill the chat box. */
  send?: boolean;
  mode?: Mode;
}

const MODES: Mode[] = ["ask", "do", "browse", "run"];
const MAX_TEXT = 8_000;
const MAX_FILES = 6;

/** Whatever was fired, as a request the shell can trust — or null. */
export function parseAsk(detail: unknown): AskRequest | null {
  if (typeof detail === "string") {
    const text = detail.trim();
    return text ? { text: text.slice(0, MAX_TEXT), files: [], send: false } : null;
  }
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  const text = typeof d.text === "string" ? d.text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return null;
  const files = Array.isArray(d.files)
    ? d.files.filter((f): f is File => typeof Blob !== "undefined" && f instanceof Blob).slice(0, MAX_FILES)
    : [];
  const mode = MODES.find((m) => m === d.mode);
  return { text, files, send: d.send === true, ...(mode ? { mode } : {}) };
}

/** Fire one. Safe to call during SSR (does nothing). */
export function askJarvis(req: AskRequest | string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: req }));
}
