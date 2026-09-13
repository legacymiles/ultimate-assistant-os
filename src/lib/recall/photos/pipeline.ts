"use client";

// ---------------------------------------------------------------------------
// Recall — the camera-roll pipeline.
//
//   import → store the blob → triage with vision → propose a destination
//          → sit in the review queue → approve → become a real Recall item
//
// Two rules shape the whole thing:
//
// 1. NOTHING is filed without a human saying yes. The triage is good, not
//    perfect, and a photo of your son in the wrong folder is a small betrayal
//    of a photo library. Approval is bulk-by-destination rather than per-photo
//    so saying yes forty times costs one click, not forty.
//
// 2. The bytes are written to IndexedDB FIRST, before any network call. If the
//    triage fails, the browser closes, or the key is missing, the photo is
//    still safely stored and reviewable — the import can never lose a picture
//    because the model was unavailable.
// ---------------------------------------------------------------------------

import { uid } from "../../utils";
import { destinationById } from "@/lib/dashboard/destinations/registry";
import { categorize, deleteFile, getFile, putFile } from "../files";
import { createItem, ensureFolderPath, folderPathString, getData, updateItem } from "../store";
import { createEvent } from "../calendar/store";
import { todayKey } from "../calendar/types";
import { backupPhotos, driveConfigured } from "../drive";
import {
  enqueuePhoto,
  getPhotos,
  getQueue,
  MAX_QUEUE,
  removePending,
  resolveDestination,
  updatePending,
} from "./store";
import { analyzePhoto, buildContactSheet, heuristicAnalysis, toThumb } from "./vision";
import { findDuplicate, fingerprintImage, type FingerprintCandidate } from "./fingerprint";
import type { PendingPhoto, PhotoAnalysis, PhotosData } from "./types";
import { PHOTOS_ROOT } from "./types";
import { closestPlace } from "@/lib/dashboard/places";

/** Photos analysed at once. Three keeps a big import moving without
 *  stampeding the gateway (and its rate limit) from one browser tab. */
const CONCURRENCY = 3;

export interface ImportProgress {
  stage: "storing" | "analyzing" | "done";
  done: number;
  total: number;
}

export interface ImportOutcome {
  queue: PendingPhoto[];
  accepted: number;
  /** Images turned away because the queue is already full. */
  deferred: number;
  /** Non-image files that were ignored. */
  skipped: number;
}

export interface ImportArgs {
  files: File[];
  folderPaths: string[];
  existingTags: string[];
  /** The user's note about the batch, e.g. "these are all recipes". */
  instruction?: string;
  onProgress?: (p: ImportProgress) => void;
  /** Called whenever the queue changes so the UI can re-render as it fills. */
  onQueue?: (queue: PendingPhoto[]) => void;
}

/**
 * Take a batch of image files all the way to "ready for review".
 *
 * The two phases are deliberately separate: every file is stored and queued
 * before ANY of them is analysed, so the review screen fills up immediately
 * with placeholders instead of staying empty until the last vision call
 * returns.
 */
export async function importPhotos(args: ImportArgs): Promise<ImportOutcome> {
  const images = args.files.filter((f) => categorize(f.name, f.type) === "image");
  let queue = getQueue();

  // Every queued photo keeps a thumbnail in localStorage, which has a hard
  // ~5MB ceiling. Taking the first N and SAYING so beats accepting them all
  // and losing the whole queue to a quota error on photo 400.
  const room = Math.max(0, MAX_QUEUE - queue.length);
  const accepted = images.slice(0, room);
  const deferred = images.length - accepted.length;

  // Photos already filed, fingerprinted once for the whole import. Anything
  // filed before fingerprints existed is fingerprinted from its thumbnail.
  const filed = await filedFingerprints();

  // Phase 1 — bytes to disk.
  const staged: { pending: PendingPhoto; file: File }[] = [];
  let stored = 0;
  for (const file of accepted) {
    args.onProgress?.({ stage: "storing", done: stored, total: accepted.length });
    const fileId = uid("blob");
    try {
      await putFile(fileId, file);
    } catch {
      // No IndexedDB (private mode, blocked storage): skip rather than queue a
      // photo whose pixels we cannot produce again at approval time.
      stored++;
      continue;
    }
    const thumb = await toThumb(file);
    const out = enqueuePhoto({
      fileId,
      name: file.name,
      type: file.type || "image/jpeg",
      size: file.size,
      thumb,
    });
    // Is this a picture the user already has? Checked against photos already
    // filed and photos already waiting — this batch included, because picking
    // the same photo twice in one import is the commonest accident of all.
    const fingerprint = await fingerprintImage(thumb);
    const dup = findDuplicate(fingerprint, [...filed, ...queuedFingerprints(out.queue)], out.photo.id);
    queue = updatePending(out.photo.id, {
      fingerprint,
      duplicateOf: dup ? { label: dup.label, identical: dup.identical } : null,
    });
    staged.push({ pending: out.photo, file });
    args.onQueue?.(queue);
    stored++;
  }

  // Phase 2 — triage, a few at a time.
  const photos = getPhotos();
  const sheet = await buildContactSheet(photos.people);
  let analysed = 0;
  const run = async (job: { pending: PendingPhoto; file: File }) => {
    const analysis = await analyzePhoto({
      blob: job.file,
      name: job.file.name,
      sheet,
      folderPaths: args.folderPaths,
      existingTags: args.existingTags,
      instruction: args.instruction,
    });
    applyAnalysis(job.pending.id, analysis, photos);
    analysed++;
    args.onProgress?.({ stage: "analyzing", done: analysed, total: staged.length });
    args.onQueue?.(getQueue());
  };

  const lanes = Array.from({ length: Math.min(CONCURRENCY, staged.length) }, async (_, lane) => {
    for (let i = lane; i < staged.length; i += CONCURRENCY) await run(staged[i]);
  });
  await Promise.all(lanes);

  args.onProgress?.({ stage: "done", done: staged.length, total: staged.length });
  return {
    queue: getQueue(),
    accepted: staged.length,
    deferred,
    skipped: args.files.length - images.length,
  };
}

