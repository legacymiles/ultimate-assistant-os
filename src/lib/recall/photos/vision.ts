"use client";

// ---------------------------------------------------------------------------
// Recall — photo triage (client side).
//
// The interesting decision here is the CONTACT SHEET. Naive face labelling
// would attach every reference photo of every person to every request: six
// people at three shots each is nineteen images per photo, which is slow and
// expensive and gets worse as the family grows. Instead the reference faces are
// composited ONCE into a single labelled grid — "1 Mike (me)", "2 Leo (child)"
// — and that one image rides along with each photo. The model is then asked the
// easy question ("which numbered faces appear here?") rather than the hard,
// open-ended one, and the cost stops growing with the size of the family.
//
// The sheet is rebuilt only when the people or their reference shots change.
// ---------------------------------------------------------------------------

import { ROLE_LABELS } from "./types";
import type { PhotoAnalysis, Person } from "./types";

const CELL = 128;
const COLS = 4;
const LABEL_H = 22;

/** Cache key = every person's id/name/role plus the refs they carry. */
function sheetSignature(people: Person[]): string {
  return people.map((p) => `${p.id}:${p.name}:${p.role}:${p.refs.length}`).join("|");
}

export interface ContactSheet {
  /** JPEG data URL of the labelled grid, or null when nobody has a face yet. */
  dataUrl: string | null;
  /** Legend the prompt needs: slot number → person. */
  legend: { slot: number; personId: string; name: string; role: string }[];
}

let cached: { sig: string; sheet: ContactSheet } | null = null;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Composite one labelled tile per reference face, grouped by person. */
export async function buildContactSheet(people: Person[]): Promise<ContactSheet> {
  const withFaces = people.filter((p) => p.refs.length > 0);
  const sig = sheetSignature(withFaces);
  if (cached && cached.sig === sig) return cached.sheet;

  const legend: ContactSheet["legend"] = [];
  const tiles: { img: HTMLImageElement; slot: number; caption: string }[] = [];

  let slot = 0;
  for (const p of withFaces) {
    slot++;
    legend.push({ slot, personId: p.id, name: p.name, role: ROLE_LABELS[p.role] });
    // Two shots each is enough variation to be useful without bloating the grid.
    for (const ref of p.refs.slice(0, 2)) {
      const img = await loadImage(ref);
      if (img) tiles.push({ img, slot, caption: `${slot}. ${p.name}` });
    }
  }

  if (tiles.length === 0) {
    const sheet: ContactSheet = { dataUrl: null, legend };
    cached = { sig, sheet };
    return sheet;
  }

  const rows = Math.ceil(tiles.length / COLS);
  const canvas = document.createElement("canvas");
  canvas.width = COLS * CELL;
  canvas.height = rows * (CELL + LABEL_H);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { dataUrl: null, legend };

  ctx.fillStyle = "#111318";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "middle";
  ctx.font = "600 13px system-ui, sans-serif";

  tiles.forEach((t, i) => {
    const cx = (i % COLS) * CELL;
    const cy = Math.floor(i / COLS) * (CELL + LABEL_H);
    // Cover-fit so faces are not squashed by a portrait/landscape mismatch.
    const scale = Math.max(CELL / t.img.width, CELL / t.img.height);
    const w = t.img.width * scale;
    const h = t.img.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, CELL, CELL);
    ctx.clip();
    ctx.drawImage(t.img, cx + (CELL - w) / 2, cy + (CELL - h) / 2, w, h);
    ctx.restore();
    ctx.fillStyle = "#000";
    ctx.fillRect(cx, cy + CELL, CELL, LABEL_H);
    ctx.fillStyle = "#fff";
    ctx.fillText(t.caption.slice(0, 18), cx + 6, cy + CELL + LABEL_H / 2);
  });

  const sheet: ContactSheet = { dataUrl: canvas.toDataURL("image/jpeg", 0.8), legend };
  cached = { sig, sheet };
  return sheet;
}

/** Drop the memo — called when a person's faces change mid-session. */
export function invalidateContactSheet(): void {
  cached = null;
}

// ----- analysis ------------------------------------------------------------

/** Shrink a photo before it goes over the wire; 1024px is plenty for triage. */
export function toAnalysisDataUrl(blob: Blob, maxDim = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("Could not decode that image."));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(String(reader.result ?? ""));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(blob);
  });
}

/** A tiny square thumbnail for the review grid — must stay localStorage-cheap. */
export function toThumb(blob: Blob, size = 180): Promise<string | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(undefined);
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => resolve(undefined);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(undefined);
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.62));
      };
      img.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * A last-resort classification when there is no AI key (or the call fails).
 * It cannot see the picture, so it does the only honest thing: routes to
 * Unsorted and says the photo needs a human. It never guesses at people.
 */
export function heuristicAnalysis(name: string): PhotoAnalysis {
  const stem = name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  const looksLikeScreenshot = /screen ?shot|screenshot|scr_|img_\d|receipt|invoice|scan/i.test(name);
  return {
    route: looksLikeScreenshot ? "info" : "people",
    title: stem || "Photo",
    caption: "Not analysed — no vision model is configured, so this needs filing by hand.",
    people: [],
    unknownPeople: 0,
    folderPath: looksLikeScreenshot ? ["Inbox"] : undefined,
    tags: [],
    event: null,
    engine: "heuristic",
  };
}

export interface AnalyzeArgs {
  blob: Blob;
  name: string;
  sheet: ContactSheet;
  folderPaths: string[];
  existingTags: string[];
}

/**
 * Triage one photo. Never throws — a failure degrades to the heuristic so a
 * bad network cannot strand a photo outside the queue.
 */
export async function analyzePhoto(args: AnalyzeArgs): Promise<PhotoAnalysis> {
  try {
    const image = await toAnalysisDataUrl(args.blob);
    const res = await fetch("/api/recall/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image,
        name: args.name,
        sheet: args.sheet.dataUrl,
        legend: args.sheet.legend,
        folderPaths: args.folderPaths,
        existingTags: args.existingTags,
        // The model has no clock; without today's date "next Friday" on a
        // flyer is unresolvable and every relative date comes back wrong.
        today: new Date().toISOString().slice(0, 10),
      }),
    });
    if (!res.ok) return heuristicAnalysis(args.name);
    const data = (await res.json()) as { analysis?: PhotoAnalysis | null };
    return data.analysis ?? heuristicAnalysis(args.name);
  } catch {
    return heuristicAnalysis(args.name);
  }
}
