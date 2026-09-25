"use client";

// ---------------------------------------------------------------------------
// Toolbox › Tools, the data behind it: every model and service the hub uses,
// and where each one is used.
//
// Two halves that must not be confused:
//
//   Scanned   — read out of the code by scripts/scan-tools.mjs and committed as
//               toolUsage.generated.json. Call sites, scope, which apps. This
//               half is never edited by hand; it is regenerated and it is true.
//
//   The owner's — purpose, intent, and which tool a Studio workflow should use.
//               Synced through app_state like the rest of Jarvis. The code
//               cannot know these: a workflow declares a medium, not a model.
//
// They are merged for display, never merged in storage — so re-scanning can
// never overwrite a note, and writing a note can never fake a call site.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { nowIso } from "@/lib/utils";
import generated from "./toolUsage.generated.json";

export const TOOL_NOTES_KEY = "jarvis:toolNotes:v1";

/** Where a call site sits. Ordered widest reach first — the UI sorts on this. */
export type Scope = "global" | "app" | "route" | "lib" | "tool" | "other";

export const SCOPE_LABEL: Record<Scope, string> = {
  global: "Hub-wide",
  app: "App",
  route: "API route",
  lib: "Shared code",
  tool: "Desktop tool",
  other: "Other",
};

export interface CallSite {
  file: string;
  line: number;
  scope: Scope;
  /** The app slug, when the call site belongs to one. */
  app: string | null;
  label: string;
}

export interface ScannedTool {
  id: string;
  kind: "model" | "service";
  url: string | null;
  /** global = every app inherits it · shared = several apps · single = one. */
  reach: "global" | "shared" | "single";
  apps: string[];
  sites: CallSite[];
}

/** The owner's layer. Everything here is intent, which no scan can read. */
export interface ToolNote {
  /**
   * The job it does, in one or two words — "Image", "Video", "Transcription".
   * Deliberately separate from `purpose`: this is the grouping key, and prose
   * cannot group. A sentence per tool makes every tool its own section, which
   * is the opposite of seeing which models compete for the same job.
   */
  job?: string;
  /** What they use it for, in their words. Prose; shown, never grouped on. */
  purpose?: string;
  note?: string;
  /** keep = settled · trial = being evaluated · replace = on the way out. */
  status?: "keep" | "trial" | "replace";
}

/**
 * A Studio workflow pinned to a tool for one job. This is the case the code
 * cannot express today: two workflows both make images, and the owner wants
 * one on Qwen and the other on Gemini.
 */
export interface WorkflowBinding {
  workflowId: string;
  /** The job it does there: "image", "video", "audio", "script"… */
  role: string;
  toolId: string;
}

export interface ToolNotes {
  notes: Record<string, ToolNote>;
  bindings: WorkflowBinding[];
  updatedAt: string;
}

/** Scanned tool + the owner's layer, which is what the table renders. */
export interface ToolRow extends ScannedTool {
  job: string;
  purpose: string;
  note: string;
  status: ToolNote["status"];
  /** Workflows the owner has pinned to this tool. */
  workflows: WorkflowBinding[];
}

export interface ScanMeta {
  generatedAt: string;
  tools: ScannedTool[];
}

/** The committed scan. Static: it ships with the build, like the skills do. */
export function scannedTools(): ScanMeta {
  return generated as ScanMeta;
}

const EMPTY: ToolNotes = { notes: {}, bindings: [], updatedAt: "" };

export function loadNotes(): ToolNotes {
  const n = loadLocal<ToolNotes | null>(TOOL_NOTES_KEY, null);
  if (!n || typeof n.notes !== "object" || n.notes === null) return EMPTY;
  return { notes: n.notes, bindings: Array.isArray(n.bindings) ? n.bindings : [], updatedAt: n.updatedAt ?? "" };
}

export function saveNotes(patch: Partial<Omit<ToolNotes, "updatedAt">>): ToolNotes {
  const current = loadNotes();
  const next: ToolNotes = { ...current, ...patch, updatedAt: nowIso() };
  saveSynced(TOOL_NOTES_KEY, next);
  return next;
}

/**
 * The merged table.
 *
 * A tool the owner has written about but that no longer appears anywhere in
 * the code still shows up, with no call sites — that absence is the useful
 * signal ("you meant to use this and nothing does"), so it is not filtered out.
 */
export function toolRows(): ToolRow[] {
  const { tools } = scannedTools();
  const { notes, bindings } = loadNotes();

  const rows: ToolRow[] = tools.map((t) => ({
    ...t,
    job: notes[t.id]?.job ?? "",
    purpose: notes[t.id]?.purpose ?? "",
    note: notes[t.id]?.note ?? "",
    status: notes[t.id]?.status,
    workflows: bindings.filter((b) => b.toolId === t.id),
  }));

  // A tool the owner has written about OR pinned a workflow to, that the code
  // does not call. Both are ordinary: pinning a workflow to Qwen is how a tool
  // enters the hub before any code names it. Dropping it here would make the
  // binding invisible in the one table meant to show bindings.
  const known = new Set(tools.map((t) => t.id));
  const extra = new Set([...Object.keys(notes), ...bindings.map((b) => b.toolId)].filter((id) => !known.has(id)));

  for (const id of extra) {
    const n = notes[id] ?? {};
    rows.push({
      id,
      kind: id.includes("/") ? "model" : "service",
      url: id.includes("/") ? `https://openrouter.ai/${id}` : null,
      reach: "single",
      apps: [],
      sites: [],
      job: n.job ?? "",
      purpose: n.purpose ?? "",
      note: n.note ?? "",
      status: n.status,
      workflows: bindings.filter((b) => b.toolId === id),
    });
  }

  return rows;
}

/**
 * Tools grouped by the job they do, so the answer to "what paints images here"
 * is one list — and so two apps doing the same job with different models sit
 * next to each other instead of pages apart.
 */
export function byRole(rows: ToolRow[]): { role: string; tools: ToolRow[] }[] {
  const of = (r: ToolRow): string => {
    // The owner's one-word job wins; their prose never becomes a heading.
    if (r.job.trim()) return r.job.trim();
    if (r.kind === "service") return "Services";
    if (/image/.test(r.id)) return "Image";
    if (/video|seedance|h3|wan/.test(r.id)) return "Video";
    if (/embedding/.test(r.id)) return "Embeddings";
    return "Language";
  };
  const groups = new Map<string, ToolRow[]>();
  for (const r of rows) {
    const role = of(r);
    groups.set(role, [...(groups.get(role) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([role, tools]) => ({ role, tools }))
    .sort((a, b) => b.tools.length - a.tools.length || a.role.localeCompare(b.role));
}