/** Store an analysis against a pending photo along with its destination. */
function applyAnalysis(id: string, analysis: PhotoAnalysis, photos: PhotosData): PendingPhoto[] {
  const dest = resolveDestination(analysis, photos);

  // The user asked for the picture itself to go in a particular album. It goes
  // in the existing album they mean ("little family" is "My Little Family"),
  // or a new one by that name when nothing is close.
  if (analysis.photoAlbum) {
    const albums = photos.categories.map((c) => c.name);
    const name = closestPlace(analysis.photoAlbum, albums) ?? analysis.photoAlbum;
    const cat = photos.categories.find((c) => c.name === name);
    return updatePending(id, {
      status: "ready",
      analysis,
      destPath: [PHOTOS_ROOT, name],
      categoryId: cat?.id ?? null,
      overridden: true,
    });
  }

  return updatePending(id, {
    status: "ready",
    analysis,
    destPath: dest.path,
    categoryId: dest.categoryId,
  });
}

/** Re-run triage on one photo — after labelling a new person, say. */
export async function reanalyze(
  photoId: string,
  folderPaths: string[],
  existingTags: string[],
  /**
   * `forceRoute` is set when the user picked an app; `userPrompt` is their own
   * instructions for this photo; `knownPlaces` lists what already exists.
   */
  options: {
    instruction?: string;
    forceRoute?: string;
    userPrompt?: string;
    knownPlaces?: Record<string, string[]>;
  } = {},
): Promise<PendingPhoto[]> {
  const pending = getQueue().find((p) => p.id === photoId);
  if (!pending) return getQueue();
  // Instructions given once keep applying: a later plain Re-read follows them too.
  const prompt = options.userPrompt ?? pending.userPrompt;
  updatePending(photoId, { status: "analyzing", userPrompt: prompt });
  const blob = await getFile(pending.fileId);
  if (!blob) {
    return updatePending(photoId, { status: "failed", error: "The file is no longer stored locally." });
  }
  const photos = getPhotos();
  const sheet = await buildContactSheet(photos.people);
  const analysis = await analyzePhoto({
    blob,
    name: pending.name,
    sheet,
    folderPaths,
    existingTags,
    instruction: options.instruction,
    forceRoute: options.forceRoute,
    userPrompt: prompt,
    knownPlaces: options.knownPlaces,
  });
  return applyAnalysis(photoId, analysis, photos);
}

/** Send a photo somewhere other than the proposal, by hand. */
export function retarget(photoId: string, path: string[], categoryId: string | null): PendingPhoto[] {
  return updatePending(photoId, { destPath: path, categoryId, overridden: true });
}

// ----- approval ------------------------------------------------------------

export interface ApproveResult {
  filed: number;
  eventsCreated: number;
  /** Records written into another hub app by a registry destination. */
  filedElsewhere?: number;
  backedUp: number;
  backupFailed: number;
  /** Photos that could not be filed, with why. */
  problems: { name: string; error: string }[];
}

export interface ApproveArgs {
  photoIds: string[];
  /** Also put "event" photos on the calendar. */
  createEvents?: boolean;
  onProgress?: (done: number, total: number) => void;
}

