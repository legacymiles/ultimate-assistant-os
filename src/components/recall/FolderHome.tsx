"use client";

import { useMemo } from "react";
import { Icon } from "../icons";
import { childFolders, descendantFolderIds } from "@/lib/recall/store";
import type { Folder, RecallData } from "@/lib/recall/types";
import { HOME_ACCENTS, accentsFor } from "@/lib/recall/accents";
import { FolderIcon } from "./FolderDialog";

// ---------------------------------------------------------------------------
// Home.
// Folders and nothing else. No sections, no rows, no counts competing for
// attention — you pick a folder, and everything it holds is one click in.
// ---------------------------------------------------------------------------

interface Props {
  data: RecallData;
  onOpen: (folderId: string | null) => void;
  onNewFolder: () => void;
  onEditFolder: (folder: Folder) => void;
  onMoveFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  /** Opens the loose-items view when something sits outside every folder. */
  onOpenUnfiled: () => void;
  /** Switches to the Photos tab — the camera roll has its own surface. */
  onOpenPhotos: () => void;
}

export function FolderHome({
  data,
  onOpen,
  onNewFolder,
  onEditFolder,
  onMoveFolder,
  onDeleteFolder,
  onOpenUnfiled,
  onOpenPhotos,
}: Props) {
  const allRoots = childFolders(data.folders, null);
  /**
   * Photos is lifted out of the ordinary grid. It is the one folder that is
   * not just a container — it has a review queue, a people list and a backup —
   * so it gets its own warm tile that opens that surface rather than a folder
   * page, and it always leads.
   */
  const photosFolder = allRoots.find(
    (f) => f.role === "photos" || f.name.toLowerCase() === "photos",
  );
  const roots = allRoots.filter((f) => f.id !== photosFolder?.id);
  const photoCount = useMemo(() => {
    if (!photosFolder) return 0;
    const ids = descendantFolderIds(data.folders, photosFolder.id);
    return data.items.filter((i) => i.folderId && ids.has(i.folderId)).length;
  }, [data, photosFolder]);
  const unfiled = data.items.filter((i) => !i.folderId).length;
  const accents = useMemo(() => accentsFor(roots.map((f) => f.id), HOME_ACCENTS), [roots]);

  const countFor = (id: string) => {
    const ids = descendantFolderIds(data.folders, id);
    return data.items.filter((i) => i.folderId && ids.has(i.folderId)).length;
  };

  if (roots.length === 0 && unfiled === 0 && !photosFolder) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-panel/40 px-6 py-20 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15 text-brand">
          <Icon.Folder width={22} height={22} />
        </div>
        <h2 className="text-base font-semibold text-ink">Start with a folder</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-muted">
          Name it after something real — a project, a market, a client. Open it and it holds
          sub-folders, notes, to-dos, links &amp; files, logins and websites.
        </p>
        <button
          onClick={onNewFolder}
          className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
        >
          <Icon.Plus width={16} height={16} /> Create your first folder
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {photosFolder && (
        <button
          onClick={onOpenPhotos}
          className="flex h-[190px] flex-col items-center justify-center gap-3 rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/35 via-amber-500/10 to-transparent px-5 text-center transition hover:brightness-125"
        >
          <Icon.Image width={40} height={40} className="text-amber-200" />
          <div className="min-w-0">
            <p className="truncate text-base font-bold tracking-tight text-ink">Photos</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
              Sorted by who&apos;s in them, with the rest filed or put on your calendar
            </p>
            <p className="mt-1.5 text-[10px] tabular-nums text-ink-faint">
              {photoCount} {photoCount === 1 ? "photo" : "photos"}
            </p>
          </div>
        </button>
      )}

      {roots.map((f, i) => {
        const a = accents[i];
        const n = countFor(f.id);
        const subs = childFolders(data.folders, f.id).length;
        return (
          <div key={f.id} className="group/tile relative">
            <button
              onClick={() => onOpen(f.id)}
              className={
                "flex h-[190px] w-full flex-col items-center justify-center gap-3 rounded-2xl border bg-gradient-to-br px-5 text-center transition hover:brightness-125 " +
                a.tile
              }
            >
              <FolderIcon name={f.icon} width={40} height={40} className={a.ink} />
              <div className="min-w-0">
                <p className="truncate text-base font-bold tracking-tight text-ink">{f.name}</p>
                {f.description && (
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-muted">
                    {f.description}
                  </p>
                )}
                <p className="mt-1.5 text-[10px] tabular-nums text-ink-faint">
                  {n} {n === 1 ? "item" : "items"}
                  {subs > 0 && ` · ${subs} sub-${subs === 1 ? "folder" : "folders"}`}
                </p>
              </div>
            </button>
            <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition group-hover/tile:opacity-100">
              <button
                onClick={() => onEditFolder(f)}
                title="Edit folder"
                aria-label={`Edit ${f.name}`}
                className="rounded-md bg-canvas/70 p-1.5 text-ink-faint backdrop-blur hover:text-ink"
              >
                <Icon.Edit width={13} height={13} />
              </button>
              <button
                onClick={() => onMoveFolder(f)}
                title="Move folder"
                aria-label={`Move ${f.name}`}
                className="rounded-md bg-canvas/70 p-1.5 text-ink-faint backdrop-blur hover:text-ink"
              >
                <Icon.Move width={13} height={13} />
              </button>
              <button
                onClick={() => onDeleteFolder(f)}
                title="Delete folder"
                aria-label={`Delete ${f.name}`}
                className="rounded-md bg-canvas/70 p-1.5 text-ink-faint backdrop-blur hover:text-red-400"
              >
                <Icon.Trash width={13} height={13} />
              </button>
            </div>
          </div>
        );
      })}

      {/* Only appears when something is genuinely loose — never a permanent tile */}
      {unfiled > 0 && (
        <button
          onClick={onOpenUnfiled}
          className="flex h-[190px] flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-panel/60 px-5 text-center transition hover:border-brand/40"
        >
          <Icon.Inbox width={40} height={40} className="text-ink-faint" />
          <div>
            <p className="text-base font-bold tracking-tight text-ink">Unfiled</p>
            <p className="mt-1 text-[11px] text-ink-muted">Captured but not in a folder yet</p>
            <p className="mt-1.5 text-[10px] tabular-nums text-ink-faint">
              {unfiled} {unfiled === 1 ? "item" : "items"}
            </p>
          </div>
        </button>
      )}

      <button
        onClick={onNewFolder}
        className="flex h-[190px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-ink-faint transition hover:border-brand/50 hover:text-brand"
      >
        <Icon.Plus width={22} height={22} />
        <span className="text-xs font-medium">New folder</span>
      </button>
    </div>
  );
}
