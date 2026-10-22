// ---------------------------------------------------------------------------
// Keeping Camera Autopilot the same on the phone and the laptop.
//
// Each device keeps its own review queue (the pixels live in that browser),
// fed from the iPhone inbox on the server. The inbox now keeps every photo
// until it is filed or removed somewhere, or deleted from the phone. On every
// check a device:
//
//   * copies in the inbox photos it hasn't had yet, and
//   * drops the queued photos the inbox no longer has — filed or removed on
//     the other device, or deleted from the phone.
//
// A device remembers which inbox photos it has had, so a photo it filed (or
// dropped as a copy) is not brought straight back on the next check.
//
// The planning is pure, so the rules are tested.
// ---------------------------------------------------------------------------

export interface QueuedLike {
  id: string;
  inboxId?: string;
}

export interface SyncPlan {
  /** Inbox photos to copy in. */
  toImport: string[];
  /** Queued photos to drop: the inbox let go of them. */
  toRemove: string[];
}

export function planInboxSync(serverIds: string[], queue: QueuedLike[], had: Set<string>): SyncPlan {
  const onServer = new Set(serverIds);
  const queuedInbox = new Set(queue.map((p) => p.inboxId).filter(Boolean) as string[]);
  return {
    toImport: serverIds.filter((id) => !had.has(id) && !queuedInbox.has(id)),
    toRemove: queue.filter((p) => p.inboxId && !onServer.has(p.inboxId)).map((p) => p.id),
  };
}

const HAD_KEY = "jarvis-inbox-had:v1";
const HAD_LIMIT = 3000;

/** The inbox photos this device has already had, newest last. */
export function readHad(): Set<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(HAD_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function rememberHad(ids: string[]): void {
  if (!ids.length) return;
  try {
    const list = [...readHad(), ...ids];
    window.localStorage.setItem(HAD_KEY, JSON.stringify([...new Set(list)].slice(-HAD_LIMIT)));
  } catch {
    // Storage full or blocked: at worst a photo is offered once more, and the copy check catches it.
  }
}
