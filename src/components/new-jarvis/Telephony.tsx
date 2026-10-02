"use client";

// ---------------------------------------------------------------------------
// When Jarvis should ring you — and, mostly, when it should not.
//
// The hero of this panel is the log of calls it DIDN'T make. That is not a
// debug view: it is the whole reason the feature ships dormant. With no
// provider configured at all, every trigger is still judged and the reasoning
// written down, so the owner can watch what it would have done for a week and
// tune the rules before spending a penny on a phone bill.
//
// Trust in something allowed to ring your phone is built by watching it decline
// to. A feature like this gets switched off for good after one bad week, so the
// defaults are narrow and the reasons are in plain words.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import {
  decide,
  DECLINE_REASON,
  defaultPolicy,
  describeVerdict,
  emptyCallState,
  type CallPolicy,
  type CallState,
} from "@/lib/telephony/decide";
import { UPDATE_LABEL, UPDATE_SOURCES, type JarvisUpdate, type UpdateSource } from "@/lib/jarvis/updates";

const POLICY_KEY = "jarvis-calls";

interface Blob {
  policy: CallPolicy;
  state: CallState;
}

interface Status {
  ready: boolean;
  reason: string;
  providerName: string;
  toHint: string;
  options: { id: string; name: string; available: boolean; reason: string }[];
}

interface CallRecord {
  reference: string;
  status: string;
  summary: string;
  requests: string[];
  at: string;
}

