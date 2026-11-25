"use client";

// ---------------------------------------------------------------------------
// The confirmation card for "save this into my folders".
//
// Nothing is written until the owner presses Save. Before that they see:
//   - the exact destination, step by step, with any folder that does not
//     exist yet marked "new" (so a typo never silently creates a folder),
//   - why Jarvis picked it,
//   - the full text that will be saved,
//   - a picker to send it somewhere else instead.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { allFolderPaths, resolveDestination } from "@/lib/recall/rag";
import type { Folder } from "@/lib/recall/types";

export function SavePreview({
  title,
  body,
  tags,
  path,
  reason,
  folders,
  state,
  onSave,
  onDismiss,
}: {
  title: string;
  body: string;
  tags: string[];
  path: string[];
  reason?: string;
  folders: Folder[];
  state?: "applied" | "dismissed";
  onSave: (path: string[]) => void;
  onDismiss: () => void;
}) {
  const [dest, setDest] = useState<string[]>(path);
  const [choosing, setChoosing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const steps = useMemo(() => resolveDestination(dest, folders), [dest, folders]);
  const choices = useMemo(() => allFolderPaths(folders).filter((p) => p[0]?.toLowerCase() !== "photos"), [folders]);
  const creates = steps.filter((s) => !s.exists).length;
  const long = body.length > 420;

  return (
    <div
      className={
        "rounded-xl border bg-canvas p-3 text-xs transition " +
        (state ? "border-line opacity-60" : "border-brand/35 shadow-[0_0_0_1px_rgba(0,0,0,0)] shadow-brand/10")
      }
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Save to Folders · review first</p>

      {/* destination */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Icon.Folder width={12} height={12} className="text-brand" />
        {steps.length === 0 ? (
          <span className="font-medium text-ink">Inbox</span>
        ) : (
          steps.map((s, i) => (
            <span key={`${s.name}-${i}`} className="inline-flex items-center gap-1">
              {i > 0 && <span className="text-ink-faint">›</span>}
              <span className={s.exists ? "font-medium text-ink" : "font-medium text-amber-300"}>{s.name}</span>
              {!s.exists && (
                <span className="rounded bg-amber-400/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-300">
                  new
                </span>
              )}
            </span>
          ))
        )}
        {!state && (
          <button
            onClick={() => setChoosing((v) => !v)}
            className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] text-ink-muted hover:bg-panel-2 hover:text-ink"
          >
            {choosing ? "Done" : "Change"}
          </button>
        )}
      </div>
      {creates > 0 && !state && (
        <p className="mt-1 text-[10px] text-amber-300/80">
          {creates === 1 ? "1 folder will be created" : `${creates} folders will be created`} when you save.
        </p>
      )}
      {choosing && !state && (
        <select
          value={dest.join("\u0000")}
          onChange={(e) => setDest(e.target.value ? e.target.value.split("\u0000") : [])}
          className="mt-2 w-full rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-ink outline-none focus:border-brand"
          aria-label="Destination folder"
        >
          {!choices.some((c) => c.join("\u0000") === path.join("\u0000")) && path.length > 0 && (
            <option value={path.join("\u0000")}>{path.join(" › ")} (suggested, new)</option>
          )}
          <option value="">Inbox (unfiled)</option>
          {choices.map((c) => (
            <option key={c.join("/")} value={c.join("\u0000")}>
              {"  ".repeat(c.length - 1)}
              {c.join(" › ")}
            </option>
          ))}
        </select>
      )}
      {reason && <p className="mt-1.5 text-[11px] leading-snug text-ink-muted">{reason}</p>}

      {/* content */}
      <div className="mt-2 rounded-lg border border-line bg-panel px-2.5 py-2">
        <p className="text-[12px] font-semibold text-ink">{title}</p>
        <p
          className={
            "mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-muted " +
            (long && !expanded ? "max-h-28 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" : "max-h-72 overflow-y-auto")
          }
        >
          {body}
        </p>
        {long && (
          <button onClick={() => setExpanded((v) => !v)} className="mt-1 text-[10px] font-medium text-brand hover:underline">
            {expanded ? "Show less" : `Show all ${body.length.toLocaleString()} characters`}
          </button>
        )}
        {tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tags.map((t) => (
              <span key={t} className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* decision */}
      <div className="mt-2 flex items-center justify-end gap-1.5">
        {state === "applied" ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-core">
            <Icon.Check width={12} height={12} /> Saved to {dest.join(" › ") || "Inbox"}
          </span>
        ) : state === "dismissed" ? (
          <span className="text-[11px] text-ink-faint">Not saved</span>
        ) : (
          <>
            <button onClick={onDismiss} className="rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-muted hover:text-ink">
              Don&apos;t save
            </button>
            <button
              onClick={() => onSave(dest)}
              className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-2"
            >
              Save here
            </button>
          </>
        )}
      </div>
    </div>
  );
}
