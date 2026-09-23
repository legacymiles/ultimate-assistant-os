"use client";

// ---------------------------------------------------------------------------
// The front door. One button.
//
// There was an email-and-password form here with a Sign in / Sign up toggle,
// which asked a visitor to invent and remember a credential before they had
// seen anything. Google's prompt does the same job in one click, and leaves no
// password for this site to hold or leak.
//
// The email form survives only as an escape hatch, collapsed and labelled as
// one, because this page is the only way into the hub: if the Google provider
// has not been switched on in Supabase yet, the owner still needs a way in.
// Once Google works it can be deleted outright — see EmergencyEmailForm.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { cancelOneTap, oneTapAvailable, signInWithGoogle, startOneTap } from "@/lib/auth/google";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/** Google's mark, in its own four colours. Their guidelines require this. */
function GoogleMark(props: { size?: number }) {
  const s = props.size ?? 18;
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const configured = isSupabaseConfigured();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);

  // One Tap runs itself. It is not announced and its failures are not shown:
  // a blocked prompt should leave the page looking exactly as it does now,
  // with the button still there.
  useEffect(() => {
    if (!configured || !oneTapAvailable()) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    void startOneTap(
      supabase,
      () => {
        window.location.href = "/";
      },
      setError,
    );
    return cancelOneTap;
  }, [configured]);

  const google = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle(supabase);
      // A redirect is in flight; the button stays busy until the page leaves.
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google sign-in failed.";
      setError(
        /provider is not enabled|Unsupported provider/i.test(message)
          ? "Google sign-in is not switched on for this project yet. Enable the Google provider in "
            + "Supabase → Authentication → Providers, then try again."
          : message,
      );
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
          <h1 className="mt-3 text-xl font-bold text-ink">Ultimate Assistant OS</h1>
          <p className="text-xs text-ink-faint">Every app in one place</p>
        </div>

        {!configured ? (
          <div className="rounded-2xl border border-line bg-panel p-5 text-center">
            <p className="text-sm text-ink-muted">
              Supabase isn&apos;t configured, so accounts are disabled. The app runs in local demo
              mode — no sign-in needed.
            </p>
            <a
              href="/"
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
            >
              Continue to app
            </a>
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-panel p-5">
            <button
              type="button"
              onClick={() => void google()}
              disabled={busy}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#1f1f1f] shadow-[0_8px_24px_-14px_rgb(0_0_0_/_0.9)] transition hover:bg-[#f3f4f6] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
            >
              {busy ? (
                <Icon.Refresh width={16} height={16} className="animate-spin text-[#5f6368]" />
              ) : (
                <GoogleMark />
              )}
              {busy ? "Taking you to Google…" : "Continue with Google"}
            </button>

            <p className="mt-3 text-center text-[12px] leading-relaxed text-ink-muted">
              First time here? The same button makes your account. No password to choose, and none
              for this site to keep.
            </p>

            {error && (
              <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 text-[12px] leading-relaxed text-amber-200">
                {error}
              </p>
            )}

            {!showFallback ? (
              <button
                type="button"
                onClick={() => setShowFallback(true)}
                className="mx-auto mt-4 block rounded px-2 py-1 text-[11.5px] text-ink-faint underline decoration-line underline-offset-4 transition hover:text-ink-muted hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
              >
                Trouble with Google?
              </button>
            ) : (
              <EmergencyEmailForm />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The way in when Google is not available. Deliberately not the main path.
 *
 * It exists for one reason: this page is the only door to the hub, and a
 * project whose Google provider is not configured yet would otherwise lock the
 * owner out of their own site. Sign-up is gone from it — a new account is a
 * Google account — so this only opens a door that already exists. Delete this
 * component and its one call site once Google sign-in is working.
 */
function EmergencyEmailForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 border-t border-line-soft pt-4">
      <p className="mb-3 text-[11.5px] leading-relaxed text-ink-faint">
        Existing password accounts only — this is a fallback, not a second way to sign up.
      </p>
      <label className="mb-2.5 block">
        <span className="mb-1 block text-[11px] font-medium text-ink-faint">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </label>
      <label className="mb-3 block">
        <span className="mb-1 block text-[11px] font-medium text-ink-faint">Password</span>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </label>

      {error && <p className="mb-3 text-[12px] text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2 text-[13px] font-medium text-ink transition hover:bg-elevated disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
      >
        {busy ? "Please wait…" : "Sign in with a password"}
      </button>
    </form>
  );
}
