"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../icons";
import {
  categoryPath,
  getPhotos,
  getQueue,
  setSettings,
  PHOTOS_KEY,
  UNSORTED_PEOPLE_PATH,
} from "@/lib/recall/photos/store";
import { PHOTO_ACCENTS, PHOTOS_ROOT } from "@/lib/recall/photos/types";
import type { PendingPhoto, PhotoCategory, PhotosData } from "@/lib/recall/photos/types";
import {
  approvePhotos,
  backupFiled,
  importPhotos,
  reanalyze,
  rejectPhotos,
  retarget,
} from "@/lib/recall/photos/pipeline";
import { driveConfigured, pickFromDrive } from "@/lib/recall/drive";
import { childFolders, getData } from "@/lib/recall/store";
import { folderPaths } from "@/lib/recall/classify";
import type { Folder, Item, RecallData } from "@/lib/recall/types";
import { useRemotePull } from "@/lib/sync/useSync";
import { ReviewQueue } from "./ReviewQueue";
import { PeopleManager } from "./PeopleManager";

// ---------------------------------------------------------------------------
// Photos.
//
// One folder, many sub-folders, and a warm palette that is never used anywhere
// else in Recall — so the photo side is identifiable from across the room and
// from every other screen in the app.
//
// The sub-folders are ordinary Recall folders under "Photos", and the photos in
// them are ordinary Recall items. That is deliberate: it means the search box,
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
    settings: { driveBackup: false, driveFolderId: null, driveMirrorCategories: true },
  }));
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const countOf = useCallback(
    (folder: Folder) => data.items.filter((i) => i.folderId === folder.id).length,
    [data.items],
  );

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

  const totalPhotos = useMemo(
    () => tiles.reduce((n, t) => n + t.count, 0),
    [tiles],
  );

  // ----- import ------------------------------------------------------------

  async function runImport(files: File[]) {
    if (!files.length) return;
    setBusy("Storing photos…");
    const out = await importPhotos({
      files,
      folderPaths: paths,
      existingTags,
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
    setBusy(null);

    // Say exactly what happened, including what did NOT come in — a silent
    // drop on a big import is how you lose photos without noticing.
    const bits = [`${out.accepted} ready to review`];
    if (out.deferred) bits.push(`${out.deferred} held back — clear the queue first`);
    if (out.skipped) bits.push(`${out.skipped} skipped (not images)`);
    onToast(bits.join(" · "));
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
    if (res.eventsCreated) bits.push(`${res.eventsCreated} on the calendar`);
    if (res.backedUp) bits.push(`${res.backedUp} backed up`);
    if (res.backupFailed) bits.push(`${res.backupFailed} failed to back up`);
    if (res.problems.length) bits.push(`${res.problems.length} couldn't be filed`);
    onToast(bits.join(" · "));
  }

  async function reject(ids: string[]) {
    setPending(await rejectPhotos(ids));
    onToast(`Discarded ${ids.length}`);
  }

  async function reread(id: string) {
    setBusy("Re-reading…");
    setPending(await reanalyze(id, paths, existingTags));
    setBusy(null);
  }

  // ----- backup ------------------------------------------------------------

  async function backupFolder(folderId: string, name: string) {
    const items: Item[] = data.items.filter((i) => i.folderId === folderId && i.attachment?.fileId);
    if (!items.length) return onToast("Nothing in that folder to back up");
    setBusy(`Backing up ${name}…`);
    try {
      const res = await backupFiled({
        items: items.map((i) => ({
          id: i.id,
          name: i.attachment?.name ?? `${i.title}.jpg`,
          fileId: i.attachment?.fileId as string,
          category: name,
          driveBackupId: i.driveBackupId,
        })),
        mirrorCategories: photos.settings.driveMirrorCategories,
        onProgress: (done, total) => setBusy(`Backing up ${done}/${total}…`),
      });
      onData(getData());
      onToast(
        `${res.ok} uploaded${res.skipped ? ` · ${res.skipped} already there` : ""}${res.failed ? ` · ${res.failed} failed` : ""}`,
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Backup failed");
    }
    setBusy(null);
  }

  const openFolder = openFolderId ? data.folders.find((f) => f.id === openFolderId) ?? null : null;
  const openPhotos = useMemo(
    () => (openFolder ? data.items.filter((i) => i.folderId === openFolder.id) : []),
    [data.items, openFolder],
  );

  if (openFolder) {
    return (
      <Gallery
        folder={openFolder}
        items={openPhotos}
        driveEnabled={photos.settings.driveBackup}
        busy={busy}
        onBack={() => setOpenFolderId(null)}
        onOpenItem={onOpenItem}
        onOpenWorkspace={() => onNavigate(openFolder.id)}
        onBackup={() => void backupFolder(openFolder.id, openFolder.name)}
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
            {totalPhotos} filed · {photos.people.length}{" "}
            {photos.people.length === 1 ? "person" : "people"} labelled
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
          onClick={() => setSettingsOpen(true)}
          title="Backup and folder rules"
          aria-label="Photo settings"
          className="rounded-xl border border-line p-2 text-ink-muted transition hover:text-ink"
        >
          <Icon.Settings width={15} height={15} />
        </button>
        {driveConfigured() && (
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

      {busy && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11.5px] text-amber-200">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
          {busy}
        </div>
      )}

      {/* Setup nudge — the one thing that must happen before any of this works */}
      {needsSetup && (
        <div className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-4">
          <p className="text-sm font-semibold text-ink">Teach Recall who&apos;s who first</p>
          <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-ink-muted">
            Add yourself, your partner and your kids, with two or three clear photos of each face.
            Recall then sorts new photos into <em>Selfies</em>, <em>Me &amp; …</em>,{" "}
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
      />

      {/* Sub-folders */}
      {tiles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
          <Icon.Image width={28} height={28} className="mx-auto mb-3 text-ink-faint" />
          <p className="text-sm font-medium text-ink">No photo folders yet</p>
          <p className="mx-auto mt-1 max-w-sm text-[11.5px] leading-relaxed text-ink-muted">
            They appear as soon as you add the people they&apos;re about.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {tiles.map((t, i) => {
            const a = PHOTO_ACCENTS[i % PHOTO_ACCENTS.length];
            const disabled = !t.folderId;
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
                    </span>
                  </span>
                </button>
                {photos.settings.driveBackup && t.folderId && t.count > 0 && (
                  <button
                    onClick={() => void backupFolder(t.folderId as string, t.name)}
                    disabled={Boolean(busy)}
                    title={`Back “${t.name}” up to Google Drive`}
                    aria-label={`Back up ${t.name} to Drive`}
                    className="absolute right-2 top-2 rounded-md bg-canvas/70 p-1.5 text-ink-faint opacity-0 backdrop-blur transition hover:text-ink group-hover/tile:opacity-100 disabled:opacity-40"
                  >
                    <Icon.Upload width={12} height={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
        <strong className="text-ink-muted">Getting photos off your phone:</strong> open Recall in
        your phone&apos;s browser and tap <em>Add photos</em> — that opens your camera roll and you
        can select as many as you like. A web app can&apos;t sync your camera roll in the
        background, so this (or a Google Drive import) is the way in.
      </p>

      {peopleOpen && (
        <PeopleManager
          data={photos}
          onData={setPhotos}
          onToast={onToast}
          onClose={() => setPeopleOpen(false)}
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
            <code className="text-ink">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> and{" "}
            <code className="text-ink">NEXT_PUBLIC_GOOGLE_API_KEY</code> and the backup and import
            buttons appear.
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
                  Copy approved photos to Drive
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-muted">
                  Uploads to a <strong>Recall Photos</strong> folder Drive creates for this app.
                  Recall only ever sees files it created or you hand-picked — it cannot read the
                  rest of your Drive.
                </span>
              </span>
            </label>

            <label className="mt-2 flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-canvas px-3 py-2.5">
              <input
                type="checkbox"
                checked={photos.settings.driveMirrorCategories}
                onChange={(e) => onChange({ driveMirrorCategories: e.target.checked })}
                disabled={!photos.settings.driveBackup}
                className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500 disabled:opacity-40"
              />
              <span>
                <span className="block text-[12.5px] font-medium text-ink">
                  Mirror the sub-folders
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-muted">
                  Recreates <em>Selfies</em>, <em>My Son</em> and the rest inside the backup folder
                  instead of dumping everything in one pile.
                </span>
              </span>
            </label>

            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Already-filed photos aren&apos;t uploaded retroactively. Hover any photo folder tile
              and press the ↑ button to back that one up; anything already in Drive is skipped.
            </p>
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
  driveEnabled,
  busy,
  onBack,
  onOpenItem,
  onOpenWorkspace,
  onBackup,
}: {
  folder: Folder;
  items: Item[];
  driveEnabled: boolean;
  busy: string | null;
  onBack: () => void;
  onOpenItem: (item: Item) => void;
  onOpenWorkspace: () => void;
  onBackup: () => void;
}) {
  const backedUp = items.filter((i) => i.driveBackupId).length;

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
            {driveEnabled && ` · ${backedUp} backed up`}
          </p>
        </div>
        {driveEnabled && items.length > 0 && (
          <button
            onClick={onBackup}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:text-ink disabled:opacity-40"
          >
            <Icon.Upload width={13} height={13} /> Back up to Drive
          </button>
        )}
        <button
          onClick={onOpenWorkspace}
          title="Open this as an ordinary Recall folder"
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

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
          <Icon.Image width={26} height={26} className="mx-auto mb-2 text-ink-faint" />
          <p className="text-sm font-medium text-ink">Nothing here yet</p>
          <p className="mx-auto mt-1 max-w-xs text-[11.5px] leading-relaxed text-ink-muted">
            Photos land here on their own once Recall recognises who&apos;s in them.
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
              {it.driveBackupId && (
                <span
                  title="Backed up to Google Drive"
                  className="absolute right-1 top-1 rounded bg-canvas/80 p-0.5 text-emerald-300 backdrop-blur"
                >
                  <Icon.Check width={10} height={10} />
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
