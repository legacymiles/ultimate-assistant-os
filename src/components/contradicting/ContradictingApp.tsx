"use client";

import { useMemo, useState } from "react";
import type { Doc, Person, Receipt } from "@/lib/contradicting/engine";
import { useRecord } from "./useRecord";
import { Onboard } from "./Onboard";
import { ReceiptsTab } from "./ReceiptsTab";
import { RecordTab } from "./RecordTab";
import { PeopleTab } from "./PeopleTab";
import { SetupTab } from "./SetupTab";
import { Replay } from "./Replay";
import "./contradicting.css";

// ---------------------------------------------------------------------------
// Contradicting — "the record doesn't lie, for both of you."
//
// The idea (interactive-web-studio pass): every conversation is a reel of tape.
// When someone denies saying something, an amber thread runs from the denial
// back to the line where they said it, and the receipt gets stamped. Tapping
// it plays the back-and-forth that led up to it, line by line, like a court
// transcript read back. One signature moment (the stamp), everything else
// quiet and dense so it reads in the middle of an argument, on a phone.
// ---------------------------------------------------------------------------

type Tab = "receipts" | "record" | "people" | "setup";

export function personOf(doc: Doc, id: string | null): Person | undefined {
  return id ? doc.people.find((p) => p.id === id) : undefined;
}

export function ContradictingApp() {
  const { view, error, busy, act, clearError } = useRecord();
  const [tab, setTab] = useState<Tab>("receipts");
  const [open, setOpen] = useState<Receipt | null>(null);

  const doc = view?.doc;
  const live = useMemo(() => (doc ? doc.receipts.filter((r) => !r.dismissed).length : 0), [doc]);
  const needsSetup = doc && (doc.people.length < 2 || !doc.people.some((p) => p.isMe));

  return (
    <div className="cx-root">
      <div className="cx-grain" aria-hidden />
      <header className="cx-head">
        <div className="cx-brand">
          <span className="cx-reel" aria-hidden>
            <i />
            <i />
          </span>
          <div>
            <h1>Contradicting</h1>
            <p>The record doesn&apos;t lie — for both of you.</p>
          </div>
        </div>
        {doc && <Fairness view={view} />}
      </header>

      {error && (
        <div className="cx-alert" role="alert">
          <span>{error}</span>
          <button onClick={clearError} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {!view && !error && <div className="cx-loading">Loading your record…</div>}

      {doc && needsSetup && <Onboard doc={doc} busy={busy} act={act} />}

      {doc && !needsSetup && (
        <>
          <nav className="cx-tabs" role="tablist">
            {(
              [
                ["receipts", `Receipts${live ? ` · ${live}` : ""}`],
                ["record", "Record"],
                ["people", "People"],
                ["setup", "Setup"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          <main className="cx-main">
            {tab === "receipts" && <ReceiptsTab view={view!} busy={busy} act={act} onOpen={setOpen} />}
            {tab === "record" && <RecordTab view={view!} act={act} />}
            {tab === "people" && <PeopleTab view={view!} busy={busy} act={act} />}
            {tab === "setup" && <SetupTab view={view!} busy={busy} act={act} />}
          </main>
        </>
      )}

      {doc && open && <Replay doc={doc} receipt={open} act={act} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Same scoreboard for everyone: the fairness bar under the title. */
function Fairness({ view }: { view: ReturnType<typeof useRecord>["view"] }) {
  if (!view) return null;
  const rows = view.stats
    .map((s) => ({ s, p: view.doc.people.find((p) => p.id === s.personId) }))
    .filter((r) => r.p && r.p.consentAt);
  const total = rows.reduce((n, r) => n + r.s.receipts, 0);
  if (rows.length < 2) return null;
  return (
    <div className="cx-fair" aria-label="Receipts per person">
      <div className="cx-fair-bar">
        {rows.map(({ s, p }) => (
          <span
            key={s.personId}
            style={{ flexGrow: total ? Math.max(s.receipts, 0.15) : 1, background: `hsl(${p!.hue} 85% 60%)` }}
            title={`${p!.name}: ${s.receipts}`}
          />
        ))}
      </div>
      <div className="cx-fair-legend">
        {rows.map(({ s, p }) => (
          <span key={s.personId}>
            <b style={{ color: `hsl(${p!.hue} 85% 66%)` }}>{p!.isMe ? "You" : p!.name}</b> {s.receipts} caught · {s.keyPoints} key {s.keyPoints === 1 ? "point" : "points"}
          </span>
        ))}
      </div>
    </div>
  );
}
