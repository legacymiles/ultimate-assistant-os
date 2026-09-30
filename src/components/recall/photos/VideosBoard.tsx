"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../icons";
import {
  childFolders,
  createFolder,
  deleteFolder,
  descendantFolderIds,
  folderDeleteImpact,
  getData,
  moveItem,
  renameFolder,
} from "@/lib/recall/store";
import { downloadAttachment, getFile } from "@/lib/recall/files";
import {
  deleteVideo,
  durationOf,
  ensureVideosRoot,
  formatDuration,
  formatSize,
  importVideos,
  isVideoItem,
  totalDuration,
  totalSize,
  VIDEOS_ROOT,
} from "@/lib/recall/photos/videos";
import type { Folder, Item, RecallData } from "@/lib/recall/types";

// ---------------------------------------------------------------------------
// Photos › Videos.
//
// The video half of the camera roll, and it is a different screen from the
// photo half on purpose. Photos arrive by the hundred, get read by a model and
// wait in a review queue to be told where they belong. A clip arrives one or
// five at a time, cannot be read by anything, and the person importing it
// already knows what it is — so this surface has no queue, no rules and no
// people. It has a shelf of folders and a wall of frames.
//
// A clip is recognised by its first real frame and by how long it runs. Those
// are the two facts on the tile: the poster fills it, and the running time sits
// in the corner in tabular mono so a column of them can be read down.
// ---------------------------------------------------------------------------

interface Props {
  data: RecallData;
  onData: (data: RecallData) => void;
  onToast: (msg: string) => void;
  /** Leaves Videos for the ordinary folder workspace. */
  onNavigate: (folderId: string) => void;
}

