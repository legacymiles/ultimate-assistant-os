"use client";

// ---------------------------------------------------------------------------
// "Connect Facebook" — shown right where an import said the video is only for
// signed-in people, so the fix is one step from the error instead of a trip to
// the hosting dashboard.
//
// Two ways in, both one-time:
//   - On the computer: the Jarvis Record extension's "Connect Facebook &
//     Instagram" button sends the sign-in Chrome already has.
//   - Anywhere (phone included): paste a cookies export.
// The panel watches for the connection to land and re-runs the import by
// itself, so there is no "now go back and press the button again".
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Button, Spinner, Textarea } from "./ui";

interface SiteStatus {
  site: string;
  connected: boolean;
  updatedAt: string | null;
}

const LABEL: Record<string, string> = { facebook: "Facebook", instagram: "Instagram" };

export function ConnectSitePanel({ site, onConnected }: { site: string; onConnected: () => void }) {
  const label = LABEL[site] ?? "that site";
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; good?: boolean } | null>(null);
  const since = useRef<string | null>(null);
  const done = useRef(false);

  // Watch for the extension's push. Starts from whatever is saved now, so an
  // old (expired) connection doesn't count as the new one.
  useEffect(() => {
    let stop = false;
    let first = true;
    const check = async () => {
      try {
        const res = await fetch("/api/social-import/cookies", { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
          setAllowed(false);
          return;
        }
        const data = (await res.json()) as { sites?: SiteStatus[] };
        setAllowed(true);
        const s = data.sites?.find((x) => x.site === site);
        if (first) {
          since.current = s?.updatedAt ?? null;
          first = false;
        } else if (s?.updatedAt && s.updatedAt !== since.current && !done.current) {
          done.current = true;
          setMessage({ text: `${label} connected. Reading the recipe again…`, good: true });
          onConnected();
          return;
        }
      } catch {
        // Offline for a moment — keep watching.
      }
      if (!stop) timer = setTimeout(check, 3000);
    };
    let timer = setTimeout(check, 0);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [site, label, onConnected]);

  const save = async () => {
    if (!paste.trim() || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/social-import/cookies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site, cookies: paste }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: String(data.error || "That didn't save.") });
        return;
      }
      done.current = true;
      setPaste("");
      setMessage({ text: `${label} connected. Reading the recipe again…`, good: true });
      onConnected();
    } catch {
      setMessage({ text: "Couldn't reach the hub. Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  };

  // Someone who isn't the hub's owner can't connect the hub's account; for
  // them the upload route in the error above is the way through.
  if (allowed === false) return null;

  return (
    <div className="cc-rise mt-2 rounded-lg border border-[var(--cc-line)] bg-[var(--cc-panel-2)] p-3">
      <p className="text-[12.5px] font-semibold text-[var(--cc-ink)]">Connect {label} once — then links like this just work</p>
      <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
        <li>
          On your computer, make sure you&apos;re signed in to {label} in Chrome.
        </li>
        <li>
          Click the <strong>Jarvis Record</strong> extension (puzzle piece, top right) →{" "}
          <strong>Connect Facebook &amp; Instagram</strong>.{" "}
          <a className="underline" href="/apps/jarvis#dashboard" target="_blank" rel="noreferrer">
            Don&apos;t have it? Get it in Jarvis › Profile › Details.
          </a>
        </li>
        <li>This page notices on its own and reads the recipe again — nothing else to press.</li>
      </ol>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {allowed === null ? (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--cc-ink-faint)]">
            <Spinner size={12} /> Checking…
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--cc-ink-faint)]">
            <Spinner size={12} /> Waiting for {label} to connect…
          </span>
        )}
        <Button onClick={() => setShowPaste((v) => !v)}>{showPaste ? "Hide" : "On a phone? Paste instead"}</Button>
      </div>

      {showPaste && (
        <div className="mt-2 space-y-2">
          <Textarea
            rows={3}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={`Paste your ${label} cookies (a cookies.txt, a JSON export, or the Cookie header)…`}
          />
          <Button variant="primary" disabled={!paste.trim() || saving} onClick={() => void save()}>
            {saving ? <Spinner size={14} /> : null}
            Save &amp; read again
          </Button>
        </div>
      )}

      {message && (
        <p
          aria-live="polite"
          className={`mt-2 text-[12px] ${message.good ? "text-[var(--cc-live)]" : "text-[var(--cc-loss)]"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
