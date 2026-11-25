"use client";

// Other storage the owner set up with rclone on their PC, read through the
// local Jarvis agent (tools/jarvis-bridge/rclone.mjs). Read-only: names, type
// and the provider's own storage numbers. Hidden entirely when the PC agent
// is not reachable, so a phone never shows a broken panel.

import { useEffect, useState } from "react";
import { call } from "@/lib/new-jarvis/bridge";
import { formatBytes } from "@/lib/dashboard/driveBackup/accounts";

interface Remote {
  name: string;
  type: string;
  total?: number | null;
  used?: number | null;
  free?: number | null;
  error?: string;
}

export function RcloneRemotes() {
  const [state, setState] = useState<{ installed: boolean; version?: string; remotes: Remote[] } | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let alive = true;
    call<{ installed: boolean; version?: string; remotes: Remote[] }>("rclone/remotes")
      .then((r) => alive && setState(r))
      .catch(() => alive && setUnreachable(true));
    return () => {
      alive = false;
    };
  }, []);

  if (unreachable || !state) return null;

  return (
    <div className="mt-4 rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12.5px] font-semibold text-ink">Other storage on this PC (rclone)</p>
        <p className="text-[10.5px] text-ink-faint">{state.installed ? state.version : "not installed"}</p>
      </div>
      {!state.installed ? (
        <p className="mt-1 text-[11.5px] text-ink-muted">
          Install rclone (<code className="text-[10.5px]">winget install Rclone.Rclone</code>) and add remotes with{" "}
          <code className="text-[10.5px]">rclone config</code> — OneDrive, Dropbox, S3, Nextcloud/WebDAV, more Google Drives. They show up here with their real storage.
        </p>
      ) : state.remotes.length === 0 ? (
        <p className="mt-1 text-[11.5px] text-ink-muted">rclone is installed but has no remotes yet. Run <code className="text-[10.5px]">rclone config</code> to add one.</p>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {state.remotes.map((r) => (
            <div key={r.name} className="rounded-xl bg-canvas px-3 py-2 text-[11.5px]">
              <p className="font-medium text-ink">
                {r.name} <span className="text-ink-faint">· {r.type}</span>
              </p>
              {r.error ? (
                <p className="text-red-400">{r.error}</p>
              ) : (
                <p className="tabular-nums text-ink-muted">
                  {formatBytes(r.used ?? 0)} used{r.total ? ` of ${formatBytes(r.total)}` : ""}
                  {r.free !== null && r.free !== undefined ? ` · ${formatBytes(r.free)} free` : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
