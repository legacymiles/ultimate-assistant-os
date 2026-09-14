"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { LENSES } from "@/lib/music-classified/levels";
import type { LensId } from "@/lib/music-classified/types";

/** "Describe as:" — which ways of hearing a song to write up when it's filed. */
export function LensPicker({ lenses, onToggle }: { lenses: LensId[]; onToggle: (id: LensId) => void }) {
  const [open, setOpen] = useState(false);
  const chosen = LENSES.filter((l) => lenses.includes(l.id)).map((l) => l.label);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex max-w-[260px] items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-muted transition hover:text-ink"
      >
        <span className="text-ink-faint">Describe as:</span>
        <span className="truncate text-ink">
          {chosen.length ? chosen.slice(0, 2).join(", ") : "filing only"}
          {chosen.length > 2 && ` +${chosen.length - 2}`}
        </span>
        <Icon.Chevron width={10} height={10} className="rotate-90" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="animate-fade-in absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-line bg-panel p-1 shadow-2xl">
            <p className="px-2.5 py-1.5 text-[11px] text-ink-faint">
              Each is a different way of hearing the song. Pick any — you can add more per song later.
            </p>
            {LENSES.map((l) => (
              <label
                key={l.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-1.5 transition hover:bg-panel-2"
              >
                <input
                  type="checkbox"
                  checked={lenses.includes(l.id)}
                  onChange={() => onToggle(l.id)}
                  className="mt-0.5 accent-[var(--color-brand)]"
                />
                <span>
                  <span className="block text-[13px] text-ink">{l.label}</span>
                  <span className="block text-[11px] text-ink-faint">{l.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
