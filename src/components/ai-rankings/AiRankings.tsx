"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { Sidebar } from "./Sidebar";
import { ToolTable } from "./ToolTable";
import { DetailPanel } from "./DetailPanel";
import * as store from "@/lib/ai-rankings/store";
import { useRemotePull } from "@/lib/sync/useSync";
import {
  addedLabel,
  applyContentFilter,
  CONTENT_FILTERS,
  EMPTY_FILTERS,
  featureIndex,
  filterTools,
  sortTools,
  VIEWS,
} from "@/lib/ai-rankings/query";
import type { ContentFilter, Filters, SortBy, SortDir } from "@/lib/ai-rankings/query";
import { isAdult } from "@/lib/ai-rankings/types";
import type { BoardData, Tool } from "@/lib/ai-rankings/types";

export function AiRankings() {
  // Storage is browser-only, so the first render must match the server's empty
  // one; everything real arrives in the effect below.
  const [data, setData] = useState<BoardData>({ tools: [], tree: {} });
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // Deliberately outside `filters`: it is remembered across reloads and it
  // survives "reset", because a filter switched on for privacy should only ever
  // come off on purpose.
  const [content, setContent] = useState<ContentFilter>("all");
  const [sort, setSort] = useState<SortBy>("name");
  const [dir, setDir] = useState<SortDir>("asc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [flash, setFlash] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setData(store.getData());
    setContent(store.getContentFilter());
    setReady(true);
  }, []);

  // Once the server copy has been settled into localStorage, re-read through
  // the store so a board created on another device shows up here.
  useRemotePull(store.KEY, () => setData(store.getData()));

  // An armed "clear the board" disarms itself. Leaving it primed means the next
  // click somewhere near that corner, minutes later, empties the board.
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 5000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  /**
   * The content filter runs first and everything else runs against what it
   * leaves. That is the whole point: with safe mode on, an adult record must
   * not be reachable through a sidebar count, a feature in the index, a stray
   * search word, or select-all — and the only way to guarantee that is for the
   * rest of the app never to see it.
   */
  const pool = useMemo(() => applyContentFilter(data.tools, content), [data.tools, content]);
  // Only meaningful in safe mode. In 18+ mode the "hidden" records are the
  // ordinary ones, and counting those would be a scary number about nothing.
  const hidden = content === "safe" ? data.tools.filter(isAdult).length : 0;

  const visible = useMemo(
    () => sortTools(filterTools(pool, filters), sort, dir),
    [pool, filters, sort, dir],
  );
  const record = pool.find((t) => t.id === selectedId) ?? null;
  const knownFeatures = useMemo(() => featureIndex(pool).map((f) => f.label), [pool]);

  // Rating the open record 18+ while in safe mode filters it out from under the
  // panel; drop the selection rather than leaving a hidden record on screen.
  useEffect(() => {
    if (selectedId && !pool.some((t) => t.id === selectedId)) setSelectedId(null);
  }, [pool, selectedId]);

  const pickContent = (mode: ContentFilter) => {
    setContent(mode);
    store.setContentFilter(mode);
    setSelected(new Set());
    setNavOpen(false);
  };

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

  const clearAll = () => {
    const n = data.tools.length;
    setData(store.clearTools());
    setSelectedId(null);
    setSelected(new Set());
    setConfirmClear(false);
    setFlash(`Cleared ${n} record${n === 1 ? "" : "s"}. Your sections are still here.`);
  };

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
    setDir("asc");
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
      // Adding a record while browsing the 18+ board means you are cataloguing
      // an adult model. Leaving it unrated would file it correctly and then
      // hide it from the very view you created it in.
      contentRating: content === "nsfw" ? "explicit" : undefined,
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
        {data.tools.length > 0 &&
          (confirmClear ? (
            <button
              onClick={clearAll}
              className="hidden shrink-0 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/20 sm:block"
            >
              Delete all {data.tools.length}?
            </button>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              className="hidden rounded-lg border border-line p-1.5 text-ink-muted transition hover:border-rose-500/40 hover:text-rose-300 sm:block"
              aria-label="Clear all records"
              title="Clear all records — your sections and their colours stay"
            >
              <Icon.Trash width={14} height={14} />
            </button>
          ))}
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
            data={{ tools: pool, tree: data.tree }}
            content={content}
            onContent={pickContent}
            hidden={hidden}
            filters={filters}
            onFilters={(f) => {
              // Choosing a window is a request to see what is new in it, so the
              // sort follows. It stays a normal sort afterwards — the column
              // headers still win if you want the oldest, or A-Z.
              if (f.added !== filters.added && f.added.preset !== "any") {
                setSort("newest");
                setDir("asc");
              }
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
              {addedLabel(filters.added) && ` · ${addedLabel(filters.added)}`}
              {content !== "all" &&
                ` · ${CONTENT_FILTERS.find((c) => c.id === content)?.label.toLowerCase()} only`}
              <span className="ml-2 text-ink-muted">
                {visible.length}
                {visible.length !== pool.length && `/${pool.length}`}
              </span>
              {/* Say how many are being withheld, so a record that has gone
                  missing reads as filtered rather than lost. */}
              {hidden > 0 && (
                <span className="ml-1.5 text-ink-faint">({hidden} hidden)</span>
              )}
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
                filters.added.preset !== "any" ||
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
