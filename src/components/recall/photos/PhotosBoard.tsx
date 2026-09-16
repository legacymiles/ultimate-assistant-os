"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../icons";
import {
  categoryPath,
  createCategory,
  deleteCategory,
  getPhotos,
  getQueue,
  setSettings,
  updateCategory,
  PHOTOS_KEY,
  UNSORTED_PEOPLE_PATH,
} from "@/lib/recall/photos/store";
import { PHOTO_ACCENTS, PHOTOS_ROOT } from "@/lib/recall/photos/types";
import type { PendingPhoto, PhotoCategory, PhotosData } from "@/lib/recall/photos/types";
import {
  approvePhotos,
  backupToDrive,
  importPhotos,
  keepDuplicate,
  reanalyze,
  rejectPhotos,
  retarget,
} from "@/lib/recall/photos/pipeline";
import { composeBatch } from "@/lib/recall/photos/compose";
import { readBatchPlan } from "@/lib/recall/photos/batch";
import type { BatchPlan } from "@/lib/recall/photos/batch";
import { driveConfigured, drivePickerConfigured, pickFromDrive } from "@/lib/recall/drive";
import {
  childFolders,
  descendantFolderIds,
  ensureFolderPath,
  folderPathString,
  getData,
  updateFolder,
} from "@/lib/recall/store";
import { AlbumDialog, type AlbumDraft } from "./AlbumDialog";
import { explainDriveFailure } from "@/lib/dashboard/driveBackup/driveApi";
import { folderPaths } from "@/lib/recall/classify";
import type { Folder, Item, RecallData } from "@/lib/recall/types";
import { useRemotePull } from "@/lib/sync/useSync";
import { ReviewQueue, type NewAlbum } from "./ReviewQueue";
import { PeopleManager } from "./PeopleManager";
import { IphoneSources } from "./IphoneSources";
import { gatherKnownPlaces } from "@/lib/dashboard/destinations/registry";

// ---------------------------------------------------------------------------
// Photos.
//
// One folder, many sub-folders, and a warm palette that is never used anywhere
// else in Dashboard — so the photo side is identifiable from across the room and
// from every other screen in the app.
//
// The sub-folders are ordinary Dashboard folders under "Photos", and the photos in
// them are ordinary Dashboard items. That is deliberate: it means the search box,
// the folder workspace and the assistant all work on photos for free, and a
// photo of a receipt is findable by what it SAYS, not by which folder it sits
// in. This screen is the specialised front door to that data, not a silo
// beside it.
// ---------------------------------------------------------------------------

interface Props {
  data: RecallData;
  /** Leaves Photos for the ordinary folder workspace (sections, notes, etc.). */
  onNavigate: (folderId: string) => void;
  onData: (data: RecallData) => void;
  onToast: (msg: string) => void;
  onOpenItem: (item: Item) => void;
  /** Bump when the calendar may have changed (an event photo was approved). */
  onCalendarChanged?: () => void;
}

