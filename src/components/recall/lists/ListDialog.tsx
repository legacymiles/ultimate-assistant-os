"use client";

import { useEffect, useState } from "react";
import { Icon } from "../../icons";
import { ListIcon } from "./bits";
import { LIST_ICONS, type ListDef } from "@/lib/recall/lists/types";

// ---------------------------------------------------------------------------
// Adding a list, or changing one. Admin only.
//
// A built-in can be hidden but never deleted, and a custom list has to be empty
// before it can go. Tidying the board must never be a way to destroy items —
// the same rule the folder sections follow.
// ---------------------------------------------------------------------------

interface Props {
  /** null when creating. */
  list: ListDef | null;
  /** How many items the list holds — a non-empty custom list cannot be deleted. */
  itemCount: number;
  busy?: boolean;
  onSubmit: (draft: { name: string; icon: string }) => void;
  onHide: (hidden: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function ListDialog({
  list,
  itemCount,
  busy,
  onSubmit,
  onHide,
  onDelete,
  onClose,
}: Props) {
  const [name, setName] = useState(list?.name ?? "");
  const [icon, setIcon] = useState(list?.icon ?? "Note");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), icon });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-t-2xl border border-line bg-panel p-4 shadow-2xl sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{list ? "List settings" : "New list"}</h2>
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Holiday, School run, Garden"
          aria-label="List name"
          className="mb-3 w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
        />

        <fieldset className="mb-4">
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Icon
          </legend>
          <div className="grid grid-cols-8 gap-1">
            {LIST_ICONS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setIcon(key)}
                aria-label={key}
                className={
                  "flex aspect-square items-center justify-center rounded-lg border transition " +
                  (icon === key
                    ? "border-brand bg-brand/15 text-brand"
                    : "border-line text-ink-faint hover:text-ink")
                }
              >
                <ListIcon name={key} width={15} height={15} />
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:opacity-50"
          >
            {list ? "Save" : "Create"}
          </button>
        </div>

        {list && (
          <div className="border-t border-line pt-3">
            <button
              type="button"
              onClick={() => onHide(!list.hidden)}
              className="w-full rounded-lg px-2 py-2 text-left text-[12px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
            >
              {list.hidden ? "Show this list again" : "Hide this list from the board"}
              <span className="block text-[10.5px] text-ink-faint">
                Hiding keeps everything in it — nothing is deleted.
              </span>
            </button>

            {!list.builtIn && (
              <button
                type="button"
                onClick={onDelete}
                disabled={itemCount > 0}
                className="mt-1 w-full rounded-lg px-2 py-2 text-left text-[12px] text-red-400 transition enabled:hover:bg-red-500/10 disabled:cursor-not-allowed disabled:text-ink-faint"
              >
                Delete this list
                <span className="block text-[10.5px] text-ink-faint">
                  {itemCount > 0
                    ? `Empty it first — it still holds ${itemCount} ${itemCount === 1 ? "item" : "items"}.`
                    : "It is empty, so nothing is lost."}
                </span>
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
