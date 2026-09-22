"use client";

// ---------------------------------------------------------------------------
// Toolbox › Tools — the models the owner actually works with.
//
// A dense table, one row per model: what it's for, the exact id, how it's
// called, and whether it's on the AI Rankings board. Rows edit in place; order
// is the owner's (most-used first). The first run is seeded from the models
// the hub's code really calls — see src/lib/jarvis/toolkit.ts.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { fileOnBoard, matchTool } from "@/lib/ai-rankings/fromDashboard";
import { getData as getBoard } from "@/lib/ai-rankings/store";
import type { Tool } from "@/lib/ai-rankings/types";
import { blankModel, loadToolkit, saveToolkit, TOOLKIT_KEY, type KitModel } from "@/lib/jarvis/toolkit";
import { useRemotePull } from "@/lib/sync/useSync";

const field =
  "w-full rounded-md border border-line bg-canvas px-2 py-1 text-xs text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none";
const iconBtn =
  "rounded p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";

export function ToolsTab() {
  const [models, setModels] = useState<KitModel[]>([]);
  const [editing, setEditing] = useState<KitModel | null>(null);
  const [board, setBoard] = useState<Tool[]>([]);
  const [filing, setFiling] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const reload = () => {
    setModels(loadToolkit().models);
    setBoard(getBoard().tools);
  };
  useEffect(reload, []);
  useRemotePull(TOOLKIT_KEY, reload);

  const commit = (next: KitModel[]) => setModels(saveToolkit(next).models);

  const move = (i: number, d: -1 | 1) => {
    const next = [...models];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    commit(next);
  };

  const saveEdit = () => {
    if (!editing || !editing.name.trim()) return;
    const clean = { ...editing, name: editing.name.trim(), modelId: editing.modelId.trim() };
    const exists = models.some((m) => m.id === clean.id);
    commit(exists ? models.map((m) => (m.id === clean.id ? clean : m)) : [...models, clean]);
    setEditing(null);
  };

  /** Board records not already in the kit — the "add from AI Rankings" picker. */
  const addable = useMemo(
    () => board.filter((t) => !models.some((m) => matchTool(m.name, m.url ?? "", [t]))),
    [board, models],
  );

  const addToBoard = async (m: KitModel) => {
    setFiling(m.id);
    try {
      const { tool } = await fileOnBoard(
        { name: m.name, url: m.url ?? "", summary: m.role },
        "Added from the Tools tab in Jarvis.",
      );
      setBoard(getBoard().tools);
      setNote(`${m.name} filed under ${tool.group} › ${tool.category}.`);
    } finally {
      setFiling(null);
    }
  };

  const row = (m: KitModel, i: number) => {
    if (editing?.id === m.id) return editor(i);
    const ranked = matchTool(m.name, m.url ?? "", board);
    return (
      <tr key={m.id} className="group border-b border-line-soft align-top last:border-0 hover:bg-panel-2/50">
        <td className="w-8 py-2 pl-3 pr-1 text-[11px] tabular-nums text-ink-faint">{i + 1}</td>
        <td className="py-2 pr-3">
          <span className="block text-[13px] font-semibold text-ink">
            {m.url ? (
              <a href={m.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
                {m.name}
              </a>
            ) : (
              m.name
            )}
          </span>
          {m.modelId && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(m.modelId);
                setNote(`Copied ${m.modelId}`);
              }}
              title="Copy the model id"
              className="mt-0.5 block font-mono text-[10.5px] text-ink-faint hover:text-ink"
            >
              {m.modelId}
            </button>
          )}
        </td>
        <td className="py-2 pr-3 text-xs text-ink">
          {m.role}
          {m.note && <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-faint">{m.note}</span>}
        </td>
        <td className="hidden py-2 pr-3 text-[11px] text-ink-muted sm:table-cell">{m.via}</td>
        <td className="py-2 pr-2">
          {ranked ? (
            <button
              type="button"
              onClick={() => {
                window.location.hash = "rankings";
              }}
              title="Open in AI Rankings"
              className="inline-flex max-w-[11rem] items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-200 hover:bg-emerald-500/25"
            >
              <Icon.Check width={10} height={10} className="shrink-0" />
              <span className="truncate">
                {ranked.group} › {ranked.category}
              </span>
            </button>
          ) : (
            <button
              type="button"
              disabled={filing === m.id}
              onClick={() => void addToBoard(m)}
              title="File this model on the AI Rankings board — the section comes from its name"
              className="inline-flex items-center gap-1 rounded-md border border-brand/40 px-1.5 py-0.5 text-[10.5px] font-medium text-brand hover:bg-brand/10 disabled:opacity-60"
            >
              <Icon.Refresh width={10} height={10} className={filing === m.id ? "animate-spin" : ""} />
              {filing === m.id ? "Filing…" : "Sync"}
            </button>
          )}
        </td>
        <td className="whitespace-nowrap py-1.5 pr-2 text-right">
          <button className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${m.name} up`}>
            <Icon.Chevron width={12} height={12} className="-rotate-90" />
          </button>
          <button
            className={iconBtn}
            disabled={i === models.length - 1}
            onClick={() => move(i, 1)}
            aria-label={`Move ${m.name} down`}
          >
            <Icon.Chevron width={12} height={12} className="rotate-90" />
          </button>
          <button className={iconBtn} onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`}>
            <Icon.Edit width={12} height={12} />
          </button>
          <button
            className={`${iconBtn} hover:text-red-400`}
            onClick={() => {
              if (window.confirm(`Take ${m.name} off your tools?`)) commit(models.filter((x) => x.id !== m.id));
            }}
            aria-label={`Remove ${m.name}`}
          >
            <Icon.Trash width={12} height={12} />
          </button>
        </td>
      </tr>
    );
  };

  const editor = (i: number) => {
    if (!editing) return null;
    const set = (k: keyof KitModel, v: string) => setEditing({ ...editing, [k]: v });
    return (
      <tr key={editing.id} className="border-b border-line-soft bg-panel-2/60 align-top">
        <td className="w-8 py-2 pl-3 pr-1 text-[11px] tabular-nums text-ink-faint">{i + 1}</td>
        <td colSpan={5} className="py-2 pr-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit();
            }}
            className="grid gap-2 sm:grid-cols-2"
          >
            <input autoFocus required value={editing.name} onChange={(e) => set("name", e.target.value)} placeholder="Model name — Claude Opus 5" className={field} />
            <input value={editing.modelId} onChange={(e) => set("modelId", e.target.value)} placeholder="Exact id — anthropic/claude-opus-5" className={`${field} font-mono`} />
            <input value={editing.role} onChange={(e) => set("role", e.target.value)} placeholder="What you use it for" className={field} />
            <input value={editing.via} onChange={(e) => set("via", e.target.value)} placeholder="Called through — OpenRouter, RunPod…" className={field} />
            <input value={editing.note} onChange={(e) => set("note", e.target.value)} placeholder="Note (where it's wired in, quirks)" className={field} />
            <input value={editing.url ?? ""} onChange={(e) => set("url", e.target.value)} placeholder="Link (optional)" className={field} />
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-2">
                Save
              </button>
              <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-line px-3 py-1 text-xs text-ink-muted hover:text-ink">
                Cancel
              </button>
            </div>
          </form>
        </td>
      </tr>
    );
  };

  const isNew = editing && !models.some((m) => m.id === editing.id);

  return (
    <div className="p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">Tools</h2>
        <span className="text-[11px] text-ink-faint">
          The models you actually run your work on, most-used first.
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {addable.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const t = board.find((x) => x.id === e.target.value);
                if (!t) return;
                commit([
                  ...models,
                  { ...blankModel(), name: t.name, role: t.summary, url: t.url || undefined, via: t.hosting === "self-host" ? "Self-hosted" : "", note: `${t.group} › ${t.category}` },
                ]);
              }}
              aria-label="Add a model from AI Rankings"
              className="rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-ink-muted"
            >
              <option value="">Add from AI Rankings…</option>
              {addable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.group} › {t.category}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setEditing(blankModel())}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Plus width={13} height={13} /> Add a model
          </button>
        </div>
      </div>

      {note && <p className="mb-2 text-[11px] text-ink-muted" role="status">{note}</p>}

      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-faint">
              <th className="py-1.5 pl-3 pr-1 font-medium">#</th>
              <th className="py-1.5 pr-3 font-medium">Model</th>
              <th className="py-1.5 pr-3 font-medium">Used for</th>
              <th className="hidden py-1.5 pr-3 font-medium sm:table-cell">Via</th>
              <th className="py-1.5 pr-2 font-medium">AI Rankings</th>
              <th className="py-1.5 pr-2" />
            </tr>
          </thead>
          <tbody>
            {models.map(row)}
            {isNew && editor(models.length)}
            {models.length === 0 && !isNew && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-xs text-ink-muted">
                  No models yet. Add the ones you reach for every day.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10.5px] text-ink-faint">
        Started from the models this hub&apos;s own code calls by default — edit, reorder or remove any of them.
      </p>
    </div>
  );
}
