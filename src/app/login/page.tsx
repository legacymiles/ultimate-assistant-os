"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Icon } from "@/components/icons";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const configured = isSupabaseConfigured();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = "/";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-white">
            <Icon.Layers width={24} height={24} />
          </div>
          <h1 className="mt-3 text-xl font-bold text-ink">Projects Timeline</h1>
          <p className="text-xs text-ink-faint">Ultimate Assistant OS</p>
        </div>

        {!configured ? (
          <div className="rounded-2xl border border-line bg-panel p-5 text-center">
            <p className="text-sm text-ink-muted">
              Supabase isn&apos;t configured, so accounts are disabled. The app runs in local
              demo mode — no sign-in needed.
            </p>
            <a
              href="/"
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
            >
              Continue to app
            </a>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-2xl border border-line bg-panel p-5">
            <div className="mb-4 flex rounded-xl border border-line p-1 text-sm">
              {(["signin", "signup"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={
                    "flex-1 rounded-lg py-1.5 font-medium transition " +
                    (mode === m ? "bg-brand text-white" : "text-ink-muted hover:text-ink")
                  }
                >
                  {m === "signin" ? "Sign in" : "Sign up"}
                </button>
              ))}
            </div>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium text-ink-faint">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </label>
            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-medium text-ink-faint">Password</span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </label>

            {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
            {message && <p className="mb-3 text-xs text-core">{message}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:opacity-50"
            >
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