export function PhotosBoard({
  data,
  onNavigate,
  onData,
  onToast,
  onOpenItem,
  onCalendarChanged,
}: Props) {
  /**
   * Opening a photo folder stays INSIDE Photos as a gallery. The ordinary
   * folder workspace is a good page for notes, links and logins and a poor one
   * for two hundred pictures of your kids — a wall of thumbnails is how you
   * recognise a photo, and a filename is not.
   */
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotosData>(() => ({
    people: [],
    categories: [],
    settings: { driveBackup: false },
  }));
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * The folder grid, or every picture in the library at once. "All photos" is
   * the view that answers "where did that go" without having to remember which
   * album the sorting chose — it reads straight through the folder tree.
   */
  const [view, setView] = useState<"folders" | "all">("folders");
  /** Open with null to create a folder, or with a category to teach one. */
  const [albumEdit, setAlbumEdit] = useState<{ category: PhotoCategory | null } | null>(null);
  /** The user's instructions for what they are importing, read by the agent. */
  const [instruction, setInstruction] = useState("");
  /** What the agent did with those instructions on the last import. */
  const [planNote, setPlanNote] = useState<{ note?: string; couldNot: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPhotos(getPhotos());
    setPending(getQueue());
  }, []);

  useRemotePull(PHOTOS_KEY, () => setPhotos(getPhotos()));

  const existingTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of data.items) for (const t of it.tags) set.add(t);
    return [...set];
  }, [data.items]);

  const paths = useMemo(() => folderPaths(data.folders), [data.folders]);

  // Photo folders that actually exist, with their live counts.
  const root = data.folders.find(
    (f) => f.parentId === null && (f.role === "photos" || f.name.toLowerCase() === PHOTOS_ROOT.toLowerCase()),
  );
  const subFolders = useMemo(
    () => (root ? childFolders(data.folders, root.id) : []),
    [data.folders, root],
  );

  /**
   * Photos counted THROUGH the tree, not just the folder itself.
   *
   * A tile that says "empty" because the pictures are one level down is worse
   * than no count at all — it reads as lost data. Every count here, and the
   * total in the header, is the whole subtree.
   */
  const deepCount = useCallback(
    (folderId: string) => {
      const ids = descendantFolderIds(data.folders, folderId);
      return data.items.filter((i) => i.kind === "image" && i.folderId && ids.has(i.folderId)).length;
    },
    [data.folders, data.items],
  );
  const countOf = useCallback((folder: Folder) => deepCount(folder.id), [deepCount]);

  /** Every picture anywhere under Photos, newest first. */
  const allPhotos = useMemo(() => {
    if (!root) return [];
    const ids = descendantFolderIds(data.folders, root.id);
    return data.items
      .filter((i) => i.kind === "image" && i.folderId && ids.has(i.folderId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [data.folders, data.items, root]);

  /**
   * The tile list is the CATEGORIES, not the folders on disk — an empty
   * "Me & My Son" should be visible and reassuring before its first photo
   * arrives, not appear out of nowhere later. Folders that exist but have no
   * matching rule (Unsorted, Events, anything the user made by hand) are
   * appended so nothing is ever hidden.
   */
  const tiles = useMemo(() => {
    const byName = new Map(subFolders.map((f) => [f.name.toLowerCase(), f]));
    const claimed = new Set<string>();
    const fromCategories = photos.categories.map((c) => {
      const folder = byName.get(c.name.toLowerCase());
      if (folder) claimed.add(folder.id);
      return {
        key: c.id,
        name: c.name,
        description: c.description,
        count: folder ? countOf(folder) : 0,
        folderId: folder?.id ?? null,
        category: c as PhotoCategory | null,
      };
    });
    const extras = subFolders
      .filter((f) => !claimed.has(f.id))
      .map((f) => ({
        key: f.id,
        name: f.name,
        description: f.description,
        count: countOf(f),
        folderId: f.id,
        category: null as PhotoCategory | null,
      }));
    return [...fromCategories, ...extras];
  }, [photos.categories, subFolders, countOf]);

  const totalPhotos = allPhotos.length;

  // ----- import ------------------------------------------------------------

  /**
   * Bring a batch in — after doing whatever the instructions asked for.
   *
   * "Make these into a collage" has to happen BEFORE anything is queued, or the
   * user reviews six photos of a truck and a collage nobody asked to keep. So
   * the agent reads the instruction first, the pictures are combined on a
   * canvas here in the browser, and it is the ONE finished picture that goes
   * into the queue, gets filed, and is backed up.
   */
  async function runImport(incoming: File[]) {
    if (!incoming.length) return;
    let files = incoming;
    const note = instruction.trim();
    setPlanNote(null);

    let plan: BatchPlan | null = null;
    if (note) {
      setBusy("Reading your instructions…");
      plan = await readBatchPlan(note, files);
    }

    let composite: { kind: "collage"; sources: string[] } | null = null;
    if (plan && (plan.collage || plan.caption)) {
      setBusy(plan.collage ? "Building the collage…" : "Adding your words…");
      try {
        const made = await composeBatch({
          files,
          collage: plan.collage,
          caption: plan.caption,
          title: plan.title,
        });
        if (plan.collage) {
          // Counted as one picture, on purpose: the originals are still in the
          // camera roll, and queueing all seven would undo the thing that was
          // asked for.
          composite = { kind: "collage", sources: files.map((f) => f.name) };
          files = [made];
        } else {
          // Words on ONE picture. Anything else in the batch comes in untouched
          // rather than being silently dropped.
          files = [made, ...files.slice(1)];
        }
      } catch (err) {
        plan = {
          ...plan,
          couldNot: [...plan.couldNot, err instanceof Error ? err.message : "That edit failed."],
        };
      }
    }
    if (plan && (plan.note || plan.couldNot.length)) {
      setPlanNote({ note: plan.note, couldNot: plan.couldNot });
    }

    setBusy("Storing photos…");
    const existing = new Set(getQueue().map((q) => q.id));
    const out = await importPhotos({
      files,
      folderPaths: paths,
      existingTags,
      instruction: note || undefined,
      composite,
      onProgress: (p) =>
        setBusy(
          p.stage === "storing"
            ? `Storing ${p.done + 1} of ${p.total}…`
            : p.stage === "analyzing"
              ? `Reading ${p.done} of ${p.total}…`
              : null,
        ),
      onQueue: setPending,
    });
    setPending(out.queue);

    // "…and put them in my Jobs folder". The folder is created if it is new —
    // nothing is committed by that: the photos sit in the review queue showing
    // exactly where they are headed, and an empty folder is one click to delete.
    if (plan?.album) {
      const queuedNow = out.queue.filter((q) => !existing.has(q.id)).map((q) => q.id);
      if (queuedNow.length) fileInto(plan.album, queuedNow);
    }
    setBusy(null);

    // Say exactly what happened, including what did NOT come in — a silent
    // drop on a big import is how you lose photos without noticing.
    const bits = [`${out.accepted} ready to review`];
    if (out.deferred) bits.push(`${out.deferred} held back — clear the queue first`);
    if (out.skipped) bits.push(`${out.skipped} skipped (not images)`);
    onToast(bits.join(" · "));
  }

  /** Point queued photos at an album by name, making it if it does not exist. */
  function fileInto(albumName: string, photoIds: string[]) {
    const wanted = albumName.trim().toLowerCase();
    let cat = photos.categories.find((c) => c.name.trim().toLowerCase() === wanted);
    if (!cat) {
      const next = makeAlbum({ name: albumName.trim(), description: "", requires: [], exact: false, refs: [] });
      cat = next.categories.find((c) => c.name.trim().toLowerCase() === wanted);
    }
    if (!cat) return;
    let queue = getQueue();
    for (const id of photoIds) queue = retarget(id, categoryPath(cat), cat.id);
    setPending(queue);
  }

  async function importFromDrive() {
    try {
      setBusy("Opening Google Drive…");
      const picked = await pickFromDrive();
      const files: File[] = [];
      for (const d of picked) {
        if (!d.dataUrl) continue;
        const blob = await (await fetch(d.dataUrl)).blob();
        files.push(new File([blob], d.name, { type: blob.type || "image/jpeg" }));
      }
      setBusy(null);
      if (!files.length) return onToast("No images picked");
      await runImport(files);
    } catch (err) {
      setBusy(null);
      onToast(err instanceof Error ? err.message : "Drive import failed");
    }
  }

  // ----- review actions ----------------------------------------------------

  async function approve(ids: string[]) {
    setBusy(`Filing ${ids.length} ${ids.length === 1 ? "photo" : "photos"}…`);
    const res = await approvePhotos({ photoIds: ids });
    setPending(getQueue());
    onData(getData());
    setBusy(null);
    if (res.eventsCreated) onCalendarChanged?.();

    const bits = [`Filed ${res.filed}`];
    if (res.filedElsewhere) bits.push(`${res.filedElsewhere} sent to other apps`);
    if (res.eventsCreated) bits.push(`${res.eventsCreated} on the calendar`);
    if (res.backedUp) bits.push(`${res.backedUp} backed up`);
    if (res.backupFailed) bits.push(`${res.backupFailed} failed to back up`);
    if (res.backupNeedsTap) bits.push("press Back up — Google needs a fresh OK");
    if (res.problems.length) {
      // A bare count gave the user nothing to act on — the reason is the useful
      // part, so the first one is shown in full. The photo stays in the queue.
      bits.push(`${res.problems.length} couldn't be filed: ${res.problems[0].error}`);
    }
    onToast(bits.join(" · "));
  }

  async function reject(ids: string[]) {
    setPending(await rejectPhotos(ids));
    onToast(`Discarded ${ids.length}`);
  }

  async function reread(id: string, forceRoute?: string, userPrompt?: string) {
    const hasPrompt = Boolean(userPrompt || pending.find((p) => p.id === id)?.userPrompt);
    setBusy(
      userPrompt
        ? "The agent is reading your instructions and the photo…"
        : forceRoute
          ? "Reading it again for that app…"
          : "Re-reading…",
    );
    // Tell the agent what already exists: cookbooks, board sections and photo
    // albums. That is what lets "my desert cookbook" land in the existing
    // "Desserts" rather than a near-duplicate beside it.
    const knownPlaces =
      hasPrompt || forceRoute
        ? { ...(await gatherKnownPlaces()), "photo albums": photos.categories.map((c) => c.name) }
        : undefined;
    setPending(
      await reanalyze(id, paths, existingTags, {
        instruction: instruction.trim() || undefined,
        forceRoute,
        userPrompt,
        knownPlaces,
      }),
    );
    setBusy(null);
  }

  /**
   * Create a photo folder, both halves of it: the RULE that sorts photos into
   * it, and the real Dashboard folder it files into.
   *
   * Both, always. A rule with no folder is a destination that shows as empty
   * until its first photo; a folder with no rule never sorts anything. Making
   * one without the other is the bug this function exists to prevent.
   */
  function makeAlbum(draft: AlbumDraft): PhotosData {
    const next = createCategory({
      name: draft.name,
      description: draft.description || undefined,
      requires: draft.requires,
      exact: draft.exact,
      // A folder with nobody chosen must NEVER match on people alone: custom
      // rules sort ahead of the family ones, so "any one person" would swallow
      // every photo of a person. A count no real photo reaches leaves it to the
      // reference pictures, or to the user.
      minPeople: draft.requires.length || 999,
      refs: draft.refs,
      refHint: draft.description || undefined,
    });
    setPhotos(next);
    // The real folder, created now rather than on the first photo, so it is on
    // the Folders tab and in the next Drive backup straight away.
    ensureFolderPath([PHOTOS_ROOT, draft.name.trim()], false);
    onData(getData());
    return next;
  }

  function createAlbum(photoId: string, album: NewAlbum) {
    const next = makeAlbum({
      name: album.name,
      description: "",
      requires: album.requires,
      exact: album.exact,
      refs: [],
    });
    const made = [...next.categories]
      .reverse()
      .find((c) => !c.builtIn && c.name === album.name.trim());
    if (made) setPending(retarget(photoId, categoryPath(made), made.id));
    onToast(`Album “${album.name}” created`);
  }

  /** Save the dialog — a new folder, or changes to one that exists. */
  function saveAlbum(draft: AlbumDraft) {
    const editing = albumEdit?.category ?? null;
    if (!editing) {
      makeAlbum(draft);
      onToast(`Folder “${draft.name}” created`);
    } else {
      const was = editing.name;
      setPhotos(
        updateCategory(editing.id, {
          name: draft.name,
          description: draft.description,
          requires: draft.requires,
          exact: draft.exact,
          refs: draft.refs,
          refHint: draft.description,
        }),
      );
      // A renamed rule whose folder kept the old name would file into a second
      // folder beside the first, so the folder is renamed with it.
      const folder = root ? childFolders(data.folders, root.id).find((f) => f.name === was) : null;
      if (folder && folder.name !== draft.name) {
        updateFolder(folder.id, { name: draft.name, description: draft.description });
      } else if (folder) {
        updateFolder(folder.id, { name: folder.name, description: draft.description });
      } else {
        ensureFolderPath([PHOTOS_ROOT, draft.name], false);
      }
      onData(getData());
      onToast(
        draft.refs.length
          ? `“${draft.name}” now sorts by ${draft.refs.length} reference ${draft.refs.length === 1 ? "picture" : "pictures"}`
          : `“${draft.name}” saved`,
      );
    }
    setAlbumEdit(null);
  }

  /**
   * Remove the RULE, never the pictures. The folder and everything filed in it
   * stay exactly where they are on the Folders tab — deleting photos is not
   * something an "edit folder" dialog should ever be able to do by accident.
   */
  function removeAlbum() {
    const editing = albumEdit?.category;
    if (!editing) return;
    setPhotos(deleteCategory(editing.id));
    setAlbumEdit(null);
    onToast(`“${editing.name}” will not sort new photos any more. The folder and its photos are untouched.`);
  }

  // ----- backup ------------------------------------------------------------

  /**
   * Back everything up — the SAME backup the Folders tab runs, on purpose.
   *
   * Photos used to have a Drive path of their own that uploaded into a separate
   * folder, flat but for one level of album names, and could not see a
   * sub-folder inside an album at all. Now there is one backup: it mirrors the
   * folder tree exactly as it appears here, at any depth, and matches by id so
   * a renamed album moves on Drive instead of being uploaded again beside the
   * old copy. "Just like everything else" is the whole point.
   */
  async function backupEverything() {
    setBusy("Checking what is already on Drive…");
    try {
      const summary = await backupToDrive((p) =>
        setBusy(
          p.stage === "scanning"
            ? "Checking what is already on Drive…"
            : `Backing up ${p.done + 1} of ${p.total}${p.current ? ` — ${p.current}` : ""}`,
        ),
      );
      onData(getData());
      const bits = [`${summary.created} added`, `${summary.updated} updated`];
      if (summary.unchanged) bits.push(`${summary.unchanged} already there`);
      if (summary.failed.length) bits.push(`${summary.failed.length} failed`);
      if (summary.notOnThisDevice.length) {
        bits.push(`${summary.notOnThisDevice.length} stored on another device`);
      }
      onToast(`Google Drive: ${bits.join(" · ")}`);
    } catch (err) {
      onToast(explainDriveFailure(err instanceof Error ? err.message : "Backup failed"));
    }
    setBusy(null);
  }

  const openFolder = openFolderId ? data.folders.find((f) => f.id === openFolderId) ?? null : null;
  const openPhotos = useMemo(
    () => (openFolder ? data.items.filter((i) => i.folderId === openFolder.id) : []),
    [data.items, openFolder],
  );
  /** Folders nested inside the open one — shown, not hidden, at every depth. */
  const openSubFolders = useMemo(
    () => (openFolder ? childFolders(data.folders, openFolder.id) : []),
    [data.folders, openFolder],
  );

  if (openFolder) {
    return (
      <Gallery
        folder={openFolder}
        items={openPhotos}
        subFolders={openSubFolders}
        countIn={deepCount}
        driveEnabled={driveConfigured()}
        busy={busy}
        onBack={() => setOpenFolderId(null)}
        onOpenFolder={setOpenFolderId}
        onOpenItem={onOpenItem}
        onOpenWorkspace={() => onNavigate(openFolder.id)}
        onBackup={() => void backupEverything()}
      />
    );
  }

  const needsSetup = photos.people.length === 0;
  const withoutFaces = photos.people.filter((p) => p.refs.length === 0);

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
          <Icon.Image width={17} height={17} />
        </span>
        <div className="mr-auto">
          <p className="text-sm font-semibold text-ink">Photos</p>
          <p className="text-[11px] text-ink-muted">
            {totalPhotos} filed · {tiles.length} {tiles.length === 1 ? "folder" : "folders"} ·{" "}
            {photos.people.length} {photos.people.length === 1 ? "person" : "people"} labelled
          </p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void runImport(files);
          }}
        />
        <button
          onClick={() => setPeopleOpen(true)}
          className={
            "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[12px] font-medium transition " +
            (withoutFaces.length || needsSetup
              ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
              : "border-line text-ink-muted hover:text-ink")
          }
        >
          <Icon.Users width={14} height={14} />
          <span className="hidden sm:inline">People</span>
          {(needsSetup || withoutFaces.length > 0) && (
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
          )}
        </button>
        <button
          onClick={() => setAlbumEdit({ category: null })}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-2.5 py-2 text-[12px] font-medium text-ink-muted transition hover:text-ink"
        >
          <Icon.Plus width={14} height={14} />
          <span className="hidden sm:inline">New folder</span>
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          title="Backup and folder rules"
          aria-label="Photo settings"
          className="rounded-xl border border-line p-2 text-ink-muted transition hover:text-ink"
        >
          <Icon.Settings width={15} height={15} />
        </button>
        {driveConfigured() && (
          <button
            onClick={() => void backupEverything()}
            disabled={Boolean(busy)}
            title="Back the whole library up to Google Drive — every folder, at any depth"
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-2.5 py-2 text-[12px] font-medium text-ink-muted transition hover:text-ink disabled:opacity-40"
          >
            <Icon.Upload width={14} height={14} />
            <span className="hidden sm:inline">Back up</span>
          </button>
        )}
        {drivePickerConfigured() && (
          <button
            onClick={() => void importFromDrive()}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-2.5 py-2 text-[12px] font-medium text-ink-muted transition hover:text-ink disabled:opacity-40"
          >
            <Icon.Download width={14} height={14} />
            <span className="hidden sm:inline">From Drive</span>
          </button>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={Boolean(busy)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-[13px] font-semibold text-black transition hover:bg-amber-400 disabled:opacity-40"
        >
          <Icon.Upload width={15} height={15} />
          {busy ? "Working…" : "Add photos"}
        </button>
      </div>

      {/*
        The batch instruction. It used to be a hint about what the photos WERE;
        it is now an instruction the agent carries out — because "make these
        into a collage" has to change the pictures before any of them is
        queued, not merely colour how they are filed.
      */}
      <label className="mb-1.5 block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Tell the agent what to do with them{" "}
          <span className="normal-case tracking-normal text-ink-faint/70">
            optional — applies to the next batch you add
          </span>
        </span>
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder='e.g. "make these into a collage and put a short quote about hard work at the bottom"'
          className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
        />
      </label>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {[
          "Make these into a collage",
          "Collage these and put “FOR SALE” across the bottom",
          "These are all recipes",
        ].map((example) => (
          <button
            key={example}
            onClick={() => setInstruction(example)}
            className="rounded-lg border border-line px-2 py-1 text-[10.5px] text-ink-faint transition hover:text-ink"
          >
            {example}
          </button>
        ))}
      </div>

      {planNote && (
        <div className="mb-2 rounded-xl border border-brand/30 bg-brand/[0.06] px-3 py-2 text-[11.5px] leading-relaxed">
          {planNote.note && (
            <p className="flex items-center gap-1.5 text-ink">
              <Icon.Sparkles width={12} height={12} className="shrink-0 text-brand" />
              {planNote.note}
            </p>
          )}
          {planNote.couldNot.map((line, i) => (
            <p key={i} className="mt-0.5 text-amber-300">
              {line}
            </p>
          ))}
        </div>
      )}

      <IphoneSources
        busy={Boolean(busy)}
        onImport={(files) => runImport(files)}
        onToast={onToast}
      />

      {busy && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11.5px] text-amber-200">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
          {busy}
        </div>
      )}

      {/* Setup nudge — the one thing that must happen before any of this works */}
      {needsSetup && (
        <div className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-4">
          <p className="text-sm font-semibold text-ink">Teach Dashboard who&apos;s who first</p>
          <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-ink-muted">
            Add yourself, your partner and your kids, with two or three clear photos of each face.
            Dashboard then sorts new photos into <em>Selfies</em>, <em>Me &amp; …</em>,{" "}
            <em>My Little Family</em> and a folder per person on its own — and anything that turns
            out to be a receipt, a screenshot or a flyer goes to your knowledge base or your
            calendar instead.
          </p>
          <button
            onClick={() => setPeopleOpen(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-[13px] font-semibold text-black transition hover:bg-amber-400"
          >
            <Icon.Users width={15} height={15} /> Add people
          </button>
        </div>
      )}

      {!needsSetup && withoutFaces.length > 0 && (
        <p className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-[11.5px] text-amber-200">
          {withoutFaces.map((p) => p.name).join(", ")}{" "}
          {withoutFaces.length === 1 ? "has" : "have"} no reference photos yet, so{" "}
          {withoutFaces.length === 1 ? "they can't" : "they can't"} be recognised.{" "}
          <button onClick={() => setPeopleOpen(true)} className="underline hover:text-amber-100">
            Add some
          </button>
          .
        </p>
      )}

      <ReviewQueue
        pending={pending}
        photos={photos}
        busy={Boolean(busy)}
        onApprove={(ids) => void approve(ids)}
        onReject={(ids) => void reject(ids)}
        onRetarget={(id, path, catId) => setPending(retarget(id, path, catId))}
        onReanalyze={(id) => void reread(id)}
        onSendTo={(id, routeId, prompt) => void reread(id, routeId, prompt)}
        onKeepDuplicate={(id) => setPending(keepDuplicate(id))}
        onCreateAlbum={(id, album) => createAlbum(id, album)}
      />

      {/* Folders, or the whole library at once */}
      <div className="mb-2 flex items-center gap-1">
        {(["folders", "all"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={
              "rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition " +
              (view === v ? "bg-amber-400/15 text-amber-200" : "text-ink-faint hover:text-ink")
            }
          >
            {v === "folders" ? "Folders" : `All photos (${totalPhotos})`}
          </button>
        ))}
      </div>

      {view === "all" ? (
        allPhotos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
            <Icon.Image width={28} height={28} className="mx-auto mb-3 text-ink-faint" />
            <p className="text-sm font-medium text-ink">No photos filed yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[11.5px] leading-relaxed text-ink-muted">
              Add some above; they appear here once you approve them.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-6">
            {allPhotos.map((it) => (
              <button
                key={it.id}
                onClick={() => onOpenItem(it)}
                title={`${it.title} — ${folderPathString(data.folders, it.folderId)}`}
                className="group relative aspect-square overflow-hidden rounded-xl bg-panel-2 transition hover:brightness-110"
              >
                {it.attachment?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.attachment.url} alt={it.title} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-ink-faint">
                    <Icon.Image width={18} height={18} />
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4 text-[10px] leading-tight text-white group-hover:block">
                  <span className="line-clamp-1">{it.title}</span>
                  <span className="line-clamp-1 text-white/60">
                    {folderPathString(data.folders, it.folderId)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )
      ) : tiles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
          <Icon.Image width={28} height={28} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-sm font-medium text-ink">No photo folders yet</p>
          <p className="mx-auto mt-1 max-w-sm text-[11.5px] leading-relaxed text-ink-muted">
            Add the people they&apos;re about, or make one yourself with{" "}
            <strong className="text-ink-muted">New folder</strong>.
          </p>
          <button
            onClick={() => setAlbumEdit({ category: null })}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-[13px] font-semibold text-black transition hover:bg-amber-400"
          >
            <Icon.Plus width={15} height={15} /> New folder
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {tiles.map((t, i) => {
            const a = PHOTO_ACCENTS[i % PHOTO_ACCENTS.length];
            const disabled = !t.folderId;
            const refs = t.category?.refs?.length ?? 0;
            return (
              <div key={t.key} className="group/tile relative">
                <button
                  onClick={() => t.folderId && setOpenFolderId(t.folderId)}
                  disabled={disabled}
                  title={t.description}
                  className={
                    "flex h-[132px] w-full flex-col items-center justify-center gap-2 rounded-2xl border bg-gradient-to-br px-3 text-center transition " +
                    a.tile +
                    (disabled ? " opacity-45" : " hover:brightness-125")
                  }
                >
                  <Icon.Image width={26} height={26} className={a.ink} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-bold tracking-tight text-ink">
                      {t.name}
                    </span>
                    <span className="mt-0.5 block text-[10px] tabular-nums text-ink-faint">
                      {t.count === 0 ? "empty" : `${t.count} ${t.count === 1 ? "photo" : "photos"}`}
                      {refs > 0 && ` · ${refs} ref`}
                    </span>
                  </span>
                </button>
                {t.category && (
                  <button
                    onClick={() => setAlbumEdit({ category: t.category })}
                    title={
                      refs > 0
                        ? `Edit “${t.name}” and its reference pictures`
                        : `Teach “${t.name}” with a reference picture`
                    }
                    aria-label={`Edit ${t.name}`}
                    className="absolute right-2 top-2 rounded-md bg-canvas/70 p-1.5 text-ink-faint opacity-0 backdrop-blur transition hover:text-ink group-hover/tile:opacity-100"
                  >
                    <Icon.Edit width={12} height={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
        <strong className="text-ink-muted">Two ways in.</strong> <em>Import now</em> opens your
        camera roll and you pick — a web page cannot select photos for you, which is an iOS rule, not
        a missing feature here. <em>Autopilot</em> installs a Shortcut on the phone that takes the
        last N by itself and can run unattended; that is the only path that syncs without you.
      </p>

      {peopleOpen && (
        <PeopleManager
          data={photos}
          onData={setPhotos}
          onToast={onToast}
          onClose={() => setPeopleOpen(false)}
        />
      )}

      {albumEdit && (
        <AlbumDialog
          photos={photos}
          category={albumEdit.category}
          takenNames={[...photos.categories.map((c) => c.name), ...subFolders.map((f) => f.name)]}
          onSave={saveAlbum}
          onDelete={removeAlbum}
          onClose={() => setAlbumEdit(null)}
        />
      )}

      {settingsOpen && (
        <PhotoSettings
          photos={photos}
          unsortedPath={UNSORTED_PEOPLE_PATH.join(" › ")}
          onChange={(patch) => setPhotos(setSettings(patch))}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

// ----- settings ------------------------------------------------------------

function PhotoSettings({
  photos,
  unsortedPath,
  onChange,
  onClose,
}: {
  photos: PhotosData;
  unsortedPath: string;
  onChange: (patch: Partial<PhotosData["settings"]>) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const configured = driveConfigured();
  const pickerConfigured = drivePickerConfigured();

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-full max-w-md rounded-2xl border border-line bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/15 text-amber-300">
            <Icon.Settings width={15} height={15} />
          </span>
          <span className="text-sm font-semibold text-ink">Photo settings</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg p-1 text-ink-faint hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Close width={15} height={15} />
          </button>
        </div>

        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Google Drive backup
        </p>
        {!configured ? (
          <p className="rounded-xl border border-line bg-canvas px-3 py-2 text-[11.5px] leading-relaxed text-ink-muted">
            Google Drive isn&apos;t set up on this deployment. Add{" "}
            <code className="text-ink">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> to your site settings and
            redeploy, and the backup button appears.
          </p>
        ) : (
          <>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-canvas px-3 py-2.5">
              <input
                type="checkbox"
                checked={photos.settings.driveBackup}
                onChange={(e) => onChange({ driveBackup: e.target.checked })}
                className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
              />
              <span>
                <span className="block text-[12.5px] font-medium text-ink">
                  Back up to Drive after filing photos
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-muted">
                  Saves into <strong>Ultimate Assistant OS › Photos</strong> in your Drive — the same
                  place the Folders tab backs up to, with every folder and sub-folder in the shape
                  they have here. Dashboard only ever sees files it created or you hand-picked; it
                  cannot read the rest of your Drive.
                </span>
              </span>
            </label>

            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Nothing is ever deleted from Drive, and a renamed folder moves there instead of being
              copied again. Press <strong className="text-ink-muted">Back up</strong> at the top to
              run it now over everything, including photos filed before you turned this on.
            </p>
            {!pickerConfigured && (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                Adding <code className="text-ink-muted">NEXT_PUBLIC_GOOGLE_API_KEY</code> as well
                turns on the other direction — a <em>From Drive</em> button for picking photos out of
                your Drive. Backing up does not need it.
              </p>
            )}
          </>
        )}

        <p className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          How photos are sorted
        </p>
        <div className="space-y-1">
          {photos.categories.map((c) => (
            <div key={c.id} className="rounded-lg border border-line bg-canvas px-2.5 py-1.5">
              <p className="text-[12px] font-medium text-ink">{c.name}</p>
              <p className="text-[10.5px] leading-relaxed text-ink-muted">{c.description}</p>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
          Rules are tried top to bottom and the first match wins. A photo of people that matches
          nothing goes to <strong>{unsortedPath}</strong> rather than disappearing. Receipts,
          screenshots and documents skip these rules entirely and are filed next to your notes.
        </p>
      </div>
    </div>
  );
}

// ----- gallery -------------------------------------------------------------

/**
 * One photo folder as a wall of thumbnails.
 *
 * Deliberately thin: it renders the same items the folder workspace holds, and
 * the "Open as a folder" button is always there for when you want the sections,
 * notes and to-dos view instead. This is a lens on the data, not a second copy
 * of it.
 */
function Gallery({
  folder,
  items,
  subFolders,
  countIn,
  driveEnabled,
  busy,
  onBack,
  onOpenFolder,
  onOpenItem,
  onOpenWorkspace,
  onBackup,
}: {
  folder: Folder;
  items: Item[];
  subFolders: Folder[];
  countIn: (folderId: string) => number;
  driveEnabled: boolean;
  busy: string | null;
  onBack: () => void;
  onOpenFolder: (folderId: string) => void;
  onOpenItem: (item: Item) => void;
  onOpenWorkspace: () => void;
  onBackup: () => void;
}) {
  const deep = countIn(folder.id);
  const nested = deep - items.length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:text-ink"
        >
          <Icon.ArrowLeft width={13} height={13} /> Photos
        </button>
        <div className="mr-auto">
          <p className="text-sm font-semibold text-ink">{folder.name}</p>
          <p className="text-[11px] text-ink-muted">
            {items.length} {items.length === 1 ? "photo" : "photos"}
            {nested > 0 && ` · ${nested} more in ${subFolders.length === 1 ? "a sub-folder" : "sub-folders"}`}
          </p>
        </div>
        {driveEnabled && deep > 0 && (
          <button
            onClick={onBackup}
            disabled={Boolean(busy)}
            title="Backs up the whole library, sub-folders and all"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:text-ink disabled:opacity-40"
          >
            <Icon.Upload width={13} height={13} /> Back up to Drive
          </button>
        )}
        <button
          onClick={onOpenWorkspace}
          title="Open this as an ordinary Dashboard folder"
          className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:text-ink"
        >
          Open as a folder
        </button>
      </div>

      {busy && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11.5px] text-amber-200">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
          {busy}
        </div>
      )}

      {subFolders.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {subFolders.map((f) => (
            <button
              key={f.id}
              onClick={() => onOpenFolder(f.id)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-muted transition hover:text-ink"
            >
              <Icon.Folder width={13} height={13} className="text-amber-300" />
              {f.name}
              <span className="tabular-nums text-ink-faint">{countIn(f.id)}</span>
            </button>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
          <Icon.Image width={26} height={26} className="mx-auto mb-2 text-ink-faint" />
          <p className="text-sm font-medium text-ink">Nothing here yet</p>
          <p className="mx-auto mt-1 max-w-xs text-[11.5px] leading-relaxed text-ink-muted">
            Photos land here on their own once Dashboard recognises who&apos;s in them.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-6">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => onOpenItem(it)}
              title={it.title}
              className="group relative aspect-square overflow-hidden rounded-xl bg-panel-2 transition hover:brightness-110"
            >
              {it.attachment?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.attachment.url} alt={it.title} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-ink-faint">
                  <Icon.Image width={18} height={18} />
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4 text-[10px] leading-tight text-white group-hover:block">
                <span className="line-clamp-2">{it.title}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
