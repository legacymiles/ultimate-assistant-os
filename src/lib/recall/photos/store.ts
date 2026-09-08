// ---------------------------------------------------------------------------
// Recall — Photos store.
//
// Split across TWO keys on purpose:
//
//   recall-photos:v1       people, categories, settings   → synced (saveSynced)
//   recall-photo-queue:v1  photos awaiting approval       → local only
//
// The queue must not sync. Each pending photo points at a blob in this
// browser's IndexedDB, and IndexedDB never leaves the device — pushing the
// queue to app_state would land a laptop with a review list of photos whose
// pixels do not exist there. Who your people are, and where their photos go,
// is exactly the part that SHOULD follow you between devices, so it does.
// ---------------------------------------------------------------------------

import { loadLocal, saveLocal, saveSynced } from "@/lib/sync/appState";
import { destinationById } from "@/lib/dashboard/destinations/registry";
import { scopedKey } from "@/lib/sync/identity";
import { nowIso, uid } from "../../utils";
import { PHOTOS_ROOT } from "./types";
import type {
  DetectedCast,
  PendingPhoto,
  Person,
  PersonRole,
  PhotoAnalysis,
  PhotoCategory,
  PhotoQueue,
  PhotosData,
  PhotosSettings,
} from "./types";
import { pickCategory } from "./types";

export const PHOTOS_KEY = "recall-photos:v1";
export const PHOTO_QUEUE_KEY = "recall-photo-queue:v1";

/** Beyond this the localStorage thumbnails start to matter; we stop and say so. */
export const MAX_QUEUE = 300;

const DEFAULT_SETTINGS: PhotosSettings = {
  driveBackup: false,
  driveFolderId: null,
  driveMirrorCategories: true,
};

// ----- category ordering ---------------------------------------------------
// Specific rules must be TRIED first. Solo and pair rules are `exact`, so they
// can never steal a group photo; the bands below only really separate the three
// fuzzy family rules from each other.

const ORDER_SOLO = 10;
const ORDER_PAIR = 20;
const ORDER_LITTLE_FAM = 30;
const ORDER_BIG_FAM = 40;
const ORDER_GROUP = 50;

// ----- persistence ---------------------------------------------------------

const EMPTY: PhotosData = { people: [], categories: [], settings: DEFAULT_SETTINGS };

function load(): PhotosData {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(scopedKey(PHOTOS_KEY));
    if (!raw) return { ...EMPTY, categories: builtInCategories([]) };
    const d = JSON.parse(raw) as PhotosData;
    return {
      people: Array.isArray(d.people) ? d.people : [],
      categories: Array.isArray(d.categories) && d.categories.length
        ? d.categories
        : builtInCategories(d.people ?? []),
      settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) },
    };
  } catch {
    return { ...EMPTY, categories: builtInCategories([]) };
  }
}

function save(data: PhotosData): PhotosData {
  saveSynced(PHOTOS_KEY, data);
  return data;
}

export function getPhotos(): PhotosData {
  return load();
}

function loadQueue(): PhotoQueue {
  return loadLocal<PhotoQueue>(PHOTO_QUEUE_KEY, { pending: [] });
}

function saveQueue(q: PhotoQueue): PhotoQueue {
  saveLocal(PHOTO_QUEUE_KEY, q);
  return q;
}

export function getQueue(): PendingPhoto[] {
  return loadQueue().pending;
}

// ----- built-in categories -------------------------------------------------

/**
 * The three fuzzy family rules. Everything else (a folder per person, a folder
 * per "me and X") is derived from the people list by `reconcileCategories`,
 * so adding a child creates its folders instead of needing new code.
 */
function builtInCategories(people: Person[]): PhotoCategory[] {
  const self = people.find((p) => p.role === "self");
  const partner = people.find((p) => p.role === "partner");
  return [
    {
      id: "cat_little_fam",
      name: "My Little Family",
      description: "Me, my partner and the kids — nobody else.",
      requires: [self?.id, partner?.id].filter(Boolean) as string[],
      anyRoles: { roles: ["child"], min: 1 },
      exact: true,
      minPeople: 3,
      order: ORDER_LITTLE_FAM,
      builtIn: true,
    },
    {
      id: "cat_big_fam",
      name: "My Big Family",
      description: "Two or more relatives — brothers, sisters, mum, dad.",
      requires: [],
      anyRoles: { roles: ["relative"], min: 2 },
      exact: false,
      minPeople: 3,
      order: ORDER_BIG_FAM,
      builtIn: true,
    },
    {
      id: "cat_group",
      name: "Group Photos",
      description: "Three or more people who don't fit a tighter rule.",
      requires: [],
      anyRoles: null,
      exact: false,
      minPeople: 3,
      order: ORDER_GROUP,
      builtIn: true,
    },
  ];
}

/** The auto-maintained solo folder name for a person. */
function soloName(p: Person): string {
  return p.role === "self" ? "Selfies" : p.name;
}

