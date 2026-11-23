"use client";

// ---------------------------------------------------------------------------
// Setting the parent password, on the console — before the hand-over.
//
// Typed twice, because a password mistyped once is a locked screen nobody can
// open. Saved as a salted hash the moment both match (see password.ts), and the
// console never shows it again: "Change" asks for a new one rather than
// revealing the old.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { PIN_MAX, hashPin, newSalt, pinProblem } from "@/lib/baby-no-scroll/password";

export interface PasswordSaved {
  passHash: string;
  passSalt: string;
  passLength: number;
}

export function PasswordSetup({
  isSet,
  length,
  onSave,
}: {
  isSet: boolean;
  length: number;
  onSave: (p: PasswordSaved) => void;
}) {
  const [editing, setEditing] = useState(!isSet);
  const [first, setFirst] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const clean = (v: string) => v.replace(/\D/g, "").slice(0, PIN_MAX);

  const save = async () => {
    const problem = pinProblem(first);
    if (problem) return setError(problem);
    if (first !== again) return setError("The two don’t match — type it again.");
    const salt = newSalt();
    onSave({ passHash: await hashPin(first, salt), passSalt: salt, passLength: first.length });
    setFirst("");
    setAgain("");
    setError(null);
    setEditing(false);
    setJustSaved(true);
  };

  if (isSet && !editing) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] px-3 py-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300" aria-hidden>
          <svg viewBox="0 0 24 24" className="h-4 w-4">
            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-ink">
            {justSaved ? "Password saved" : "Password is set"}
          </span>
          <span className="block font-mono text-[10px] text-ink-faint">
            {"•".repeat(Math.max(4, length))} · {length} numbers
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            setJustSaved(false);
          }}
          className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <input
          value={first}
          onChange={(e) => {
            setFirst(clean(e.target.value));
            setError(null);
          }}
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          placeholder="New password"
          aria-label="New password, 4 to 8 numbers"
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[13px] tracking-[0.3em] text-ink outline-none transition placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-faint/70 focus:border-sky-400/60"
        />
        <input
          value={again}
          onChange={(e) => {
            setAgain(clean(e.target.value));
            setError(null);
          }}
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          placeholder="Type it again"
          aria-label="Type the password again"
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[13px] tracking-[0.3em] text-ink outline-none transition placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-faint/70 focus:border-sky-400/60"
        />
      </div>
      <p className={`min-h-[16px] text-[11px] leading-snug ${error ? "text-amber-400" : "text-ink-faint"}`}>
        {error ?? "4–8 numbers. Typed on a number pad the app draws, so the phone’s keyboard never opens."}
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={first.length === 0 || again.length === 0}
          className="flex-1 rounded-lg bg-sky-500/90 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-elevated disabled:text-ink-faint"
        >
          Save password
        </button>
        {isSet && (
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setFirst("");
              setAgain("");
              setError(null);
            }}
            className="rounded-lg border border-line px-3 py-2 text-[12px] text-ink-muted transition hover:text-ink"
          >
            Keep the old one
          </button>
        )}
      </div>
    </form>
  );
}
