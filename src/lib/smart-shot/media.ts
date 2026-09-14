// ---------------------------------------------------------------------------
// Smart Shot — the byte store. Generated panels are 1–2 MB and clips are
// tens of MB, so they live in IndexedDB under a media id; the project JSON in
// localStorage only holds the id. Best-effort: with storage blocked the app
// still works for the life of the tab through the in-memory fallback.
// ---------------------------------------------------------------------------

"use client";

import { uid } from "@/lib/utils";

const DB = "smart-shot-media";
const STORE = "blobs";
const memory = new Map<string, Blob>();

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

export async function putMedia(blob: Blob, id = uid("ss")): Promise<string> {
  memory.set(id, blob);
  const db = await open();
  if (!db) return id;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  return id;
}

export async function getMedia(id: string): Promise<Blob | null> {
  const hit = memory.get(id);
  if (hit) return hit;
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      req.onsuccess = () => {
        const blob = (req.result as Blob | undefined) ?? null;
        if (blob) memory.set(id, blob);
        resolve(blob);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function deleteMedia(id: string): Promise<void> {
  memory.delete(id);
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
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

/** An object URL for a media id, cached for the life of the tab. */
export async function mediaUrl(id: string): Promise<string | null> {
  const hit = urls.get(id);
  if (hit) return hit;
  const blob = await getMedia(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

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

/** A stored image as a data URL, for sending to a model. */
export async function mediaDataUrl(id: string): Promise<string | null> {
  const blob = await getMedia(id);
  return blob ? blobToDataUrl(blob) : null;
}

/**
 * A JPEG data URL no larger than `max` px on the long side. Uploads are
 * shrunk before they are stored so a project with nine of them still fits
 * localStorage, and generated PNGs are shrunk before they ride along as
 * references so a render request stays well under the body limit.
 */
export async function downscaleToDataUrl(file: Blob, max = 1024, quality = 0.86): Promise<string> {
  const source = await decode(file);
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source.image, 0, 0, canvas.width, canvas.height);
  source.close();
  return canvas.toDataURL("image/jpeg", quality);
}

interface Decoded {
  image: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(file: Blob): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }
}
