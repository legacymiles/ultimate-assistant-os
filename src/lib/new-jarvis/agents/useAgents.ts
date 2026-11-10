"use client";

// ---------------------------------------------------------------------------
// The Agents tab's state.
//
// It polls, because the whole point is that work happens on a machine the
// owner is not looking at: a laptop that woke at 6am should show its progress
// without anyone pressing anything (A1). Fifteen seconds matches In Queue's
// own hook, so the two tabs feel like one app.
//
// Polling pauses while the tab is hidden. An agent that takes three days has
// no business waking a phone's radio every fifteen seconds in a pocket.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  EMPTY_AGENTS,
  liveCount,
  normalizeDoc,
  sortAgents,
  type Agent,
  type AgentNeed,
  type AgentsDoc,
} from "./agents";

const POLL_MS = 15_000;
const URL = "/api/new-jarvis/agents";

export interface NewAgentDraft {
  goal: string;
  needs: AgentNeed[];
  steps: string[];
  folder?: string;
}

export interface UseAgents {
  doc: AgentsDoc;
  /** Live work first, finished last — what the owner actually reads. */
  list: Agent[];
  live: number;
  loading: boolean;
  /** Plain English, never a code (R3). */
  error: string;
  /** True once a load has finished, so the empty state is not shown while loading (U4). */
  loaded: boolean;
  refresh: () => void;
  create: (draft: NewAgentDraft) => Promise<boolean>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  busy: boolean;
}

export function useAgents(enabled = true): UseAgents {
  const [doc, setDoc] = useState<AgentsDoc>(EMPTY_AGENTS);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** Guards against a slow response from an earlier poll landing after a newer one. */
  const run = useRef(0);

  const load = useCallback(async () => {
    const mine = ++run.current;
    setLoading(true);
    try {
      const res = await fetch(URL, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { doc?: unknown; error?: string };
      if (mine !== run.current) return;
      if (!res.ok) {
        // 401 is not an error worth shouting about: it means signed out.
        setError(res.status === 401 ? "" : data.error || "Couldn't read your agents.");
        setDoc(EMPTY_AGENTS);
        return;
      }
      setDoc(normalizeDoc(data.doc));
      setError("");
    } catch {
      if (mine !== run.current) return;
      setError("Couldn't reach your agents. Check the connection.");
    } finally {
      if (mine === run.current) {
        setLoading(false);
        setLoaded(true);
      }
    }
  }, []);

  // Load once however this is mounted, so the tab's badge is honest before
  // anyone opens it. QueueBoard mounts in three places, and three POLLERS
  // would be three requests every fifteen seconds for a screen nobody is
  // looking at -- so polling is gated on `enabled` while the first read is
  // not.
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(load, POLL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        load();
        start();
      } else {
        stop();
      }
    };
    onVisible();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, load]);

  const send = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      setBusy(true);
      try {
        const res = await fetch(URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { doc?: unknown; error?: string };
        if (!res.ok) {
          setError(data.error || "That didn't work. Try again.");
          return false;
        }
        setDoc(normalizeDoc(data.doc));
        setError("");
        return true;
      } catch {
        setError("Couldn't reach your agents. Check the connection.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const create = useCallback(
    (draft: NewAgentDraft) =>
      send({
        action: "add",
        goal: draft.goal,
        needs: draft.needs,
        steps: draft.steps,
        folder: draft.folder,
      }),
    [send],
  );

  const pause = useCallback(async (id: string) => void (await send({ action: "pause", id })), [send]);
  const resume = useCallback(async (id: string) => void (await send({ action: "resume", id })), [send]);
  const remove = useCallback(async (id: string) => void (await send({ action: "remove", id })), [send]);

  const list = useMemo(() => sortAgents(doc.agents), [doc]);

  return {
    doc,
    list,
    live: liveCount(doc),
    loading,
    loaded,
    error,
    refresh: load,
    create,
    pause,
    resume,
    remove,
    busy,
  };
}
