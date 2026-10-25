"use client";

import { useState } from "react";
import type { Doc } from "@/lib/contradicting/engine";
import type { RecordView } from "./useRecord";

export type Act = (body: Record<string, unknown>) => Promise<RecordView | null>;

/** Two names and one shared yes — that's the whole setup. */
export function Onboard({ doc, busy, act }: { doc: Doc; busy: boolean; act: Act }) {
  const mine = doc.people.find((p) => p.isMe);
  const [myName, setMyName] = useState("");
  const [theirName, setTheirName] = useState("");
  const [agreed, setAgreed] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) return;
    if (!mine) {
      const ok = await act({ action: "person.add", name: myName, isMe: true, consent: true });
      if (!ok) return;
    }
    await act({ action: "person.add", name: theirName, consent: true });
  }

  return (
    <form className="cx-onboard" onSubmit={start}>
      <p className="cx-kicker">Set up · 30 seconds</p>
      <h2>Who&apos;s on the record?</h2>
      <p className="cx-muted">
        Contradicting listens through a clip-on recorder, keeps what each of you says with the time, and when someone says
        &ldquo;I never said that&rdquo;, it shows the exact line and when. It checks both of you the same way.
      </p>
      {!mine && (
        <label className="cx-field">
          <span>Your name</span>
          <input value={myName} onChange={(e) => setMyName(e.target.value)} placeholder="Miles" autoComplete="given-name" required />
        </label>
      )}
      <label className="cx-field">
        <span>Their name</span>
        <input value={theirName} onChange={(e) => setTheirName(e.target.value)} placeholder="Jada" required />
      </label>
      <label className="cx-consent">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          <b>We both agreed</b> to have our conversations recorded and checked by this app. Either of us can withdraw any time in
          People, and everything that person said is deleted.
        </span>
      </label>
      <button className="cx-primary" disabled={busy || !agreed || !theirName.trim() || (!mine && !myName.trim())}>
        {busy ? "Starting…" : "Start the record"}
      </button>
    </form>
  );
}
