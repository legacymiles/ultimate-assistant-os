"use client";

// ---------------------------------------------------------------------------
// Sign in with Google, in one click.
//
// Two routes to the same account, and the difference matters:
//
//   One Tap      — Google's own prompt, shown over the page. The visitor picks
//                  their account and is signed in without ever leaving; there
//                  is no redirect and no second page. This is the "one click"
//                  and it needs NEXT_PUBLIC_GOOGLE_CLIENT_ID.
//   OAuth button — the ordinary redirect to accounts.google.com and back
//                  through /auth/callback. Needs nothing but the Google
//                  provider switched on in Supabase, so it is the path that
//                  always works and the one the button uses.
//
// The page offers both: One Tap fires on its own when it can, and the button
// is there regardless, so a blocked prompt or a missing client id costs the
// visitor nothing.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

export function oneTapAvailable(): boolean {
  return Boolean(GOOGLE_CLIENT_ID);
}

const GSI_SRC = "https://accounts.google.com/gsi/client";

interface CredentialResponse {
  credential?: string;
}

interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (config: Record<string, unknown>) => void;
      prompt: () => void;
      cancel: () => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

/** Load Google's script once, and resolve false rather than throw if blocked. */
function loadGsi(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.google?.accounts?.id) return Promise.resolve(true);

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.google?.accounts?.id)));
      existing.addEventListener("error", () => resolve(false));
      return;
    }
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(Boolean(window.google?.accounts?.id));
    // An ad blocker or an offline machine is an ordinary state here, not an
    // error: the button below the prompt still signs the visitor in.
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

/**
 * A nonce, in the two forms the handshake needs.
 *
 * Google is given the SHA-256 hash and mints a token containing it; Supabase
 * is given the raw value and checks that it hashes to what the token carries.
 * That is what stops a token minted for some other page being replayed here,
 * so the pair must come from one generation and never be reused.
 */
async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = btoa(String.fromCharCode(...bytes));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { raw, hashed };
}

/**
 * Show Google's One Tap prompt and sign the visitor in where they stand.
 *
 * Returns false when the prompt could not run at all — no client id, script
 * blocked, unsupported browser — which is a cue to say nothing and let the
 * button do the work, not to show an error.
 */
export async function startOneTap(
  supabase: SupabaseClient,
  onSignedIn: () => void,
  onError: (message: string) => void,
): Promise<boolean> {
  if (!oneTapAvailable()) return false;
  if (!(await loadGsi())) return false;

  const { raw, hashed } = await makeNonce();

  try {
    window.google?.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      nonce: hashed,
      // FedCM is how Chrome intends this prompt to be shown from 2025 on;
      // without it the prompt is silently suppressed in more and more cases.
      use_fedcm_for_prompt: true,
      auto_select: false,
      cancel_on_tap_outside: true,
      callback: (response: CredentialResponse) => {
        if (!response.credential) return;
        void supabase.auth
          .signInWithIdToken({ provider: "google", token: response.credential, nonce: raw })
          .then(({ error }) => {
            if (error) onError(error.message);
            else onSignedIn();
          });
      },
    });
    window.google?.accounts.id.prompt();
    return true;
  } catch {
    return false;
  }
}

/** Dismiss the prompt — used when the page unmounts mid-decision. */
export function cancelOneTap(): void {
  try {
    window.google?.accounts.id.cancel();
  } catch {
    // The script may never have loaded; nothing to cancel.
  }
}

/**
 * The redirect route: off to Google and back through /auth/callback.
 *
 * `next` rides along so the callback can return the visitor to the page they
 * were trying to reach. Where they are allowed to land is the middleware's
 * decision, not this function's — an owner gets the hub, anyone else gets the
 * public app, and that rule lives in one place.
 */
export async function signInWithGoogle(supabase: SupabaseClient, next = "/"): Promise<void> {
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      // Ask Google to show the chooser rather than silently reusing the last
      // account: a shared machine should never sign someone in as the owner.
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
}
