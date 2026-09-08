"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { FolderIcon } from "./FolderDialog";
import { folderPathString } from "@/lib/recall/store";
import type { Folder } from "@/lib/recall/types";

// ---------------------------------------------------------------------------
// Move a folder under a different parent.
//
// This existed only as an assistant action until now: `moveFolder` was in the
// store, the agent could propose it, and no button anywhere called it — so
// reorganising the tree meant asking the AI, and if no model was configured
// there was no way to do it at all.
//
// Descendants are removed from the list rather than rejected on submit. The
// store's `wouldCycle` already refuses those moves *silently*, so offering one
// would produce a button that appears to work and does nothing.
// ---------------------------------------------------------------------------

interface Props {
  folder: Folder;
  folders: Folder[];
  onMove: (parentId: string | null) => void;
  onClose: () => void;
}

export function MoveFolderDialog({ folder, folders, onMove, onClose }: Props) {
  const [parentId, setParentId] = useState<string | null>(folder.parentId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The folder itself, plus everything beneath it, cannot be its own parent.
  const options = useMemo(() => {
    const banned = new Set<string>([folder.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of folders) {
        if (f.parentId && banned.has(f.parentId) && !banned.has(f.id)) {
          banned.add(f.id);
          grew = true;
        }
      }
    }
    return folders
      .filter((f) => !banned.has(f.id))
      .map((f) => ({ id: f.id, path: folderPathString(folders, f.id), icon: f.icon }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [folders, folder.id]);

  const hidden = folders.length - 1 - options.length;
  const unchanged = parentId === folder.parentId;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-[14vh]"
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-full max-w-md rounded-2xl border border-line bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/15 text-brand">
            <Icon.Move width={15} height={15} />
          </span>
          <span className="text-sm font-semibold text-ink">Move “{folder.name}”</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg p-1 text-ink-faint hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Close width={15} height={15} />
          </button>
        </div>

        <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">
          Currently at{" "}
          <span className="text-ink">{folderPathString(folders, folder.id)}</span>. Everything
          inside moves with it — nothing is lost.
        </p>

        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          New location
        </label>

        <div className="max-h-64 overflow-y-auto rounded-xl border border-line bg-canvas p-1">
          <button
            onClick={() => setParentId(null)}
            aria-pressed={parentId === null}
            className={
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition " +
              (parentId === null
                ? "bg-brand/15 text-brand"
                : "text-ink-muted hover:bg-panel-2 hover:text-ink")
            }
          >
            <Icon.Home width={13} height={13} />
            Top level
          </button>
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => setParentId(o.id)}
              aria-pressed={parentId === o.id}
              className={
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition " +
                (parentId === o.id
                  ? "bg-brand/15 text-brand"
                  : "text-ink-muted hover:bg-panel-2 hover:text-ink")
              }
            >
              <FolderIcon name={o.icon} width={13} height={13} />
              <span className="truncate">{o.path}</span>
            </button>
          ))}
        </div>

        {hidden > 0 && (
          <p className="mt-2 text-[10px] text-ink-faint">
            {hidden} sub-folder{hidden === 1 ? "" : "s"} of this folder {hidden === 1 ? "is" : "are"}{" "}
            hidden — a folder cannot move inside itself.
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-line px-3 py-2 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onMove(parentId);
              onClose();
            }}
            disabled={unchanged}
            className="rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {unchanged ? "Already here" : "Move folder"}
          </button>
        </div>
      </div>
    </div>
  );
}
