"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import type { SectionId } from "@/lib/recall/types";

// ---------------------------------------------------------------------------
// One + button for the whole folder.
//
// It does two jobs, because people reach for the same + for both: sections the
// folder already has offer "add another one of these" (a second login, a third
// note), and the rest offer to add the section itself. A section never
// disappears from this menu just because you used it once.
// ---------------------------------------------------------------------------

export interface SectionChoice {
  id: SectionId;
  label: string;
  icon: typeof Icon.File;
  blurb: string;
  /** What adding one more of these is called — "New login", "New note"… */
  addLabel: string;
  /** The folder already shows this section, so picking it adds an item. */
  present: boolean;
}

export function AddSectionMenu({
  choices,
  onPick,
  variant = "block",
}: {
  choices: SectionChoice[];
  /** `present` says which of the two jobs the pick means. */
  onPick: (id: SectionId, present: boolean) => void;
  /** "block" for the empty-folder call to action, "inline" for the footer row. */
  variant?: "block" | "inline";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (choices.length === 0) return null;

  const here = choices.filter((c) => c.present);
  const rest = choices.filter((c) => !c.present);
  const heads = here.length > 0 && rest.length > 0;

  function row(c: SectionChoice) {
    const Ico = c.icon;
    return (
      <button
        key={c.id}
        role="menuitem"
        onClick={() => {
          onPick(c.id, c.present);
          setOpen(false);
        }}
        className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-panel-2"
      >
        <Ico width={14} height={14} className="mt-0.5 shrink-0 text-ink-faint" />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-ink">
            {c.present ? c.addLabel : c.label}
          </span>
          <span className="block text-[11px] leading-snug text-ink-faint">
            {c.present ? `In ${c.label}` : c.blurb}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={
          variant === "block"
            ? "inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
            : "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-ink-faint transition hover:bg-panel-2 hover:text-ink"
        }
      >
        <Icon.Plus width={variant === "block" ? 16 : 13} height={variant === "block" ? 16 : 13} />
        {here.length > 0 ? "Add" : "Add section"}
      </button>

      {open && (
        <div
          role="menu"
          className={
            "animate-fade-in absolute z-40 max-h-80 w-64 overflow-y-auto rounded-xl border border-line bg-elevated p-1 shadow-2xl " +
            (variant === "block" ? "left-1/2 top-full mt-2 -translate-x-1/2" : "bottom-full left-0 mb-2")
          }
        >
          {heads && here.length > 0 && (
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              Add to this folder
            </p>
          )}
          {here.map(row)}
          {heads && <div className="my-1 border-t border-line-soft" />}
          {heads && rest.length > 0 && (
            <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              New section
            </p>
          )}
          {rest.map(row)}
        </div>
      )}
    </div>
  );
}
