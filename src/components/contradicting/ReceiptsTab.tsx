"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { receiptText, stamp, type Receipt } from "@/lib/contradicting/engine";
import type { RecordView } from "./useRecord";
import type { Act } from "./Onboard";

export function ReceiptsTab({ view, busy, act, onOpen }: { view: RecordView; busy: boolean; act: Act; onOpen: (r: Receipt) => void }) {
  const { doc } = view;
  const [showDismissed, setShowDismissed] = useState(false);
  const sorted = useMemo(() => [...doc.receipts].sort((a, b) => b.at.localeCompare(a.at)), [doc.receipts]);
  const live = sorted.filter((r) => !r.dismissed);
  const dismissed = sorted.filter((r) => r.dismissed);

  // Receipts that arrive while the page is open get the stamp.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(doc.receipts.map((r) => r.id));
    if (seen.current) {
      const n = [...ids].filter((id) => !seen.current!.has(id));
      if (n.length) setFresh(new Set(n));
    }
    seen.current = ids;
  }, [doc.receipts]);

  return (
    <section className="cx-stack">
      <TryBox view={view} busy={busy} act={act} />

      {live.length === 0 && (
        <div className="cx-empty">
          <div className="cx-empty-tape" aria-hidden>
            <span />
          </div>
          <h3>No receipts yet</h3>
          <p>
            When anyone on the record says something like &ldquo;I never called you that&rdquo; and the record shows they did, the
            receipt lands here — and on your phone through Omi.
          </p>
        </div>
      )}

      <ol className="cx-receipts">
        {live.map((r) => (
          <ReceiptCard key={r.id} view={view} r={r} fresh={fresh.has(r.id)} onOpen={onOpen} act={act} />
        ))}
      </ol>

      {dismissed.length > 0 && (
        <div className="cx-dismissed">
          <button className="cx-link" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? "Hide" : "Show"} &ldquo;not a contradiction&rdquo; · {dismissed.length}
          </button>
          {showDismissed && (
            <ol className="cx-receipts dim">
              {dismissed.map((r) => (
                <ReceiptCard key={r.id} view={view} r={r} fresh={false} onOpen={onOpen} act={act} />
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

function ReceiptCard({ view, r, fresh, onOpen, act }: { view: RecordView; r: Receipt; fresh: boolean; onOpen: (r: Receipt) => void; act: Act }) {
  const { doc } = view;
  const p = doc.people.find((x) => x.id === r.personId);
  const denialAt = doc.lines.find((l) => l.id === r.denialLineId)?.at ?? r.at;
  const [copied, setCopied] = useState(false);
  const hue = p?.hue ?? 40;

  async function copy() {
    const text = receiptText(doc, r);
    try {
      if (navigator.share && /Mobi|iPhone|Android/i.test(navigator.userAgent)) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the person closed the share sheet */
    }
  }

  return (
    <li className={`cx-receipt${fresh ? " fresh" : ""}`} style={{ ["--hue" as string]: hue }}>
      <div className="cx-thread" aria-hidden />
      <div className="cx-denial">
        <span className="cx-who">{p?.isMe ? "You" : p?.name}</span>
        <span className="cx-time">{stamp(denialAt, doc.settings.tz)}</span>
        <q>{r.denial}</q>
      </div>
      <button className="cx-quote" onClick={() => onOpen(r)} aria-label="Replay what led up to it">
        <span className="cx-stamp" aria-hidden>
          Said it
        </span>
        <span className="cx-time big">{stamp(r.quoteAt, doc.settings.tz)}</span>
        <q>{r.quote}</q>
      </button>
      <div className="cx-row">
        <span className="cx-badge" title={r.why}>
          {r.by === "ai" ? "Same meaning" : "Same words"} · {Math.round(r.score * 100)}%
        </span>
        <span className="cx-spacer" />
        <button className="cx-ghost" onClick={() => onOpen(r)}>
          Replay lead-up
        </button>
        <button className="cx-ghost" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button className="cx-ghost" onClick={() => act({ action: "receipt.dismiss", id: r.id, dismissed: !r.dismissed })}>
          {r.dismissed ? "Bring back" : "Not it"}
        </button>
      </div>
    </li>
  );
}

/** Type a line as someone — how you try it without the pendant, or add something said off-mic. */
function TryBox({ view, busy, act }: { view: RecordView; busy: boolean; act: Act }) {
  const people = view.doc.people.filter((p) => p.consentAt);
  const [who, setWho] = useState(people.find((p) => !p.isMe)?.id ?? people[0]?.id ?? "");
  const [text, setText] = useState("");
  const [open, setOpen] = useState(view.doc.lines.length === 0);
  const [note, setNote] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || !who) return;
    const res = await act({ action: "say", personId: who, text });
    if (res) {
      setText("");
      setNote(res.caught?.length ? "Caught one — see the receipt below." : "Added to the record.");
      setTimeout(() => setNote(""), 2500);
    }
  }

  if (!open) {
    return (
      <button className="cx-try-toggle" onClick={() => setOpen(true)}>
        + Type a line someone said
      </button>
    );
  }
  return (
    <form className="cx-try" onSubmit={add}>
      <div className="cx-try-head">
        <span>Type a line someone said</span>
        <button type="button" className="cx-link" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>
      <div className="cx-chips" role="radiogroup" aria-label="Who said it">
        {people.map((p) => (
          <button
            type="button"
            key={p.id}
            role="radio"
            aria-checked={who === p.id}
            className={who === p.id ? "on" : ""}
            style={{ ["--hue" as string]: p.hue }}
            onClick={() => setWho(p.id)}
          >
            {p.isMe ? "Me" : p.name}
          </button>
        ))}
      </div>
      <div className="cx-try-row">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="omg u are acting like a little girl" aria-label="What they said" />
        <button className="cx-primary small" disabled={busy || !text.trim()}>
          Add
        </button>
      </div>
      <p className="cx-hint">{note || "Try it: add a line, then add “I never called u a girl” as the same person."}</p>
    </form>
  );
}
