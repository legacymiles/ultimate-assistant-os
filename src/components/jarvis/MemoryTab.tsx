"use client";

// ---------------------------------------------------------------------------
// The memory tab: the ball full-size, the source filters, a search that
// highlights hits inside the ball, the box that writes a memory, and the
// master-folder sync.
//
// Which memory is in use — Supabase with meaning search, or this device with
// word search — comes from useMemory, and the header says which, always.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { MemoryCore, SOURCE_COLOR } from "./MemoryCore";
import { MemorySyncCard } from "./MemorySyncCard";
import { recency } from "@/lib/jarvis/rank";
import { useMemory } from "@/lib/jarvis/useMemory";
import {
  MEMORY_SOURCES,
  SOURCE_LABEL,
  type JarvisStore,
  type Memory,
  type MemorySource,
} from "@/lib/jarvis/types";
import type { GraphNode } from "@/lib/jarvis/memoryClient";

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50";

/**
 * Why the list is empty - which is never "nothing has happened yet".
 *
 * An empty memory has three different causes and three different answers, and
 * the one sentence that fits all three ("no memories yet") is the reason this
 * tab could sit empty for days with a hundred skills on disk.
 */
export function emptyReason(m: { remote: boolean; canSync: boolean; loading: boolean }): string {
  if (m.loading) return "Reading your memory…";
  if (!m.remote) return "Memory is local to this device right now, and nothing is saved here yet.";
  if (m.canSync) return "Nothing yet — the master-folder sync is running, or has nothing to read.";
  return "Nothing yet. Write one above, or open Jarvis on your PC to pull your Claude folder in.";
}

/** The ball's nodes, from whichever memory store is live. */
export function nodesFrom(memories: Memory[], muted: MemorySource[], cap = 2000): GraphNode[] {
  return memories
    .filter((m) => !muted.includes(m.source))
    .slice(0, cap)
    .map((m) => ({
      id: m.id,
      source: m.source,
      title: m.title,
      strength: Math.min(1, 0.35 + Math.min(m.content.length, 800) / 1600 + recency(m.capturedAt) * 0.3),
      links: m.links ?? [],
    }));
}

