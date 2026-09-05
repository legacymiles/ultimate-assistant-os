"use client";

// ---------------------------------------------------------------------------
// Sign in / sign up.
//
// The panel says what the app does and does not claim before asking for
// anything, because someone deciding whether to put their results here deserves
// to know what the badge will and will not say about them.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { signIn, signUp, type Dashboard } from "@/lib/stdsafe/client";

const PROMISES = [
  ["Reads the report you already have", "Upload the PDF from STDcheck, Quest, Labcorp or MyChart. Nothing is saved until you confirm every line."],
  ["Never says the word clean", "It says what was tested, what came back, and when the sample was taken. A partial panel can never look like a full one."],
  ["Nobody sees anything without a yes", "They ask with your code, you approve, they get 24 hours. Rotating your code cuts off everyone at once."],
];

export function AuthPanel({ onSignedIn }: { onSignedIn: (dashboard: Dashboard) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const dashboard =
        mode === "signup" ? await signUp(handle, password, displayName) : await signIn(handle, password);
      onSignedIn(dashboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none " +
    "placeholder:text-ink-faint focus:border-brand/60 focus:ring-1 focus:ring-brand/30";

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-14 lg:grid-cols-[1.1fr_1fr] lg:py-20">
      <div>
        <p className="mb-3 text-xs uppercase tracking-[0.2em] text-ink-faint">STD Safe</p>
        <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-ink">
          Your test results, <span className="text-emerald-300">provable</span> — and honest about
          what they do not prove.
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-muted">
          A tracker for the lab reports you already receive, and a way to show someone exactly what
          you were tested for, what came back, and how long ago the sample was taken.
        </p>

        <ul className="mt-8 space-y-5">
          {PROMISES.map(([title, body]) => (
            <li key={title} className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />
              <div>
                <p className="text-sm font-medium text-ink">{title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{body}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-8 max-w-xl rounded-lg border border-line bg-panel px-4 py-3 text-[12px] leading-relaxed text-ink-muted">
          <span className="font-medium text-ink">Read this first.</span> No lab offers third-party
          result sharing, so there is no "connect your account" here and nothing is pulled from
          anywhere. Verification means a report file is on file and was machine-read — it proves a
          document exists, not that it is authentic. And no test covers exposure after the date the
          sample was taken.
        </p>
      </div>

      <div className="lg:pt-12">
        <form onSubmit={submit} className="rounded-xl border border-line bg-panel p-6">
          <div className="mb-5 flex rounded-lg border border-line bg-canvas p-1">
            {(["signup", "signin"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError("");
                }}
                className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition ${
                  mode === m ? "bg-elevated text-ink" : "text-ink-faint hover:text-ink-muted"
                }`}
              >
                {m === "signup" ? "Create account" : "Sign in"}
              </button>
            ))}
          </div>

          <label className="mb-1.5 block text-[12px] font-medium text-ink-muted">Handle</label>
          <input
            className={field}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="riverstone"
            autoComplete="username"
            required
          />

          <label className="mb-1.5 mt-4 block text-[12px] font-medium text-ink-muted">Passphrase</label>
          <input
            className={field}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="at least 8 characters"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
          />

          {mode === "signup" && (
            <>
              <label className="mb-1.5 mt-4 block text-[12px] font-medium text-ink-muted">
                Display name <span className="text-ink-faint">— optional</span>
              </label>
              <input
                className={field}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="what someone sees when you share"
              />
            </>
          )}

          {error && (
            <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-200">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-2 disabled:opacity-50"
          >
            {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>

          <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
            There is no password reset and no admin account — nobody holds a key that opens
            everyone's results. Lose the passphrase and the records go with it.
          </p>
        </form>
      </div>
    </div>
  );
}
