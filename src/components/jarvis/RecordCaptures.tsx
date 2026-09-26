"use client";

// ---------------------------------------------------------------------------
// What the browser extension sent in, and the button that connects it.
//
// The extension can only ever put things in the buffer — it cannot write the
// Life Record, because the record lives in this browser and the server has no
// session with which to touch it. So everything it captures arrives here, as a
// proposal, and the owner confirms it exactly as they confirm a value read off
// a document. One doorway into the record, not two.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../icons";
import { addEntry, setField, updateEntry } from "@/lib/jarvis/record/store";
import { FIELD_BY_KEY, labelForKey, parseKey, type LifeRecord } from "@/lib/jarvis/record/types";

interface CapturedValue {
  key: string;
  value: string;
  label: string;
  by: string;
  confidence: number;
}

interface Capture {
  id: string;
  site: string;
  title: string;
  receivedAt: string;
  values: CapturedValue[];
}

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-40";

/** How the matcher placed it, in words the owner can weigh. */
const BY_LABEL: Record<string, string> = {
  autocomplete: "the page said so",
  name: "matched the field's name",
  label: "read off the label",
  learned: "you taught it this site",
  model: "worked out from the label",
};

export function RecordCaptures({
  record,
  onChange,
}: {
  record: LifeRecord;
  onChange: (r: LifeRecord) => void;
}) {
  const [captures, setCaptures] = useState<Capture[] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dropped, setDropped] = useState<Record<string, string[]>>({});

  const refresh = useCallback(async () => {
    try {
      const [cap, tok] = await Promise.all([
        fetch("/api/jarvis/record/capture").then((r) => r.json()),
        fetch("/api/jarvis/record/token").then((r) => r.json()),
      ]);
      setCaptures(Array.isArray(cap.captures) ? cap.captures : []);
      setConnected(cap.captures !== undefined ? Boolean(tok.connected) : null);
    } catch {
      setCaptures([]);
      setConnected(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/jarvis/record/token", { method: "POST" });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error ?? "Could not mint a token.");
      setToken(data.token);
      setConnected(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mint a token.");
    } finally {
      setBusy(false);
    }
  };

  const drop = async (id: string) => {
    setCaptures((cs) => (cs ?? []).filter((c) => c.id !== id));
    await fetch(`/api/jarvis/record/capture?ids=${encodeURIComponent(id)}`, { method: "DELETE" });
  };

  /** Keep the ones still showing, then clear the capture from the buffer. */
  const keep = async (capture: Capture) => {
    const refused = new Set(dropped[capture.id] ?? []);
    let next = record;
    for (const v of capture.values) {
      if (refused.has(v.key)) continue;
      const origin = `${capture.site || "a website"}, ${BY_LABEL[v.by] ?? v.by}`;
      const parsed = parseKey(v.key);
      if (!parsed) continue;
      if (!parsed.groupId) {
        next = setField(next, parsed.field, v.value, "document", origin);
        continue;
      }
      // Every grouped value from one capture belongs to the SAME entry: a form
      // asking for an employer and a job title is asking about one job. Adding
      // an entry per value would turn one previous job into four blank ones.
      const rows = next.groups[parsed.groupId] ?? [];
      const target = rows.find((e) => e.origin === origin);
      next = target
        ? updateEntry(next, parsed.groupId, target.id, { [parsed.field]: v.value })
        : addEntry(next, parsed.groupId, { [parsed.field]: v.value }, "document", origin);
    }
    onChange(next);
    await drop(capture.id);
  };

  const refuse = (captureId: string, key: string) =>
    setDropped((d) => ({ ...d, [captureId]: [...(d[captureId] ?? []), key] }));

  const waiting = captures?.length ?? 0;

  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">
            From the websites you fill in
            {waiting > 0 && (
              <span className="ml-2 rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-brand">
                {waiting} waiting
              </span>
            )}
          </h3>
          <p className="mt-0.5 max-w-[70ch] text-[11px] leading-snug text-ink-faint">
            The browser extension saves what you type into a job or benefits application and sends it
            here. Nothing enters your Record until you keep it.
          </p>
        </div>
        {connected === false && (
          <button type="button" className={btn} disabled={busy} onClick={connect}>
            <Icon.Link className="h-3.5 w-3.5" />
            {busy ? "Connecting…" : "Connect your browser"}
          </button>
        )}
        {connected === true && !token && (
          <button type="button" className={btn} disabled={busy} onClick={connect}>
            <Icon.Refresh className="h-3.5 w-3.5" />
            New token
          </button>
        )}
      </header>

      {error && <p className="border-t border-line-soft px-3 py-2 text-xs text-rose-300">{error}</p>}

      {token && (
        <div className="border-t border-line-soft px-3 py-3">
          <p className="text-xs text-ink-muted">
            Paste this into the extension's options, with your hub&apos;s address. It is shown once —
            mint a new one any time, which stops the old one working.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-canvas px-2.5 py-2 font-mono text-xs text-ink">
              {token}
            </code>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                void navigator.clipboard.writeText(token).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2500);
                });
              }}
            >
              <Icon.Copy className="h-3.5 w-3.5" />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-ink-faint">
            The extension is in <code className="text-ink-muted">extension/jarvis-record</code> of
            this repo. Load it once at <code className="text-ink-muted">chrome://extensions</code> →
            Developer mode → Load unpacked.
          </p>
        </div>
      )}

      {captures === null ? (
        <p className="border-t border-line-soft px-3 py-3 text-xs text-ink-faint">Checking…</p>
      ) : !captures.length ? (
        <p className="border-t border-line-soft px-3 py-3 text-xs text-ink-faint">
          {connected
            ? "Nothing waiting. Fill in an application, then press Save in the extension."
            : "Connect your browser and the applications you fill in will start feeding this."}
        </p>
      ) : (
        <ul>
          {captures.map((capture) => {
            const refused = new Set(dropped[capture.id] ?? []);
            const live = capture.values.filter((v) => !refused.has(v.key));
            return (
              <li key={capture.id} className="border-t border-line">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{capture.site || "A website"}</p>
                    <p className="truncate text-[11px] text-ink-faint">
                      {capture.title || "Untitled page"} ·{" "}
                      {new Date(capture.receivedAt).toLocaleString(undefined, {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className={btn} onClick={() => void drop(capture.id)}>
                      Discard
                    </button>
                    <button
                      type="button"
                      className={btnPrimary}
                      disabled={!live.length}
                      onClick={() => void keep(capture)}
                    >
                      <Icon.Check className="h-3.5 w-3.5" />
                      Keep {live.length}
                    </button>
                  </div>
                </div>
                <ul className="bg-canvas/40">
                  {capture.values.map((v) => {
                    const label = labelForKey(v.key);
                    const gone = refused.has(v.key);
                    const held = FIELD_BY_KEY.has(v.key) ? record.fields[v.key]?.value : undefined;
                    return (
                      <li
                        key={v.key}
                        className={`grid grid-cols-[1fr_auto] items-start gap-3 border-t border-line-soft px-3 py-1.5 ${
                          gone ? "opacity-40" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-ink">
                            <span className="text-ink-muted">{label ?? v.key}</span>
                            <span className="mx-1.5 text-ink-faint">→</span>
                            {v.value}
                          </p>
                          <p className="truncate text-[11px] text-ink-faint">
                            {v.label ? `“${v.label}” · ` : ""}
                            {BY_LABEL[v.by] ?? v.by}
                            {held && held !== v.value ? ` · replaces “${held}”` : ""}
                          </p>
                        </div>
                        {!gone && (
                          <button
                            type="button"
                            title="Leave this one out"
                            aria-label={`Leave out ${label ?? v.key}`}
                            onClick={() => refuse(capture.id, v.key)}
                            className="rounded-lg border border-line p-1.5 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
                          >
                            <Icon.Close className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
