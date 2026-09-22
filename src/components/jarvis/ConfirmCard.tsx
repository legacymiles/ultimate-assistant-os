"use client";

// ---------------------------------------------------------------------------
// The confirm card: the one place an action with outside effects is approved.
//
// It shows the plain sentence, the app it touches, and the exact arguments —
// editable, because a wrong date should be fixable without starting the
// conversation again. Nothing here executes; the parent does that on approval.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import type { PendingAction } from "@/lib/jarvis/types";

export function ConfirmCard({
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  action: PendingAction;
  busy?: boolean;
  onConfirm: (args: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.stringify(action.args, null, 2));
  const [error, setError] = useState("");

  const confirm = () => {
    if (!editing) return onConfirm(action.args);
    try {
      onConfirm(JSON.parse(draft) as Record<string, unknown>);
      setError("");
    } catch {
      setError("That isn't valid JSON — fix it or cancel the edit.");
    }
  };

  const done = action.status !== "pending";

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <Icon.Shield width={13} height={13} className="text-amber-400" />
        <span className="text-xs font-semibold text-ink">
          {done ? (action.status === "done" ? "Done" : action.status === "failed" ? "Failed" : "Cancelled") : "Needs your yes"}
        </span>
        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-faint">
          {action.app}
        </span>
      </div>
      <p className="text-xs text-ink">{action.summary}</p>

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(14, draft.split("\n").length + 1)}
          className="mt-2 w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 font-mono text-[11px] text-ink focus:border-ink-faint focus:outline-none"
        />
      ) : (
        <dl className="mt-2 space-y-0.5">
          {Object.entries(action.args).map(([k, v]) => (
            <div key={k} className="flex gap-2 text-[11px]">
              <dt className="shrink-0 text-ink-faint">{k}</dt>
              <dd className="min-w-0 flex-1 break-words text-ink-muted">
                {typeof v === "string" ? v : JSON.stringify(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {error && <p className="mt-1 text-[11px] text-rose-400">{error}</p>}
      {action.error && <p className="mt-1 text-[11px] text-rose-400">{action.error}</p>}
      {action.result && <p className="mt-1 text-[11px] text-ink-muted">{action.result}</p>}

      {!done && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={confirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/90 px-2.5 py-1.5 text-xs font-medium text-black transition hover:bg-amber-400 disabled:opacity-60"
          >
            <Icon.Check width={13} height={13} /> {action.tool === "studio_generate" ? (busy ? "Rendering…" : "Make it") : busy ? "Doing it…" : "Yes, do it"}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-muted transition hover:text-ink"
          >
            <Icon.Close width={13} height={13} /> No
          </button>
          <button
            onClick={() => setEditing((e) => !e)}
            disabled={busy}
            className="text-[11px] text-ink-faint underline transition hover:text-ink"
          >
            {editing ? "Stop editing" : "Edit the details"}
          </button>
        </div>
      )}
    </div>
  );
}
