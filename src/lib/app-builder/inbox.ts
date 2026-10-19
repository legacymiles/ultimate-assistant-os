"use client";

// ---------------------------------------------------------------------------
// App Builder's inbox: recordings handed over from Jarvis chat.
//
// The project itself goes into the synced store; the frames and sound of a
// video are too heavy for that (and for localStorage), so they wait here, in
// this browser's IndexedDB, until App Builder opens the project and the super
// agent watches them. Same origin, so a chat tab and an App Builder tab share
// it. Every call is best-effort: a browser without IndexedDB (private mode on
// some phones) just starts the project without the recording, and says so.
// ---------------------------------------------------------------------------

import type { PreparedMedia } from "./media";

const DB = "app-builder";
const STORE = "inbox";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      t.oncomplete = () => db.close();
    } catch {
      resolve(null);
    }
  });
}

/** Keep a project's media until App Builder picks it up. */
export async function putMedia(projectId: string, media: PreparedMedia[]): Promise<boolean> {
  if (!media.length) return true;
  return (await tx("readwrite", (s) => s.put(media, projectId))) !== null;
}

/** A project's waiting media (kept until `dropMedia`, so a failed watch can be retried). */
export async function getMedia(projectId: string): Promise<PreparedMedia[]> {
  const got = await tx<PreparedMedia[] | undefined>("readonly", (s) => s.get(projectId) as IDBRequest<PreparedMedia[] | undefined>);
  return Array.isArray(got) ? got : [];
}

export async function dropMedia(projectId: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(projectId));
}
