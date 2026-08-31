"use client";

import { useMemo } from "react";
import { Icon } from "../icons";
import { SUB_ACCENTS, accentsFor } from "@/lib/recall/accents";
import type { Folder } from "@/lib/recall/types";
import { FolderIcon } from "./FolderDialog";

/**
 * Sub-folders as tiles inside the folder, not rows in a sidebar tree.
 * Twenty of them cost four tidy rows here and zero permanent chrome — which is
 * how the folder page stays minimal no matter how deep the structure gets.
 */

interface Props {
  folders: Folder[];
  countFor: (folderId: string) => number;
  onOpen: (folderId: string) => void;
  onDelete: (folder: Folder) => void;
  onRename: (folder: Folder) => void;
  onAdd: () => void;
}

export function SubfolderGrid({ folders, countFor, onOpen, onDelete, onRename, onAdd }: Props) {
  const accents = useMemo(
    () => accentsFor(folders.map((f) => f.id), SUB_ACCENTS, 4),
    [folders],
  );

  return (
    <div className="grid grid-cols-2 gap-2 px-1 sm:grid-cols-3 lg:grid-cols-4">
      {folders.map((f, i) => {
        const a = accents[i];
        const n = countFor(f.id);
        return (
          <div key={f.id} className="group/tile relative">
            <button
              onClick={() => onOpen(f.id)}
              className={
                "flex h-[86px] w-full flex-col justify-between rounded-xl border bg-gradient-to-br p-3 text-left transition hover:brightness-125 " +
                a.tile
              }
            >
              <FolderIcon name={f.icon} width={18} height={18} className={a.ink} />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-ink">{f.name}</p>
                <p className="text-[10px] tabular-nums text-ink-faint">
                  {n} {n === 1 ? "item" : "items"}
                </p>
              </div>
            </button>
            <div className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition group-hover/tile:opacity-100">
              <button
                onClick={() => onRename(f)}
                title="Rename"
                aria-label={`Rename ${f.name}`}
                className="rounded-md bg-canvas/70 p-1 text-ink-faint backdrop-blur hover:text-ink"
              >
                <Icon.Edit width={12} height={12} />
              </button>
              <button
                onClick={() => onDelete(f)}
                title="Delete"
                aria-label={`Delete ${f.name}`}
                className="rounded-md bg-canvas/70 p-1 text-ink-faint backdrop-blur hover:text-red-400"
              >
                <Icon.Trash width={12} height={12} />
              </button>
            </div>
          </div>
        );
      })}

      <button
        onClick={onAdd}
        className="flex h-[86px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-ink-faint transition hover:border-brand/50 hover:text-brand"
      >
        <Icon.Plus width={16} height={16} />
        <span className="text-[11px] font-medium">New folder</span>
      </button>
    </div>
  );
}
