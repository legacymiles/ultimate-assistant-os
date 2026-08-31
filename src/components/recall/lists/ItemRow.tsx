"use client";

import { Icon } from "../../icons";
import { Avatar, DueChip, PriorityDot } from "./bits";
import type { ListItem, PublicMember } from "@/lib/recall/lists/types";

// ---------------------------------------------------------------------------
// One row on a list tile.
//
// Reads left to right as: how urgent → what it is → who added it. The checkbox
// is available to everyone by design; the edit and delete actions appear only
// for people allowed to use them, and the server checks again anyway.
// ---------------------------------------------------------------------------

interface Props {
  item: ListItem;
  author: PublicMember;
  /** True for the item's author and for the admin. */
  canEdit: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ItemRow({ item, author, canEdit, onToggle, onEdit, onDelete }: Props) {
  return (
    <div className="group/item flex items-start gap-2 rounded-lg px-1.5 py-1 transition hover:bg-panel-2">
      <button
        onClick={onToggle}
        aria-label={item.done ? `Mark ${item.text} as not done` : `Mark ${item.text} as done`}
        title={item.done ? "Not done after all" : "Done"}
        className={
          "mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition " +
          (item.done
            ? "border-emerald-400/60 bg-emerald-500/25 text-emerald-300"
            : "border-line text-transparent hover:border-ink-faint hover:text-ink-faint")
        }
      >
        <Icon.Check width={10} height={10} />
      </button>

      <button
        onClick={canEdit ? onEdit : undefined}
        disabled={!canEdit}
        className="min-w-0 flex-1 text-left disabled:cursor-default"
      >
        <span className="flex items-center gap-1.5">
          {!item.done && <PriorityDot priority={item.priority} />}
          <span
            className={
              "truncate text-[12.5px] leading-snug " +
              (item.done ? "text-ink-faint line-through" : "text-ink")
            }
          >
            {item.text}
          </span>
        </span>

        {item.note && !item.done && (
          <span className="mt-0.5 block truncate pl-3.5 text-[11px] leading-snug text-ink-muted">
            {item.note}
          </span>
        )}

        {!item.done && (item.dueDate || item.url) && (
          <span className="mt-1 flex flex-wrap items-center gap-1 pl-3.5">
            {item.dueDate && <DueChip dueDate={item.dueDate} />}
            {item.url && (
              <span className="inline-flex items-center gap-1 rounded-md border border-line bg-panel-2 px-1.5 py-px text-[10px] text-ink-faint">
                <Icon.Link width={9} height={9} /> Link
              </span>
            )}
          </span>
        )}
      </button>

      <div className="flex shrink-0 items-center gap-0.5 pt-px">
        {item.url && !item.done && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            title="Open link"
            aria-label={`Open the link on ${item.text}`}
            className="rounded p-0.5 text-ink-faint opacity-0 transition [@media(hover:none)]:opacity-100 hover:text-ink focus:opacity-100 group-hover/item:opacity-100"
          >
            <Icon.Launch width={12} height={12} />
          </a>
        )}
        {canEdit && (
          <button
            onClick={onDelete}
            title="Remove"
            aria-label={`Remove ${item.text}`}
            className="rounded p-0.5 text-ink-faint opacity-0 transition [@media(hover:none)]:opacity-100 hover:text-red-400 focus:opacity-100 group-hover/item:opacity-100"
          >
            <Icon.Trash width={12} height={12} />
          </button>
        )}
        <Avatar member={author} size={18} />
      </div>
    </div>
  );
}