export function VideosBoard({ data, onData, onToast, onNavigate }: Props) {
  /** null = every clip in the branch; otherwise the sub-folder being shown. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * The Videos folder is made on arrival, not on first upload.
   *
   * A branch that does not exist until you use it cannot be browsed, backed up
   * or pointed at — and an empty folder costs nothing. `ensureFolderPath` only
   * writes when it actually creates something, so this is not a save on every
   * mount.
   */
  const rootId = useMemo(() => {
    const photos =
      data.folders.find((f) => f.parentId === null && f.role === "photos") ??
      data.folders.find((f) => f.parentId === null && f.name.toLowerCase() === "photos") ??
      null;
    const existing = photos
      ? data.folders.find(
          (f) => f.parentId === photos.id && f.name.toLowerCase() === VIDEOS_ROOT.toLowerCase(),
        )
      : null;
    return existing?.id ?? null;
  }, [data.folders]);

  useEffect(() => {
    if (rootId) return;
    const { data: next } = ensureVideosRoot();
    onData(next);
    // onData is stable in the parent; re-running on it would loop the create.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId]);

  const folders = useMemo(
    () => (rootId ? childFolders(data.folders, rootId) : []),
    [data.folders, rootId],
  );

  /** Every clip anywhere in the branch, newest first. */
  const allClips = useMemo(() => {
    if (!rootId) return [];
    const ids = descendantFolderIds(data.folders, rootId);
    return data.items
      .filter((i) => i.folderId && ids.has(i.folderId) && isVideoItem(i))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [data.folders, data.items, rootId]);

  /** Clips through a sub-folder's own subtree, so nothing reads as empty. */
  const clipsIn = useCallback(
    (folderId: string) => {
      const ids = descendantFolderIds(data.folders, folderId);
      return allClips.filter((i) => i.folderId && ids.has(i.folderId));
    },
    [allClips, data.folders],
  );

  const shown = useMemo(
    () => (openId ? clipsIn(openId) : allClips),
    [openId, clipsIn, allClips],
  );

  /** Loose clips — dropped straight into Videos rather than into a folder. */
  const loose = useMemo(
    () => allClips.filter((i) => i.folderId === rootId).length,
    [allClips, rootId],
  );

  const openFolder = openId ? data.folders.find((f) => f.id === openId) ?? null : null;
  /** Where an upload lands: the open folder, or the branch root. */
  const target = openFolder?.id ?? rootId;
  const playingItem = playing ? shown.find((i) => i.id === playing) ?? null : null;

  // ----- import ------------------------------------------------------------

  async function runImport(incoming: File[]) {
    if (!incoming.length) return;
    if (!target) return onToast("The Videos folder is still being made — try again.");

    const out = await importVideos({
      files: incoming,
      folderId: target,
      onProgress: (p) =>
        setBusy(
          `${p.stage === "reading" ? "Reading" : "Storing"} ${p.index} of ${p.total} — ${p.name}`,
        ),
    });
    setBusy(null);
    onData(getData());

    const bits: string[] = [];
    if (out.added) {
      bits.push(
        `${out.added} ${out.added === 1 ? "clip" : "clips"} in ${openFolder?.name ?? VIDEOS_ROOT}`,
      );
    }
    if (out.skipped) bits.push(`${out.skipped} skipped (not video)`);
    // The reason, not a count: "2 failed" gives nothing to act on.
    for (const f of out.failed) bits.push(`${f.name}: ${f.reason}`);
    onToast(bits.length ? bits.join(" · ") : "Nothing to add");
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    void runImport(Array.from(e.dataTransfer.files ?? []));
  }

  // ----- folders -----------------------------------------------------------

  function addFolder(name: string) {
    const clean = name.trim();
    if (!clean || !rootId) return setNewFolder(null);
    const taken = folders.some((f) => f.name.toLowerCase() === clean.toLowerCase());
    if (taken) {
      onToast(`There is already a “${clean}” in Videos`);
      return setNewFolder(null);
    }
    const { data: next, folder } = createFolder({ name: clean }, rootId);
    onData(next);
    setNewFolder(null);
    setOpenId(folder.id);
    onToast(`“${clean}” created — the next clips you add land in it`);
  }

  function saveRename() {
    if (!renaming) return;
    const clean = renaming.name.trim();
    if (clean) onData(renameFolder(renaming.id, clean));
    setRenaming(null);
  }

  function removeFolder(folder: Folder) {
    const impact = folderDeleteImpact(data, folder.id);
    const inside = [
      impact.items ? `${impact.items} ${impact.items === 1 ? "clip" : "clips"}` : "",
      impact.subfolders ? `${impact.subfolders} sub-folders` : "",
    ]
      .filter(Boolean)
      .join(" and ");
    const ok = window.confirm(
      inside
        ? `Delete “${folder.name}” and the ${inside} inside it? The video files go too, and this cannot be undone.`
        : `Delete the empty folder “${folder.name}”?`,
    );
    if (!ok) return;
    onData(deleteFolder(folder.id));
    if (openId === folder.id) setOpenId(null);
    onToast(`“${folder.name}” deleted`);
  }

  // ----- one clip ----------------------------------------------------------

  async function removeClip(item: Item) {
    if (!window.confirm(`Delete “${item.title}”? The video file goes with it.`)) return;
    setPlaying(null);
    onData(await deleteVideo(item));
    onToast(`“${item.title}” deleted`);
  }

  async function download(item: Item) {
    if (!item.attachment) return;
    try {
      const kind = await downloadAttachment(item.attachment);
      onToast(kind === "original" ? "Saved to your downloads" : "Only the poster frame is on this device");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not save that file");
    }
  }

  function move(item: Item, folderId: string) {
    onData(moveItem(item.id, folderId));
    const name = folderId === rootId ? VIDEOS_ROOT : data.folders.find((f) => f.id === folderId)?.name;
    onToast(`Moved to ${name}`);
  }

  const runtime = formatDuration(totalDuration(shown));
  const weight = formatSize(totalSize(shown));

  return (
    <div className="vidb" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
      {/* Header — what is here, then the two things you do with it */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
          <Icon.Film width={16} height={16} />
        </span>
        <div className="mr-auto min-w-0">
          <p className="truncate text-sm font-semibold text-ink">
            {openFolder ? (
              <>
                <button
                  onClick={() => setOpenId(null)}
                  className="text-ink-faint transition hover:text-ink-muted"
                >
                  Videos
                </button>
                <span className="px-1 text-ink-faint">›</span>
                {openFolder.name}
              </>
            ) : (
              "Videos"
            )}
          </p>
          <p className="font-mono text-[11px] tabular-nums text-ink-muted">
            {shown.length} {shown.length === 1 ? "clip" : "clips"}
            {shown.length > 0 && ` · ${runtime} · ${weight}`}
          </p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="video/*,.mkv,.mov,.m4v,.avi"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void runImport(files);
          }}
        />
        {openFolder && (
          <button
            onClick={() => onNavigate(openFolder.id)}
            title="Open this as an ordinary Dashboard folder"
            className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:text-ink"
          >
            Open as a folder
          </button>
        )}
        <button
          onClick={() => setNewFolder("")}
          // The label is hidden on a phone, so the button needs a name of its own
          // there — an icon with a visually-hidden sibling is a button with no
          // name at all to anything that is not looking at it.
          aria-label="New video folder"
          title="New video folder"
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-2.5 py-2 text-[12px] font-medium text-ink-muted transition hover:text-ink"
        >
          <Icon.Plus width={14} height={14} />
          <span className="hidden sm:inline">New folder</span>
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={Boolean(busy)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-[13px] font-semibold text-black transition hover:bg-amber-400 disabled:opacity-40"
        >
          <Icon.Upload width={15} height={15} />
          {busy ? "Working…" : "Add videos"}
        </button>
      </div>

      {busy && (
        <div className="mb-2.5 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 px-3 py-2 font-mono text-[11px] tabular-nums text-amber-200">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
          {busy}
        </div>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row">
        {/* The shelf. Dense rows, real counts, and the folder an upload lands in
            is the one that is lit — so "Add videos" is never a guess. */}
        <div className="shrink-0 sm:w-[184px]">
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            <FolderRow
              label="All clips"
              count={allClips.length}
              runtime={formatDuration(totalDuration(allClips))}
              selected={openId === null}
              onOpen={() => setOpenId(null)}
            />
            {folders.map((f) => {
              const clips = clipsIn(f.id);
              return renaming?.id === f.id ? (
                <div key={f.id} className="border-t border-line-soft px-2 py-1.5">
                  <input
                    autoFocus
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                    onBlur={saveRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    className="w-full rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-ink outline-none focus:border-brand"
                  />
                </div>
              ) : (
                <FolderRow
                  key={f.id}
                  label={f.name}
                  count={clips.length}
                  runtime={formatDuration(totalDuration(clips))}
                  selected={openId === f.id}
                  onOpen={() => setOpenId(f.id)}
                  onRename={() => setRenaming({ id: f.id, name: f.name })}
                  onDelete={() => removeFolder(f)}
                />
              );
            })}
            {newFolder !== null && (
              <div className="border-t border-line-soft px-2 py-1.5">
                <input
                  autoFocus
                  value={newFolder}
                  placeholder="Folder name"
                  onChange={(e) => setNewFolder(e.target.value)}
                  onBlur={() => addFolder(newFolder)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addFolder(newFolder);
                    if (e.key === "Escape") setNewFolder(null);
                  }}
                  className="w-full rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-brand"
                />
              </div>
            )}
          </div>
          {loose > 0 && openId === null && folders.length > 0 && (
            <p className="mt-1.5 px-1 text-[10.5px] leading-relaxed text-ink-faint">
              {loose} {loose === 1 ? "clip sits" : "clips sit"} loose in Videos. Open one and change
              its folder below the player, or pick a folder here before adding the next batch.
            </p>
          )}
        </div>

        {/* The wall */}
        <div className="min-w-0 flex-1">
          {shown.length === 0 ? (
            <div
              className={
                "rounded-2xl border border-dashed px-6 py-12 text-center transition " +
                (dragOver ? "border-amber-400/70 bg-amber-400/[0.06]" : "border-line bg-panel/40")
              }
            >
              <Icon.Film width={26} height={26} className="mx-auto mb-2 text-ink-faint" />
              <p className="text-sm font-medium text-ink">
                {openFolder ? `Nothing in ${openFolder.name} yet` : "No clips yet"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[11.5px] leading-relaxed text-ink-muted">
                Drop video files here, or press <strong className="text-ink-muted">Add videos</strong>
                . They are stored on this device and backed up with everything else — nothing reads
                them, so no folder rules and no review queue: the folder you pick is where they go.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((it) => (
                <ClipTile
                  key={it.id}
                  item={it}
                  folderName={
                    openId === null && it.folderId !== rootId
                      ? data.folders.find((f) => f.id === it.folderId)?.name
                      : undefined
                  }
                  onPlay={() => setPlaying(it.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {playingItem && (
        <Player
          item={playingItem}
          folders={[
            ...(rootId ? [{ id: rootId, name: VIDEOS_ROOT }] : []),
            ...folders.map((f) => ({ id: f.id, name: f.name })),
          ]}
          onClose={() => setPlaying(null)}
          onStep={(dir) => {
            const i = shown.findIndex((x) => x.id === playingItem.id);
            const next = shown[i + dir];
            if (next) setPlaying(next.id);
          }}
          hasPrev={shown.findIndex((x) => x.id === playingItem.id) > 0}
          hasNext={shown.findIndex((x) => x.id === playingItem.id) < shown.length - 1}
          onMove={(folderId) => move(playingItem, folderId)}
          onDownload={() => void download(playingItem)}
          onDelete={() => void removeClip(playingItem)}
        />
      )}
    </div>
  );
}

// ----- the shelf -----------------------------------------------------------

function FolderRow({
  label,
  count,
  runtime,
  selected,
  onOpen,
  onRename,
  onDelete,
}: {
  label: string;
  count: number;
  runtime: string;
  selected: boolean;
  onOpen: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={
        "group/row relative flex items-center border-t border-line-soft first:border-t-0 transition " +
        (selected ? "bg-amber-400/[0.08]" : "hover:bg-panel-2")
      }
    >
      {/* Armed is a lit edge, not a colour wash — the same grammar the rail uses */}
      <span
        aria-hidden
        className={"absolute inset-y-0 left-0 w-[2px] " + (selected ? "bg-amber-400" : "bg-transparent")}
      />
      <button onClick={onOpen} className="min-w-0 flex-1 px-2.5 py-1.5 text-left">
        <span
          className={
            "block truncate text-[12px] font-medium " + (selected ? "text-ink" : "text-ink-muted")
          }
        >
          {label}
        </span>
        <span className="block font-mono text-[10px] tabular-nums text-ink-faint">
          {count === 0 ? "empty" : `${count} · ${runtime}`}
        </span>
      </button>
      {onRename && (
        <span className="flex shrink-0 items-center gap-0.5 pr-1.5 opacity-0 transition group-hover/row:opacity-100 focus-within:opacity-100">
          <button
            onClick={onRename}
            aria-label={`Rename ${label}`}
            title="Rename"
            className="rounded-md p-1 text-ink-faint transition hover:text-ink"
          >
            <Icon.Edit width={11} height={11} />
          </button>
          <button
            onClick={onDelete}
            aria-label={`Delete ${label}`}
            title="Delete folder"
            className="rounded-md p-1 text-ink-faint transition hover:text-red-400"
          >
            <Icon.Trash width={11} height={11} />
          </button>
        </span>
      )}
    </div>
  );
}

// ----- one tile ------------------------------------------------------------

function ClipTile({
  item,
  folderName,
  onPlay,
}: {
  item: Item;
  folderName?: string;
  onPlay: () => void;
}) {
  const seconds = durationOf(item);
  return (
    <button
      onClick={onPlay}
      title={item.title}
      className="group/clip block w-full overflow-hidden rounded-xl border border-line-soft bg-panel text-left transition hover:border-line"
    >
      <span className="relative block aspect-video overflow-hidden bg-canvas">
        {item.attachment?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.attachment.url}
            alt=""
            className="h-full w-full object-cover transition duration-200 group-hover/clip:brightness-[0.72]"
          />
        ) : (
          // A codec the browser could not decode a frame from. Say that on the
          // tile rather than showing an empty box that looks like a broken file.
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink-faint">
            <Icon.Film width={18} height={18} />
            <span className="text-[9.5px]">no preview frame</span>
          </span>
        )}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition duration-200 group-hover/clip:opacity-100">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
            <Icon.Play width={15} height={15} />
          </span>
        </span>
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white">
          {formatDuration(seconds)}
        </span>
      </span>
      <span className="block px-2 py-1.5">
        <span className="block truncate text-[11.5px] font-medium text-ink">{item.title}</span>
        <span className="block truncate font-mono text-[10px] tabular-nums text-ink-faint">
          {formatSize(item.attachment?.size)}
          {item.fields?.resolution ? ` · ${item.fields.resolution}` : ""}
          {folderName ? ` · ${folderName}` : ""}
        </span>
      </span>
    </button>
  );
}

// ----- the player ----------------------------------------------------------

/**
 * Full-surface playback. A clip is the one thing on this screen that wants the
 * room to itself — everything else is a list, and a 200px video inside a list is
 * not watching anything.
 *
 * The blob is pulled out of IndexedDB and handed to the element as an object
 * URL, revoked when the clip changes or the overlay closes. Leaking these is how
 * a tab holding a gigabyte of video never gives it back.
 */
function Player({
  item,
  folders,
  hasPrev,
  hasNext,
  onClose,
  onStep,
  onMove,
  onDownload,
  onDelete,
}: {
  item: Item;
  folders: { id: string; name: string }[];
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  onMove: (folderId: string) => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let live = true;
    setSrc(null);
    setError(null);
    const fileId = item.attachment?.fileId;
    if (!fileId) {
      setError("This clip has no stored file.");
      return;
    }
    void getFile(fileId)
      .then((blob) => {
        if (!live) return;
        if (!blob) {
          // The item syncs across devices; the bytes never leave the browser
          // they were imported in. Say which of the two this is.
          setError("The video file is on the device you imported it from, not this one.");
          return;
        }
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => live && setError("This browser would not open the stored file."));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.id, item.attachment?.fileId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // Left and right belong to the video's own scrubbing once it has focus.
      const onControls = (e.target as HTMLElement | null)?.tagName === "VIDEO";
      if (onControls) return;
      if (e.key === "ArrowLeft" && hasPrev) onStep(-1);
      if (e.key === "ArrowRight" && hasNext) onStep(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep, hasPrev, hasNext]);

  const facts = [
    formatDuration(durationOf(item)),
    formatSize(item.attachment?.size),
    item.fields?.resolution,
    new Date(item.createdAt).toLocaleDateString(),
  ].filter((f): f is string => Boolean(f) && f !== "—");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      className="fixed inset-0 z-50 flex flex-col bg-canvas/95 p-3 backdrop-blur-sm sm:p-5"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel"
      >
        <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2">
          <div className="mr-auto min-w-0">
            <p className="truncate text-[13px] font-semibold text-ink">{item.title}</p>
            <p className="truncate font-mono text-[10.5px] tabular-nums text-ink-faint">
              {facts.join(" · ")}
            </p>
          </div>
          <button
            onClick={() => onStep(-1)}
            disabled={!hasPrev}
            aria-label="Previous clip"
            title="Previous clip (←)"
            className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:text-ink disabled:opacity-30"
          >
            <Icon.ArrowLeft width={13} height={13} />
          </button>
          <button
            onClick={() => onStep(1)}
            disabled={!hasNext}
            aria-label="Next clip"
            title="Next clip (→)"
            className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:text-ink disabled:opacity-30"
          >
            <Icon.ArrowRight width={13} height={13} />
          </button>
          <button
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:text-ink"
          >
            <Icon.Close width={13} height={13} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-canvas p-2">
          {error ? (
            <div className="px-6 py-10 text-center">
              <Icon.Film width={24} height={24} className="mx-auto mb-2 text-ink-faint" />
              <p className="text-[12.5px] text-ink">{error}</p>
              {item.attachment?.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.attachment.url}
                  alt=""
                  className="mx-auto mt-3 max-h-56 rounded-lg border border-line-soft"
                />
              )}
            </div>
          ) : src ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              key={item.id}
              src={src}
              controls
              autoPlay
              playsInline
              poster={item.attachment?.url}
              // Fills the stage rather than sitting at its natural size: a
              // phone clip is 1080 wide and a screen recording can be 320, and
              // a 320px video marooned in the middle of a black pane reads as a
              // broken player rather than a small file.
              className="h-full w-full rounded-lg object-contain"
              onError={() =>
                setError(
                  `This browser cannot play ${item.attachment?.name?.split(".").pop()?.toUpperCase() ?? "this format"}. Save it and open it in a player.`,
                )
              }
            />
          ) : (
            <p className="font-mono text-[11px] text-ink-faint">Opening the file…</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-soft px-3 py-2">
          {/* All of it right-aligned: the assistant's voice avatar is pinned to
              the bottom-left corner of every screen in the app and would sit on
              top of anything placed there. */}
          <label className="flex items-center gap-1.5 text-[11px] text-ink-faint">
            Folder
            <select
              value={item.folderId ?? ""}
              onChange={(e) => onMove(e.target.value)}
              className="rounded-md border border-line bg-canvas px-2 py-1 text-[11.5px] text-ink outline-none focus:border-brand"
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={onDownload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-ink-muted transition hover:text-ink"
          >
            <Icon.Download width={13} height={13} /> Save a copy
          </button>
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-ink-muted transition hover:border-red-400/40 hover:text-red-400"
          >
            <Icon.Trash width={13} height={13} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