/** The auto-maintained pair folder name for a person alongside the user. */
function pairName(p: Person): string {
  return `Me & ${p.name}`;
}

/**
 * Rebuild the derived categories so they always agree with the people list:
 * one solo folder per person, and one "Me & X" folder for a partner or child.
 *
 * Renames follow a person's name, but a category the user has EDITED by hand
 * keeps its name — the derived list is a starting point, not a cage.
 */
export function reconcileCategories(data: PhotosData): PhotosData {
  const self = data.people.find((p) => p.role === "self");
  const kept = data.categories.filter((c) => !c.personId || data.people.some((p) => p.id === c.personId));
  const byKey = new Map(kept.map((c) => [c.id, c]));

  const derived: PhotoCategory[] = [];
  for (const p of data.people) {
    const soloId = `cat_solo_${p.id}`;
    const existing = byKey.get(soloId);
    derived.push({
      id: soloId,
      name: existing?.name ?? soloName(p),
      description: existing?.description ?? `${p.name} on their own.`,
      requires: [p.id],
      anyRoles: null,
      exact: true,
      minPeople: 1,
      order: existing?.order ?? ORDER_SOLO,
      builtIn: true,
      personId: p.id,
    });

    // "Me and my son" only means something once the user has said who "me" is.
    if (self && p.id !== self.id && (p.role === "partner" || p.role === "child")) {
      const pairId = `cat_pair_${p.id}`;
      const ex = byKey.get(pairId);
      derived.push({
        id: pairId,
        name: ex?.name ?? pairName(p),
        description: ex?.description ?? `Just me and ${p.name}.`,
        requires: [self.id, p.id],
        anyRoles: null,
        exact: true,
        minPeople: 2,
        order: ex?.order ?? ORDER_PAIR,
        builtIn: true,
        personId: p.id,
      });
    }
  }

  // Built-in family rules are refreshed so they pick up a newly named self/partner.
  const fresh = builtInCategories(data.people);
  const fixed = fresh.map((f) => {
    const ex = byKey.get(f.id);
    return ex ? { ...f, name: ex.name, description: ex.description, order: ex.order } : f;
  });

  const custom = kept.filter((c) => !c.builtIn);
  data.categories = [...derived, ...fixed, ...custom].sort((a, b) => a.order - b.order);
  return data;
}

// ----- people --------------------------------------------------------------

export interface PersonInput {
  name: string;
  role: PersonRole;
  refs?: string[];
  notes?: string;
}

export function createPerson(input: PersonInput): PhotosData {
  const data = load();
  data.people.push({
    id: uid("per"),
    name: input.name.trim() || "Unnamed",
    role: input.role,
    refs: (input.refs ?? []).slice(0, 6),
    notes: input.notes?.trim() || undefined,
    createdAt: nowIso(),
  });
  return save(reconcileCategories(data));
}

export function updatePerson(id: string, patch: Partial<PersonInput>): PhotosData {
  const data = load();
  const p = data.people.find((x) => x.id === id);
  if (p) {
    if (patch.name !== undefined) p.name = patch.name.trim() || p.name;
    if (patch.role !== undefined) p.role = patch.role;
    if (patch.refs !== undefined) p.refs = patch.refs.slice(0, 6);
    if (patch.notes !== undefined) p.notes = patch.notes.trim() || undefined;
  }
  return save(reconcileCategories(data));
}

export function deletePerson(id: string): PhotosData {
  const data = load();
  data.people = data.people.filter((p) => p.id !== id);
  // A rule that named them drops the reference rather than becoming unmatchable.
  for (const c of data.categories) c.requires = c.requires.filter((r) => r !== id);
  return save(reconcileCategories(data));
}

/** Add one reference face to a person — how recognition gets better over time. */
export function addPersonRef(id: string, dataUrl: string): PhotosData {
  const data = load();
  const p = data.people.find((x) => x.id === id);
  if (p) p.refs = [...p.refs, dataUrl].slice(-6);
  return save(data);
}

export function removePersonRef(id: string, index: number): PhotosData {
  const data = load();
  const p = data.people.find((x) => x.id === id);
  if (p) p.refs = p.refs.filter((_, i) => i !== index);
  return save(data);
}

// ----- categories ----------------------------------------------------------

export interface CategoryInput {
  name: string;
  description?: string;
  requires: string[];
  anyRoles?: PhotoCategory["anyRoles"];
  exact: boolean;
  minPeople: number;
}

export function createCategory(input: CategoryInput): PhotosData {
  const data = load();
  data.categories.push({
    id: uid("cat"),
    name: input.name.trim() || "Untitled",
    description: input.description?.trim() || undefined,
    requires: input.requires,
    anyRoles: input.anyRoles ?? null,
    exact: input.exact,
    minPeople: Math.max(1, input.minPeople),
    // Custom rules run just ahead of the fuzzy family rules, so a hand-written
    // rule can beat "Group Photos" without having to out-rank a pair folder.
    order: ORDER_LITTLE_FAM - 1,
    builtIn: false,
  });
  return save(reconcileCategories(data));
}

