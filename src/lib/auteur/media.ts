// ---------------------------------------------------------------------------
// Auteur — the media store.
//
// Reference images, uploaded audio and rendered clips are bytes. They belong
// in IndexedDB, not in the project JSON: a single 2K H3 clip is tens of MB,
// and localStorage tops out around 5 MB in total. Each item is one Blob under
// a mediaId that the project structure refers to.
//
// Everything here is best-effort and browser-only. A missing blob is an
// ordinary state (another device, cleared storage) and the UI shows the
// reference's thumbnail or the take's animatic instead of failing.
// ---------------------------------------------------------------------------

"use client";

import { uid } from "@/lib/utils";

const DB = "auteur-media";
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

/** Store a blob, returning its new mediaId, or null when storage is unavailable. */
export async function putMedia(blob: Blob, id = uid("m")): Promise<string | null> {
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

// ----- object URL cache ----------------------------------------------------
// One object URL per mediaId for the life of the tab. Revoking on unmount
// would break the next component that asks for the same clip a moment later.

const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export function mediaUrl(id: string): Promise<string | null> {
  const hit = urls.get(id);
  if (hit) return Promise.resolve(hit);
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;
  const p = getMedia(id).then((blob) => {
    pending.delete(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(id, url);
    return url;
  });
  pending.set(id, p);
  return p;
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

/** A small JPEG data URL for cards; null for non-images or when drawing fails. */
export async function makeThumb(file: Blob, max = 320): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  }
}

/** First frame of a video as a JPEG data URL, for video-reference cards. */
export function videoPoster(file: Blob, max = 320): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.src = url;
      const done = (out: string | null) => {
        URL.revokeObjectURL(url);
        resolve(out);
      };
      v.onerror = () => done(null);
      v.onloadeddata = () => {
        v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
      };
      v.onseeked = () => {
        try {
          const scale = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(v.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(v.videoHeight * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) return done(null);
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          done(canvas.toDataURL("image/jpeg", 0.72));
        } catch {
          done(null);
        }
      };
      setTimeout(() => done(null), 4000);
    } catch {
      resolve(null);
    }
  });
}

/** Duration of an audio or video file in seconds, or undefined. */
export function mediaDuration(file: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
      el.preload = "metadata";
      el.src = url;
      el.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(el.duration) ? el.duration : undefined);
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(undefined);
      };
      setTimeout(() => resolve(undefined), 4000);
    } catch {
      resolve(undefined);
    }
  });
}
