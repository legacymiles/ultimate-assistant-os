"use client";

// ---------------------------------------------------------------------------
// Getting a kept document's bytes somewhere, and back again.
//
// Two homes, and which one a picture got is recorded on it rather than
// guessed at later:
//
//   synced  the owner's private bucket, through /api/jarvis/record/file. This
//           is the one that matters — the insurance card is wanted ON THE
//           PHONE at the clinic desk, which is the whole point, and a picture
//           that only exists on the laptop that scanned it is no use there.
//   device  IndexedDB here, when nobody is signed in or the upload failed.
//
// The fallback is not a nicety. The hub's rule is that an app works with no
// keys set and degrades VISIBLY — so a signed-out owner still keeps their card
// and the surface says, in words, that it is on this device only. Silently
// dropping it would be the worst of the three outcomes.
//
// IndexedDB rather than localStorage because localStorage is ~5 MB of UTF-16
// shared with every other store in the hub, and base64 of a card would eat a
// large fraction of it and could evict the Record itself.
// ---------------------------------------------------------------------------

import type { FileHome } from "./files";

const DB_NAME = "jarvis-record-files";
const STORE = "pictures";

export function newFileId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// --- this device -----------------------------------------------------------

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = run(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

async function putLocal(id: string, blob: Blob): Promise<boolean> {
  return (await withStore("readwrite", (s) => s.put(blob, id) as IDBRequest<unknown>)) !== null;
}

async function getLocal(id: string): Promise<Blob | null> {
  const v = await withStore<Blob>("readonly", (s) => s.get(id) as IDBRequest<Blob>);
  return v instanceof Blob ? v : null;
}

async function deleteLocal(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}

// --- keeping ---------------------------------------------------------------

export interface Kept {
  id: string;
  where: FileHome;
  bytes: number;
  /** Set when it could not be synced, for the surface to say so plainly. */
  note?: string;
}

export function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const mime = /^data:([^;]+);base64$/.exec(dataUrl.slice(0, comma))?.[1];
  if (!mime) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

/**
 * Store the picture, preferring the owner's account, falling back to here.
 *
 * Never throws and never returns nothing: a kept picture that vanished because
 * the network blinked would be the one failure the owner finds out about at
 * the clinic desk, with the card in a drawer at home.
 */
export async function keepPicture(id: string, dataUrl: string): Promise<Kept> {
  const blob = dataUrlToBlob(dataUrl);
  const bytes = blob?.size ?? 0;

  try {
    const res = await fetch("/api/jarvis/record/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, dataUrl }),
    });
    if (res.ok) return { id, where: "synced", bytes };

    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (blob && (await putLocal(id, blob))) {
      return {
        id,
        where: "device",
        bytes,
        note:
          res.status === 401
            ? "Kept on this device. Sign in and it will follow you to your phone."
            : data.error ?? "Kept on this device — your account could not be reached.",
      };
    }
    return { id, where: "device", bytes, note: data.error ?? "The picture could not be kept." };
  } catch {
    if (blob && (await putLocal(id, blob))) {
      return { id, where: "device", bytes, note: "Kept on this device — you appear to be offline." };
    }
    return { id, where: "device", bytes, note: "The picture could not be kept." };
  }
}

/**
 * A URL to show the picture at, and how to release it.
 *
 * A synced picture is served by a route that re-checks the session, so there
 * is nothing to revoke. A device one is an object URL, which leaks the blob
 * for the life of the document unless the caller gives it back — hence the
 * pair, rather than a bare string the caller has no way to clean up.
 */
export async function pictureUrl(id: string, where: FileHome): Promise<{ url: string; release: () => void } | null> {
  if (where === "synced") {
    return { url: `/api/jarvis/record/file/${encodeURIComponent(id)}`, release: () => {} };
  }
  const blob = await getLocal(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  return { url, release: () => URL.revokeObjectURL(url) };
}

/** Forget it in both places — a picture that moved homes must leave neither behind. */
export async function forgetPicture(id: string): Promise<void> {
  await deleteLocal(id);
  await fetch(`/api/jarvis/record/file?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
}
