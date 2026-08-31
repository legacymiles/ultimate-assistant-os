"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { createItem, deleteItem, toggleTodo, updateItem } from "@/lib/recall/store";
import { relativeTime } from "@/lib/utils";
import type { Item, RecallData } from "@/lib/recall/types";
import { Row, RowAction } from "./Section";

// ---------------------------------------------------------------------------
// Notes & Ideas / To-Do List.
// Links & Resources lives in LinksSection.tsx — it carries files, so it earns
// its own file.
// Each adds inline — one field, Enter, done — because the point of the folder
// page is that capturing into it never costs a modal.
// ---------------------------------------------------------------------------

function InlineAdd({
  placeholder,
  onSubmit,
  onCancel,
  busy,
}: {
  placeholder: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="flex items-center gap-2 px-2 py-1">
      <input
        autoFocus
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
          if (e.key === "Escape") onCancel();
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg border border-brand/40 bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand disabled:opacity-50"
      />
      <button
        onClick={() => value.trim() && onSubmit(value.trim())}
        disabled={busy || !value.trim()}
        className="rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
      >
        {busy ? "…" : "Add"}
      </button>
      <button onClick={onCancel} className="rounded-lg p-1 text-ink-faint hover:text-ink" aria-label="Cancel">
        <Icon.Close width={14} height={14} />
      </button>
    </div>
  );
}

// ----- notes ---------------------------------------------------------------

export function NotesBody({
  items,
  folderId,
  adding,
  onAddingChange,
  onOpen,
  onData,
  onToast,
}: {
  items: Item[];
  folderId: string | null;
  adding: boolean;
  onAddingChange: (v: boolean) => void;
  onOpen: (item: Item) => void;
  onData: (d: RecallData) => void;
  onToast: (m: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      {items.map((it) => (
        <Row
          key={it.id}
          onClick={() => onOpen(it)}
          actions={
            <RowAction
              label="Delete"
              danger
              onClick={() => {
                if (window.confirm(`Delete “${it.title}”?`)) {
                  onData(deleteItem(it.id));
                  onToast("Deleted");
                }
              }}
            >
              <Icon.Trash width={13} height={13} />
            </RowAction>
          }
        >
          {it.kind === "image" && it.attachment?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.attachment.url} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
          ) : (
            <Icon.File width={13} height={13} className="shrink-0 text-ink-faint" />
          )}
          <span className="shrink-0 text-[13px] text-ink">{it.title}</span>
          <span className="min-w-0 truncate text-[11px] text-ink-faint">{it.summary || it.body}</span>
          <span className="ml-auto shrink-0 pl-2 text-[10px] text-ink-faint">
            {relativeTime(it.createdAt)}
          </span>
        </Row>
      ))}
      {adding && (
        <InlineAdd
          placeholder="Note title — open it after to add the detail"
          onCancel={() => onAddingChange(false)}
          onSubmit={(title) => {
            const { data } = createItem({
              title,
              body: "",
              summary: "",
              kind: "note",
              source: "manual",
              folderId,
              tags: [],
            });
            onAddingChange(false);
            onData(data);
            onToast("Note added");
          }}
        />
      )}
    </div>
  );
}

// ----- to-dos --------------------------------------------------------------

export function TodosBody({
  items,
  folderId,
  adding,
  onAddingChange,
  onData,
  onToast,
}: {
  items: Item[];
  folderId: string | null;
  adding: boolean;
  onAddingChange: (v: boolean) => void;
  onData: (d: RecallData) => void;
  onToast: (m: string) => void;
}) {
  // Open tasks first, done ones sink to the bottom.
  const sorted = [...items].sort((a, b) => Number(a.done ?? false) - Number(b.done ?? false));

  return (
    <div className="space-y-0.5">
      {sorted.map((it) => (
        <Row
          key={it.id}
          tone={it.done ? "muted" : "default"}
          onClick={() => onData(toggleTodo(it.id))}
          actions={
            <RowAction label="Delete" danger onClick={() => onData(deleteItem(it.id))}>
              <Icon.Trash width={13} height={13} />
            </RowAction>
          }
        >
          <span className={it.done ? "shrink-0 text-brand" : "shrink-0 text-ink-faint"}>
            {it.done ? <Icon.Check2 width={14} height={14} /> : <Icon.Square width={14} height={14} />}
          </span>
          <span className={"min-w-0 truncate text-[13px] " + (it.done ? "text-ink-faint line-through" : "text-ink")}>
            {it.title}
          </span>
        </Row>
      ))}
      {adding && (
        <InlineAdd
          placeholder="What needs doing?"
          onCancel={() => onAddingChange(false)}
          onSubmit={(title) => {
            const { data } = createItem({
              title,
              body: "",
              summary: "",
              kind: "todo",
              source: "manual",
              folderId,
              tags: [],
              done: false,
            });
            onData(data);
            onToast("Task added");
            // Stay open — adding several in a row is the common case.
          }}
        />
      )}
    </div>
  );
}

/** Rename helper shared by the workspace header. */
export function renameItemPrompt(item: Item, onData: (d: RecallData) => void) {
  const next = window.prompt("Rename", item.title);
  if (next?.trim()) onData(updateItem(item.id, { title: next.trim() }));
}
