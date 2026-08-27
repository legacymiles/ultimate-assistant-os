"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "../icons";
import { childFolders, descendantFolderIds } from "@/lib/recall/store";
import type { Folder, Item } from "@/lib/recall/types";

export const ALL = "all";
export const UNFILED = "__unfiled__";

interface Props {
  folders: Folder[];
  items: Item[];
  selected: string;
  onSelect: (id: string) => void;
  onDelete: (folder: Folder) => void;
}

export function FolderTree({ folders, items, selected, onSelect, onDelete }: Props) {
  const unfiledCount = useMemo(() => items.filter((i) => !i.folderId).length, [items]);
  const roots = useMemo(() => childFolders(folders, null), [folders]);

  return (
    <nav className="flex flex-col gap-0.5 text-sm">
      <Row
        icon={<Icon.Layers width={15} height={15} />}
        label="All items"
        count={items.length}
        active={selected === ALL}
        depth={0}
        onClick={() => onSelect(ALL)}
      />
      {roots.map((f) => (
        <FolderNode
          key={f.id}
          folder={f}
          folders={folders}
          items={items}
          selected={selected}
          onSelect={onSelect}
          onDelete={onDelete}
          depth={0}
        />
      ))}
      {unfiledCount > 0 && (
        <Row
          icon={<Icon.Inbox width={15} height={15} />}
          label="Unfiled"
          count={unfiledCount}
          active={selected === UNFILED}
          depth={0}
          onClick={() => onSelect(UNFILED)}
        />
      )}
    </nav>
  );
}

function FolderNode({
  folder,
  folders,
  items,
  selected,
  onSelect,
  onDelete,
  depth,
}: {
  folder: Folder;
  folders: Folder[];
  items: Item[];
  selected: string;
  onSelect: (id: string) => void;
  onDelete: (folder: Folder) => void;
  depth: number;
}) {
  const kids = useMemo(() => childFolders(folders, folder.id), [folders, folder.id]);
  const count = useMemo(() => {
    const ids = descendantFolderIds(folders, folder.id);
    return items.filter((i) => i.folderId && ids.has(i.folderId)).length;
  }, [folders, items, folder.id]);
  const [open, setOpen] = useState(depth === 0);

  return (
    <div>
      <Row
        icon={
          kids.length ? (
            open ? <Icon.FolderOpen width={15} height={15} /> : <Icon.Folder width={15} height={15} />
          ) : (
            <Icon.Folder width={15} height={15} />
          )
        }
        label={folder.name}
        count={count}
        active={selected === folder.id}
        depth={depth}
        hasChildren={kids.length > 0}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        onClick={() => onSelect(folder.id)}
        onDelete={() => onDelete(folder)}
      />
      {open &&
        kids.map((k) => (
          <FolderNode
            key={k.id}
            folder={k}
            folders={folders}
            items={items}
            selected={selected}
            onSelect={onSelect}
            onDelete={onDelete}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

function Row({
  icon,
  label,
  count,
  active,
  depth,
  hasChildren,
  open,
  onToggle,
  onClick,
  onDelete,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  active: boolean;
  depth: number;
  hasChildren?: boolean;
  open?: boolean;
  onToggle?: () => void;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={
        "group flex items-center gap-1 rounded-lg pr-1.5 transition " +
        (active ? "bg-brand/15 text-brand" : "text-ink-muted hover:bg-panel-2 hover:text-ink")
      }
      style={{ paddingLeft: 6 + depth * 14 }}
    >
      {hasChildren ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
          className="flex h-5 w-4 shrink-0 items-center justify-center text-ink-faint hover:text-ink"
          aria-label={open ? "Collapse" : "Expand"}
        >
          <Icon.Chevron width={13} height={13} className={"transition " + (open ? "rotate-90" : "")} />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
        <span className={active ? "text-brand" : "text-ink-faint"}>{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      <span className="shrink-0 text-[11px] tabular-nums text-ink-faint group-hover:hidden">{count}</span>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="hidden shrink-0 rounded p-1 text-ink-faint hover:text-red-400 group-hover:block"
          aria-label={`Delete ${label}`}
          title="Delete folder"
        >
          <Icon.Trash width={13} height={13} />
        </button>
      )}
    </div>
  );
}
