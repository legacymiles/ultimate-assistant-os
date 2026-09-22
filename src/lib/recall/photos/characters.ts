"use client";

// ---------------------------------------------------------------------------
// Recall — writing down who someone is.
//
// The library already knows more about a person than their reference faces: by
// the time a folder is called "Brandy" it has photos of Brandy in it. Those
// filed photos are better evidence than the two crops the owner uploaded when
// they created her — more angles, more years, more light — and until now nothing
// read them.
//
// So a character sheet is built from BOTH: the reference faces first, because
// the owner chose those on purpose, then the pictures already filed under that
// person or folder. One vision call, cached on the person, and it pays for two
// features at once — recognition gets told which features to compare, and
// Studio gets a description it can put a person into a scene with.
//
// Nothing here uploads anything. The pictures are already on this device.
// ---------------------------------------------------------------------------

import { getFile } from "../files";
import { getData } from "../store";
import { getPhotos, setCategorySheet, setPersonSheet } from "./store";
import { invalidateContactSheet, toAnalysisDataUrl, toThumb } from "./vision";
import type { CharacterSheet, PhotoCategory, Person, PhotosData } from "./types";

/**
 * Pictures sent to the writer.
 *
 * Eight is where extra angles stop telling the model anything new, and it keeps
 * the request well inside the body limit at 640px a side.
 */
const MAX_SOURCES = 8;
/** Bigger than a reference crop: this call is the one place detail is worth it. */
const SOURCE_DIM = 640;

/** A subject that can have a sheet written about it. */
export type Subject =
  | { kind: "person"; person: Person }
  | { kind: "album"; category: PhotoCategory };

export function subjectName(s: Subject): string {
  return s.kind === "person" ? s.person.name : s.category.name;
}

export function subjectId(s: Subject): string {
  return s.kind === "person" ? s.person.id : s.category.id;
}

export function subjectSheet(s: Subject): CharacterSheet | null {
  return (s.kind === "person" ? s.person.sheet : s.category.sheet) ?? null;
}

/** The reference pictures the owner uploaded by hand. */
function ownRefs(s: Subject): string[] {
  return s.kind === "person" ? s.person.refs : s.category.refs ?? [];
}

/**
 * Photos already filed that show this subject, newest first.
 *
 * A person's photos are found by the ids the triage wrote onto the item, not by
 * which folder they landed in: a picture of Brandy at a party is filed under
 * "Friends", and it is still a picture of Brandy.
 */
export function filedPhotoIds(s: Subject): { fileId: string; thumb?: string }[] {
  const items = getData().items.filter((i) => {
    if (i.kind !== "image" || !i.attachment) return false;
    return s.kind === "person"
      ? (i.people ?? []).includes(s.person.id)
      : i.photoCategoryId === s.category.id;
  });
  return items
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .map((i) => ({ fileId: i.attachment?.fileId ?? "", thumb: i.attachment?.url ?? undefined }))
    .filter((r) => r.fileId || r.thumb);
}

/** How much evidence there is about this subject, for the card to report. */
export function evidenceCount(s: Subject): { refs: number; filed: number } {
  return { refs: ownRefs(s).length, filed: filedPhotoIds(s).length };
}

/**
 * Every picture of this subject, as data URLs, best evidence first.
 *
 * "Best first" means the owner's own reference crops lead: they were chosen to
 * show a face clearly, where a filed photo might be a group shot at a distance.
 */
export async function gatherPictures(s: Subject): Promise<string[]> {
  const out = [...ownRefs(s)].slice(0, MAX_SOURCES);
  for (const row of filedPhotoIds(s)) {
    if (out.length >= MAX_SOURCES) break;
    // The full blob when it is still on this device, else the thumbnail, which
    // is small but real — better than skipping the photo entirely.
    const blob = row.fileId ? await getFile(row.fileId).catch(() => null) : null;
    if (blob) {
      const url = await toAnalysisDataUrl(blob, SOURCE_DIM).catch(() => "");
      if (url) out.push(url);
    } else if (row.thumb) {
      out.push(row.thumb);
    }
  }
  return out;
}

