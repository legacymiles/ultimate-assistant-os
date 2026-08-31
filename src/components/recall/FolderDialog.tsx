"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";

// ---------------------------------------------------------------------------
// Create / edit a folder.
// Name is required; a one-line blurb and an icon are optional but they are what
// make the home grid readable at a glance instead of a wall of identical tiles.
// ---------------------------------------------------------------------------

export const FOLDER_ICONS: Record<string, typeof Icon.Folder> = {
  folder: Icon.Folder,
  spark: Icon.Sparkles,
  layers: Icon.Layers,
  globe: Icon.Globe,
  server: Icon.Server,
  database: Icon.Database,
  film: Icon.Film,
  star: Icon.Star,
  key: Icon.Key,
  bot: Icon.Bot,
  tag: Icon.Tag,
  check: Icon.Check2,
};

export function FolderIcon({ name, ...props }: { name?: string } & Record<string, unknown>) {
  const Cmp = FOLDER_ICONS[name ?? "folder"] ?? Icon.Folder;
  return <Cmp {...props} />;
}

export interface FolderDraft {
  name: string;
  description?: string;
  icon?: string;
}

interface Props {
  title: string;
  confirmLabel: string;
  initial?: FolderDraft;
  onSubmit: (draft: FolderDraft) => void;
  onClose: () => void;
}

export function FolderDialog({ title, confirmLabel, initial, onSubmit, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "folder");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit() {
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: description.trim() || undefined, icon });
    onClose();
  }

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
            <FolderIcon name={icon} width={15} height={15} />
          </span>
          <span className="text-sm font-semibold text-ink">{title}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg p-1 text-ink-faint hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Close width={15} height={15} />
          </button>
        </div>

        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          Name
        </label>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="TRADING FX"
          className="mb-3 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
        />

        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          Description <span className="normal-case tracking-normal text-ink-faint/70">optional</span>
        </label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="What lives in here"
          className="mb-3 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
        />

        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          Icon
        </label>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(FOLDER_ICONS).map((key) => (
            <button
              key={key}
              onClick={() => setIcon(key)}
              aria-label={key}
              aria-pressed={icon === key}
              className={
                "flex h-8 w-8 items-center justify-center rounded-lg border transition " +
                (icon === key
                  ? "border-brand bg-brand/15 text-brand"
                  : "border-line text-ink-faint hover:text-ink")
              }
            >
              <FolderIcon name={key} width={15} height={15} />
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
