"use client";

import { useState } from "react";
import { useCookbook } from "../CookbookGenie";

interface Props {
  mode: "login" | "signup";
}

export function AuthView({ mode }: Props) {
  const { sb, isLocal, navigate } = useCookbook();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [showReset, setShowReset] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: err } = await sb.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (err) setError(err.message);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    setError(null);
    const { error: err } = await sb.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    setLoading(false);
    if (err) {
      setError(err.message);
    } else {
      setError(null);
      navigate({ page: "login" });
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await sb.auth.resetPasswordForEmail(email);
    setLoading(false);
    setResetSent(true);
  };

  if (showReset) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <LogoBlock />
            <h1 className="text-3xl font-bold text-ink" style={{ fontFamily: "Georgia, serif" }}>
              Reset password
            </h1>
            <p className="mt-2 text-ink-muted">Enter your email to receive a reset link</p>
          </div>
          {resetSent ? (
            <div className="rounded-lg border border-line bg-panel p-4 text-center">
              <p className="text-ink">Check your email for the reset link.</p>
              <button onClick={() => { setShowReset(false); setResetSent(false); }} className="mt-3 text-sm text-[#e67e22] hover:underline">
                Back to login
              </button>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <input
                type="email" placeholder="chef@kitchen.com" value={email}
                onChange={(e) => setEmail(e.target.value)} required
                className="w-full rounded-lg border border-line bg-elevated px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-[#e67e22] focus:outline-none"
              />
              <button type="submit" disabled={loading}
                className="w-full rounded-lg bg-[#e67e22] px-4 py-2.5 font-medium text-white hover:bg-[#d35400] disabled:opacity-50">
                {loading ? "Sending..." : "Send reset link"}
              </button>
              <button type="button" onClick={() => setShowReset(false)} className="block w-full text-center text-sm text-ink-muted hover:text-ink">
                Back to login
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <LogoBlock />
          <h1 className="text-3xl font-bold text-ink" style={{ fontFamily: "Georgia, serif" }}>
            {mode === "login" ? "Welcome back" : "Create your cookbook"}
          </h1>
          <p className="mt-2 text-ink-muted">
            {mode === "login" ? "Sign in to your recipe cookbook" : "Start collecting AI-powered recipes"}
          </p>
        </div>

        {isLocal && (
          <div className="rounded-lg border border-[#e67e22]/30 bg-[#e67e22]/10 px-4 py-3 text-sm text-[#e67e22]">
            <strong>Local demo mode.</strong> No account needed — enter anything (or use any email/password) to sign in. Your cookbooks are saved in this browser.
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={mode === "login" ? handleLogin : handleSignup} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink">Display name</label>
              <input
                type="text" placeholder="Chef Miles" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)} required
                className="w-full rounded-lg border border-line bg-elevated px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-[#e67e22] focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Email</label>
            <input
              type="email" placeholder="chef@kitchen.com" value={email}
              onChange={(e) => setEmail(e.target.value)} required
              className="w-full rounded-lg border border-line bg-elevated px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-[#e67e22] focus:outline-none"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium text-ink">Password</label>
              {mode === "login" && (
                <button type="button" onClick={() => setShowReset(true)} className="text-sm text-[#e67e22] hover:underline">
                  Forgot password?
                </button>
              )}
            </div>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"} placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)} required minLength={6}
                className="w-full rounded-lg border border-line bg-elevated px-3 py-2.5 pr-10 text-ink placeholder:text-ink-faint focus:border-[#e67e22] focus:outline-none"
              />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink">
                {showPw ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full rounded-lg bg-[#e67e22] px-4 py-2.5 font-medium text-white hover:bg-[#d35400] disabled:opacity-50 transition-colors">
            {loading ? (mode === "login" ? "Signing in..." : "Creating account...") : (mode === "login" ? "Sign in" : "Create account")}
          </button>
        </form>

        <p className="text-center text-sm text-ink-muted">
          {mode === "login" ? "Don't have an account? " : "Already have an account? "}
          <button
            onClick={() => navigate({ page: mode === "login" ? "signup" : "login" })}
            className="font-medium text-[#e67e22] hover:underline"
          >
            {mode === "login" ? "Create one" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}

function LogoBlock() {
  return (
    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e67e22]">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
        <path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.646-7.544 6 6 0 0 0-11.162 0A4 4 0 0 0 2.32 14.58c.46.217.68.593.68 1.06V20a1 1 0 0 0 1 1z" />
        <path d="M6 17h12" />
      </svg>
    </div>
  );
}

function EyeIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></svg>;
}

function EyeOffIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path d="m2 2 20 20" /></svg>;
}
