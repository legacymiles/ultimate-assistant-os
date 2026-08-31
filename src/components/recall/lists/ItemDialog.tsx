"use client";

import { useEffect, useState } from "react";
import { Icon } from "../../icons";
import { ListIcon } from "./bits";
import {
  PRIORITIES,
  type ListDef,
  type ListItem,
  type Priority,
} from "@/lib/recall/lists/types";

// ---------------------------------------------------------------------------
// The full form for one item.
//
// The fast path is typing straight into a tile; this is for when an item needs
// a tier, a note, a date or a link. Priority is picked with its meaning next to
// it, because three colours only stay meaningful if everyone reads them the
// same way.
// ---------------------------------------------------------------------------

export interface ItemDraft {
  listId: string;
  text: string;
  priority: Priority;
  note: string;
  dueDate: string;
  url: string;
}

interface Props {
  lists: ListDef[];
  /** Editing an existing row, or null when adding a new one. */
  item: ListItem | null;
  defaultListId: string;
  busy?: boolean;
  onSubmit: (draft: ItemDraft) => void;
  onClose: () => void;
}

export function ItemDialog({ lists, item, defaultListId, busy, onSubmit, onClose }: Props) {
  const [draft, setDraft] = useState<ItemDraft>({
    listId: item?.listId ?? defaultListId,
    text: item?.text ?? "",
    priority: item?.priority ?? null,
    note: item?.note ?? "",
    dueDate: item?.dueDate ?? "",
    url: item?.url ?? "",
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.text.trim()) return;
    onSubmit(draft);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-line bg-panel p-4 shadow-2xl sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{item ? "Edit item" : "Add an item"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-faint hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Close width={14} height={14} />
          </button>
        </div>

        <input
          autoFocus
          required
          value={draft.text}
          onChange={(e) => set("text", e.target.value)}
          placeholder="Milk, bread, washing-up liquid"
          aria-label="What is it"
          className="mb-3 w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
        />

        <fieldset className="mb-3">
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Priority
          </legend>
          <div className="grid grid-cols-2 gap-1.5">
            {PRIORITIES.map((p) => {
              const value: Priority = p.id === "none" ? null : p.id;
              const active = draft.priority === value;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => set("priority", value)}
                  className={
                    "flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition " +
                    (active ? p.chip : "border-line bg-canvas text-ink-muted hover:border-ink-faint")
                  }
                >
                  <span className={"h-2.5 w-2.5 shrink-0 rounded-full " + p.dot} />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium">{p.label}</span>
                    <span className="block truncate text-[10px] text-ink-faint">{p.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="mb-3 block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            List
          </span>
          <div className="flex flex-wrap gap-1.5">
            {lists.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => set("listId", l.id)}
                className={
                  "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] transition " +
                  (draft.listId === l.id
                    ? "border-brand bg-brand/15 text-brand"
                    : "border-line text-ink-muted hover:text-ink")
                }
              >
                <ListIcon name={l.icon} width={12} height={12} />
                {l.name}
              </button>
            ))}
          </div>
        </label>

        <label className="mb-3 block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Note <span className="font-normal normal-case text-ink-faint/70">optional</span>
          </span>
          <textarea
            rows={2}
            value={draft.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="The blue ones, not the green"
            className="w-full resize-none rounded-xl border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
          />
        </label>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Due <span className="font-normal normal-case text-ink-faint/70">optional</span>
            </span>
            <input
              type="date"
              value={draft.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
              className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Link <span className="font-normal normal-case text-ink-faint/70">optional</span>
            </span>
            <input
              type="url"
              inputMode="url"
              value={draft.url}
              onChange={(e) => set("url", e.target.value)}
              placeholder="https://…"
              className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
          </label>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !draft.text.trim()}
            className="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:opacity-50"
          >
            {item ? "Save" : "Add"}
          </button>
        </div>
      </form>
    </div>
  );
}
