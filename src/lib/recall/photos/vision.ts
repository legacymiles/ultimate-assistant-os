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
// TWO NUMBERS DECIDE WHETHER ANY OF THAT WORKS, and both used to be wrong. The
// sheet showed two shots per person and drew them at 128px. Two shots is one
// angle and one haircut, so adding a third and fourth photo of someone changed
// nothing — the extra pictures were stored, synced, listed on the card, and
// never looked at. And 128px is below the size at which a vision model can
// separate two people who merely resemble each other: it can see a face there,
// not whose face it is.
//
// So the sheet now draws every reference it can fit, at 192px, and spends its
// budget on TILES rather than on a fixed number per person: `BUDGET` bounds the
// payload, and the allowance per person falls out of how many people there are.
// A family of three gets four shots each; a gallery of twelve gets two. Adding
// a photo of someone always improves the sheet, which is the only behaviour
// that makes "add more photos" honest advice.
//
// The sheet is rebuilt only when the people or their reference shots change.
// ---------------------------------------------------------------------------

import { ROLE_LABELS } from "./types";
import type { PhotoAnalysis, PhotoCategory, Person } from "./types";

/**
 * 192px per face, not 128. Faces are the whole job of this image, and a tile
 * too small to tell two cousins apart makes every other part of the pipeline
 * pointless.
 */
const CELL = 192;
const COLS = 4;
const LABEL_H = 24;
/** The most tiles the sheet will ever draw, so the payload has a ceiling. */
const BUDGET = 28;
/** Shots of one person past this add angles nobody needs. */
const MAX_PER_SUBJECT = 4;
/** …and below this a subject is not really on the sheet at all. */
const MIN_PER_SUBJECT = 1;

/**
 * How many shots of each subject fit. Divided evenly rather than first-come, so
 * the last person added is not the one who goes unrecognised.
 */
export function shotsPerSubject(subjects: number, budget = BUDGET): number {
  if (subjects <= 0) return 0;
  return Math.max(MIN_PER_SUBJECT, Math.min(MAX_PER_SUBJECT, Math.floor(budget / subjects)));
}

/**
 * A cheap content digest of one reference picture.
 *
 * The signature used to count refs, which meant swapping a bad face crop for a
 * good one — same count, different pixels — reused the stale sheet for the rest
 * of the session. Length plus a sample of the base64 catches that without
 * hashing tens of kilobytes on every import.
 */
function refDigest(url: string): string {
  return `${url.length}.${url.slice(-24)}`;
}

/**
 * Cache key = every person's id/name/role plus the refs they carry, and the
 * same for every folder that has reference pictures of its own.
 */
function sheetSignature(people: Person[], albums: PhotoCategory[]): string {
  return [
    ...people.map((p) => `p${p.id}:${p.name}:${p.role}:${p.refs.map(refDigest).join(",")}`),
    ...albums.map(
      (c) => `a${c.id}:${c.name}:${(c.refs ?? []).map(refDigest).join(",")}:${c.refHint ?? ""}`,
    ),
  ].join("|");
}

/** One numbered slot on the sheet: a person to recognise, or a folder to match. */
export interface SheetEntry {
  slot: number;
  kind: "person" | "album";
  /** The person id or the category id, depending on `kind`. */
  id: string;
  name: string;
  /** Role label for a person; "" for a folder. */
  role: string;
  /** What the user says belongs in this folder. */
  hint?: string;
  /** How many tiles on the sheet show this subject. */
  shots: number;
  /**
   * The features from their character sheet that do not change between
   * photographs. Recognition is much steadier when the model is told what to
   * compare than when it is left to decide for itself which of two similar
   * faces a tile is closer to.
   */
  look?: string;
}

export interface ContactSheet {
  /** JPEG data URL of the labelled grid, or null when nothing has a reference yet. */
  dataUrl: string | null;
  /** Legend the prompt needs: slot number → person or folder. */
  legend: SheetEntry[];
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

/**
 * Composite one labelled tile per reference picture — faces first, then the
 * folders that carry references of their own.
 *
 * Folders share the sheet rather than getting one of their own for the reason
 * the sheet exists at all: cost must not grow with the number of things the
 * user has taught the app. "Which numbered tiles does this photo match?" is one
 * question whether there are two tiles or twenty.
 */
export async function buildContactSheet(
  people: Person[],
  albums: PhotoCategory[] = [],
): Promise<ContactSheet> {
  const withFaces = people.filter((p) => p.refs.length > 0);
  const withRefs = albums.filter((c) => (c.refs ?? []).length > 0);
  const sig = sheetSignature(withFaces, withRefs);
  if (cached && cached.sig === sig) return cached.sheet;

  const legend: SheetEntry[] = [];
  const tiles: { img: HTMLImageElement; slot: number; caption: string }[] = [];

  // One allowance for everything on the sheet, so a folder with four reference
  // pictures cannot crowd out the face of a person the owner actually named.
  const per = shotsPerSubject(withFaces.length + withRefs.length);

  let slot = 0;
  for (const p of withFaces) {
    slot++;
    const shots = p.refs.slice(0, per);
    legend.push({
      slot,
      kind: "person",
      id: p.id,
      name: p.name,
      role: ROLE_LABELS[p.role],
      shots: shots.length,
      look: p.sheet?.identifiers?.length ? p.sheet.identifiers.join("; ") : undefined,
    });
    for (const ref of shots) {
      const img = await loadImage(ref);
      if (img) tiles.push({ img, slot, caption: `${slot}. ${p.name}` });
    }
  }
  for (const c of withRefs) {
    slot++;
    const shots = (c.refs ?? []).slice(0, per);
    legend.push({
      slot,
      kind: "album",
      id: c.id,
      name: c.name,
      role: "",
      hint: c.refHint,
      shots: shots.length,
      look: c.sheet?.identifiers?.length ? c.sheet.identifiers.join("; ") : undefined,
    });
    for (const ref of shots) {
      const img = await loadImage(ref);
      if (img) tiles.push({ img, slot, caption: `${slot}. ${c.name}` });
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
  ctx.font = "600 14px system-ui, sans-serif";

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
    ctx.fillText(t.caption.slice(0, 24), cx + 6, cy + CELL + LABEL_H / 2);
  });

  // 0.92, not 0.8: JPEG artefacts land on exactly the high-frequency detail —
  // eyelids, the line of a nose, the edge of a hairline — that tells two faces
  // apart, so this is the last place to save bytes.
  const sheet: ContactSheet = { dataUrl: canvas.toDataURL("image/jpeg", 0.92), legend };
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

/**
 * A square crop, JPEG, as a data URL.
 *
 * Two callers with opposite needs: the review grid wants tiny and cheap, and a
 * reference face wants every bit of detail it can get for a few more kilobytes,
 * because that crop is what recognition is later asked to match against. Hence
 * the quality argument — the default stays cheap.
 */
export function toThumb(blob: Blob, size = 180, quality = 0.62): Promise<string | undefined> {
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
        resolve(canvas.toDataURL("image/jpeg", quality));
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
  /** The user's own note about what these photos are, e.g. "these are all recipes". */
  instruction?: string;
  /** Where the user has decided this photo goes, e.g. "cookbook". Overrides the guess. */
  forceRoute?: string;
  /** The user's instructions for THIS photo, followed rather than weighed. */
  userPrompt?: string;
  /** Places that already exist, keyed by destination id, so named places resolve to them. */
  knownPlaces?: Record<string, string[]>;
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
        instruction: args.instruction,
        forceRoute: args.forceRoute,
        userPrompt: args.userPrompt,
        knownPlaces: args.knownPlaces,
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
