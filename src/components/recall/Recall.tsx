"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import {
  createFolder,
  deleteFolder,
  descendantFolderIds,
  folderPathString,
  getData,
  isLocal,
} from "@/lib/recall/store";
import { search } from "@/lib/recall/search";
import type { Folder, Item, RecallData } from "@/lib/recall/types";
import { ALL, FolderTree, UNFILED } from "./FolderTree";
import { ItemCard } from "./ItemCard";
import { CaptureModal } from "./CaptureModal";
import { ItemDetailModal } from "./ItemDetailModal";
import { AgentChat } from "./AgentChat";

export function Recall() {
  const [data, setData] = useState<RecallData>({ folders: [], items: [] });
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<Item | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [askQuestion, setAskQuestion] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setData(getData());
    setReady(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const pathFor = useCallback((id: string | null) => folderPathString(data.folders, id), [data.folders]);

  // Items in the currently-selected folder scope.
  const scopeItems = useMemo(() => {
    if (selected === ALL) return data.items;
    if (selected === UNFILED) return data.items.filter((i) => !i.folderId);
    const ids = descendantFolderIds(data.folders, selected);
    return data.items.filter((i) => i.folderId && ids.has(i.folderId));
  }, [data, selected]);

  // Tags present in scope, most-frequent first (for the filter bar).
  const scopeTags = useMemo(() => {
    const freq = new Map<string, number>();
    for (const it of scopeItems) for (const t of it.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 18);
  }, [scopeItems]);

  // Apply tag filters (AND) then keyword ranking.
  const results = useMemo(() => {
    const tagged = activeTags.length
      ? scopeItems.filter((i) => activeTags.every((t) => i.tags.includes(t)))
      : scopeItems;
    if (query.trim()) {
      return search(query, { items: tagged, folders: data.folders }).items.map((s) => s.item);
    }
    return [...tagged].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [scopeItems, activeTags, query, data.folders]);

  // Global folder/tag matches for the "jump to" row while searching.
  const jump = useMemo(() => {
    if (!query.trim()) return { folders: [] as Folder[], tags: [] as string[] };
    const r = search(query, data);
    return { folders: r.folders.slice(0, 6), tags: r.tags.slice(0, 8) };
  }, [query, data]);

  const existingTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of data.items) for (const t of it.tags) set.add(t);
    return [...set];
  }, [data]);

  const toggleTag = (t: string) =>
    setActiveTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const handleSelect = (id: string) => {
    setSelected(id);
    setMobileNav(false);
  };

  const handleDeleteFolder = (folder: Folder) => {
    if (!window.confirm(`Delete “${folder.name}”? Items inside move up to the parent folder.`)) return;
    const next = deleteFolder(folder.id);
    setData(next);
    if (selected === folder.id) setSelected(ALL);
  };

  const handleNewFolder = () => {
    const name = window.prompt("New folder name");
    if (!name?.trim()) return;
    setData(createFolder(name.trim(), null).data);
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Folders</span>
        <button onClick={handleNewFolder} className="rounded-md p-1 text-ink-faint hover:bg-panel-2 hover:text-ink" title="New folder">
          <Icon.Plus width={15} height={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <FolderTree folders={data.folders} items={data.items} selected={selected} onSelect={handleSelect} onDelete={handleDeleteFolder} />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-panel/95 px-3 py-2.5 backdrop-blur sm:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          aria-label="Back to hub"
        >
          <Icon.ArrowLeft width={14} height={14} />
          <span className="hidden sm:inline">Hub</span>
        </Link>
        <button onClick={() => setMobileNav((v) => !v)} className="rounded-lg border border-line p-1.5 text-ink-muted hover:text-ink md:hidden" aria-label="Folders">
          <Icon.Menu width={16} height={16} />
        </button>
        <span className="ml-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Icon.Sparkles width={16} height={16} className="text-brand" /> Recall
        </span>
        {isLocal() && (
          <span className="ml-1 rounded-md bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand">Local</span>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1">
        {/* Sidebar (desktop) */}
        <aside className="sticky top-[49px] hidden h-[calc(100dvh-49px)] w-60 shrink-0 border-r border-line px-3 py-4 md:block">{sidebar}</aside>

        {/* Mobile nav overlay */}
        {mobileNav && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMobileNav(false)}>
            <div className="absolute inset-0 bg-black/50" />
            <div className="absolute left-0 top-0 h-full w-64 border-r border-line bg-panel px-3 py-4" onClick={(e) => e.stopPropagation()}>
              {sidebar}
            </div>
          </div>
        )}

        {/* Main */}
        <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-6">
          {/* Search + add */}
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Icon.Search width={16} height={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search everything…  (⌘K)"
                className="w-full rounded-xl border border-line bg-panel py-2.5 pl-9 pr-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>
            <button
              onClick={() => setCaptureOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
            >
              <Icon.Plus width={16} height={16} />
              <span className="hidden sm:inline">Add</span>
            </button>
          </div>

          {/* Jump-to matches while searching */}
          {(jump.folders.length > 0 || jump.tags.length > 0) && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-panel/50 p-2 text-xs">
              {jump.folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => handleSelect(f.id)}
                  className="inline-flex items-center gap-1 rounded-lg bg-panel-2 px-2 py-1 text-ink-muted transition hover:text-brand"
                >
                  <Icon.Folder width={12} height={12} /> {pathFor(f.id)}
                </button>
              ))}
              {jump.tags.map((t) => (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className="inline-flex items-center gap-1 rounded-lg bg-panel-2 px-2 py-1 text-ink-muted transition hover:text-brand"
                >
                  <Icon.Tag width={12} height={12} /> {t}
                </button>
              ))}
            </div>
          )}

          {/* Tag filter bar */}
          {scopeTags.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {activeTags.length > 0 && (
                <button onClick={() => setActiveTags([])} className="text-[11px] font-medium text-ink-faint hover:text-ink">
                  Clear
                </button>
              )}
              {scopeTags.map((t) => {
                const on = activeTags.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    className={
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition " +
                      (on ? "border-brand bg-brand/15 text-brand" : "border-line text-ink-muted hover:bg-panel-2 hover:text-ink")
                    }
                  >
                    <Icon.Tag width={11} height={11} /> {t}
                  </button>
                );
              })}
            </div>
          )}

          {/* Header line */}
          <div className="mb-2 flex items-baseline justify-between">
            <h1 className="text-base font-semibold text-ink">
              {selected === ALL ? "All items" : selected === UNFILED ? "Unfiled" : pathFor(selected)}
            </h1>
            <span className="text-xs text-ink-faint">
              {results.length} {results.length === 1 ? "item" : "items"}
            </span>
          </div>

          {/* Results */}
          {!ready ? (
            <p className="py-16 text-center text-sm text-ink-muted">Loading…</p>
          ) : results.length === 0 ? (
            <EmptyState hasData={data.items.length > 0} onAdd={() => setCaptureOpen(true)} />
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {results.map((item) => (
                <ItemCard key={item.id} item={item} folderPath={pathFor(item.folderId)} onOpen={setDetailItem} onTagClick={toggleTag} />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Agent */}
      <AgentChat
        open={agentOpen}
        onOpen={() => setAgentOpen(true)}
        onClose={() => setAgentOpen(false)}
        data={data}
        onData={(d) => {
          setData(d);
          setToast("Done");
        }}
        onOpenItem={(it) => {
          setAgentOpen(false);
          setDetailItem(it);
        }}
        ask={askQuestion}
        onAskConsumed={() => setAskQuestion(null)}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-elevated px-4 py-2 text-xs font-medium text-ink shadow-lg">
          {toast}
        </div>
      )}

      {/* Modals */}
      {captureOpen && (
        <CaptureModal
          folders={data.folders}
          existingTags={existingTags}
          onClose={() => setCaptureOpen(false)}
          onSaved={(d, count) => {
            setData(d);
            setCaptureOpen(false);
            setToast(count > 1 ? `Saved ${count} items` : "Saved");
          }}
        />
      )}
      {detailItem && (
        <ItemDetailModal
          // Re-read the latest version of the item from data so edits reflect.
          item={data.items.find((i) => i.id === detailItem.id) ?? detailItem}
          folders={data.folders}
          onClose={() => setDetailItem(null)}
          onChange={setData}
          onDeleted={(d) => {
            setData(d);
            setDetailItem(null);
            setToast("Deleted");
          }}
          onAsk={(it) => {
            setDetailItem(null);
            setAskQuestion(it.title);
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ hasData, onAdd }: { hasData: boolean; onAdd: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-panel/50 py-16 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15 text-brand">
        <Icon.Sparkles width={22} height={22} />
      </div>
      <h3 className="text-sm font-semibold text-ink">{hasData ? "Nothing matches here" : "Your second brain is empty"}</h3>
      <p className="mx-auto mt-1 max-w-xs text-xs text-ink-muted">
        {hasData
          ? "Try a different folder, tag, or search — or capture something new."
          : "Capture a note, a link, or an image and Recall files and tags it for you."}
      </p>
      <button onClick={onAdd} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2">
        <Icon.Plus width={16} height={16} /> Capture something
      </button>
    </div>
  );
}
