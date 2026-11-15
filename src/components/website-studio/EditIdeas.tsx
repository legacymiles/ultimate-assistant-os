"use client";

// Ideas that go with an edit, each accepted or denied on its own — App
// Builder's feature list, sized for a change to a live site. The edit never
// waits on these: it is already filed and the look pass is already painting.

import type { EditIdea } from "@/lib/website-studio/ideas";

interface Props {
  items: EditIdea[];
  loading: boolean;
  /** Set when the build already started: accepted ideas go in as the next edit. */
  late: boolean;
  note?: string;
  busy: boolean;
  onDecide: (id: string, choice: "accepted" | "denied") => void;
  onSendLate: () => void;
}

export function EditIdeas({ items, loading, late, note, busy, onDecide, onSendLate }: Props) {
  const yes = items.filter((i) => i.status === "accepted").length;
  return (
    <section className="ws-ideas" aria-labelledby="ws-ideas-h" aria-busy={loading}>
      <header>
        <h3 id="ws-ideas-h">Ideas that go with this edit</h3>
        {items.length > 0 && <span className="ws-ideas-count">{yes} added</span>}
      </header>
      {loading ? (
        <p className="ws-hint">Working out what would finish this change off…</p>
      ) : items.length === 0 ? (
        <p className="ws-hint">Nothing to add — this one stands on its own.</p>
      ) : (
        <>
          <ul>
            {items.map((i) => (
              <li key={i.id} className={`ws-idea ${i.status}`}>
                <div className="ws-idea-body">
                  <b>{i.title}</b>
                  <span>{i.detail}</span>
                  {i.why && <em>{i.why}</em>}
                </div>
                <div className="ws-idea-acts" role="group" aria-label={`${i.title}: add or skip`}>
                  <button
                    type="button"
                    className="yes"
                    aria-pressed={i.status === "accepted"}
                    disabled={busy}
                    onClick={() => onDecide(i.id, "accepted")}
                    title="Add it to this edit"
                  >
                    {i.status === "accepted" ? "Added" : "Add"}
                  </button>
                  <button
                    type="button"
                    className="no"
                    aria-pressed={i.status === "denied"}
                    disabled={busy}
                    onClick={() => onDecide(i.id, "denied")}
                    title="Skip it"
                  >
                    Skip
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="ws-hint">
            {late
              ? "The build already started, so what you add goes in as the next edit."
              : "What you add is built in the same pass as your edit. Nothing is added unless you press Add."}
          </p>
          {late && yes > 0 && (
            <button className="ws-btn small" disabled={busy} onClick={onSendLate}>
              Send {yes} as the next edit
            </button>
          )}
        </>
      )}
      {note && <p className="ws-hint">{note}</p>}
    </section>
  );
}
