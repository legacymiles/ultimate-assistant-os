"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { backupConfigured, folderUrl } from "@/lib/dashboard/driveBackup/driveApi";
import { runBackup, type BackupProgress, type BackupSummary } from "@/lib/dashboard/driveBackup/run";
import {
  getDriveBackupSettings,
  saveDriveBackupSettings,
  type DriveBackupSettings,
} from "@/lib/dashboard/driveBackup/settings";
import { driveTokenLive } from "@/lib/recall/drive";
import type { RecallData } from "@/lib/recall/types";

// ---------------------------------------------------------------------------
// Back the Folders tab up to Google Drive.
//
// "Automatic" has an honest limit, stated in the card rather than hidden: a web
// page can only back up while it is open, and it will not open Google's consent
// window by itself — a pop-up with no click behind it is blocked by browsers,
// and would look like the app misbehaving. So automatic runs happen only while
// an approval from this visit is still valid; otherwise the card asks for one
// tap instead of failing quietly.
// ---------------------------------------------------------------------------

/** Wait after the last change, so a burst of edits becomes one backup. */
const AUTO_DELAY_MS = 90_000;

function ago(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : new Date(iso).toLocaleDateString();
}

export function DriveBackupCard({ data, onToast }: { data: RecallData; onToast: (msg: string) => void }) {
  const [settings, setSettings] = useState<DriveBackupSettings>(() => ({
    linked: false,
    auto: true,
    rootId: null,
    last: null,
  }));
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  useEffect(() => setSettings(getDriveBackupSettings()), []);

  // Anything that would change what is on Drive: items edited, added or moved,
  // folders added, renamed or moved.
  const signature = useMemo(() => {
    const newest = data.items.reduce((m, i) => (i.updatedAt > m ? i.updatedAt : m), "");
    const shape = data.folders.map((f) => `${f.id}:${f.name}:${f.parentId}`).join("|");
    return `${data.items.length}/${newest}/${shape}`;
  }, [data]);

  const newestChange = useMemo(
    () => data.items.reduce((m, i) => (i.updatedAt > m ? i.updatedAt : m), ""),
    [data.items],
  );
  const behind = Boolean(settings.last && newestChange > settings.last.finishedAt);

  const backUp = useCallback(
    async (silent: boolean) => {
      if (running.current) return;
      running.current = true;
      setError(null);
      try {
        const summary: BackupSummary = await runBackup(data.folders, data.items, setProgress);
        setSettings(saveDriveBackupSettings({ linked: true, rootId: summary.rootId, last: summary }));
        if (!silent) {
          const bits = [`${summary.created} added`, `${summary.updated} updated`];
          if (summary.unchanged) bits.push(`${summary.unchanged} already backed up`);
          if (summary.failed.length) bits.push(`${summary.failed.length} failed`);
          onToast(`Google Drive: ${bits.join(" · ")}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Backup failed";
        setError(/cancel/i.test(msg) ? "Google approval was cancelled — nothing was backed up." : msg);
      } finally {
        setProgress(null);
        running.current = false;
      }
    },
    [data.folders, data.items, onToast],
  );

  const tokenLive = driveTokenLive();
  const autoCanRun = settings.linked && settings.auto && tokenLive;

  useEffect(() => {
    if (!autoCanRun) return;
    const t = setTimeout(() => void backUp(true), AUTO_DELAY_MS);
    return () => clearTimeout(t);
    // Re-armed on every change; the timer only fires once edits settle.
  }, [signature, autoCanRun, backUp]);

  if (!backupConfigured()) {
    return (
      <div className="mb-3 flex items-start gap-2.5 rounded-2xl border border-dashed border-line bg-panel/40 p-3">
        <Icon.Upload width={16} height={16} className="mt-0.5 shrink-0 text-ink-faint" />
        <div>
          <p className="text-[12px] font-semibold text-ink">Back up to Google Drive</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
            Needs a one-time Google setup: add <code className="text-[10px]">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code>{" "}
            to your site settings and redeploy. Then this becomes a Back up now button.
          </p>
        </div>
      </div>
    );
  }

  const last = settings.last;

  return (
    <div className="mb-3 rounded-2xl border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/15 text-brand">
          <Icon.Upload width={16} height={16} />
        </span>
        <div className="mr-auto min-w-0">
          <p className="text-[12.5px] font-semibold text-ink">Google Drive backup</p>
          <p className="text-[11px] text-ink-muted">
            {progress
              ? progress.stage === "scanning"
                ? "Checking what is already on Drive…"
                : `Backing up ${progress.done + 1} of ${progress.total}${progress.current ? ` — ${progress.current}` : ""}`
              : last
                ? `Last backed up ${ago(last.finishedAt)}${behind ? " · new changes since" : ""}`
                : "Not backed up yet · saves to “Ultimate Assistant OS” in your Drive"}
          </p>
        </div>
        {settings.rootId && (
          <a
            href={folderUrl(settings.rootId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-xl border border-line px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:text-ink"
          >
            <Icon.Launch width={12} height={12} /> Open in Drive
          </a>
        )}
        <button
          onClick={() => void backUp(false)}
          disabled={Boolean(progress)}
          className="rounded-xl bg-brand px-3 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-brand-2 disabled:opacity-50"
        >
          {progress ? "Backing up…" : settings.linked ? "Back up now" : "Link Google Drive"}
        </button>
      </div>

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}

      {last && !progress && (
        <p className="mt-2 text-[11px] text-ink-muted">
          {last.created} added · {last.updated} updated · {last.moved} moved · {last.unchanged} already backed up
          {last.failed.length > 0 && (
            <span className="text-red-400"> · {last.failed.length} failed ({last.failed[0].name}: {last.failed[0].error})</span>
          )}
        </p>
      )}
      {last && last.notOnThisDevice.length > 0 && !progress && (
        <p className="mt-1 text-[10.5px] text-amber-300">
          {last.notOnThisDevice.length} photo{last.notOnThisDevice.length === 1 ? " is" : "s are"} stored on another
          device — back up from that device to include {last.notOnThisDevice.length === 1 ? "it" : "them"}.
        </p>
      )}

      {settings.linked && (
        <label className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-muted">
          <input
            type="checkbox"
            checked={settings.auto}
            onChange={(e) => setSettings(saveDriveBackupSettings({ auto: e.target.checked }))}
          />
          Back up automatically while Dashboard is open
          {settings.auto && !tokenLive && (
            <span className="text-amber-300"> — paused until you tap Back up now (Google needs a fresh OK)</span>
          )}
        </label>
      )}
      <p className="mt-1 text-[10px] text-ink-faint">
        Backs up your folders and photo albums. Deleting something here never deletes it from Drive, and saved
        passwords are never uploaded.
      </p>
    </div>
  );
}
