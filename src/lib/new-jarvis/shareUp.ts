// ---------------------------------------------------------------------------
// One Camera Autopilot on every device.
//
// iPhone photos reach every device through the inbox (inboxSync.ts). But a
// photo waiting on only ONE device — added with the upload button, or brought
// in before photos were shared — never reached the others, so the phone and
// the laptop showed different photos. Each check now:
//
//   * sends a few of those one-device photos up to the inbox, so the other
//     devices copy them in like any iPhone photo, and
//   * lines every waiting inbox photo up by the same time on every device
//     (taken, or else reached the inbox), so the order matches too — newest
//     at the top everywhere.
//
// The planning is pure, so the rules are tested.
// ---------------------------------------------------------------------------

export interface QueuedForShare {
  id: string;
  fileId?: string;
  inboxId?: string;
  takenAt?: string;
  addedAt?: string;
}

/** Photos sent up per check — the rest go on the next one. */
export const SHARE_UP_PER_CHECK = 6;

/** Which one-device photos to send up now, newest first. */
export function planShareUp<T extends QueuedForShare>(queue: T[], skip: Set<string>, max = SHARE_UP_PER_CHECK): T[] {
  const t = (p: T) => Date.parse(p.takenAt ?? "") || Date.parse(p.addedAt ?? "") || 0;
  return queue
    .filter((p) => !p.inboxId && p.fileId && !skip.has(p.id))
    .sort((a, b) => t(b) - t(a))
    .slice(0, max);
}

/**
 * Queued photos whose time differs from the inbox's for the same photo:
 * id → the time every device should use.
 */
export function planRestamp(
  queue: QueuedForShare[],
  inboxTimes: Map<string, number>,
): { id: string; takenAt: string }[] {
  const out: { id: string; takenAt: string }[] = [];
  for (const p of queue) {
    if (!p.inboxId) continue;
    const want = inboxTimes.get(p.inboxId);
    if (want === undefined || Number.isNaN(want)) continue;
    const have = p.takenAt ? Date.parse(p.takenAt) : NaN;
    if (Number.isNaN(have) || Math.abs(have - want) > 1000) out.push({ id: p.id, takenAt: new Date(want).toISOString() });
  }
  return out;
}

const SKIP_KEY = "jarvis-share-up-skip:v1";

/** Photos not to try again (a copy of one already filed elsewhere). */
export function readShareSkip(): Set<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SKIP_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function addShareSkip(id: string): void {
  try {
    const list = [...readShareSkip(), id].slice(-1000);
    window.localStorage.setItem(SKIP_KEY, JSON.stringify(list));
  } catch {
    // Blocked storage: at worst it is tried again next check.
  }
}

/** Under Vercel's 4.5 MB request limit, with room for the form around it. */
const MAX_UPLOAD_BYTES = 4_000_000;

/** A big photo is re-encoded smaller so it fits through the upload. */
export async function fitForUpload(blob: Blob): Promise<Blob> {
  if (blob.size <= MAX_UPLOAD_BYTES || typeof createImageBitmap === "undefined") return blob;
  try {
    const bmp = await createImageBitmap(blob);
    for (const edge of [2560, 2048, 1600]) {
      const k = Math.min(1, edge / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
      const out = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
      if (out && out.size <= MAX_UPLOAD_BYTES) return out;
    }
  } catch {
    // Can't decode it here: send it as is and let the server say.
  }
  return blob;
}
