"use client";

// The screen people see instead of a white page (checklist R1 + R3): plain
// words, what happened to the problem, and two ways forward. Shared by the
// route boundary (app/error.tsx) and the root one (app/global-error.tsx).

import { useEffect } from "react";
import { reportError } from "@/lib/site-errors/client";

export function CrashScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error, "render", { digest: error.digest });
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#0a0b0f",
        color: "#e8eaf0",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8b90a0", margin: 0 }}>Something broke</p>
        <h1 style={{ fontSize: 22, margin: "10px 0 8px", fontWeight: 600 }}>This page hit a problem.</h1>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: "#b4b8c5", margin: 0 }}>
          It&apos;s been logged automatically, so it can be fixed. Trying again usually works; if it keeps happening, go back to the start.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
          <button
            type="button"
            onClick={reset}
            style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #3b82f6", background: "#3b82f6", color: "white", fontSize: 14, cursor: "pointer" }}
          >
            Try again
          </button>
          <a href="/" style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #2a2e3a", color: "#e8eaf0", fontSize: 14, textDecoration: "none" }}>
            Go to the start
          </a>
        </div>
      </div>
    </main>
  );
}
