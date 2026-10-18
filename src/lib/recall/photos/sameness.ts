// ---------------------------------------------------------------------------
// "Is this the same photo?" — the rule that keeps duplicates out entirely.
//
// The look-alike check in fingerprint.ts only WARNED, so the same picture could
// sit in Camera Autopilot twice: once under the phone's file name and once as a
// re-sent copy. Copies arrive more ways than one would think — a second
// Shortcut or automation sending the same photo, a re-run after a dropped
// connection, the dashboard on two devices pulling at the same moment — and
// each copy can be re-encoded (a different resize, JPEG vs HEIC), so neither the
// bytes nor the file name can be trusted on their own.
//
// A photo is the same as one already here when:
//   • the pictures are indistinguishable (fingerprint distance 0), or
//   • the name and byte size match exactly, or
//   • they look alike AND share the phone's file number ("IMG_6843.jpeg" and
//     "IMG 6843") or the moment they were taken.
// Look-alike alone is NOT enough: two shots of a burst really are different
// photos, and the owner keeps those (they still get the look-alike warning).
// ---------------------------------------------------------------------------

import { hammingHex, LOOKALIKE_MAX_DISTANCE } from "./fingerprint";

export interface PhotoIdentity {
  id: string;
  hash?: string;
  name?: string;
  size?: number;
  takenAt?: string;
  composite?: boolean;
}

/** "IMG_6843.jpeg", "IMG 6843", "img-6843.HEIC" → "img6843". */
export function photoNameKey(name: string | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\.(jpe?g|heic|heif|png|webp|gif|tiff?|dng)$/i, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Generic names a Shortcut invents ("photo-1729…", "image") identify nothing. */
function meaningfulName(key: string): boolean {
  return key.length >= 4 && !/^(photo|image|img|file|upload)\d{0,3}$/.test(key) && !/^photo\d{10,}$/.test(key);
}

const TAKEN_WINDOW_MS = 2000;

export function samePhoto(a: PhotoIdentity, b: PhotoIdentity): boolean {
  if (a.id === b.id) return false;
  if (Boolean(a.composite) !== Boolean(b.composite)) return false;

  const na = photoNameKey(a.name);
  const nb = photoNameKey(b.name);
  if (na && na === nb && meaningfulName(na) && a.size && a.size === b.size) return true;

  if (!a.hash || !b.hash) return false;
  const distance = hammingHex(a.hash, b.hash);
  if (distance === 0) return true;
  if (distance > LOOKALIKE_MAX_DISTANCE) return false;

  if (na && na === nb && meaningfulName(na)) return true;
  const ta = a.takenAt ? Date.parse(a.takenAt) : NaN;
  const tb = b.takenAt ? Date.parse(b.takenAt) : NaN;
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) <= TAKEN_WINDOW_MS;
}

/** The first existing photo `incoming` is a copy of, or null. */
export function findSamePhoto<T extends PhotoIdentity>(incoming: PhotoIdentity, existing: readonly T[]): T | null {
  for (const e of existing) if (samePhoto(incoming, e)) return e;
  return null;
}

/**
 * Which queued photos are copies of another and should go. Of each set of
 * copies the one that is furthest along stays (read beats still reading beats
 * failed), and among equals the one that arrived first.
 */
export function duplicateIds<
  T extends PhotoIdentity & { status?: string; addedAt?: string },
>(queue: readonly T[]): string[] {
  const rank = (p: T) => (p.status === "ready" ? 0 : p.status === "analyzing" ? 1 : 2);
  const ordered = [...queue].sort(
    (x, y) => rank(x) - rank(y) || (Date.parse(x.addedAt ?? "") || 0) - (Date.parse(y.addedAt ?? "") || 0),
  );
  const kept: T[] = [];
  const drop: string[] = [];
  for (const p of ordered) {
    if (findSamePhoto(p, kept)) drop.push(p.id);
    else kept.push(p);
  }
  return drop;
}
