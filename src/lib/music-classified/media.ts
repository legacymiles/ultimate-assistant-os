"use client";

// Uploaded songs, kept on this device in IndexedDB.
//
// Audio can't live in the synced JSON (a song is tens of MB; localStorage tops
// out near 5 MB), so the record carries an audioId and the bytes stay here. On
// another device the record still shows — it just has nothing to play.

import { uid } from "@/lib/utils";

const DB = "music-classified-audio";
const STORE = "songs";

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putAudio(blob: Blob, id = uid("audio")): Promise<string | null> {
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

export async function getAudio(id: string): Promise<Blob | null> {
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

export async function deleteAudio(id: string): Promise<void> {
  const db = await open();
  if (!db) return;
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

const urls = new Map<string, string>();

/** An object URL for playback, cached for the life of the tab; null when the audio isn't on this device. */
export async function audioUrl(id: string): Promise<string | null> {
  const hit = urls.get(id);
  if (hit) return hit;
  const blob = await getAudio(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}
