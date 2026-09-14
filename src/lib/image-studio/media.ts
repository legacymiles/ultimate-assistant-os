// ---------------------------------------------------------------------------
// Image Studio — the image store.
//
// Generated images are 1–2 MB each, far past what localStorage can hold, so
// the bytes live in IndexedDB under a media id and the gallery metadata refers
// to that id. Same pattern as src/lib/auteur/media.ts. Everything is
// best-effort: with storage blocked the app still generates, it just forgets.
// ---------------------------------------------------------------------------

"use client";

import { uid } from "@/lib/utils";

const DB = "image-studio-media";
const STORE = "blobs";

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Store a blob, returning its media id, or null when storage is unavailable. */
export async function putMedia(blob: Blob, id = uid("img")): Promise<string | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getMedia(id: string): Promise<Blob | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function deleteMedia(id: string): Promise<void> {
  const db = await open();
  if (!db) return;
  urls.delete(id);
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// One object URL per media id for the life of the tab.
const urls = new Map<string, string>();

export async function mediaUrl(id: string): Promise<string | null> {
  const hit = urls.get(id);
  if (hit) return hit;
  const blob = await getMedia(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

// ----- conversions ---------------------------------------------------------

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

/**
 * A reference photo as a JPEG data URL no larger than `max` px on its long
 * side. Phone photos are 3–8 MB; shrinking first keeps six of them well under
 * the request size limit and makes the model call faster.
 */
export async function downscaleToDataUrl(file: Blob, max = 1024, quality = 0.86): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}
