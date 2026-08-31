"use client";

import { useState } from "react";
import { Icon } from "../../icons";
import { ItemRow } from "./ItemRow";
import { ListIcon, memberById } from "./bits";
import type { Accent } from "@/lib/recall/accents";
import {
  PRIORITY_RANK,
  type ListDef,
  type ListItem,
  type PublicMember,
} from "@/lib/recall/lists/types";

// ---------------------------------------------------------------------------
// One list, as a tile on the card wall.
//
// An empty list collapses to its header row. That is what makes eight lists
// affordable: the ones you are not using cost one line each instead of eight
// large empty cards, and they are still one click from holding something.
// ---------------------------------------------------------------------------

interface Props {
  list: ListDef;
  items: ListItem[];
  members: PublicMember[];
  me: PublicMember;
  isAdmin: boolean;
  accent: Accent;
  /** True when a member filter is on and this list has matches hidden by it. */
  hiddenByFilter: number;
  onQuickAdd: (text: string) => void;
  onOpenAdd: () => void;
  onToggle: (item: ListItem) => void;
  onEdit: (item: ListItem) => void;
  onDelete: (item: ListItem) => void;
  onClearDone: () => void;
  onEditList: () => void;
}

/** Urgent first, unset last, and anything ticked drops to the bottom. */
function order(a: ListItem, b: ListItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const rank = PRIORITY_RANK[a.priority ?? "none"] - PRIORITY_RANK[b.priority ?? "none"];
  if (rank !== 0) return rank;
  return a.createdAt.localeCompare(b.createdAt);
}

export function ListCard({
  list,
  items,
  members,
  me,
  isAdmin,
  accent,
  hiddenByFilter,
  onQuickAdd,
  onOpenAdd,
  onToggle,
  onEdit,
  onDelete,
  onClearDone,
  onEditList,
}: Props) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const sorted = [...items].sort(order);
  const open = sorted.filter((i) => !i.done).length;
  // Only what THIS caller may actually clear. Deleting stays owner-scoped, so
  // offering a member "clear 5 ticked items" when four of them are someone
  // else's would promise a tidy-up the server is right to refuse.
  const doneCount = sorted.filter((i) => i.done && (isAdmin || i.authorId === me.id)).length;
  const empty = sorted.length === 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onQuickAdd(text);
    setDraft("");
  };

  return (
    <section
      className={
        "group/card flex flex-col rounded-2xl border bg-gradient-to-br " + accent.tile
      }
    >
      <header className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <ListIcon name={list.icon} width={16} height={16} className={accent.ink} />
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-bold tracking-tight text-ink">
          {list.name}
        </h3>
        {open > 0 && (
          <span className="rounded-md bg-canvas/50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ink-muted">
            {open}
          </span>
        )}
        {isAdmin && (
          <button
            onClick={onEditList}
            title={`List settings for ${list.name}`}
            aria-label={`List settings for ${list.name}`}
            className="rounded p-0.5 text-ink-faint opacity-0 transition [@media(hover:none)]:opacity-100 hover:text-ink focus:opacity-100 group-hover/card:opacity-100"
          >
            <Icon.Settings width={12} height={12} />
          </button>
        )}
        <button
          onClick={onOpenAdd}
          title={`Add to ${list.name} with a note, date or link`}
          aria-label={`Add to ${list.name} with details`}
          className="rounded p-0.5 text-ink-faint opacity-0 transition [@media(hover:none)]:opacity-100 hover:text-ink focus:opacity-100 group-hover/card:opacity-100"
        >
          <Icon.Plus width={13} height={13} />
        </button>
      </header>

      {empty ? (
        <button
          onClick={() => setAdding(true)}
          className="mx-2 mb-2 rounded-lg px-1.5 py-1.5 text-left text-[11px] text-ink-faint transition hover:bg-panel-2/60 hover:text-ink-muted"
        >
          {hiddenByFilter > 0
            ? `${hiddenByFilter} hidden by the filter`
            : `Nothing in ${list.name} — add something`}
        </button>
      ) : (
        <div className="px-1.5 pb-1">
          {sorted.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              author={memberById(members, item.authorId)}
              canEdit={isAdmin || item.authorId === me.id}
              onToggle={() => onToggle(item)}
              onEdit={() => onEdit(item)}
              onDelete={() => onDelete(item)}
            />
          ))}
          {doneCount > 0 && (
            <button
              onClick={onClearDone}
              className="mt-0.5 w-full rounded-lg px-1.5 py-1 text-left text-[10px] text-ink-faint transition hover:bg-panel-2/60 hover:text-ink-muted"
            >
              Clear {doneCount} ticked {doneCount === 1 ? "item" : "items"} now
              <span className="text-ink-faint/70"> · clears itself after a day</span>
            </button>
          )}
        </div>
      )}

      {(!empty || adding) && (
        <form onSubmit={submit} className="px-2 pb-2">
          <input
            value={draft}
            autoFocus={adding}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => !draft && setAdding(false)}
            placeholder={`Add to ${list.name}…`}
            aria-label={`Add to ${list.name}`}
            className="w-full rounded-lg border border-line/70 bg-canvas/60 px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-brand/60 focus:bg-canvas focus:ring-1 focus:ring-brand/25"
          />
          {/* Explicit rather than relying on implicit single-input submission. */}
          <button type="submit" className="sr-only">
            Add to {list.name}
          </button>
        </form>
      )}
    </section>
  );
}
