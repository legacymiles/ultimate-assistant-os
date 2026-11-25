"use client";

// ---------------------------------------------------------------------------
// The Google Drive backup dashboard: every connected account, its real storage
// (read from Google), what is backed up where, and what failed.
//
// Opened from the backup card. Storage and file lists come from each
// account's own Drive (lib/dashboard/driveBackup/accounts); nothing is
// estimated. An account whose numbers are stale says when they were read.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import {
  addAccount,
  coverage,
  forgetAccount,
  formatBytes,
  getAccounts,
  refreshAccount,
  setTarget,
  type AccountsState,
  type DriveAccount,
} from "@/lib/dashboard/driveBackup/accounts";
import { explainDriveFailure, folderUrl } from "@/lib/dashboard/driveBackup/driveApi";
import { accountTokenLive } from "@/lib/recall/drive";
import { folderPathString } from "@/lib/recall/store";
import type { RecallData } from "@/lib/recall/types";
import { RcloneRemotes } from "./RcloneRemotes";

function ago(iso?: string): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString();
}

function StorageBar({ a }: { a: DriveAccount }) {
  const q = a.quota;
  if (!q) return <p className="text-[11px] text-ink-faint">Storage not read yet — press Refresh.</p>;
  const limit = q.limit;
  const pct = (n: number) => (limit ? Math.min(100, (n / limit) * 100) : 0);
  const other = Math.max(0, q.usage - q.usageInDrive - q.usageInTrash);
  const left = limit === null ? null : Math.max(0, limit - q.usage);
  const full = limit ? q.usage / limit : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[20px] font-semibold tabular-nums tracking-tight text-ink">
          {formatBytes(q.usage)}
          <span className="ml-1 text-[12px] font-normal text-ink-faint">of {formatBytes(limit)}</span>
        </p>
        <p className={"text-[11.5px] font-medium tabular-nums " + (full > 0.9 ? "text-red-400" : full > 0.75 ? "text-amber-300" : "text-core")}>
          {left === null ? "Unlimited" : `${formatBytes(left)} free`}
        </p>
      </div>
      {limit !== null && (
        <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-panel-2" role="img" aria-label={`${Math.round(full * 100)}% used`}>
          <span className="h-full bg-brand" style={{ width: `${pct(q.usageInDrive)}%` }} title={`Drive ${formatBytes(q.usageInDrive)}`} />
          <span className="h-full bg-brand/45" style={{ width: `${pct(other)}%` }} title={`Gmail & Photos ${formatBytes(other)}`} />
          <span className="h-full bg-amber-300/60" style={{ width: `${pct(q.usageInTrash)}%` }} title={`Trash ${formatBytes(q.usageInTrash)}`} />
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink-faint">
        <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-brand align-middle" />Drive {formatBytes(q.usageInDrive)}</span>
        <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-brand/45 align-middle" />Gmail &amp; Photos {formatBytes(other)}</span>
        <span><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-300/60 align-middle" />Trash {formatBytes(q.usageInTrash)}</span>
      </div>
    </div>
  );
}

export function DriveBackupDashboard({ data, onClose }: { data: RecallData; onClose: () => void }) {
  const [state, setState] = useState<AccountsState>({ accounts: [], target: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<string>("all");
  const [tab, setTab] = useState<"files" | "missing" | "failed">("files");

  useEffect(() => setState(getAccounts()), []);

  const act = async (label: string, fn: () => Promise<AccountsState> | AccountsState) => {
    setBusy(label);
    setError(null);
    try {
      setState(await fn());
    } catch (e) {
      setError(explainDriveFailure(e instanceof Error ? e.message : String(e)));
      setState(getAccounts());
    } finally {
      setBusy(null);
    }
  };

  const cov = useMemo(() => coverage(data.items, state.accounts), [data.items, state.accounts]);
  const files = useMemo(() => {
    const t = q.trim().toLowerCase();
    return state.accounts
      .filter((a) => only === "all" || a.email === only)
      .flatMap((a) => (a.inventory?.files ?? []).map((f) => ({ ...f, email: a.email })))
      .filter((f) => !t || f.name.toLowerCase().includes(t) || f.path.toLowerCase().includes(t))
      .sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""))
      .slice(0, 400);
  }, [state.accounts, q, only]);
  const failures = state.accounts.flatMap((a) =>
    [
      ...(a.lastRun?.failed ?? []).map((f) => ({ email: a.email, what: f.name, why: f.error, kind: "Failed" })),
      ...(a.lastRun?.notBackedUp ?? []).map((f) => ({ email: a.email, what: f.title, why: f.reason, kind: "Skipped" })),
      ...(a.lastError ? [{ email: a.email, what: "Account check", why: a.lastError, kind: "Error" }] : []),
    ],
  );
  const totalFiles = state.accounts.reduce((n, a) => n + (a.inventory?.files.length ?? 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Google Drive backups">
      <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden border border-line bg-canvas shadow-2xl sm:rounded-3xl">
        {/* header */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 text-brand">
            <Icon.Server width={18} height={18} />
          </span>
          <div className="mr-auto">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Backups</h2>
            <p className="text-[11.5px] text-ink-muted">
              {state.accounts.length} Google account{state.accounts.length === 1 ? "" : "s"} · {totalFiles.toLocaleString()} files on Drive ·{" "}
              {cov.backedUp.toLocaleString()} of {data.items.length.toLocaleString()} Folders items covered
            </p>
          </div>
          <button
            onClick={() => void act("add", addAccount)}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-brand-2 disabled:opacity-50"
          >
            <Icon.Plus width={14} height={14} /> {busy === "add" ? "Waiting for Google…" : "Connect Google account"}
          </button>
          <button onClick={onClose} className="rounded-xl p-2 text-ink-faint hover:bg-panel-2 hover:text-ink" aria-label="Close">
            <Icon.Close width={18} height={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="mb-3 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-[12px] text-red-300">{error}</p>}

          {/* accounts */}
          {state.accounts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-6 text-center">
              <p className="text-[13px] font-semibold text-ink">No Google account connected here yet</p>
              <p className="mx-auto mt-1 max-w-md text-[12px] text-ink-muted">
                Connect one (or several). Each shows its real storage from Google, and exactly which of your folders and photos are backed up in it.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {state.accounts.map((a) => {
                const isTarget = state.target === a.email;
                const live = accountTokenLive(a.email);
                const run = a.lastRun;
                return (
                  <div key={a.email} className={"rounded-2xl border bg-panel p-4 " + (isTarget ? "border-brand/40" : "border-line")}>
                    <div className="flex items-start gap-3">
                      {a.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.photo} alt="" className="h-9 w-9 rounded-full" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-panel-2 text-[13px] font-semibold uppercase text-ink">{a.email[0]}</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-ink">{a.name ?? a.email}</p>
                        <p className="truncate text-[11.5px] text-ink-muted">{a.email}</p>
                      </div>
                      {isTarget ? (
                        <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">Backup target</span>
                      ) : (
                        <button onClick={() => void act("target", () => setTarget(a.email))} className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-muted hover:text-ink">
                          Back up here
                        </button>
                      )}
                    </div>

                    <div className="mt-3">
                      <StorageBar a={a} />
                    </div>

                    <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                      <div className="rounded-xl bg-canvas px-2.5 py-2">
                        <dt className="text-ink-faint">Backed up</dt>
                        <dd className="mt-0.5 font-semibold tabular-nums text-ink">{(a.inventory?.files.length ?? 0).toLocaleString()} files</dd>
                      </div>
                      <div className="rounded-xl bg-canvas px-2.5 py-2">
                        <dt className="text-ink-faint">Last success</dt>
                        <dd className="mt-0.5 font-semibold text-ink">{ago(a.lastSuccessAt)}</dd>
                      </div>
                      <div className="rounded-xl bg-canvas px-2.5 py-2">
                        <dt className="text-ink-faint">Last run</dt>
                        <dd className={"mt-0.5 font-semibold " + (run?.failed.length ? "text-red-400" : "text-ink")}>
                          {run ? (run.failed.length ? `${run.failed.length} failed` : "OK") : "—"}
                        </dd>
                      </div>
                    </dl>
                    {run && (
                      <p className="mt-2 text-[10.5px] text-ink-faint">
                        {ago(run.finishedAt)}: {run.created} added · {run.updated} updated · {run.moved} moved · {run.unchanged} unchanged
                        {run.notOnThisDevice ? ` · ${run.notOnThisDevice} on another device` : ""}
                      </p>
                    )}
                    {a.lastError && <p className="mt-1 text-[10.5px] text-red-400">{explainDriveFailure(a.lastError)}</p>}

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => void act(`refresh:${a.email}`, () => refreshAccount(a.email, { interactive: !live }))}
                        disabled={Boolean(busy)}
                        className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-muted hover:text-ink disabled:opacity-50"
                      >
                        <Icon.Refresh width={12} height={12} /> {busy === `refresh:${a.email}` ? "Reading Drive…" : live ? "Refresh" : "Sign in & refresh"}
                      </button>
                      {a.rootId && (
                        <a href={folderUrl(a.rootId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-muted hover:text-ink">
                          <Icon.Launch width={12} height={12} /> Open in Drive
                        </a>
                      )}
                      <span className="ml-auto text-[10px] text-ink-faint">Read {ago(a.checkedAt)}</span>
                      <button
                        onClick={() => {
                          if (window.confirm(`Stop showing ${a.email} here? Its backups stay in its Drive.`)) void act("forget", () => forgetAccount(a.email));
                        }}
                        className="rounded-lg px-1.5 py-1 text-[10.5px] text-ink-faint hover:text-red-400"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* other storage through rclone, when the PC agent has it */}
          <RcloneRemotes />

          {/* what is where */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-b border-line">
            {(
              [
                ["files", `Backed up (${totalFiles.toLocaleString()})`],
                ["missing", `Not backed up (${cov.missing.length.toLocaleString()})`],
                ["failed", `Failed or skipped (${failures.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={"-mb-px border-b-2 px-2 py-2 text-[12px] font-medium " + (tab === id ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink")}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "files" && (
            <div className="mt-3">
              <div className="mb-2 flex flex-wrap gap-2">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search file or folder…"
                  className="min-w-[200px] flex-1 rounded-xl border border-line bg-panel px-3 py-1.5 text-[12px] text-ink outline-none focus:border-brand"
                />
                <select value={only} onChange={(e) => setOnly(e.target.value)} className="rounded-xl border border-line bg-panel px-2 py-1.5 text-[12px] text-ink" aria-label="Account">
                  <option value="all">All accounts</option>
                  {state.accounts.map((a) => (
                    <option key={a.email} value={a.email}>
                      {a.email}
                    </option>
                  ))}
                </select>
              </div>
              {files.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-ink-faint">Nothing to show yet — connect an account and press Refresh.</p>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-line">
                  <table className="w-full table-fixed text-left text-[11.5px]">
                    <thead className="bg-panel text-[10.5px] uppercase tracking-wide text-ink-faint">
                      <tr>
                        <th className="w-[34%] px-3 py-2 font-medium">File</th>
                        <th className="w-[34%] px-3 py-2 font-medium">Destination on Drive</th>
                        <th className="hidden w-[18%] px-3 py-2 font-medium md:table-cell">Account</th>
                        <th className="w-[14%] px-3 py-2 text-right font-medium">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((f) => (
                        <tr key={`${f.email}:${f.id}`} className="border-t border-line/70 hover:bg-panel/60">
                          <td className="truncate px-3 py-1.5 text-ink">
                            {f.link ? (
                              <a href={f.link} target="_blank" rel="noreferrer" className="hover:text-brand hover:underline">
                                {f.name}
                              </a>
                            ) : (
                              f.name
                            )}
                            {f.size ? <span className="ml-1.5 text-ink-faint">{formatBytes(f.size)}</span> : null}
                          </td>
                          <td className="truncate px-3 py-1.5 text-ink-muted" title={f.path}>{f.path}</td>
                          <td className="hidden truncate px-3 py-1.5 text-ink-muted md:table-cell" title={f.email}>{f.email}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-ink-faint">{ago(f.modified)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "missing" && (
            <div className="mt-3 space-y-1">
              {cov.missing.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-core">Every Folders item is on Drive.</p>
              ) : (
                cov.missing.slice(0, 300).map((i) => (
                  <div key={i.id} className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-1.5 text-[11.5px]">
                    <Icon.File width={12} height={12} className="shrink-0 text-ink-faint" />
                    <span className="min-w-0 flex-1 truncate text-ink">{i.title}</span>
                    <span className="max-w-[45%] truncate text-ink-faint">{folderPathString(data.folders, i.folderId)}</span>
                  </div>
                ))
              )}
              {state.accounts.length > 0 && cov.missing.length > 0 && (
                <p className="pt-1 text-[10.5px] text-ink-faint">These are not in any connected account yet. Back up now from the card, then Refresh.</p>
              )}
            </div>
          )}

          {tab === "failed" && (
            <div className="mt-3 space-y-1">
              {failures.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-core">No failed or skipped backups in the last runs.</p>
              ) : (
                failures.map((f, i) => (
                  <div key={i} className="rounded-xl border border-line bg-panel px-3 py-2 text-[11.5px]">
                    <div className="flex items-center gap-2">
                      <span className={"rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase " + (f.kind === "Skipped" ? "bg-amber-300/15 text-amber-300" : "bg-red-400/15 text-red-400")}>
                        {f.kind}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-ink">{f.what}</span>
                      <span className="truncate text-[10.5px] text-ink-faint">{f.email}</span>
                    </div>
                    <p className="mt-0.5 text-ink-muted">{f.why}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
