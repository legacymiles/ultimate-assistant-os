"use client";

// Browser-only helpers for Custom Video Swap: read a clip's size and length,
// pull a still out of it at a time, and cut a person out of that still where
// the owner tapped. Everything stays on this device until "Make it".

import type { ClipMeta } from "./plan";

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.crossOrigin = "anonymous";
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error("This browser can't open that clip. Try an MP4 (H.264)."));
    v.src = url;
  });
}

export async function clipMeta(file: File, url: string): Promise<ClipMeta> {
  const v = await loadVideo(url);
  const duration = Number.isFinite(v.duration) ? v.duration : 0;
  return {
    name: file.name || "clip.mp4",
    duration: Math.round(duration * 10) / 10,
    width: v.videoWidth,
    height: v.videoHeight,
    size: file.size,
  };
}

/** A JPEG still of the clip at `t` seconds, longest edge `maxEdge`. */
export async function frameAt(url: string, t: number, maxEdge = 960): Promise<string> {
  const v = await loadVideo(url);
  const at = Math.min(Math.max(0, t), Math.max(0, (v.duration || 0) - 0.05));
  await new Promise<void>((resolve, reject) => {
    const done = () => resolve();
    v.onseeked = done;
    v.onerror = () => reject(new Error("Couldn't read that moment of the clip."));
    v.currentTime = at;
    // Some browsers don't fire seeked for t = 0 on a fresh element.
    if (at === 0 && v.readyState >= 2) setTimeout(done, 60);
  });
  const scale = Math.min(1, maxEdge / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(v.videoWidth * scale));
  c.height = Math.max(1, Math.round(v.videoHeight * scale));
  const g = c.getContext("2d");
  if (!g) throw new Error("This browser can't draw frames.");
  g.drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.86);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Couldn't read the frame."));
    i.src = src;
  });
}

/**
 * The person under a tap: a portrait box a little taller than wide, centred a
 * touch below the tap (people tap faces; the crop should show head and
 * shoulders), clamped inside the frame.
 */
export async function cropAround(frame: string, x: number, y: number, edge = 320): Promise<string> {
  const img = await loadImage(frame);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const w = Math.round(Math.min(W, H) * 0.42);
  const h = Math.round(w * 1.25);
  const cx = x * W;
  const cy = y * H + h * 0.18;
  const sx = Math.round(Math.min(Math.max(0, cx - w / 2), Math.max(0, W - w)));
  const sy = Math.round(Math.min(Math.max(0, cy - h / 2), Math.max(0, H - h)));
  const scale = edge / Math.max(w, h);
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const g = c.getContext("2d");
  if (!g) throw new Error("This browser can't draw frames.");
  g.drawImage(img, sx, sy, Math.min(w, W), Math.min(h, H), 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

/** PUT with upload progress (fetch can't report it). */
export function putWithProgress(url: string, body: Blob, type: string, onProgress: (p: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("Content-Type", type || "video/mp4");
    x.setRequestHeader("x-upsert", "true");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => resolve(x.status >= 200 && x.status < 300);
    x.onerror = () => resolve(false);
    x.send(body);
  });
}

/** Multipart POST with upload progress, for a local hub. */
export function postWithProgress(url: string, form: FormData, onProgress: (p: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => resolve(x.status >= 200 && x.status < 300);
    x.onerror = () => resolve(false);
    x.send(form);
  });
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
}

/** `n` small stills spread across the clip, for the scrub strip. One element, seeked in turn. */
export async function filmstrip(url: string, n = 10, edge = 120): Promise<string[]> {
  const v = await loadVideo(url);
  const d = v.duration || 0;
  if (!d) return [];
  const scale = Math.min(1, edge / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(v.videoWidth * scale));
  c.height = Math.max(1, Math.round(v.videoHeight * scale));
  const g = c.getContext("2d");
  if (!g) return [];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = Math.min(d - 0.05, (d * (i + 0.5)) / n);
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      v.onseeked = done;
      v.onerror = done;
      v.currentTime = Math.max(0, t);
      setTimeout(done, 1500);
    });
    g.drawImage(v, 0, 0, c.width, c.height);
    out.push(c.toDataURL("image/jpeg", 0.7));
  }
  return out;
}
