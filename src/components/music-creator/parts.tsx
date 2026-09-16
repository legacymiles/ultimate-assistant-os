"use client";

// ---------------------------------------------------------------------------
// Music Creator — the pieces every tool reuses.
//
// Deliberately small and unopinionated about layout. Each tool is supposed to
// look like the instrument it is, so what is shared here is the machinery that
// must behave identically everywhere — the take list, the progress bar, the
// reason a render is unavailable, the writing-assistant hook — and not the
// arrangement of the screen.
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import { Icon } from "../icons";
import { type WriteTask, write } from "@/lib/music-creator/client";
import type { Render, ServerState } from "@/lib/music-creator/types";
import type { Requirement, ToolDef } from "@/lib/music-creator/tools";
import { useStudio } from "./studio";

// ----- form fields ---------------------------------------------------------

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mc-field">
      <span className="mc-field-l">
        {label}
        {hint && <i>{hint}</i>}
      </span>
      {children}
    </label>
  );
}

export function Text({
  value,
  onChange,
  placeholder,
  rows,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return rows ? (
    <textarea className="mc-input mc-area" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input className="mc-input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

// ----- the writing assistant ----------------------------------------------

/**
 * Calls the writing route and remembers how the answer was produced.
 *
 * `engine` is surfaced by every caller: a local draft assembled from the user's
 * own words must never be mistaken for something a model wrote.
 */
export function useWriter() {
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState<"ai" | "local" | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (task: WriteTask, input: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const body = await write(task, input);
      setEngine((body.engine as "ai" | "local") ?? null);
      setWarning((body.warning as string) ?? null);
      return (body.result ?? {}) as Record<string, unknown>;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { run, busy, engine, warning, error };
}

export function WriterNote({ engine, warning, error }: { engine: "ai" | "local" | null; warning: string | null; error: string | null }) {
  if (error) return <p className="mc-note is-bad">{error}</p>;
  if (warning) return <p className="mc-note is-warn">{warning}</p>;
  if (engine === "ai") return <p className="mc-note">Written by the model. Edit anything — it is only a draft until you render it.</p>;
  return null;
}

// ----- server availability -------------------------------------------------

export function missingFor(tool: ToolDef, server: ServerState | null): Requirement[] {
  return tool.requires.filter((req) => {
    if (req === "ai") return false; // the writing route degrades on its own
    if (!server?.reachable) return true;
    return !server.health?.engines?.[req]?.available;
  });
}

const ENGINE_NAMES: Record<string, string> = {
  yue2: "YuE2",
  auk: "AuK",
  sheetsage: "SheetSage2",
};

/**
 * Why this tool cannot render right now, in the tool itself.
 *
 * Three different states with three different fixes, kept distinct because
 * "nothing configured", "configured but unreachable" and "reachable but that
 * model is not installed" need different things from the user.
 */
export function ServerNotice({ tool }: { tool: ToolDef }) {
  const { server, checkingServer, refreshServer } = useStudio();
  const missing = missingFor(tool, server);
  if (checkingServer || !missing.length) return null;

  const names = missing.map((m) => ENGINE_NAMES[m] ?? m).join(" and ");
  const noServer = !server?.reachable;

  return (
    <div className="mc-notice">
      <div className="mc-notice-h">
        <Icon.Server width={14} height={14} />
        <strong>{noServer ? "No GPU server" : `${names} is not installed on the server`}</strong>
        <button type="button" className="mc-btn mc-btn-s" onClick={refreshServer}>
          <Icon.Refresh width={12} height={12} /> Check again
        </button>
      </div>
      <p>
        {noServer
          ? server?.reason ?? "The music server has not been reached."
          : `The server answered, but ${names} is not available on it.`}
      </p>
      <p className="mc-notice-fix">
        {tool.offlineNote} Set up <code>tools/music-creator</code> on a 24 GB NVIDIA GPU and point{" "}
        <code>MUSIC_SERVER_URL</code> at it to render.
      </p>
    </div>
  );
}

// ----- takes ---------------------------------------------------------------

export function RunBar() {
  const { running, cancelWatch } = useStudio();
  if (!running) return null;
  const pct = Math.round(Math.min(1, Math.max(0, running.progress)) * 100);
  return (
    <div className="mc-run">
      <div className="mc-run-h">
        <span className="mc-dot" />
        <strong>{running.label}</strong>
        <em>{running.stage}</em>
        <button type="button" className="mc-btn mc-btn-s" onClick={cancelWatch}>
          Stop watching
        </button>
      </div>
      <div className="mc-run-bar">
        <i style={{ width: `${pct || 6}%` }} className={pct ? "" : "is-idle"} />
      </div>
      <p className="mc-run-note">
        The GPU keeps working if you leave this page. Renders take minutes, not seconds.
      </p>
    </div>
  );
}

export function Takes({ renders, empty }: { renders: Render[]; empty?: string }) {
  const { fileUrl } = useStudio();
  if (!renders.length) return <p className="mc-empty">{empty ?? "No takes yet."}</p>;

  return (
    <ul className="mc-takes">
      {renders.map((r) => (
        <li key={r.id} className={`mc-take ${r.error ? "is-bad" : ""}`}>
          <div className="mc-take-h">
            <strong>{r.label}</strong>
            <span className="mc-take-kind">{r.kind}</span>
            <time>{new Date(r.created).toLocaleString()}</time>
          </div>
          {r.error ? (
            <p className="mc-take-err">{r.error}</p>
          ) : r.fileId ? (
            <>
              <audio controls preload="none" src={fileUrl(r.fileId)} />
              <div className="mc-take-f">
                <a className="mc-btn mc-btn-s" href={fileUrl(r.fileId)} download>
                  <Icon.Download width={12} height={12} /> Download
                </a>
                {truncatedNote(r) && <span className="mc-take-warn">{truncatedNote(r)}</span>}
              </div>
            </>
          ) : (
            <p className="mc-take-err">The job finished without producing a file.</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * YuE2 reports per-stage truncation flags. A truncated song still plays, so
 * saying nothing would let a cut-off ending pass for a finished one.
 */
function truncatedNote(render: Render): string | null {
  const truncated = render.meta?.truncated as Record<string, boolean> | undefined;
  if (!truncated) return null;
  const hit = Object.entries(truncated).filter(([, v]) => v).map(([k]) => k);
  return hit.length ? `Hit the token limit during ${hit.join(" and ")} — this take may end early.` : null;
}