export function MemoryTab({
  store,
  commit,
}: {
  store: JarvisStore;
  commit: (s: JarvisStore) => void;
}) {
  const memory = useMemory(store, commit);
  const [mode, setMode] = useState<"sphere" | "network">("sphere");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Memory[] | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const visible = useMemo(
    () => memory.memories.filter((m) => !store.mutedSources.includes(m.source)),
    [memory.memories, store.mutedSources],
  );
  const nodes = useMemo(() => nodesFrom(memory.memories, store.mutedSources), [memory.memories, store.mutedSources]);

  // Search runs against the live store, debounced so typing does not fire a
  // request per keystroke.
  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void memory.search(query, 40).then((hits) => {
        if (!cancelled) setResults(hits.filter((m) => !store.mutedSources.includes(m.source)));
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, memory, store.mutedSources]);

  const shown = results ?? visible.slice(0, 40);
  const highlight = useMemo(
    () => (results ? new Set(results.map((m) => m.id)) : undefined),
    [results],
  );

  const counts = useMemo(() => {
    const c = new Map<MemorySource, number>();
    for (const m of memory.memories) c.set(m.source, (c.get(m.source) ?? 0) + 1);
    return c;
  }, [memory.memories]);

  const save = async () => {
    if (!text.trim()) return;
    const msg = await memory.save({ source: "note", title, content: text, origin: "you" });
    setNote(msg);
    if (msg.startsWith("Saved")) {
      setTitle("");
      setText("");
    }
    window.setTimeout(() => setNote(null), 4000);
  };

  const sync = async () => {
    setSyncing(true);
    setNote("Reading your master folder…");
    setNote(await memory.syncMasterFolder());
    setSyncing(false);
  };

  const toggleSource = (s: MemorySource) => {
    const muted = store.mutedSources.includes(s)
      ? store.mutedSources.filter((x) => x !== s)
      : [...store.mutedSources, s];
    commit({ ...store, mutedSources: muted });
  };

  return (
    <div className="p-3 sm:p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
        <section className="relative overflow-hidden rounded-xl border border-line bg-black">
          <MemoryCore nodes={nodes} mode={mode} highlight={highlight} className="h-[46vh] min-h-[280px] w-full" />

          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
            <div className="pointer-events-auto flex flex-wrap items-center gap-2">
              <div className="flex overflow-hidden rounded-lg border border-line bg-panel/70 backdrop-blur">
                {(["sphere", "network"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-2.5 py-1.5 text-xs capitalize transition ${
                      mode === m ? "bg-panel-2 text-ink" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="flex min-w-[180px] flex-1 items-center gap-1.5 rounded-lg border border-line bg-panel/70 px-2 py-1 backdrop-blur">
                <Icon.Search width={13} height={13} className="text-ink-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a memory…"
                  className="w-full bg-transparent text-xs text-ink placeholder:text-ink-faint focus:outline-none"
                />
                {query && (
                  <button onClick={() => setQuery("")} aria-label="Clear search">
                    <Icon.Close width={12} height={12} className="text-ink-faint hover:text-ink" />
                  </button>
                )}
              </div>
            </div>

            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-ink-faint">memory core</p>
              <p className="text-sm text-ink">
                {memory.memories.length.toLocaleString()} memories
                {results ? ` · ${results.length} match${results.length === 1 ? "" : "es"}` : ""}
              </p>
            </div>
          </div>
        </section>

        <aside className="rounded-xl border border-line bg-panel p-3">
          <h2 className="mb-2 text-xs font-semibold text-ink">Memory sources</h2>
          <ul className="space-y-1">
            {MEMORY_SOURCES.map((s) => {
              const n = counts.get(s) ?? 0;
              const on = !store.mutedSources.includes(s);
              return (
                <li key={s}>
                  <button
                    onClick={() => toggleSource(s)}
                    className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs transition hover:bg-panel-2 ${
                      on ? "text-ink" : "text-ink-faint"
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: on ? SOURCE_COLOR[s] : "#2b3040" }}
                      aria-hidden
                    />
                    <span className="flex-1 text-left">{SOURCE_LABEL[s]}</span>
                    <span className="font-mono text-[11px]">{n}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">
            Switching a source off hides it from the ball and from search. Nothing is deleted.
          </p>

          <div className="mt-3 space-y-2 border-t border-line-soft pt-3">
            <p className="text-[11px] text-ink-muted">
              {memory.loading
                ? "Checking your memory database…"
                : memory.remote
                  ? "Saved to your account, searched by meaning and by words."
                  : `Local to this device. ${memory.reason}`}
            </p>
            <button className={btn} onClick={() => void sync()} disabled={syncing || !memory.remote}>
              <Icon.Refresh width={13} height={13} /> {syncing ? "Syncing…" : "Sync master folder"}
            </button>
            <p className="text-[10px] leading-relaxed text-ink-faint">
              {memory.autoSync
                ? memory.autoSync
                : memory.canSync
                  ? "Runs itself every six hours on this PC: CLAUDE.md, aios/, your Claude Code memory files and your skills."
                  : "On this machine only CLAUDE.md and aios/ are readable — open Jarvis on your PC to pull in your Claude Code memory files and skills."}
            </p>
          </div>
        </aside>
      </div>

      <MemorySyncCard />

      <section className="mt-3 rounded-xl border border-line bg-panel p-3">
        <h2 className="mb-2 text-xs font-semibold text-ink">Remember something</h2>
        <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a note, a preference, a decision, a lesson…"
            rows={3}
            className="rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button className={btn} onClick={() => void save()} disabled={!text.trim()}>
            <Icon.Plus width={13} height={13} /> Save memory
          </button>
          {note && <span className="text-[11px] text-ink-muted">{note}</span>}
        </div>
      </section>

      <section className="mt-3 rounded-xl border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <h2 className="text-xs font-semibold text-ink">
            {query.trim() ? `Results for "${query}"` : "Recent memories"}
          </h2>
          <span className="text-[11px] text-ink-faint">{shown.length} shown</span>
        </div>
        {shown.length === 0 ? (
          <div className="px-3 py-4">
            <p className="text-xs text-ink-muted">
              {query.trim()
                ? "Nothing matches. Jarvis would rather show nothing than guess."
                : emptyReason(memory)}
            </p>
            {!query.trim() && !memory.canSync && memory.remote && (
              <p className="mt-1.5 max-w-[68ch] text-[11px] leading-relaxed text-ink-faint">
                Your skills and the memory files Claude Code writes live in ~/.claude on your PC, and only
                a Jarvis running there can read them. Open this tab on your machine once and they load
                themselves — after that they are in your account and readable from anywhere, including here.
              </p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {shown.map((m) => (
              <li key={m.id} className="flex items-start gap-2 px-3 py-2">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: SOURCE_COLOR[m.source] }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-ink">{m.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-muted">{m.content}</p>
                  <p className="mt-1 text-[10px] text-ink-faint">
                    {SOURCE_LABEL[m.source]} · {m.origin} · captured{" "}
                    {m.capturedAt ? new Date(m.capturedAt).toLocaleDateString() : "unknown"}
                  </p>
                </div>
                <button
                  onClick={() => void memory.remove(m.id)}
                  aria-label={`Forget ${m.title}`}
                  className="shrink-0 rounded-md p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
                >
                  <Icon.Trash width={13} height={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
