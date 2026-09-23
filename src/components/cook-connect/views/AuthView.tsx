"use client";

import { useState } from "react";
import { useCook } from "../CookConnect";
import { Button, Field, Input, Spinner } from "../ui";

/** Google's mark, drawn rather than imported — it is a brand asset, not an icon. */
function GoogleMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8a10 10 0 0 1-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.3z" />
      <path fill="#34A853" d="M24 46c6 0 11-2 14.5-5.2l-7.1-5.5a13 13 0 0 1-19.3-6.8H4.8v5.7A22 22 0 0 0 24 46z" />
      <path fill="#FBBC05" d="M11.7 28.5a13 13 0 0 1 0-8.4v-5.7H4.8a22 22 0 0 0 0 19.8l6.9-5.7z" />
      <path fill="#EA4335" d="M24 10.8c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3A21 21 0 0 0 24 2 22 22 0 0 0 4.8 14.4l6.9 5.7A13 13 0 0 1 24 10.8z" />
    </svg>
  );
}

export function AuthView() {
  const { sb, isLocal } = useCook();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  /**
   * Google sign-in goes through the hub's existing /auth/callback route, which
   * exchanges the code for a session and sends you back here.
   */
  const signInWithGoogle = async () => {
    setError(null);
    if (isLocal) {
      setError("Google sign-in needs a real database. Without keys, sign in with any email and password.");
      return;
    }
    setGoogle(true);
    const { error: err } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/apps/cook-connect`,
      },
    });
    if (err) {
      setGoogle(false);
      // The exact failure when the provider has not been switched on in the
      // Supabase project, which is easy to mistake for a code problem.
      setError(
        /not enabled|unsupported provider/i.test(err.message)
          ? "Google isn't switched on for this project yet: Supabase → Authentication → Providers → Google."
          : err.message,
      );
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = mode === "in"
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signUp({ email, password, options: { data: { display_name: name || undefined } } });
    setBusy(false);
    if (err) { setError(err.message); return; }
    if (mode === "up" && !isLocal) setSent(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[26rem]">
        <div className="mb-7">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">
            Cook<span className="text-[var(--cc-ember)]">Connect</span>
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--cc-ink-muted)]">
            Share what you cook, save the cookbooks worth keeping, and play the people who wrote them.
          </p>
        </div>

        {sent ? (
          <div className="rounded-[var(--cc-radius)] border border-[var(--cc-line)] bg-[var(--cc-panel)] p-5">
            <p className="text-[14px] font-semibold">Check your email</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--cc-ink-muted)]">
              We sent a confirmation link to {email}. Open it and you are in.
            </p>
            <Button className="mt-4" onClick={() => { setSent(false); setMode("in"); }}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="space-y-3 rounded-[var(--cc-radius)] border border-[var(--cc-line)] bg-[var(--cc-panel)] p-5"
          >
            <Button
              type="button"
              disabled={google || busy}
              onClick={() => void signInWithGoogle()}
              className="w-full justify-center py-2"
            >
              {google ? <Spinner size={14} /> : <GoogleMark size={16} />}
              {google ? "Opening Google…" : "Continue with Google"}
            </Button>

            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-[var(--cc-line)]" />
              <span className="text-[11px] uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">or</span>
              <span className="h-px flex-1 bg-[var(--cc-line)]" />
            </div>

            <div className="mb-1 flex gap-1">
              {(["in", "up"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError(null); }}
                  className={
                    "rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors duration-150 "
                    + (mode === m
                      ? "bg-[var(--cc-elevated)] text-[var(--cc-ink)]"
                      : "text-[var(--cc-ink-faint)] hover:text-[var(--cc-ink-muted)]")
                  }
                >
                  {m === "in" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>

            {mode === "up" && (
              <Field label="Name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="What people should call you"
                  autoComplete="name"
                />
              </Field>
            )}

            <Field label="Email">
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </Field>

            <Field label="Password" hint={mode === "up" ? "At least six characters." : undefined}>
              <Input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "in" ? "current-password" : "new-password"}
              />
            </Field>

            {error && (
              <p role="alert" className="text-[12px] leading-relaxed text-[var(--cc-loss)]">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" disabled={busy} className="w-full py-2">
              {busy && <Spinner size={14} />}
              {mode === "in" ? "Sign in" : "Create account"}
            </Button>
          </form>
        )}

        {isLocal && (
          <p className="mt-4 rounded-lg border border-[#3a3420] bg-[#1c1a10] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--cc-gold)]">
            No database is configured, so Cook Connect is running entirely in this browser. Sign in with
            any email and password. It starts empty, like the real thing — but the computer will play
            you at either game, and two tabs of this browser can genuinely play each other.
          </p>
        )}
      </div>
    </div>
  );
}