export interface SheetResult {
  sheet: CharacterSheet | null;
  data: PhotosData | null;
  /** What the writer noticed about the pictures, e.g. two different people. */
  warning?: string;
  error?: string;
  /** How many pictures it actually read. */
  used: number;
}

/**
 * Write (or rewrite) the sheet for one subject and save it.
 *
 * A failure returns the reason and changes nothing: a stale description that
 * still works beats a blank card, and the owner gets told why the rebuild did
 * not happen.
 */
export async function buildSheet(s: Subject): Promise<SheetResult> {
  const images = await gatherPictures(s);
  if (!images.length) {
    return {
      sheet: null,
      data: null,
      used: 0,
      error: `There are no pictures of ${subjectName(s)} yet, so there is nothing to describe.`,
    };
  }
  try {
    const res = await fetch("/api/studio/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images,
        name: subjectName(s),
        // A folder can be about anything; a named person is a person.
        kind: s.kind === "person" ? "person" : "thing",
        notes: s.kind === "person" ? s.person.notes : s.category.refHint,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      sheet?: CharacterSheet | null;
      warning?: string;
      error?: string;
    };
    if (!res.ok || data.error) {
      return { sheet: null, data: null, used: images.length, error: data.error ?? `The writer failed (${res.status}).` };
    }
    if (!data.sheet) {
      return {
        sheet: null,
        data: null,
        used: images.length,
        error: "No AI key is set, so a description cannot be written yet.",
      };
    }
    const saved =
      s.kind === "person"
        ? setPersonSheet(s.person.id, data.sheet)
        : setCategorySheet(s.category.id, data.sheet);
    // The sheet's identifiers ride along in the contact sheet's legend, so the
    // memo of that sheet is now out of date.
    invalidateContactSheet();
    return { sheet: data.sheet, data: saved, warning: data.warning, used: images.length };
  } catch (e) {
    return {
      sheet: null,
      data: null,
      used: images.length,
      error: e instanceof Error ? e.message : "The description could not be written.",
    };
  }
}

/** The owner rewrote it by hand; their words win and a rebuild must be asked for. */
export function editSheet(s: Subject, appearance: string): PhotosData {
  const current = subjectSheet(s);
  const next: CharacterSheet = {
    appearance: appearance.trim().slice(0, 1200),
    identifiers: current?.identifiers ?? [],
    wardrobe: current?.wardrobe,
    builtFrom: current?.builtFrom ?? 0,
    builtAt: new Date().toISOString(),
    edited: true,
  };
  invalidateContactSheet();
  return s.kind === "person" ? setPersonSheet(s.person.id, next) : setCategorySheet(s.category.id, next);
}

/**
 * Is this sheet older than the evidence? Only a question worth asking, never an
 * automatic rebuild: rebuilding costs a vision call, and a sheet the owner
 * edited by hand must never be overwritten because a photo arrived.
 */
export function sheetIsStale(s: Subject): boolean {
  const sheet = subjectSheet(s);
  if (!sheet || sheet.edited) return false;
  const { refs, filed } = evidenceCount(s);
  return Math.min(MAX_SOURCES, refs + filed) > sheet.builtFrom;
}

/** Every subject in the library that could be a character, people first. */
export function allSubjects(data: PhotosData = getPhotos()): Subject[] {
  return [
    ...data.people.map((person) => ({ kind: "person" as const, person })),
    ...data.categories
      .filter((c) => (c.refs ?? []).length > 0)
      .map((category) => ({ kind: "album" as const, category })),
  ];
}

/**
 * A face crop for a character's chip in the composer.
 *
 * The reference crop when there is one; otherwise the first filed photo, so a
 * folder the owner taught by example still has a face on its chip.
 */
export async function subjectAvatar(s: Subject): Promise<string | undefined> {
  const own = ownRefs(s)[0];
  if (own) return own;
  const row = filedPhotoIds(s)[0];
  if (row?.thumb) return row.thumb;
  if (!row?.fileId) return undefined;
  const blob = await getFile(row.fileId).catch(() => null);
  return blob ? await toThumb(blob, 96) : undefined;
}
