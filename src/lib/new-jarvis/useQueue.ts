"use client";

// ---------------------------------------------------------------------------
// The In Queue board's state.
//
// Three sources meet here and only here:
//
//   the repo      — /api/new-jarvis/queue, which looks at disk
//   this device   — which workflows have actually been run, which is Studio
//                   conversation state and exists nowhere on the server
//   the owner     — their own verdicts and notes, synced across devices
//
// The fold order matters: the repo says what is there, the device upgrades a
// workflow from "untried" to "run", and the owner outranks both.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { mentionsIn } from "@/lib/studio/workflows";
import type { JarvisStore } from "@/lib/jarvis/types";
import { useRequests, type UseRequests } from "./useRequests";
import {
  QUEUE_STORE_KEY,
  annotate,
  countQueue,
  filterQueue,
  rule,
  sortQueue,
  toRows,
  EMPTY_FILTER,
  type QueueCounts,
  type QueueFact,
  type QueueFilter,
  type QueueRow,
  type QueueState,
  type QueueVerdicts,
} from "./queue";

export interface UseQueue {
  /** Loading until the first scan lands. */
  loading: boolean;
  error: string | null;
  /** Everything, judged and sorted — before the filter. */
  all: QueueRow[];
  /** What the board renders. */
  rows: QueueRow[];
  /** Counts over `all`, so the chips never move when a filter is applied. */
  counts: QueueCounts;
  filter: QueueFilter;
  setFilter: (f: QueueFilter | ((f: QueueFilter) => QueueFilter)) => void;
  /** The owner's click on a pip. */
  setState: (row: QueueRow, state: QueueState) => void;
  /** The owner's line about what is left. */
  setNote: (row: QueueRow, note: string) => void;
  refresh: () => void;
  /** What the owner asked for, per folder — the chat half of each row. */
  requests: UseRequests;
}

/**
 * Which workflow ids appear anywhere in the Studio transcripts.
 *
 * An @-mention in a conversation is the one durable trace that a workflow was
 * actually reached for. It is device-local, which is correct: a workflow the
 * owner has only ever run on the laptop is still a workflow they have run.
 */
function usedWorkflows(store: JarvisStore | null): Set<string> {
  const used = new Set<string>();
  if (!store) return used;
  for (const convo of store.conversations) {
    for (const turn of convo.turns) {
      for (const m of mentionsIn(turn.text)) used.add(m.workflow.id);
    }
  }
  return used;
}

export function useQueue(store: JarvisStore | null): UseQueue {
  const [facts, setFacts] = useState<QueueFact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [verdicts, setVerdicts] = useState<QueueVerdicts>(() =>
    loadLocal<QueueVerdicts>(QUEUE_STORE_KEY, {}),
  );
  const [filter, setFilter] = useState<QueueFilter>(EMPTY_FILTER);
  const requests = useRequests();

  // Verdicts made on the phone should be on the laptop. `useRemotePull`
  // reconciles the key and then calls back; the value is re-read from local
  // storage, which is where reconcile left the winner.
  useRemotePull(QUEUE_STORE_KEY, () =>
    setVerdicts(loadLocal<QueueVerdicts>(QUEUE_STORE_KEY, {})),
  );

  useEffect(() => {
    let live = true;
    setError(null);
    fetch("/api/new-jarvis/queue", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { facts?: QueueFact[]; error?: string }) => {
        if (!live) return;
        setFacts(data.facts ?? []);
        if (data.error) setError(data.error);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setFacts([]);
        setError(e instanceof Error ? e.message : "could not read the repo");
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  const used = useMemo(() => usedWorkflows(store), [store]);

  const all = useMemo(() => {
    if (!facts) return [];
    const folded = facts.map((f) =>
      f.kind === "workflow" && used.has(f.id.slice("flow:".length))
        ? { ...f, signals: { ...f.signals, everUsed: true } }
        : f,
    );
    return sortQueue(toRows(folded, verdicts, requests.counts));
  }, [facts, used, verdicts, requests.counts]);

  const rows = useMemo(() => filterQueue(all, filter), [all, filter]);
  const counts = useMemo(() => countQueue(all), [all]);

  const setState = useCallback((row: QueueRow, state: QueueState) => {
    setVerdicts((v) => {
      const next = rule(v, row, state);
      saveSynced(QUEUE_STORE_KEY, next);
      return next;
    });
  }, []);

  const setNote = useCallback((row: QueueRow, note: string) => {
    setVerdicts((v) => {
      const next = annotate(v, row, note);
      saveSynced(QUEUE_STORE_KEY, next);
      return next;
    });
  }, []);

  return {
    loading: facts === null,
    error,
    all,
    rows,
    counts,
    filter,
    setFilter,
    setState,
    setNote,
    refresh: () => setNonce((n) => n + 1),
    requests,
  };
}
