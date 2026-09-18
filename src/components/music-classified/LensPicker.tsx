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
    <div className="mcl-menu">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="mcl-btn"
        style={{ padding: "0.55rem 0.7rem" }}
      >
        <span className="mcl-muted">Describe as:</span>
        <span style={{ color: "var(--color-ink)", maxWidth: "11rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {chosen.length ? chosen.slice(0, 2).join(", ") : "filing only"}
          {chosen.length > 2 && ` +${chosen.length - 2}`}
        </span>
        <Icon.Chevron width={10} height={10} className="rotate-90" />
      </button>
      {open && (
        <>
          <button type="button" aria-hidden tabIndex={-1} className="mcl-menu__scrim" onClick={() => setOpen(false)} />
          <div className="mcl-menu__pop" style={{ width: "20rem", right: "auto", left: 0 }}>
            <p className="mcl-rail__hint" style={{ padding: "0.5rem 0.6rem 0.4rem" }}>
              Each is a different way of hearing the song. Pick any — you can add more per song later.
            </p>
            {LENSES.map((l) => (
              <label key={l.id} className="mcl-menu__item" style={{ cursor: "pointer", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={lenses.includes(l.id)}
                  onChange={() => onToggle(l.id)}
                  style={{ marginTop: "0.2rem", accentColor: "var(--color-brand)" }}
                />
                <span>
                  <span style={{ display: "block", color: "var(--color-ink)" }}>{l.label}</span>
                  <span style={{ display: "block", fontSize: "0.7rem", color: "var(--color-ink-faint)" }}>{l.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
