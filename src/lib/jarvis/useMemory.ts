"use client";

// ---------------------------------------------------------------------------
// One hook for "what does Jarvis remember", whichever half of the system is
// available.
//
//   remote  — Supabase + embeddings. Shared across devices, searched by
//             meaning, and what the agent itself reads.
//   local   — this device's store, word search only. The fallback when
//             Supabase is not configured or nobody is signed in.
//
// The UI never chooses; it asks this hook and shows `reason` when the answer
// is the degraded one. Writes go to whichever half is live, so a memory saved
// offline still exists — on this device — and is honestly labelled.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addMemory, searchMemories, type NewMemory } from "./memoryClient";
import type { JarvisStore, Memory, MemorySource } from "./types";

interface RemoteRow {
  id: string;
  source: MemorySource;
  title: string;
  content: string;
  origin: string;
  capturedAt: string;
  externalId?: string | null;
  meta?: Record<string, unknown> | null;
  tags?: string[];
}

/**
 * A row as the app's `Memory`.
 *
 * `links` used to be hardcoded `[]` here — and in the other producer — which
 * meant no memory anywhere in the app had a single relationship on it, and the
 * web drawn around the memory ball was decorative rather than real. Vault rows
 * carry their resolved wikilink targets in `meta.links`, so reading them here
 * is what turns that ball into an actual knowledge graph.
 */
function asMemory(r: RemoteRow): Memory {
  const links = Array.isArray(r.meta?.links)
    ? (r.meta!.links as unknown[]).filter((l): l is string => typeof l === "string")
    : [];
  const { meta: _meta, externalId: _externalId, ...rest } = r;
  return { ...rest, tags: r.tags ?? [], links, remote: true };
}

export interface UseMemory {
  /** Every memory, newest first, from whichever store is live. */
  memories: Memory[];
  /** True when the Supabase-backed memory is the one in use. */
  remote: boolean;
  /** Why memory is local-only, when it is. */
  reason: string;
  loading: boolean;
  /** Can this machine see the owner's ~/.claude folder? */
  canSync: boolean;
  /**
   * What the automatic master-folder sync did on this machine, when it ran.
   *
   * Empty everywhere else - off the owner's PC there is nothing to read, and
   * an empty string is how the UI knows not to claim otherwise.
   */
  autoSync: string;
  save: (input: NewMemory) => Promise<string>;
  remove: (id: string) => Promise<void>;
  search: (query: string, k?: number) => Promise<Memory[]>;
  syncMasterFolder: () => Promise<string>;
  refresh: () => Promise<void>;
}

/**
 * How long a master-folder sync is good for.
 *
 * The files it reads are the owner's notes and skills, which change over a day
 * of work, not over minutes - and each sync embeds every file it saved, which
 * costs. Six hours means opening Jarvis in the morning picks up yesterday's
 * work without re-embedding a hundred files every time a tab mounts.
 */
const SYNC_EVERY_MS = 6 * 3600_000;

/**
 * One automatic sync per page load, no matter how many components ask.
 *
 * Several mount `useMemory` at once (the shell, the Chat tab, the Memory tab),
 * and each would otherwise fire its own POST at the same moment - the same
 * hundred files, embedded three times over.
 */
let autoSyncRun = false;

export function useMemory(store: JarvisStore, commit: (s: JarvisStore) => void): UseMemory {
  const [rows, setRows] = useState<RemoteRow[] | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [canSync, setCanSync] = useState(false);
  const [autoSync, setAutoSync] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/jarvis/memory/list");
      const data = (await res.json()) as { available: boolean; reason?: string; memories?: RemoteRow[] };
      if (data.available) {
        setRows(data.memories ?? []);
        setReason("");
      } else {
        setRows(null);
        setReason(data.reason ?? "Memory database unavailable.");
      }
    } catch {
      setRows(null);
      setReason("Couldn't reach the memory database.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Whether the master-folder sync button can do anything here.
    fetch("/api/jarvis/memory/sync")
      .then((r) => r.json())
      .then((d: { local?: boolean }) => setCanSync(Boolean(d.local)))
      .catch(() => setCanSync(false));
  }, [refresh]);

  const remote = rows !== null;

  const memories = useMemo<Memory[]>(
    () => (rows ? rows.map(asMemory) : store.memories),
    [rows, store.memories],
  );

  const save = useCallback(
    async (input: NewMemory): Promise<string> => {
      if (remote) {
        const res = await fetch("/api/jarvis/memory/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memories: [input] }),
        });
        const data = (await res.json()) as { available?: boolean; saved?: number; reason?: string; embedded?: boolean };
        if (data.available && data.saved) {
          await refresh();
          return data.embedded ? "Saved and indexed." : "Saved (word search only — no embedding key).";
        }
        return data.reason ? `Couldn't save: ${data.reason}` : "Couldn't save.";
      }
      const next = addMemory(store, input);
      if (next === store) return "You already have that exact note.";
      commit(next);
      return "Saved on this device.";
    },
    [remote, refresh, store, commit],
  );

  const remove = useCallback(
    async (id: string) => {
      if (remote) {
        await fetch("/api/jarvis/memory/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        await refresh();
        return;
      }
      commit({ ...store, memories: store.memories.filter((m) => m.id !== id) });
    },
    [remote, refresh, store, commit],
  );

  const search = useCallback(
    async (query: string, k = 20): Promise<Memory[]> => {
      if (!remote) {
        return searchMemories(store, query, k).map((h) => h.memory);
      }
      if (!query.trim()) return memories.slice(0, k);
      const res = await fetch("/api/jarvis/memory/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: k }),
      });
      const data = (await res.json()) as { available: boolean; hits?: RemoteRow[] };
      return (data.hits ?? []).map(asMemory);
    },
    [remote, store, memories],
  );

  const syncMasterFolder = useCallback(async (): Promise<string> => {
    const res = await fetch("/api/jarvis/memory/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = (await res.json()) as {
      available?: boolean;
      saved?: number;
      files?: number;
      local?: number;
      repo?: number;
      error?: string;
      reason?: string;
      note?: string;
    };
    await refresh();
    if (!data.available) return data.reason ?? "Sync needs the memory database.";
    if (data.error) return `Synced ${data.saved ?? 0}, then stopped: ${data.error}`;
    if (!data.files) return data.note ?? "Nothing to sync.";
    return `Synced ${data.saved} files — ${data.repo ?? 0} from the repo, ${data.local ?? 0} from your Claude folder.`;
  }, [refresh]);

  /**
   * On the owner's PC, pull the master folder in without being asked.
   *
   * The reason this exists: ~/.claude — a hundred skills and every memory file
   * Claude Code has written — can only be read by a server running on that
   * machine. Off the PC the button is disabled and the tab stays empty, so a
   * sync that has to be found and pressed is a sync that never happens. The
   * Skills Library already learned this and scans on mount; memory now does the
   * same, and the store remembers when, so it is once every six hours rather
   * than once per tab.
   */
  const storeRef = useRef(store);
  storeRef.current = store;
  useEffect(() => {
    if (loading || !remote || !canSync || autoSyncRun) return;
    const last = Date.parse(storeRef.current.lastSync || "");
    if (Number.isFinite(last) && Date.now() - last < SYNC_EVERY_MS) return;
    autoSyncRun = true;
    void (async () => {
      const said = await syncMasterFolder();
      setAutoSync(said);
      commit({ ...storeRef.current, lastSync: new Date().toISOString() });
    })();
  }, [loading, remote, canSync, syncMasterFolder, commit]);

  return { memories, remote, reason, loading, canSync, autoSync, save, remove, search, syncMasterFolder, refresh };
}
