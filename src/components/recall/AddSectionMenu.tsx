"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import type { SectionId } from "@/lib/recall/types";

// ---------------------------------------------------------------------------
// One + button, a short menu, and the folder grows only the sections you ask
// for. A folder full of empty headings you never use is the thing this avoids.
// ---------------------------------------------------------------------------

export interface SectionChoice {
  id: SectionId;
  label: string;
  icon: typeof Icon.File;
  blurb: string;
}

export function AddSectionMenu({
  choices,
  onPick,
  variant = "block",
}: {
  choices: SectionChoice[];
  onPick: (id: SectionId) => void;
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
        Add section
      </button>

      {open && (
        <div
          role="menu"
          className={
            "animate-fade-in absolute z-40 w-64 overflow-hidden rounded-xl border border-line bg-elevated p-1 shadow-2xl " +
            (variant === "block" ? "left-1/2 top-full mt-2 -translate-x-1/2" : "bottom-full left-0 mb-2")
          }
        >
          {choices.map((c) => {
            const Ico = c.icon;
            return (
              <button
                key={c.id}
                role="menuitem"
                onClick={() => {
                  onPick(c.id);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-panel-2"
              >
                <Ico width={14} height={14} className="mt-0.5 shrink-0 text-ink-faint" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">{c.label}</span>
                  <span className="block text-[11px] leading-snug text-ink-faint">{c.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
