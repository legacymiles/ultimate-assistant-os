"use client";

// ---------------------------------------------------------------------------
// Where the brain actually is, right now.
//
// This strip exists because the honest answer changes constantly and the owner
// cannot be expected to guess. The vault is a folder on one laptop; the index
// is a table on Vercel; the phone has the second and not the first. Every
// combination of those is a legitimate state and each needs saying out loud:
//
//   swept        the disk was read just now — this is the vault
//   mirror       the index only — everything is searchable, nothing is live
//   no vault     the folder is not there yet, with the path it looked in
//   waiting      captures queued, with nowhere to write them until the PC is up
//
// Refusing to show a progress bar that lies is most of the job here: a sweep
// that skipped 2000 unchanged notes finished in a second and must say so,
// rather than implying it did nothing.
// ---------------------------------------------------------------------------

import { Icon } from "../icons";
import type { SweepProgress } from "@/lib/new-jarvis/useVault";

interface Props {
  mirrorOnly: boolean;
  present: boolean | null;
  root: string;
  progress: SweepProgress;
  waiting: number;
  notes: number;
  error: string;
  bridgeUp: boolean;
  onSweep: () => void;
  onFlush: () => void;
}

export function VaultStatus({
  mirrorOnly,
  present,
  root,
  progress,
  waiting,
  notes,
  error,
  bridgeUp,
  onSweep,
  onFlush,
}: Props) {
  const busy = progress.phase === "scanning" || progress.phase === "reading" || progress.phase === "writing" || progress.phase === "pruning";

  const state = (() => {
    if (busy) return { dot: "bg-support", label: progress.note || "Working…" };
    if (present === false) {
      return {
        dot: "bg-amber-400",
        label: root ? `No vault at ${root}` : "No vault yet",
      };
    }
    if (mirrorOnly) {
      return {
        dot: "bg-ink-faint",
        label: bridgeUp
          ? `${notes} notes from the index — sweep to read the disk`
          : `${notes} notes from the index. Your PC is not reachable, so this is a mirror.`,
      };
    }
    return { dot: "bg-core", label: progress.note || `${notes} notes, read from disk` };
  })();

  return (
    <div className="border-b border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5">
        <span className={`nj-dot ${state.dot}`} data-live={busy ? "true" : undefined} aria-hidden />
        <p className="min-w-0 flex-1 truncate text-[11px] text-ink-muted" title={state.label}>
          {state.label}
        </p>

        {waiting > 0 && (
          <button
            type="button"
            onClick={onFlush}
            disabled={!bridgeUp}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50"
            title={
              bridgeUp
                ? "Write the queued captures into the vault"
                : "These land in your vault next time this PC is reachable. They are already searchable."
            }
          >
            <Icon.Upload width={9} height={9} aria-hidden />
            <span data-num>{waiting}</span> waiting
          </button>
        )}

        <button
          type="button"
          onClick={onSweep}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50"
          title="Read the vault and bring the index up to date. Unchanged notes cost nothing."
        >
          <Icon.Refresh width={9} height={9} aria-hidden />
          Sweep
        </button>
      </div>

      {/* A determinate bar only where the size of the job is actually known.
          A fake one on an indeterminate phase is a lie the owner can measure. */}
      {busy && progress.done !== null && (
        <div className="h-0.5 w-full bg-line-soft" role="progressbar" aria-valuenow={Math.round(progress.done * 100)}>
          <div className="h-full bg-support transition-[width] duration-200" style={{ width: `${progress.done * 100}%` }} />
        </div>
      )}

      {error && (
        <p className="border-t border-line-soft px-3 py-1.5 text-[10.5px] leading-relaxed text-amber-300">{error}</p>
      )}
    </div>
  );
}