export function updateCategory(id: string, patch: Partial<CategoryInput>): PhotosData {
  const data = load();
  const c = data.categories.find((x) => x.id === id);
  if (c) {
    if (patch.name !== undefined) c.name = patch.name.trim() || c.name;
    if (patch.description !== undefined) c.description = patch.description.trim() || undefined;
    if (patch.requires !== undefined) c.requires = patch.requires;
    if (patch.anyRoles !== undefined) c.anyRoles = patch.anyRoles;
    if (patch.exact !== undefined) c.exact = patch.exact;
    if (patch.minPeople !== undefined) c.minPeople = Math.max(1, patch.minPeople);
  }
  return save(data);
}

export function deleteCategory(id: string): PhotosData {
  const data = load();
  // Built-ins are the backbone of the matcher; they can be renamed, not removed.
  data.categories = data.categories.filter((c) => c.id !== id || c.builtIn);
  return save(data);
}

export function setSettings(patch: Partial<PhotosSettings>): PhotosData {
  const data = load();
  data.settings = { ...data.settings, ...patch };
  return save(data);
}

// ----- destinations --------------------------------------------------------

/** The Recall folder path a category files into. */
export function categoryPath(cat: PhotoCategory): string[] {
  return [PHOTOS_ROOT, cat.name];
}

/** Where an unmatched photo of people goes — never the loose Inbox. */
export const UNSORTED_PEOPLE_PATH = [PHOTOS_ROOT, "Unsorted"];

/**
 * Turn an analysis into a destination. This is the one place the three routes
 * become a folder path, so the review queue and the agent cannot disagree.
 */
export function resolveDestination(
  analysis: PhotoAnalysis,
  data: PhotosData,
): { path: string[]; categoryId: string | null } {
  if (analysis.route === "people") {
    const cast: DetectedCast = {
      personIds: analysis.people.map((h) => h.personId),
      unknownPeople: analysis.unknownPeople,
    };
    const cat = pickCategory(data.categories, cast, data.people);
    if (cat) return { path: categoryPath(cat), categoryId: cat.id };
    return { path: UNSORTED_PEOPLE_PATH, categoryId: null };
  }
  if (analysis.route === "event") {
    // The picture of the flyer is still worth keeping next to the event.
    return { path: [PHOTOS_ROOT, "Events"], categoryId: null };
  }
  // A registry destination files the RECORD into another app, but the picture
  // itself is still worth keeping and searchable — so it lands in a folder
  // named after where the record went, rather than vanishing into that app.
  const dest = destinationById(analysis.route);
  if (dest) return { path: ["Screenshots", dest.label], categoryId: null };

  const path = analysis.folderPath?.filter(Boolean) ?? [];
  return { path: path.length ? path : ["Inbox"], categoryId: null };
}

// ----- queue ---------------------------------------------------------------

export interface QueueInput {
  fileId: string;
  name: string;
  type: string;
  size: number;
  thumb?: string;
}

export function enqueuePhoto(input: QueueInput): { queue: PendingPhoto[]; photo: PendingPhoto } {
  const q = loadQueue();
  const photo: PendingPhoto = {
    id: uid("pho"),
    ...input,
    addedAt: nowIso(),
    status: "analyzing",
  };
  q.pending.push(photo);
  saveQueue(q);
  return { queue: q.pending, photo };
}

export function updatePending(id: string, patch: Partial<PendingPhoto>): PendingPhoto[] {
  const q = loadQueue();
  const p = q.pending.find((x) => x.id === id);
  if (p) Object.assign(p, patch);
  return saveQueue(q).pending;
}

export function removePending(ids: string[]): PendingPhoto[] {
  const q = loadQueue();
  const drop = new Set(ids);
  q.pending = q.pending.filter((p) => !drop.has(p.id));
  return saveQueue(q).pending;
}

export function clearQueue(): PendingPhoto[] {
  return saveQueue({ pending: [] }).pending;
}

/**
 * The review queue grouped by destination — the shape the "approve everything
 * headed for My Son" button needs. Sorted with the biggest pile first, because
 * that is the one worth clearing.
 */
export interface DestGroup {
  key: string;
  label: string;
  path: string[];
  categoryId: string | null;
  photos: PendingPhoto[];
}

export function groupByDestination(pending: PendingPhoto[]): DestGroup[] {
  const groups = new Map<string, DestGroup>();
  for (const p of pending) {
    if (p.status !== "ready" || !p.destPath) continue;
    const key = p.destPath.join(" › ");
    const g = groups.get(key);
    if (g) g.photos.push(p);
    else
      groups.set(key, {
        key,
        label: key,
        path: p.destPath,
        categoryId: p.categoryId ?? null,
        photos: [p],
      });
  }
  return [...groups.values()].sort((a, b) => b.photos.length - a.photos.length);
}
