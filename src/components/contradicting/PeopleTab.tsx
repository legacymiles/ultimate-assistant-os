"use client";

import { useState } from "react";
import type { RecordView } from "./useRecord";
import type { Act } from "./Onboard";

/** Who's on the record, and each person's yes. Withdrawing deletes what they said. */
export function PeopleTab({ view, busy, act }: { view: RecordView; busy: boolean; act: Act }) {
  const { doc } = view;
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);

  return (
    <section className="cx-stack">
      <ol className="cx-people">
        {doc.people.map((p) => {
          const s = view.stats.find((x) => x.personId === p.id);
          return (
            <li key={p.id} style={{ ["--hue" as string]: p.hue }}>
              <span className="cx-avatar" aria-hidden>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="cx-person">
                <b>
                  {p.name}
                  {p.isMe ? " (you)" : ""}
                </b>
                <span className="cx-muted small">
                  {p.consentAt ? `Agreed ${new Date(p.consentAt).toLocaleDateString()}` : "Hasn't agreed — nothing they say is kept"}
                  {s ? ` · ${s.lines} ${s.lines === 1 ? "line" : "lines"} · ${s.receipts} caught` : ""}
                </span>
              </div>
              <div className="cx-row">
                {p.consentAt ? (
                  <button
                    className="cx-ghost danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Withdraw ${p.isMe ? "your" : `${p.name}'s`} consent? Everything ${p.isMe ? "you" : p.name} said is deleted.`)) {
                        act({ action: "person.consent", id: p.id, agreed: false });
                      }
                    }}
                  >
                    Withdraw
                  </button>
                ) : (
                  <button className="cx-ghost" disabled={busy} onClick={() => act({ action: "person.consent", id: p.id, agreed: true })}>
                    They agreed
                  </button>
                )}
                <button
                  className="cx-ghost"
                  onClick={() => {
                    const n = prompt("New name", p.name);
                    if (n && n.trim() && n !== p.name) act({ action: "person.rename", id: p.id, name: n });
                  }}
                >
                  Rename
                </button>
                {!p.isMe && (
                  <button
                    className="cx-ghost danger"
                    onClick={() => {
                      if (confirm(`Remove ${p.name} and everything they said?`)) act({ action: "person.remove", id: p.id });
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <form
        className="cx-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act({ action: "person.add", name, consent: agreed })) {
            setName("");
            setAgreed(false);
          }
        }}
      >
        <p className="cx-kicker">Add someone (a roommate, a coworker, a co-parent)</p>
        <div className="cx-try-row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" />
          <button className="cx-primary small" disabled={busy || !name.trim()}>
            Add
          </button>
        </div>
        <label className="cx-consent small">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>They agreed to be recorded. Without this, they&apos;re set up but nothing they say is kept.</span>
        </label>
      </form>
    </section>
  );
}
