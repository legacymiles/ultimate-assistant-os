"use client";

// ---------------------------------------------------------------------------
// The memory tab: the ball full-size, the source filters, a search that
// highlights hits inside the ball, and the box that writes a memory.
//
// In stage 1 every memory here is one the owner typed, and search is word
// overlap on this device. Stage 2 adds Supabase, embeddings and the master
// folder sync — the UI does not change, because it only talks to memoryClient.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { MemoryCore, SOURCE_COLOR } from "./MemoryCore";
import { addMemory, graphNodes, linkCount, searchMemories } from "@/lib/jarvis/memoryClient";
import { MEMORY_SOURCES, SOURCE_LABEL, type JarvisStore, type MemorySource } from "@/lib/jarvis/types";

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink";

export function MemoryTab({
  store,
  commit,
}: {
  store: JarvisStore;
  commit: (s: JarvisStore) => void;
}) {
  const [mode, setMode] = useState<"sphere" | "network">("sphere");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const nodes = useMemo(() => graphNodes(store), [store]);
  const links = useMemo(() => linkCount(nodes), [nodes]);
  const hits = useMemo(() => searchMemories(store, query, 40), [store, query]);
  const highlight = useMemo(
    () => (query.trim() ? new Set(hits.map((h) => h.memory.id)) : undefined),
    [hits, query],
  );

  const counts = useMemo(() => {
    const c = new Map<MemorySource, number>();
    for (const m of store.memories) c.set(m.source, (c.get(m.source) ?? 0) + 1);
    return c;
  }, [store.memories]);

  const save = () => {
    if (!text.trim()) return;
    const next = addMemory(store, { source: "note", title, content: text, origin: "you" });
    if (next === store) {
      setSaved("You already have that exact note.");
      return;
    }
    commit(next);
    setTitle("");
    setText("");
    setSaved("Saved.");
    window.setTimeout(() => setSaved(null), 2500);
  };

  const toggleSource = (s: MemorySource) => {
    const muted = store.mutedSources.includes(s)
      ? store.mutedSources.filter((x) => x !== s)
      : [...store.mutedSources, s];
    commit({ ...store, mutedSources: muted });
  };

  const remove = (id: string) => {
    commit({ ...store, memories: store.memories.filter((m) => m.id !== id) });
  };

  return (
    <div className="p-3 sm:p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
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
                {store.memories.length.toLocaleString()} memories · {links.toLocaleString()} links
                {query.trim() ? ` · ${hits.length} match${hits.length === 1 ? "" : "es"}` : ""}
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
          <div className="mt-3 border-t border-line-soft pt-3">
            <p className="text-[10px] leading-relaxed text-ink-faint">
              Stage 2 adds Supabase memory, meaning-based search and the master-folder sync
              (CLAUDE.md, aios/ and your Claude Code memory files).
            </p>
          </div>
        </aside>
      </div>

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
          <button className={btn} onClick={save} disabled={!text.trim()}>
            <Icon.Plus width={13} height={13} /> Save memory
          </button>
          {saved && <span className="text-[11px] text-ink-muted">{saved}</span>}
        </div>
      </section>

      <section className="mt-3 rounded-xl border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <h2 className="text-xs font-semibold text-ink">
            {query.trim() ? `Results for "${query}"` : "All memories"}
          </h2>
          <span className="text-[11px] text-ink-faint">{hits.length} shown</span>
        </div>
        {hits.length === 0 ? (
          <p className="px-3 py-4 text-xs text-ink-muted">
            {query.trim()
              ? "Nothing matches. Jarvis would rather show nothing than guess."
              : "No memories yet. Write one above."}
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {hits.map(({ memory: m }) => (
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
                    {new Date(m.capturedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => remove(m.id)}
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