/**
 * File approved photos into the knowledge base.
 *
 * A photo becomes an ordinary Recall item — same kind, same attachment shape,
 * same extract — which is why the search box and the assistant can find it
 * without knowing the photo pipeline exists at all.
 */
export async function approvePhotos(args: ApproveArgs): Promise<ApproveResult> {
  const wanted = new Set(args.photoIds);
  const queue = getQueue().filter((p) => wanted.has(p.id) && p.status === "ready");
  const photos = getPhotos();
  const nameOf = new Map(photos.people.map((p) => [p.id, p.name]));
  const result: ApproveResult = {
    filed: 0,
    eventsCreated: 0,
    backedUp: 0,
    backupFailed: 0,
    problems: [],
  };

  const filedForBackup: { photo: PendingPhoto; itemId: string; category: string }[] = [];

  let done = 0;
  for (const p of queue) {
    args.onProgress?.(done, queue.length);
    const a = p.analysis;
    try {
      // The other-app write goes FIRST. It is the one step here that can fail for
      // a reason outside this app — signed out of Cookbook Genie, say — and when
      // it ran after the Dashboard item was created, a failure left the photo
      // filed here AND still queued, so pressing "File it" again made a duplicate.
      // Now a failed destination writes nothing and a retry is clean.
      //
      // Writes go through the target app's own client or store, never its
      // storage key; parse() is the trust boundary, and a proposal that does not
      // survive it is dropped rather than repaired.
      const dest = a?.destination ? destinationById(a.destination.id) : undefined;
      if (dest && a?.destination) {
        const fields = dest.parse(a.destination.fields);
        if (fields) {
          await dest.commit(fields);
          result.filedElsewhere = (result.filedElsewhere ?? 0) + 1;
        }
      }

      const path = p.destPath?.length ? p.destPath : ["Inbox"];
      const { folderId } = ensureFolderPath(path, true);

      // Person names become tags, so "photos of Leo" works from the search box
      // even for someone who never opens the Photos tab.
      const peopleIds = a?.people.map((h) => h.personId) ?? [];
      const personTags = peopleIds
        .map((id) => nameOf.get(id))
        .filter(Boolean)
        .map((n) => (n as string).toLowerCase().replace(/\s+/g, "-"));

      const extract = [a?.caption, a?.text].filter(Boolean).join("\n\n");
      const { item } = createItem({
        title: a?.title || p.name,
        body: a?.caption ?? "",
        summary: (a?.caption ?? "").slice(0, 160),
        kind: "image",
        source: "manual",
        folderId,
        tags: [...(a?.tags ?? []), ...personTags],
        attachment: {
          name: p.name,
          type: p.type,
          size: p.size,
          url: p.thumb,
          fileId: p.fileId,
          category: "image",
        },
        extract: extract || undefined,
        extractStatus: a?.engine === "ai" ? "ok" : "unsupported",
        people: peopleIds.length ? peopleIds : undefined,
        photoCategoryId: p.categoryId ?? null,
        // Kept on the item so this photo is recognised as a duplicate later,
        // on any device — the item syncs, the pixels do not.
        fingerprint: p.fingerprint,
      });
      result.filed++;

      if (args.createEvents !== false && a?.route === "event" && a.event) {
        createEvent({
          title: a.event.title,
          // A photo with no readable date is still worth putting somewhere the
          // user will see it; today, flagged, beats silently dropping it.
          date: a.event.date ?? todayKey(),
          time: a.event.time,
          location: a.event.location,
          notes: [a.caption, a.text].filter(Boolean).join("\n\n").slice(0, 500),
          source: "photo",
          itemId: item.id,
          reminders: [1440, 60],
        });
        result.eventsCreated++;
      }

      filedForBackup.push({
        photo: p,
        itemId: item.id,
        category: (p.destPath ?? []).slice(1).join(" - "),
      });
    } catch (err) {
      result.problems.push({
        name: p.name,
        error: err instanceof Error ? err.message : "Could not file this photo.",
      });
    }
    done++;
    args.onProgress?.(done, queue.length);
  }

  // Only the successfully-filed photos leave the queue; anything that failed
  // stays put so the user can see it and try again.
  const problemNames = new Set(result.problems.map((x) => x.name));
  removePending(queue.filter((p) => !problemNames.has(p.name)).map((p) => p.id));

  if (photos.settings.driveBackup && driveConfigured() && filedForBackup.length) {
    const backup = await runBackup(filedForBackup, photos);
    result.backedUp = backup.ok;
    result.backupFailed = backup.failed;
  }

  return result;
}

