// One shape for everything that arrives — a TikTok comment, a gift, a demo
// viewer, or (later) the owner's microphone — so nothing downstream knows or
// cares where a line came from.

export type EventKind = "comment" | "gift" | "follow" | "share" | "speech";

export interface AgentEvent {
  /** Stable id, so the same comment arriving twice is one comment (D5). */
  id: string;
  kind: EventKind;
  /** Platform unique id — stable, used as the memory key. */
  handle: string;
  /** Display name, what the character says out loud. */
  user: string;
  /** Comment body or transcript. For a gift, the gift's name. Empty for follows. */
  text: string;
  ts: number;
  /** Profile picture, when the platform sends one. https only. */
  avatar?: string;
}

const KINDS: EventKind[] = ["comment", "gift", "follow", "share", "speech"];
/** Comments longer than this are padding, not questions. */
export const MAX_TEXT = 280;
/** Kinds that mean nothing without words. */
const NEEDS_TEXT: EventKind[] = ["comment", "speech"];

/** Small, stable, non-cryptographic hash (FNV-1a) for building ids. */
export function hashText(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function parseEvent(raw: unknown, now: number): AgentEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const kind = KINDS.find((k) => k === r.type);
  if (!kind) return null;

  const handle = typeof r.handle === "string" ? r.handle.trim().slice(0, 64) : "";
  if (!handle) return null;

  const text = (typeof r.text === "string" ? r.text : "").trim().slice(0, MAX_TEXT);
  if (!text && NEEDS_TEXT.includes(kind)) return null;

  const user = ((typeof r.user === "string" ? r.user.trim() : "") || handle).slice(0, 64);
  const ts = typeof r.ts === "number" && Number.isFinite(r.ts) ? r.ts : now;
  const avatar = typeof r.avatar === "string" && /^https:\/\//.test(r.avatar) ? r.avatar : undefined;
  const id =
    typeof r.id === "string" && r.id.trim()
      ? r.id.trim().slice(0, 120)
      : `${kind}:${handle}:${ts}:${hashText(text)}`;

  return { id, kind, handle, user, text, ts, ...(avatar ? { avatar } : {}) };
}
