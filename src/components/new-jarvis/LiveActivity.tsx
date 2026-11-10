"use client";

// ---------------------------------------------------------------------------
// One live line for a coding harness.
//
// A harness turn can touch a hundred files. Printing each one as it happens
// turns the chat into a wall the person has to scroll before they can see what
// is happening now. So while a turn is running every chat shows the same small
// strip: what it is doing, the line it is on, and how long it has been at it.
// The strip is replaced in place as the next tool starts. When the turn ends —
// or the harness stops to ask a question — the full transcript appears.
//
// The shape is deliberately the one the owner pointed at: a spark, "Analyzing
// the request · …", then "Deep diving for 56s …". It should feel like watching
// someone work, not like reading a finished log.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import type { ToolRow } from "@/lib/new-jarvis/harness/types";
import "./live-activity.css";

const PHASE: Record<ToolRow["kindOf"], string> = {
  read: "Reading the code",
  write: "Writing the code",
  run: "Running the checks",
  other: "Working",
};

function firstLine(s: string): string {
  return s.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

function targetOf(t: ToolRow): string {
  if (t.path) return t.path;
  const cmd = firstLine(t.command);
  if (cmd) return cmd.length > 120 ? `${cmd.slice(0, 117)}…` : cmd;
  return t.title;
}

function codeOf(t: ToolRow): string {
  if (t.kindOf === "write") return "";
  const out = firstLine(t.output);
  if (out) return out.length > 150 ? `${out.slice(0, 147)}…` : out;
  const cmd = firstLine(t.command);
  if (cmd) return cmd.length > 150 ? `${cmd.slice(0, 147)}…` : cmd;
  return "";
}

function duration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function LiveActivity({
  tool,
  note,
  startedAt,
  waiting = false,
  idle = "Reading the brief…",
}: {
  /** The tool call in flight, or the newest one if it just finished. */
  tool?: ToolRow | null;
  /** The newest thing the agent said, kept to one line. */
  note?: string;
  /** When this turn started, for "Deep diving for …". */
  startedAt?: number;
  /** A gate is on screen; the line should not pretend to be working. */
  waiting?: boolean;
  idle?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const phase = waiting ? "Waiting on you" : tool ? PHASE[tool.kindOf] : "Analyzing the request";
  const target = tool ? targetOf(tool) : idle;
  const code = tool ? codeOf(tool) : "";
  const secs = startedAt && startedAt > 0 ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const said = note ? firstLine(note) : "";

  return (
    <div className={`la${waiting ? " is-waiting" : ""}`} role="status" aria-live="polite">
      <svg className="la-spark" viewBox="0 0 16 16" aria-hidden focusable="false">
        <path d="M8 1.2l1.55 5.25L14.8 8l-5.25 1.55L8 14.8l-1.55-5.25L1.2 8l5.25-1.55z" />
      </svg>
      <div className="la-main">
        <p className="la-head" key={tool?.callId || "idle"}>
          <b>{phase}</b>
          <span aria-hidden>·</span>
          <code className="la-target" title={target}>
            {target}
          </code>
        </p>
        {code && (
          <code className="la-code" title={code}>
            {code}
          </code>
        )}
        {!code && said && (
          <span className="la-said" title={said}>
            {said.length > 120 ? `${said.slice(0, 117)}…` : said}
          </span>
        )}
        <p className="la-foot">
          <span className="la-wave" aria-hidden />
          {waiting ? "Waiting for your answer…" : `Deep diving for ${duration(secs)} …`}
        </p>
      </div>
    </div>
  );
}
