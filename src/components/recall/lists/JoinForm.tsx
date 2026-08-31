"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "../../icons";
import { MEMBER_COLOURS, initials } from "@/lib/recall/lists/types";

// ---------------------------------------------------------------------------
// The door for family members.
//
// With ?t=<token> it is a one-time signup; without one (or once the link is
// spent) it is a plain sign-in. Deliberately says nothing about whether a link
// expired, was already used, or never existed — all three are the same answer
// to whoever is holding it.
// ---------------------------------------------------------------------------

interface Check {
  valid: boolean;
  freeColours: string[];
  takenNames: string[];
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-2xl">
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-white">
            <Icon.ListChecks width={24} height={24} />
          </div>
          <h1 className="mt-3 text-xl font-bold text-ink">Family lists</h1>
          <p className="mt-1 text-xs text-ink-faint">
            The shared board — to-do, to-buy, things to remember.
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Inner() {
  const token = useSearchParams().get("t") ?? "";
  const [check, setCheck] = useState<Check | null>(null);
  const [mode, setMode] = useState<"loading" | "join" | "signin">(token ? "loading" : "signin");

  const [name, setName] = useState("");
  const [colour, setColour] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/recall/lists/join?t=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d: Check) => {
        setCheck(d);
        setColour(d.freeColours[0] ?? "");
        setMode(d.valid ? "join" : "signin");
      })
      .catch(() => setMode("signin"));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "join") {
      if (password.length < 8) return setError("Use at least 8 characters.");
      if (password !== confirm) return setError("The two passwords do not match.");
      if (check?.takenNames.includes(name.trim().toLowerCase())) {
        return setError("Someone is already using that name.");
      }
    }

    setBusy(true);
    try {
      const res = await fetch(
        mode === "join" ? "/api/recall/lists/join" : "/api/recall/lists/session",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "join" ? { token, name, colour, password } : { name, password },
          ),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "That did not work.");
        return;
      }
      // Full reload so the server sees the new cookie on the next render.
      window.location.href = "/apps/recall/lists";
    } catch {
      setError("No connection.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "loading") {
    return (
      <Card>
        <p className="text-center text-xs text-ink-muted">Checking the link…</p>
      </Card>
    );
  }

  const joining = mode === "join";
  const free = MEMBER_COLOURS.filter((c) => check?.freeColours.includes(c.id));

  return (
    <Card>
      {token && !joining && (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
          That link is no longer valid — ask for a new one. If you already joined, sign in below.
        </p>
      )}

      <form onSubmit={submit}>
        <label className="mb-3 block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Your name
          </span>
          <input
            required
            autoFocus
            maxLength={24}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="username"
            placeholder="Jack"
            className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </label>

        {joining && (
          <fieldset className="mb-3">
            <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Your colour
            </legend>
            <div className="flex flex-wrap gap-2">
              {free.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColour(c.id)}
                  aria-label={c.label}
                  title={c.label}
                  className={
                    "flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold transition " +
                    c.dot + " " + c.ink +
                    (colour === c.id
                      ? " ring-2 ring-ink ring-offset-2 ring-offset-panel"
                      : " opacity-70 hover:opacity-100")
                  }
                >
                  {name.trim() ? initials(name) : ""}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10.5px] text-ink-faint">
              Everything you add to the board is marked in this colour.
            </p>
          </fieldset>
        )}

        <label className="mb-3 block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Password
          </span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={joining ? "new-password" : "current-password"}
            className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </label>

        {joining && (
          <label className="mb-3 block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Again
            </span>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </label>
        )}

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy || !name.trim() || !password || (joining && !colour)}
          className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:opacity-50"
        >
          {busy ? "One moment…" : joining ? "Join the board" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-faint">
        {joining
          ? "You only do this once. After that, sign in with the name and password you just chose."
          : "You need an invite link from whoever set the board up."}
      </p>

      <Link
        href="/"
        className="mt-4 block text-center text-xs text-ink-faint underline-offset-2 hover:text-ink hover:underline"
      >
        ← Back to hub
      </Link>
    </Card>
  );
}

export function JoinForm() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
