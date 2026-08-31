"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { Sidebar } from "./Sidebar";
import { ToolTable } from "./ToolTable";
import { DetailPanel } from "./DetailPanel";
import * as store from "@/lib/ai-rankings/store";
import {
  EMPTY_FILTERS,
  featureIndex,
  filterTools,
  sortTools,
  VIEWS,
} from "@/lib/ai-rankings/query";
import type { Filters, SortBy, SortDir } from "@/lib/ai-rankings/query";
import type { BoardData, Tool } from "@/lib/ai-rankings/types";

export function AiRankings() {
  // Storage is browser-only, so the first render must match the server's empty
  // one; everything real arrives in the effect below.
  const [data, setData] = useState<BoardData>({ tools: [], tree: {} });
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortBy>("name");
  const [dir, setDir] = useState<SortDir>("asc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [flash, setFlash] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setData(store.getData());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const visible = useMemo(
    () => sortTools(filterTools(data.tools, filters), sort, dir),
    [data.tools, filters, sort, dir],
  );
  const record = data.tools.find((t) => t.id === selectedId) ?? null;
  const knownFeatures = useMemo(
    () => featureIndex(data.tools).map((f) => f.label),
    [data.tools],
  );

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** Select-all applies to what is on screen, never to the whole board. */
  const toggleAll = () =>
    setSelected((prev) => {
      const allShown = visible.length > 0 && visible.every((t) => prev.has(t.id));
      if (allShown) return new Set();
      return new Set(visible.map((t) => t.id));
    });

  const deleteSelected = () => {
    const ids = [...selected];
    setData(store.deleteTools(ids));
    if (selectedId && selected.has(selectedId)) setSelectedId(null);
    setSelected(new Set());
    setConfirmBulk(false);
    setFlash(`Deleted ${ids.length} record${ids.length === 1 ? "" : "s"}.`);
  };

  /**
   * Drag-to-rank only makes sense inside one leaderboard, which is exactly when
   * a single leaf category is in view.
   */
  const rankable = Boolean(filters.group && filters.category);
  const boardSize = record
    ? store.rankedIn(data, record.group, record.category).length
    : 0;

  const sortBy = (by: SortBy) => {
    if (by === sort) return setDir((d) => (d === "asc" ? "desc" : "asc"));
    setSort(by);
    setDir(by === "newest" ? "desc" : "asc");
  };

  const addRecord = () => {
    const { data: next, id } = store.addTool({
      name: "Untitled",
      url: "",
      summary: "",
      group: filters.group ?? "Unfiled",
      category: filters.category ?? "Unfiled",
      tags: [],
      access: "freemium",
      openSource: false,
      hosting: "hosted",
      apiKey: "none",
      haveKey: false,
    });
    setData(next);
    setSelectedId(id);
    setNavOpen(false);
  };

  const exportJson = () => {
    const blob = new Blob([store.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-rankings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFlash("Exported.");
  };

  const importJson = async (file: File) => {
    try {
      setData(store.importJson(await file.text()));
      setSelectedId(null);
      setFlash("Imported — the board was replaced.");
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "That file couldn't be read.");
    }
  };

  const viewLabel = VIEWS.find((v) => v.id === filters.view)?.label ?? "All records";
  const where = filters.category
    ? `${filters.group} › ${filters.category}`
    : (filters.group ?? "Everything");

  return (
    <div className="flex h-dvh flex-col">
      {/* Top bar */}
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <button
          onClick={() => setNavOpen((v) => !v)}
          className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:text-ink lg:hidden"
          aria-label="Toggle sections"
        >
          <Icon.Menu width={14} height={14} />
        </button>
        <Link
          href="/"
          className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink sm:inline-flex"
          aria-label="Back to hub"
        >
          <Icon.ArrowLeft width={13} height={13} />
          Hub
        </Link>
        <span className="hidden text-sm font-semibold text-ink md:inline">AI Rankings</span>

        <div className="relative mx-1 min-w-0 flex-1">
          <Icon.Search
            width={14}
            height={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
            placeholder="Search names, notes, features…"
            className="w-full rounded-lg border border-line bg-canvas py-1.5 pl-8 pr-2 text-[13px] text-ink outline-none focus:border-brand"
          />
        </div>

        <button
          onClick={exportJson}
          className="hidden rounded-lg border border-line p-1.5 text-ink-muted transition hover:text-ink sm:block"
          aria-label="Export JSON"
          title="Export JSON"
        >
          <Icon.Download width={14} height={14} />
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          className="hidden rounded-lg border border-line p-1.5 text-ink-muted transition hover:text-ink sm:block"
          aria-label="Import JSON"
          title="Import JSON"
        >
          <Icon.Upload width={14} height={14} />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importJson(file);
            e.target.value = "";
          }}
        />
        <button
          onClick={addRecord}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2"
        >
          <Icon.Plus width={13} height={13} />
          <span className="hidden sm:inline">New</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sections */}
        <div
          className={
            "w-60 shrink-0 border-r border-line bg-panel lg:block " +
            (navOpen
              ? "absolute inset-y-0 left-0 top-[49px] z-30 shadow-2xl"
              : "hidden")
          }
        >
          <Sidebar
            data={data}
            filters={filters}
            onFilters={(f) => {
              setFilters(f);
              setNavOpen(false);
            }}
            onAddGroup={(g) => setData(store.addGroup(g))}
            onAddCategory={(g, c) => setData(store.addCategory(g, c))}
          />
        </div>

        {/* Records */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line-soft px-3 py-1.5">
            <p className="font-mono text-[11px] text-ink-faint">
              {where}
              {filters.view !== "all" && ` · ${viewLabel.toLowerCase()}`}
              {filters.tags.length > 0 && ` · ${filters.tags.join(" + ")}`}
              {filters.feature && ` · does "${filters.feature}"`}
              <span className="ml-2 text-ink-muted">
                {visible.length}
                {visible.length !== data.tools.length && `/${data.tools.length}`}
              </span>
            </p>
            <div className="flex items-center gap-2">
              {/* Selection lives in this same strip on purpose: a bar that
                  appears above the table pushes every row down by its own
                  height, so the second checkbox you click is never the one you
                  aimed at. */}
              {selected.size > 0 && (
                <>
                  <span className="font-mono text-[11px] text-ink">{selected.size} selected</span>
                  <button
                    onClick={() => {
                      setSelected(new Set());
                      setConfirmBulk(false);
                    }}
                    className="font-mono text-[11px] text-ink-faint transition hover:text-ink"
                  >
                    clear
                  </button>
                  <button
                    onClick={() => (confirmBulk ? deleteSelected() : setConfirmBulk(true))}
                    className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/20"
                  >
                    {confirmBulk ? `Really delete ${selected.size}?` : "Delete selected"}
                  </button>
                </>
              )}
              {rankable && selected.size === 0 && (
                <span className="font-mono text-[11px] text-ink-faint">drag rows to rank</span>
              )}
              {(filters.view !== "all" ||
                filters.group ||
                filters.feature ||
                filters.tags.length > 0 ||
                filters.query) && (
                <button
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="font-mono text-[11px] text-ink-faint transition hover:text-ink"
                >
                  reset
                </button>
              )}
            </div>
          </div>


          {flash && (
            <p className="animate-fade-in shrink-0 border-b border-line-soft bg-panel px-3 py-1.5 text-[12px] text-ink-muted">
              {flash}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {!ready ? (
              <p className="px-4 py-20 text-center text-sm text-ink-faint">Loading your board…</p>
            ) : (
              <ToolTable
                tools={visible}
                selectedId={selectedId}
                onSelect={setSelectedId}
                sort={sort}
                dir={dir}
                onSort={sortBy}
                rankable={rankable}
                onMove={(id, position) => setData(store.moveToPosition(id, position))}
                onRank={(id) => setData(store.rankTool(id))}
                selected={selected}
                onToggleSelect={toggleSelect}
                onToggleAll={toggleAll}
              />
            )}
          </div>
        </main>

        {/* Record */}
        {record && (
          <div className="fixed inset-0 z-40 border-line bg-panel lg:static lg:z-auto lg:w-[380px] lg:shrink-0 lg:border-l">
            <DetailPanel
              tool={record}
              data={data}
              boardSize={boardSize}
              knownFeatures={knownFeatures}
              onClose={() => setSelectedId(null)}
              onPatch={(patch) => setData(store.updateTool(record.id, patch))}
              onDelete={() => {
                setData(store.deleteTool(record.id));
                setSelectedId(null);
              }}
              onAddFeature={(text, verdict) =>
                setData(store.addFeature(record.id, text, verdict))
              }
              onUpdateFeature={(featureId, patch) =>
                setData(store.updateFeature(record.id, featureId, patch))
              }
              onDeleteFeature={(featureId) =>
                setData(store.deleteFeature(record.id, featureId))
              }
              onMove={(position) => setData(store.moveToPosition(record.id, position))}
              onRank={() => setData(store.rankTool(record.id))}
              onUnrank={() => setData(store.unrankTool(record.id))}
              onTag={(tag) =>
                setFilters({
                  ...filters,
                  tags: filters.tags.includes(tag)
                    ? filters.tags.filter((t) => t !== tag)
                    : [...filters.tags, tag],
                })
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
