"use client";

// The last stop of a sign-in started inside a frame (see signInFromFrame in
// src/lib/auth/google.ts). The session cookies are already set by
// /auth/callback; this page tells the frame that opened it and closes itself.

import { useEffect, useState } from "react";
import { AUTH_CHANNEL } from "@/lib/auth/google";

export default function PopupDone() {
  const [stayed, setStayed] = useState(false);

  useEffect(() => {
    try {
      window.opener?.postMessage({ type: `${AUTH_CHANNEL}:done` }, window.location.origin);
    } catch {
      // Google may have cut the link to the opener; the broadcast below still lands.
    }
    try {
      const channel = new BroadcastChannel(AUTH_CHANNEL);
      channel.postMessage("done");
      channel.close();
    } catch {
      // Older browser: the frame notices the session by itself.
    }
    const t = window.setTimeout(() => {
      window.close();
      // Still here: it was opened as a tab, which a page can't close itself.
      window.setTimeout(() => setStayed(true), 300);
    }, 250);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 text-center">
      <div>
        <h1 className="text-lg font-semibold text-ink">You&apos;re signed in</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {stayed ? "You can close this tab — the page you were on carries on by itself." : "Closing this window…"}
        </p>
      </div>
    </div>
  );
}
