"use client";

// ---------------------------------------------------------------------------
// The Studio gallery — everything the owner has actually made.
//
// Until now a finished render was a blob URL that died with the tab: the
// conversation kept the prompt and lost the picture. Here the bytes go into
// IndexedDB under an id and the record (what it was, which prompt made it,
// which workflows and camera settings were on) goes into localStorage beside
// it, so the gallery survives a reload and can be re-opened, re-downloaded or
// sent back into a new prompt.
//
// Same shape as the other media stores in this repo (smart-shot, auteur): the
// blob store is best-effort, and with storage blocked the in-memory map keeps
// the app working for the life of the tab.
// ---------------------------------------------------------------------------

import { uid } from "@/lib/jarvis/store";

const DB = "jarvis-studio-media";
const STORE = "blobs";
const KEY = "jarvis.studio.gallery.v1";
const EVENT = "jarvis-gallery-change";

const memory = new Map<string, Blob>();

export interface GalleryItem {
  id: string;
  medium: "video" | "image";
  /** The job's title, e.g. "Shot 1 — the hook". */
  title: string;
  /** The prompt that produced it, kept so a good result can be repeated. */
  prompt: string;
  /** Workflow labels that were mixed in, for filtering later. */
  workflows: string[];
  /** A one-line read of the camera deck at the time ("Horror · 35mm film"). */
  spec: string;
  mime: string;
  bytes: number;
  createdAt: string;
  /** A still for the grid: the image itself, or a frame grabbed from the clip. */
  poster?: string;
}

// ---------------------------------------------------------------------------
// The bytes.
// ---------------------------------------------------------------------------

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

async function putBlob(id: string, blob: Blob): Promise<void> {
  memory.set(id, blob);
  const db = await open();
  if (!db) return;
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
}

export async function getBlob(id: string): Promise<Blob | null> {
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

async function dropBlob(id: string): Promise<void> {
  memory.delete(id);
  const db = await open();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
  } catch {
    // A blocked store just means the bytes outlive the record; the record is
    // what the gallery lists, so nothing is shown that cannot be opened.
  }
}

// ---------------------------------------------------------------------------
// The records.
// ---------------------------------------------------------------------------

function readIndex(): GalleryItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? (raw as GalleryItem[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(items: GalleryItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Out of quota: the newest render still shows in this session.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT));
}

export function listGallery(): GalleryItem[] {
  return readIndex().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function onGalleryChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

/** A still for the grid: the image itself, or the clip's first drawable frame. */
async function posterFor(blob: Blob, medium: "video" | "image"): Promise<string | undefined> {
  if (typeof document === "undefined") return undefined;
  const url = URL.createObjectURL(blob);
  try {
    if (medium === "image") {
      const img = await new Promise<HTMLImageElement | null>((resolve) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => resolve(null);
        el.src = url;
      });
      if (!img) return undefined;
      return draw(img, img.naturalWidth, img.naturalHeight);
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    const ready = await new Promise<boolean>((resolve) => {
      const done = () => resolve(true);
      video.onloadeddata = done;
      video.onseeked = done;
      video.onerror = () => resolve(false);
      video.src = url;
      // A frame a little in is more representative than a black first frame.
      video.currentTime = 0.4;
      setTimeout(() => resolve(video.readyState >= 2), 4000);
    });
    if (!ready || !video.videoWidth) return undefined;
    return draw(video, video.videoWidth, video.videoHeight);
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(source: CanvasImageSource, w: number, h: number): string | undefined {
  const edge = 320;
  const scale = Math.min(1, edge / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

/** File it. Returns the record, or null when the bytes could not be read. */
export async function saveToGallery(
  blob: Blob,
  meta: Omit<GalleryItem, "id" | "bytes" | "createdAt" | "mime" | "poster">,
): Promise<GalleryItem | null> {
  if (!blob.size) return null;
  const id = uid();
  await putBlob(id, blob);
  const item: GalleryItem = {
    ...meta,
    id,
    mime: blob.type || (meta.medium === "video" ? "video/mp4" : "image/png"),
    bytes: blob.size,
    createdAt: new Date().toISOString(),
    poster: await posterFor(blob, meta.medium),
  };
  writeIndex([item, ...readIndex()]);
  return item;
}

export async function deleteFromGallery(id: string): Promise<void> {
  writeIndex(readIndex().filter((i) => i.id !== id));
  await dropBlob(id);
}

/** What the file is called when the owner saves it out. */
export function fileNameFor(item: GalleryItem): string {
  const stem = item.title.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "studio";
  return `${stem}.${item.medium === "video" ? "mp4" : "png"}`;
}

export function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
