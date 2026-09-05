"use client";

// ---------------------------------------------------------------------------
// Asking someone for their card, in person.
//
// Six characters, typed while standing in front of them. The input upper-cases
// and strips as you go, so a code read aloud from a phone screen goes in
// without anyone thinking about it.
// ---------------------------------------------------------------------------

import { useState } from "react";

interface Props {
  busy: boolean;
  onAsk: (code: string) => Promise<void>;
}

export function AskPanel({ busy, onAsk }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSent(false);
    try {
      await onAsk(code);
      setCode("");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-panel px-5 py-4">
      <h3 className="text-[15px] font-semibold text-ink">Ask someone</h3>
      <p className="mt-1 text-[13px] text-ink-muted">
        Type the six characters from their screen. They get a prompt and decide.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6));
            setSent(false);
          }}
          placeholder="A7K2QD"
          maxLength={6}
          autoCapitalize="characters"
          spellCheck={false}
          className="w-40 rounded-lg border border-line bg-canvas px-3 py-2.5 text-center font-mono text-lg tracking-[0.3em] text-ink outline-none placeholder:text-ink-faint focus:border-brand/60 focus:ring-1 focus:ring-brand/30"
        />
        <button
          type="submit"
          disabled={busy || code.length < 6}
          className="rounded-lg bg-brand px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-brand-2 disabled:opacity-40"
        >
          {busy ? "Asking…" : "Send request"}
        </button>
      </div>

      {error && <p className="mt-3 text-[13px] text-rose-300">{error}</p>}
      {sent && !error && (
        <p className="mt-3 text-[13px] text-emerald-300">
          Sent. It shows under “You asked” once they answer — and stays quiet if they would rather not.
        </p>
      )}
    </form>
  );
}
