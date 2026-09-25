"use client";

// ---------------------------------------------------------------------------
// Toolbox › Tools — every model and service this hub uses, and where.
//
// The rows are not typed in. They are read out of the code by
// scripts/scan-tools.mjs and committed, so "where is this used" answers itself
// and keeps answering after the code moves. What the owner writes on top —
// what a tool is FOR, whether it is settled or on trial, and which Studio
// workflow should use which engine — lives in a separate store that re-scanning
// cannot touch.
//
// Grouped by job by default, because the question that started this tab was
// "which apps paint images with Qwen and which with Gemini" — and that is only
// visible when the two sit on adjacent rows.
// ---------------------------------------------------------------------------

import { Fragment, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { fileOnBoard, matchTool } from "@/lib/ai-rankings/fromDashboard";
import { getData as getBoard } from "@/lib/ai-rankings/store";
import type { Tool } from "@/lib/ai-rankings/types";
import { loadToolkit } from "@/lib/jarvis/toolkit";
import {
  byRole,
  loadNotes,
  saveNotes,
  scannedTools,
  toolRows,
  SCOPE_LABEL,
  TOOL_NOTES_KEY,
  type CallSite,
  type Scope,
  type ToolRow,
} from "@/lib/jarvis/toolUsage";
import { WORKFLOWS } from "@/lib/studio/workflows";
import { useRemotePull } from "@/lib/sync/useSync";

const field =
  "w-full rounded-md border border-line bg-canvas px-2 py-1 text-xs text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none";
const iconBtn =
  "rounded p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";

/** A model id reads better as its last segment; a service is already a name. */
function displayName(id: string): string {
  if (!id.includes("/")) return id;
  const tail = id.split("/")[1].replace(/[-_]/g, " ");
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/**
 * Scope chips. Hub-wide is the one that changes a decision — it means every
 * app inherits this tool — so it is the only scope that carries colour.
 */
const SCOPE_STYLE: Record<Scope, string> = {
  global: "border-amber-400/35 bg-amber-500/12 text-amber-200",
  app: "border-line bg-panel-2 text-ink-muted",
  route: "border-line bg-panel-2 text-ink-muted",
  lib: "border-line bg-transparent text-ink-faint",
  tool: "border-line bg-transparent text-ink-faint",
  other: "border-line bg-transparent text-ink-faint",
};

const STATUS_STYLE = {
  keep: "border-emerald-400/30 bg-emerald-500/12 text-emerald-200",
  trial: "border-sky-400/30 bg-sky-500/12 text-sky-200",
  replace: "border-red-400/30 bg-red-500/12 text-red-200",
} as const;

const STATUS_LABEL = { keep: "Keep", trial: "Trial", replace: "Replace" } as const;

function Chip({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium ${className}`}>
      {children}
    </span>
  );
}

export function ToolsTab() {
  const [rows, setRows] = useState<ToolRow[]>([]);
  const [board, setBoard] = useState<Tool[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [filing, setFiling] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const reload = () => {
    setRows(toolRows());
    setBoard(getBoard().tools);
  };

  // One-time migration: the tab used to hold hand-written rows. Anything the
  // owner wrote there becomes their note on the matching scanned tool, so the
  // switch to scanning costs them nothing they had typed.
  useEffect(() => {
    const { notes } = loadNotes();
    if (Object.keys(notes).length === 0) {
      const carried: Record<string, { purpose: string; note: string }> = {};
      for (const m of loadToolkit().models) {
        if (!m.modelId.trim()) continue;
        if (m.role.trim() || m.note.trim()) carried[m.modelId.trim()] = { purpose: m.role.trim(), note: m.note.trim() };
      }
      if (Object.keys(carried).length > 0) saveNotes({ notes: carried });
    }
    reload();
  }, []);

  useRemotePull(TOOL_NOTES_KEY, reload);

  const setNoteFor = (id: string, patch: Partial<{ job: string; purpose: string; note: string; status: ToolRow["status"] }>) => {
    const { notes } = loadNotes();
    saveNotes({ notes: { ...notes, [id]: { ...notes[id], ...patch } } });
    setRows(toolRows());
  };

  const bind = (workflowId: string, role: string, toolId: string) => {
    const { bindings } = loadNotes();
    const without = bindings.filter((b) => !(b.workflowId === workflowId && b.role === role));
    saveNotes({ bindings: toolId ? [...without, { workflowId, role, toolId }] : without });
    setRows(toolRows());
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.job.toLowerCase().includes(q) ||
        r.purpose.toLowerCase().includes(q) ||
        r.apps.some((a) => a.includes(q)) ||
        r.sites.some((s) => s.file.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const groups = useMemo(
    () => (grouped ? byRole(visible) : [{ role: "", tools: visible }]),
    [visible, grouped],
  );

  const addToBoard = async (r: ToolRow) => {
    setFiling(r.id);
    try {
      const { tool } = await fileOnBoard(
        { name: displayName(r.id), url: r.url ?? "", summary: r.purpose || r.id },
        "Added from the Tools tab in Jarvis.",
      );
      setBoard(getBoard().tools);
      setNote(`${displayName(r.id)} filed under ${tool.group} › ${tool.category}.`);
    } finally {
      setFiling(null);
    }
  };

  const scan = scannedTools();
  const stale = Date.now() - new Date(scan.generatedAt).getTime() > 1000 * 60 * 60 * 24 * 30;

  /** The call sites, grouped by scope — widest reach first. */
  const sitesByScope = (sites: CallSite[]) => {
    const order: Scope[] = ["global", "app", "route", "lib", "tool", "other"];
    const map = new Map<Scope, CallSite[]>();
    for (const s of sites) map.set(s.scope, [...(map.get(s.scope) ?? []), s]);
    return order.filter((s) => map.has(s)).map((s) => ({ scope: s, sites: map.get(s)! }));
  };

  const detail = (r: ToolRow) => (
    <tr key={`${r.id}-detail`} className="border-b border-line-soft bg-canvas/60">
      <td />
      <td colSpan={5} className="py-3 pr-3">
        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Call sites <span className="tabular-nums">({r.sites.length})</span>
            </h4>
            {r.sites.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-ink-muted">
                Nothing in the code calls this. That is either a tool you are about to wire in, or one you have
                already replaced.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {sitesByScope(r.sites).map(({ scope, sites }) => (
                  <li key={scope}>
                    <Chip className={SCOPE_STYLE[scope]}>{SCOPE_LABEL[scope]}</Chip>
                    <ul className="mt-1 space-y-0.5 pl-1">
                      {sites.map((s) => (
                        <li key={`${s.file}:${s.line}`} className="font-mono text-[10.5px] leading-relaxed text-ink-muted">
                          {s.file}
                          <span className="text-ink-faint">:{s.line}</span>
                          {s.app && <span className="ml-1.5 font-sans text-ink-faint">{s.app}</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Studio workflows pinned here <span className="tabular-nums">({r.workflows.length})</span>
            </h4>
            {r.workflows.length > 0 && (
              <ul className="mb-2 space-y-1">
                {r.workflows.map((b) => {
                  const wf = WORKFLOWS.find((w) => w.id === b.workflowId);
                  return (
                    <li key={`${b.workflowId}-${b.role}`} className="flex items-center gap-2 text-[11px] text-ink">
                      <span className="flex-1 truncate">{wf?.name ?? b.workflowId}</span>
                      <Chip className="border-line bg-panel-2 text-ink-muted">{b.role}</Chip>
                      <button
                        className={`${iconBtn} hover:text-red-400`}
                        onClick={() => bind(b.workflowId, b.role, "")}
                        aria-label={`Unpin ${wf?.name ?? b.workflowId} from ${displayName(r.id)}`}
                      >
                        <Icon.Trash width={11} height={11} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <form
              className="flex flex-wrap gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const wf = (form.elements.namedItem("wf") as HTMLSelectElement).value;
                const role = (form.elements.namedItem("role") as HTMLInputElement).value.trim() || "render";
                if (wf) bind(wf, role, r.id);
                form.reset();
              }}
            >
              <select name="wf" defaultValue="" aria-label="Workflow to pin" className={`${field} w-auto flex-1 min-w-[10rem]`}>
                <option value="">Pin a workflow…</option>
                {WORKFLOWS.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <input name="role" placeholder="for — image" aria-label="Job it does there" className={`${field} w-24`} />
              <button type="submit" className="rounded-md border border-brand/40 px-2 py-1 text-[11px] font-medium text-brand transition hover:bg-brand/10">
                Pin
              </button>
            </form>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
              A workflow declares a medium, not a model — the render layer picks the engine. Pin one here when it
              should use this tool specifically.
            </p>
          </section>
        </div>
      </td>
    </tr>
  );

  const row = (r: ToolRow, i: number) => {
    const ranked = matchTool(displayName(r.id), r.url ?? "", board);
    const isOpen = open === r.id;
    const isEditing = editing === r.id;

    return [
      <tr
        key={r.id}
        className={`group border-b border-line-soft align-top transition-colors last:border-0 hover:bg-panel-2/50 ${isOpen ? "bg-panel-2/40" : ""}`}
      >
        <td className="w-8 py-2 pl-3 pr-1 text-[11px] tabular-nums text-ink-faint">{i + 1}</td>

        <td className="py-2 pr-3">
          <span className="block text-[13px] font-semibold text-ink">
            {r.url ? (
              <a href={r.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
                {displayName(r.id)}
              </a>
            ) : (
              displayName(r.id)
            )}
          </span>
          {r.id.includes("/") && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(r.id);
                setNote(`Copied ${r.id}`);
              }}
              title="Copy the exact id"
              className="mt-0.5 block whitespace-nowrap font-mono text-[10.5px] text-ink-faint transition-colors hover:text-ink"
            >
              {r.id}
            </button>
          )}
        </td>

        <td className="py-2 pr-3 text-xs text-ink">
          {isEditing ? (
            <form
              className="grid gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                setEditing(null);
              }}
            >
              <input
                autoFocus
                defaultValue={r.job}
                onBlur={(e) => setNoteFor(r.id, { job: e.target.value })}
                placeholder="Job — one or two words, e.g. Image"
                aria-label={`The job ${displayName(r.id)} does`}
                className={field}
              />
              <input
                defaultValue={r.purpose}
                onBlur={(e) => setNoteFor(r.id, { purpose: e.target.value })}
                placeholder="What you use it for"
                aria-label={`What ${displayName(r.id)} is for`}
                className={field}
              />
              <input
                defaultValue={r.note}
                onBlur={(e) => setNoteFor(r.id, { note: e.target.value })}
                placeholder="Note — quirks, plans"
                aria-label={`Note on ${displayName(r.id)}`}
                className={field}
              />
              <div className="flex gap-1">
                {(["keep", "trial", "replace"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setNoteFor(r.id, { status: r.status === s ? undefined : s })}
                    className={`rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium transition ${
                      r.status === s ? STATUS_STYLE[s] : "border-line text-ink-faint hover:text-ink"
                    }`}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
                <button type="submit" className="ml-auto rounded-md bg-brand px-2 py-0.5 text-[10.5px] font-semibold text-white hover:bg-brand-2">
                  Done
                </button>
              </div>
            </form>
          ) : (
            <>
              {r.purpose || <span className="text-ink-faint">—</span>}
              {r.note && <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-faint">{r.note}</span>}
            </>
          )}
        </td>

        <td className="py-2 pr-3">
          <div className="flex flex-wrap items-center gap-1">
            {r.reach === "global" && <Chip className={SCOPE_STYLE.global}>Hub-wide</Chip>}
            {r.apps.slice(0, 3).map((a) => (
              <Chip key={a} className={SCOPE_STYLE.app}>
                {a}
              </Chip>
            ))}
            {r.apps.length > 3 && <span className="text-[10.5px] tabular-nums text-ink-faint">+{r.apps.length - 3}</span>}
            {r.reach !== "global" && r.apps.length === 0 && r.sites.length > 0 && (
              <Chip className={SCOPE_STYLE.lib}>{r.sites[0].label}</Chip>
            )}
            {r.sites.length === 0 && <span className="text-[10.5px] text-ink-faint">not in code</span>}
          </div>
          <button
            type="button"
            onClick={() => setOpen(isOpen ? null : r.id)}
            aria-expanded={isOpen}
            className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-ink-faint transition-colors hover:text-ink"
          >
            <Icon.Chevron width={9} height={9} className={`transition-transform duration-200 ${isOpen ? "rotate-0" : "-rotate-90"}`} />
            <span className="tabular-nums">{r.sites.length}</span> call {r.sites.length === 1 ? "site" : "sites"}
            {r.workflows.length > 0 && (
              <>
                {" · "}
                <span className="tabular-nums">{r.workflows.length}</span> pinned
              </>
            )}
          </button>
        </td>

        <td className="py-2 pr-2">
          {r.status && <Chip className={STATUS_STYLE[r.status]}>{STATUS_LABEL[r.status]}</Chip>}
        </td>

        <td className="whitespace-nowrap py-1.5 pr-2 text-right">
          {r.kind === "model" &&
            (ranked ? (
              <button
                type="button"
                onClick={() => {
                  window.location.hash = "rankings";
                }}
                title={`On the AI Rankings board under ${ranked.group} › ${ranked.category}`}
                className={`${iconBtn} text-emerald-300/80 hover:text-emerald-200`}
                aria-label={`${displayName(r.id)} is on the AI Rankings board`}
              >
                <Icon.Check width={12} height={12} />
              </button>
            ) : (
              <button
                type="button"
                disabled={filing === r.id}
                onClick={() => void addToBoard(r)}
                title="File this model on the AI Rankings board"
                className={iconBtn}
                aria-label={`File ${displayName(r.id)} on AI Rankings`}
              >
                <Icon.Refresh width={12} height={12} className={filing === r.id ? "animate-spin" : ""} />
              </button>
            ))}
          <button
            className={iconBtn}
            onClick={() => setEditing(isEditing ? null : r.id)}
            aria-label={`Edit what ${displayName(r.id)} is for`}
          >
            <Icon.Edit width={12} height={12} />
          </button>
        </td>
      </tr>,
      isOpen ? detail(r) : null,
    ];
  };

  let n = 0;

  return (
    <div className="p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">Tools</h2>
        <span className="text-[11px] text-ink-faint">
          Every model and service this hub uses, read from the code.
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="tool-search">
            Search tools
          </label>
          <input
            id="tool-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a model, app or file…"
            className="w-44 rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
          />
          <div className="inline-flex rounded-lg border border-line p-0.5">
            {([["By job", true], ["Flat", false]] as const).map(([label, on]) => (
              <button
                key={label}
                onClick={() => setGrouped(on)}
                aria-pressed={grouped === on}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                  grouped === on ? "bg-panel-2 text-ink" : "text-ink-faint hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {note && (
        <p className="mb-2 text-[11px] text-ink-muted" role="status">
          {note}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-faint">
              <th className="py-1.5 pl-3 pr-1 font-medium">#</th>
              <th className="py-1.5 pr-3 font-medium">Tool</th>
              <th className="py-1.5 pr-3 font-medium">Used for</th>
              <th className="py-1.5 pr-3 font-medium">Where it&apos;s used</th>
              <th className="py-1.5 pr-2 font-medium">Status</th>
              <th className="py-1.5 pr-2" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.role || "all"}>
                {grouped && (
                  <tr className="border-b border-line-soft bg-canvas/40">
                    <td colSpan={6} className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      {g.role} <span className="ml-1 tabular-nums text-ink-faint">{g.tools.length}</span>
                    </td>
                  </tr>
                )}
                {g.tools.flatMap((r) => row(r, n++))}
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-xs text-ink-muted">
                  {query ? `Nothing matches “${query}”.` : "The scan found no tools — run node scripts/scan-tools.mjs."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
        Scanned from the code on{" "}
        <time dateTime={scan.generatedAt}>{new Date(scan.generatedAt).toLocaleDateString()}</time>
        {stale && <span className="text-amber-300/80"> — over a month old; re-run the scan</span>}. Re-read it with{" "}
        <code className="font-mono text-ink-muted">node scripts/scan-tools.mjs</code> and commit the result. What you
        write here is yours and survives every re-scan.
      </p>
    </div>
  );
}
