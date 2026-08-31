"use client";

import { Suspense, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// ---------------------------------------------------------------------------
// The unlock screen shared by every gated app.
// A gate is a door on the route, not encryption — see src/lib/appGate.ts.
// ---------------------------------------------------------------------------

interface Props {
  title: string;
  subtitle: string;
  /** POST { password } → sets the gate cookie. */
  endpoint: string;
  /** Where to land when no ?next= was supplied. */
  defaultNext: string;
  icon: ReactNode;
  /** Optional line under the button, e.g. what this does and does not protect. */
  footnote?: string;
}

function Form({ title, subtitle, endpoint, defaultNext, icon, footnote }: Props) {
  const params = useSearchParams();
  const next = params.get("next") || defaultNext;

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        setError("Wrong password.");
        return;
      }
      if (!res.ok) {
        setError("Something went wrong. Try again.");
        return;
      }
      // Full reload so the middleware sees the new cookie.
      window.location.href = next;
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-2xl"
    >
      <div className="mb-5 flex flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-white">
          {icon}
        </div>
        <h1 className="mt-3 text-xl font-bold text-ink">{title}</h1>
        <p className="mt-1 text-xs text-ink-faint">{subtitle}</p>
      </div>

      <label className="mb-4 block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
          Password
        </span>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </label>

      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={busy || !password}
        className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:opacity-50"
      >
        {busy ? "Unlocking…" : "Unlock"}
      </button>

      {footnote && (
        <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-faint">{footnote}</p>
      )}

      <Link
        href="/"
        className="mt-4 block text-center text-xs text-ink-faint underline-offset-2 hover:text-ink hover:underline"
      >
        ← Back to hub
      </Link>
    </form>
  );
}

export function UnlockScreen(props: Props) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Suspense fallback={null}>
        <Form {...props} />
      </Suspense>
    </div>
  );
}
