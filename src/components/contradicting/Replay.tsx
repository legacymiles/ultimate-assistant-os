"use client";

import { useEffect, useMemo, useState } from "react";
import { leadUp, receiptText, stamp, type Doc, type Receipt } from "@/lib/contradicting/engine";
import type { Act } from "./Onboard";

/**
 * "Do you want me to bring up the conversation back and forth that led up to
 * that?" — the lead-up read back one line at a time, the caught line stamped,
 * and the later denial underneath.
 */
export function Replay({ doc, receipt, act, onClose }: { doc: Doc; receipt: Receipt; act: Act; onClose: () => void }) {
  const lines = useMemo(() => leadUp(doc, receipt.matchLineId, 10, 3), [doc, receipt.matchLineId]);
  const denial = doc.lines.find((l) => l.id === receipt.denialLineId);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [shown, setShown] = useState(reduced ? lines.length : 0);

  useEffect(() => {
    if (shown >= lines.length) return;
    const id = window.setTimeout(() => setShown((n) => n + 1), 260);
    return () => window.clearTimeout(id);
  }, [shown, lines.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const name = (id: string | null) => {
    const p = id ? doc.people.find((x) => x.id === id) : undefined;
    return p ? (p.isMe ? "You" : p.name) : "Unknown voice";
  };
  const hue = (id: string | null) => doc.people.find((x) => x.id === id)?.hue ?? 0;

  return (
    <div className="cx-sheet-wrap" onClick={onClose}>
      <div className="cx-sheet" role="dialog" aria-modal aria-label="The lead-up" onClick={(e) => e.stopPropagation()}>
        <div className="cx-sheet-head">
          <div>
            <p className="cx-kicker">The lead-up</p>
            <h3>{stamp(lines[0]?.at ?? receipt.quoteAt, doc.settings.tz)}</h3>
          </div>
          <button className="cx-ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <ol className="cx-transcript">
          {lines.slice(0, shown).map((l) => (
            <li key={l.id} className={l.id === receipt.matchLineId ? "hit" : ""} style={{ ["--hue" as string]: hue(l.personId) }}>
              <span className="cx-who">{name(l.personId)}</span>
              <span className="cx-time">{stamp(l.at, doc.settings.tz).split(" ").slice(0, 2).join(" ")}</span>
              <p>{l.text}</p>
              {l.id === receipt.matchLineId && (
                <span className="cx-stamp" aria-hidden>
                  Said it
                </span>
              )}
            </li>
          ))}
        </ol>
        {denial && shown >= lines.length && (
          <div className="cx-later">
            <span className="cx-kicker">Later · {stamp(denial.at, doc.settings.tz)}</span>
            <p>
              <b>{name(denial.personId)}:</b> &ldquo;{denial.text}&rdquo;
            </p>
          </div>
        )}
        <div className="cx-row">
          <button
            className="cx-primary small"
            onClick={() => navigator.clipboard?.writeText(receiptText(doc, receipt)).catch(() => undefined)}
          >
            Copy receipt
          </button>
          <span className="cx-spacer" />
          <button
            className="cx-ghost"
            onClick={async () => {
              await act({ action: "receipt.dismiss", id: receipt.id, dismissed: !receipt.dismissed });
              onClose();
            }}
          >
            {receipt.dismissed ? "Bring back" : "Not a contradiction"}
          </button>
        </div>
      </div>
    </div>
  );
}
