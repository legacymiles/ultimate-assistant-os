"use client";

import { useState } from "react";
import { useCook } from "../CookConnect";
import { Button, Field, Input, Spinner } from "../ui";

export function AuthView() {
  const { sb, isLocal } = useCook();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

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
            any email and password — the community you see is a demo, and two tabs of this browser can
            genuinely play each other.
          </p>
        )}
      </div>
    </div>
  );
}