async function runBackup(
  filed: { photo: PendingPhoto; itemId: string; category: string }[],
  photos: PhotosData,
): Promise<{ ok: number; failed: number }> {
  try {
    const targets = [];
    for (const f of filed) {
      const blob = await getFile(f.photo.fileId);
      if (blob) targets.push({ blob, name: f.photo.name, category: f.category });
    }
    const res = await backupPhotos(targets, {
      mirrorCategories: photos.settings.driveMirrorCategories,
    });
    // Stamp the Drive id on each item so a later "back everything up" can skip
    // what is already there rather than making duplicates.
    const byName = new Map(res.uploaded.map((u) => [u.name, u.driveId]));
    for (const f of filed) {
      const driveId = byName.get(f.photo.name);
      if (driveId) updateItem(f.itemId, { driveBackupId: driveId });
    }
    return { ok: res.uploaded.length, failed: res.failed.length };
  } catch {
    // A failed backup must never look like a failed import — the photos are
    // filed either way, and the Photos tab reports the backup state separately.
    return { ok: 0, failed: filed.length };
  }
}

/** Discard photos from the queue, taking their blobs with them. */
export async function rejectPhotos(photoIds: string[]): Promise<PendingPhoto[]> {
  const wanted = new Set(photoIds);
  for (const p of getQueue().filter((x) => wanted.has(x.id))) {
    await deleteFile(p.fileId).catch(() => {
      /* already gone */
    });
  }
  return removePending(photoIds);
}

/** Re-triage anything that failed, e.g. after a key was added. */
export async function retryFailed(folderPaths: string[], existingTags: string[]): Promise<PendingPhoto[]> {
  for (const p of getQueue().filter((x) => x.status === "failed")) {
    await reanalyze(p.id, folderPaths, existingTags);
  }
  return getQueue();
}

/** The heuristic stand-in, for a queue entry that never reached the model. */
export function markUnanalysed(photo: PendingPhoto): PendingPhoto[] {
  return applyAnalysis(photo.id, heuristicAnalysis(photo.name), getPhotos());
}

// ----- backing up what is already filed ------------------------------------

export interface BulkBackupArgs {
  /** Already-filed photo items, newest first. */
  items: { id: string; name: string; fileId: string; category: string; driveBackupId?: string | null }[];
  mirrorCategories: boolean;
  onProgress?: (done: number, total: number, current: string) => void;
}

/**
 * Copy an existing photo folder to Drive. Anything already stamped with a
 * Drive id is skipped, so running this twice is cheap rather than duplicative.
 */
export async function backupFiled(args: BulkBackupArgs): Promise<{ ok: number; failed: number; skipped: number }> {
  const todo = args.items.filter((i) => !i.driveBackupId);
  const skipped = args.items.length - todo.length;
  if (!todo.length) return { ok: 0, failed: 0, skipped };

  const targets = [];
  for (const i of todo) {
    const blob = await getFile(i.fileId);
    if (blob) targets.push({ blob, name: i.name, category: i.category, itemId: i.id });
  }
  const res = await backupPhotos(
    targets.map(({ blob, name, category }) => ({ blob, name, category })),
    {
      mirrorCategories: args.mirrorCategories,
      onProgress: (p) => args.onProgress?.(p.done, p.total, p.current),
    },
  );
  const byName = new Map(res.uploaded.map((u) => [u.name, u.driveId]));
  for (const t of targets) {
    const driveId = byName.get(t.name);
    if (driveId) updateItem(t.itemId, { driveBackupId: driveId });
  }
  return { ok: res.uploaded.length, failed: res.failed.length, skipped };
}

// ----- duplicates ------------------------------------------------------------

/** Every filed photo's fingerprint, labelled with the folder it lives in. */
async function filedFingerprints(): Promise<FingerprintCandidate[]> {
  const data = getData();
  const out: FingerprintCandidate[] = [];
  for (const it of data.items) {
    if (it.kind !== "image") continue;
    const hash = it.fingerprint ?? (await fingerprintImage(it.attachment?.url));
    if (hash) out.push({ id: it.id, hash, label: folderPathString(data.folders, it.folderId) });
  }
  return out;
}

/** Photos still waiting for review that have been fingerprinted. */
function queuedFingerprints(queue: PendingPhoto[]): FingerprintCandidate[] {
  return queue
    .filter((p) => p.fingerprint)
    .map((p) => ({ id: p.id, hash: p.fingerprint as string, label: "Waiting for review" }));
}

/** The user saw the duplicate warning and wants this photo anyway. */
export function keepDuplicate(photoId: string): PendingPhoto[] {
  return updatePending(photoId, { keepDuplicate: true });
}
