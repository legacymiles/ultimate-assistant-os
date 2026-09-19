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

import { useCallback, useEffect, useMemo, useState } from "react";
import { addMemory, searchMemories, type NewMemory } from "./memoryClient";
import type { JarvisStore, Memory, MemorySource } from "./types";

interface RemoteRow {
  id: string;
  source: MemorySource;
  title: string;
  content: string;
  origin: string;
  capturedAt: string;
}

function asMemory(r: RemoteRow): Memory {
  return { ...r, tags: [], links: [], remote: true };
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
  save: (input: NewMemory) => Promise<string>;
  remove: (id: string) => Promise<void>;
  search: (query: string, k?: number) => Promise<Memory[]>;
  syncMasterFolder: () => Promise<string>;
  refresh: () => Promise<void>;
}

export function useMemory(store: JarvisStore, commit: (s: JarvisStore) => void): UseMemory {
  const [rows, setRows] = useState<RemoteRow[] | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [canSync, setCanSync] = useState(false);

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

  return { memories, remote, reason, loading, canSync, save, remove, search, syncMasterFolder, refresh };
}
