"use client";

// ---------------------------------------------------------------------------
// "Is sync set up — and what do I do on this device?"
//
// Reads /api/jarvis/sync-status (env as booleans, plus who has actually
// connected: the connector's clients and every computer that has synced) and
// lets syncPlan() decide the state and the next step for the device this page
// is open on. Shown on the Skills everywhere card, the New Jarvis Skills tab,
// and — through useSyncStatus — in New Jarvis's Finish setup checklist.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import { ago, type DeviceKind, type SyncPlan } from "@/lib/jarvis/syncSteps";
import { useSyncStatus } from "@/lib/jarvis/useSyncStatus";

export { useSyncStatus };

const DEVICE_LABEL: Record<DeviceKind, string> = {
  phone: "this phone",
  windows: "this Windows PC",
  mac: "this Mac",
  linux: "this Linux computer",
  other: "this device",
};

const STATE_STYLE = {
  "not-set-up": { pill: "bg-red-500/15 text-red-300", dot: "bg-red-400", label: "Not set up" },
  partial: { pill: "bg-amber-500/15 text-amber-300", dot: "bg-amber-400", label: "Partly set up" },
  ready: { pill: "bg-emerald-500/15 text-emerald-300", dot: "bg-emerald-400", label: "Set up" },
} as const;

export function SyncStatePill({ plan, error }: { plan: SyncPlan | null; error?: boolean }) {
  if (error) return <span className="rounded-full bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint">status unavailable</span>;
  if (!plan) return <span className="rounded-full bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint">checking…</span>;
  const s = STATE_STYLE[plan.state];
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${s.pill}`}>{s.label}</span>;
}

function CopyLine({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1.5 flex items-start gap-2 rounded-md border border-line-soft bg-canvas/60 p-1.5">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-ink">{value}</pre>
      <button
        onClick={() =>
          navigator.clipboard.writeText(value).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => {},
          )
        }
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-[10.5px] text-ink-muted hover:bg-panel-2 hover:text-ink"
        aria-label={`Copy ${label}`}
      >
        {copied ? <Icon.Check width={11} height={11} /> : <Icon.Copy width={11} height={11} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * @param token When the owner has typed or generated a token on the same card,
 *   it is put into the command/URL in place of YOUR_TOKEN. Held in memory only.
 */
export function SyncStatusPanel({ token = "", status }: { token?: string; status?: ReturnType<typeof useSyncStatus> }) {
  const own = useSyncStatus();
  const { report, plan, device, error, refresh } = status ?? own;
  const fill = (s?: string) => (s && token.trim() ? s.replace("YOUR_TOKEN", token.trim()) : s);

  if (error) {
    return (
      <div className="rounded-lg border border-line bg-panel-2/50 p-2.5 text-[11px] text-ink-muted">
        Couldn&apos;t read the sync status. Sign in to the hub and{" "}
        <button className="underline hover:text-ink" onClick={refresh}>
          try again
        </button>
        .
      </div>
    );
  }
  if (!plan || !report) {
    return <div className="rounded-lg border border-line bg-panel-2/50 p-2.5 text-[11px] text-ink-faint">Checking what&apos;s set up…</div>;
  }

  const st = STATE_STYLE[plan.state];
  const here = plan.here;
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex min-w-0 items-start gap-2 text-[12px] font-medium text-ink">
          <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-hidden />
          <span>{plan.headline}</span>
        </p>
        {report.skills && <span className="text-[10.5px] text-ink-faint">· {report.skills.count} skills in Jarvis</span>}
        <button onClick={refresh} className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-ink-faint hover:text-ink" aria-label="Check again">
          <Icon.Refresh width={11} height={11} /> Check again
        </button>
      </div>

      <div className={`rounded-lg border p-2.5 ${here.done ? "border-emerald-500/30 bg-emerald-500/5" : "border-indigo-400/40 bg-indigo-500/5"}`}>
        <p className="text-[10px] text-ink-faint">Next step on {DEVICE_LABEL[device]}</p>
        <p className="mt-0.5 text-[12px] font-semibold text-ink">
          {here.done && <Icon.Check width={12} height={12} className="mr-1 inline text-emerald-300" />}
          {here.title}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{here.detail}</p>
        {here.copy && <CopyLine value={fill(here.copy)!} label={here.copyLabel ?? "this"} />}
        {here.copy?.includes("YOUR_TOKEN") && !token.trim() && (
          <p className="mt-1 text-[10px] text-ink-faint">
            Replace YOUR_TOKEN with your JARVIS_MCP_TOKEN. On a computer that already has the connector, <span className="font-mono">claude mcp get jarvis-memory</span> shows it.
          </p>
        )}
      </div>

      <ul className="grid gap-1 sm:grid-cols-2">
        {plan.steps.map((s) => (
          <li key={s.id} className="flex gap-2 rounded-md border border-line-soft bg-panel-2/40 px-2 py-1.5">
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${s.done ? "bg-emerald-400" : "bg-amber-400"}`} aria-hidden />
            <span className="min-w-0">
              <span className={`block text-[11px] ${s.done ? "text-ink-muted" : "text-ink"}`}>
                {s.title}
                <span className="sr-only">{s.done ? " — done" : " — to do"}</span>
              </span>
              <span className="block text-[10px] leading-snug text-ink-faint">{s.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {report.devices.length > 0 && (
        <table className="w-full text-left text-[10.5px]">
          <thead>
            <tr className="text-ink-faint">
              <th className="py-1 pr-2 font-medium">Computer</th>
              <th className="py-1 pr-2 font-medium">OS</th>
              <th className="py-1 pr-2 font-medium">Last sync</th>
              <th className="py-1 font-medium">Skills</th>
            </tr>
          </thead>
          <tbody>
            {[...report.devices]
              .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
              .map((d) => (
                <tr key={d.host} className="border-t border-line-soft text-ink-muted">
                  <td className="py-1 pr-2 font-mono text-ink">{d.host}</td>
                  <td className="py-1 pr-2">{d.os}</td>
                  <td className="py-1 pr-2">
                    {ago(d.lastSeen, Date.now())} <span className="text-ink-faint">({d.lastAction})</span>
                  </td>
                  <td className="py-1 font-mono">{d.skillCount ?? "–"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