export function Telephony({ updates, lastSeenAt }: { updates: JarvisUpdate[]; lastSeenAt?: string | null }) {
  const [blob, setBlob] = useState<Blob>(() => ({ policy: defaultPolicy(), state: emptyCallState() }));
  const [status, setStatus] = useState<Status | null>(null);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [testing, setTesting] = useState("");

  const reload = useCallback(() => {
    const raw = loadLocal<Partial<Blob>>(POLICY_KEY, { policy: defaultPolicy(), state: emptyCallState() });
    setBlob({
      policy: { ...defaultPolicy(), ...(raw.policy ?? {}) },
      state: { ...emptyCallState(), ...(raw.state ?? {}) },
    });
  }, []);
  useEffect(reload, [reload]);
  useRemotePull(POLICY_KEY, reload);

  useEffect(() => {
    void fetch("/api/jarvis/call", { cache: "no-store" })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
    void fetch("/api/jarvis/call/webhook", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCalls(d.calls ?? []))
      .catch(() => setCalls([]));
  }, []);

  const commit = useCallback((next: Blob) => {
    setBlob(next);
    saveSynced(POLICY_KEY, next);
  }, []);

  const setPolicy = useCallback(
    (patch: Partial<CallPolicy>) => commit({ ...blob, policy: { ...blob.policy, ...patch } }),
    [blob, commit],
  );

  // Judged live against the real feed, with the real rules — including when
  // there is no provider. That IS the feature while it is dormant.
  const verdict = useMemo(
    () =>
      decide({
        updates,
        policy: blob.policy,
        state: blob.state,
        now: Date.now(),
        lastSeenAt,
        providerReady: Boolean(status?.ready),
      }),
    [blob.policy, blob.state, lastSeenAt, status?.ready, updates],
  );

  const test = useCallback(async () => {
    setTesting("Ringing…");
    try {
      const res = await fetch("/api/jarvis/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const data = (await res.json()) as { placed?: boolean; reason?: string };
      setTesting(data.placed ? "Calling you now." : (data.reason ?? "It could not place the call."));
    } catch (e) {
      setTesting(e instanceof Error ? e.message : "It could not place the call.");
    }
  }, []);

  const toggleSource = (source: UpdateSource) => {
    const on = blob.policy.sources.includes(source);
    setPolicy({ sources: on ? blob.policy.sources.filter((s) => s !== source) : [...blob.policy.sources, source] });
  };

  return (
    <section className="space-y-3">
      {/* --- where it stands ------------------------------------------- */}
      <header className="rounded-md border border-line bg-panel p-3">
        <div className="flex items-center gap-2">
          <Icon.Bell width={13} height={13} className="text-ink-muted" aria-hidden />
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Calling you</h2>
          <span
            className={`ml-auto rounded-full border px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide ${
              status?.ready ? "border-core/40 text-core" : "border-line text-ink-faint"
            }`}
          >
            {status?.ready ? "connected" : "not connected"}
          </span>
        </div>

        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted">
          {status?.ready
            ? `${status.providerName} will ring ${status.toHint}.`
            : "No phone service is connected, so nothing will ever ring. Everything below still runs — that is the point."}
        </p>
        {status && !status.ready && status.reason && (
          <p className="mt-1 font-mono text-[10.5px] leading-relaxed text-ink-faint">{status.reason}</p>
        )}

        {status?.ready && (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void test()}
              className="rounded border border-line bg-panel-2 px-2 py-1 text-[11px] text-ink transition hover:border-ink-faint hover:bg-elevated"
            >
              Ring me now, as a test
            </button>
            {testing && <span className="text-[10.5px] text-ink-muted">{testing}</span>}
          </div>
        )}

        {status && status.options.some((o) => !o.available) && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[10.5px] text-ink-faint">What it could use</summary>
            <ul className="mt-1 space-y-0.5">
              {status.options.map((o) => (
                <li key={o.id} className="text-[10.5px] leading-relaxed text-ink-faint">
                  <span className={o.available ? "text-core" : "text-ink-muted"}>{o.name}</span>
                  {o.reason ? ` — ${o.reason}` : " — ready"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </header>

      {/* --- the rules --------------------------------------------------- */}
      <div className="rounded-md border border-line bg-panel p-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">When it may ring</h3>
          <button
            type="button"
            role="checkbox"
            aria-checked={blob.policy.enabled}
            onClick={() => setPolicy({ enabled: !blob.policy.enabled })}
            className="ml-auto flex items-center gap-1.5 rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            <span
              className={`flex size-3 items-center justify-center rounded-[3px] border ${
                blob.policy.enabled ? "border-brand-2 bg-brand-2 text-white" : "border-line text-transparent"
              }`}
              aria-hidden
            >
              <Icon.Check width={8} height={8} />
            </span>
            Allowed to call
          </button>
        </div>

        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
          {UPDATE_SOURCES.map((source) => {
            const on = blob.policy.sources.includes(source);
            return (
              <li key={source}>
                <button
                  type="button"
                  onClick={() => toggleSource(source)}
                  aria-pressed={on}
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition hover:bg-panel-2"
                >
                  <span className={`size-1.5 rounded-full ${on ? "bg-core" : "bg-line"}`} aria-hidden />
                  <span className={`text-[11px] ${on ? "text-ink-muted" : "text-ink-faint line-through"}`}>
                    {UPDATE_LABEL[source]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-line-soft pt-2.5">
          <NumberField
            label="Quiet from"
            value={blob.policy.quietFrom}
            min={0}
            max={23}
            onChange={(quietFrom) => setPolicy({ quietFrom })}
            suffix=":00"
          />
          <NumberField
            label="Quiet until"
            value={blob.policy.quietUntil}
            min={0}
            max={23}
            onChange={(quietUntil) => setPolicy({ quietUntil })}
            suffix=":00"
          />
          <NumberField
            label="Most calls a day"
            value={blob.policy.maxPerDay}
            min={1}
            max={20}
            onChange={(maxPerDay) => setPolicy({ maxPerDay })}
          />
          <NumberField
            label="Wait between"
            value={blob.policy.cooldownMinutes}
            min={0}
            max={720}
            onChange={(cooldownMinutes) => setPolicy({ cooldownMinutes })}
            suffix=" min"
          />
        </div>

        <button
          type="button"
          role="checkbox"
          aria-checked={blob.policy.skipIfRecentlySeen}
          onClick={() => setPolicy({ skipIfRecentlySeen: !blob.policy.skipIfRecentlySeen })}
          className="mt-2 flex w-full items-start gap-2 rounded border border-line px-2 py-1.5 text-left transition hover:bg-panel-2"
        >
          <span
            className={`mt-0.5 flex size-3 shrink-0 items-center justify-center rounded-[3px] border ${
              blob.policy.skipIfRecentlySeen ? "border-brand-2 bg-brand-2 text-white" : "border-line text-transparent"
            }`}
            aria-hidden
          >
            <Icon.Check width={8} height={8} />
          </span>
          <span className="text-[11px] leading-relaxed text-ink-muted">
            Not if Jarvis was open in front of me
            <span className="block text-[10px] text-ink-faint">
              The commonest mistake by a distance — ringing you about something already on your screen.
            </span>
          </span>
        </button>
      </div>

      {/* --- the log that earns the trust -------------------------------- */}
      <div className="rounded-md border border-line bg-panel">
        <header className="border-b border-line-soft px-3 py-2.5">
          <h3 className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">What it would do, right now</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink">{describeVerdict(verdict)}</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-ink-faint">
            Judged against your real feed with your real rules, whether or not a phone is connected. Watch it for a
            week before you let it ring anything.
          </p>
        </header>

        {verdict.judged.length === 0 ? (
          <p className="px-3 py-3 text-[11.5px] text-ink-muted">Nothing in the feed to consider.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {verdict.judged.slice(0, 12).map((row) => (
              <li key={row.update.id} className="flex items-start gap-2 px-3 py-2">
                <span
                  className={`mt-1 size-1.5 shrink-0 rounded-full ${row.decline ? "bg-line" : "bg-core"}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11.5px] text-ink">{row.update.title}</p>
                  <p className="text-[10.5px] leading-relaxed text-ink-faint">
                    {row.decline ? DECLINE_REASON[row.decline] : "would ring you about this"}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-ink-faint" data-num title="How much it warrants interrupting you">
                  {row.urgency.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- what happened on the calls that did go out ------------------ */}
      {calls.length > 0 && (
        <div className="rounded-md border border-line bg-panel">
          <header className="border-b border-line-soft px-3 py-2.5">
            <h3 className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Calls it made</h3>
          </header>
          <ul className="divide-y divide-line-soft">
            {calls.slice(0, 8).map((call) => (
              <li key={call.reference} className="px-3 py-2">
                <p className="text-[11.5px] text-ink">{call.summary}</p>
                {call.requests.length > 0 && (
                  <div className="mt-1">
                    <p className="text-[10px] uppercase tracking-wide text-amber-300">You asked for — not done yet</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {call.requests.map((r, i) => (
                        <li key={i} className="text-[10.5px] leading-relaxed text-ink-muted">
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-line-soft px-3 py-2 text-[10px] leading-relaxed text-ink-faint">
            Nothing asked for on a call is ever carried out from the call. There is no screen to confirm on and no undo
            — it is written down and waits for a yes you can see.
          </p>
        </div>
      )}
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  suffix = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">{label}</span>
      <span className="mt-0.5 flex items-center gap-1">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const n = globalThis.Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
          }}
          className="w-14 rounded border border-line bg-panel-2 px-1.5 py-1 font-mono text-[11.5px] text-ink focus:border-ink-faint focus:outline-none"
        />
        {suffix && <span className="text-[10.5px] text-ink-faint">{suffix}</span>}
      </span>
    </label>
  );
}
