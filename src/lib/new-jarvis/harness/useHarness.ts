"use client";

// ---------------------------------------------------------------------------
// Driving a harness thread from the page.
//
// The thread does not live here. It lives in the bridge, in a worktree, with a
// real child process in it — so this hook owns no state the thread depends on,
// and closing the tab does not end anything. What it owns is a CURSOR and a
// fold of everything past it, which is what makes reattaching after a reload
// (or on a second device) a matter of asking again from zero.
//
// The poll rate follows the thread rather than the clock. A thread that is
// thinking is polled hard because its text is arriving; an idle thread is
// polled rarely because nothing will happen until the owner types; an ended
// thread is not polled at all. A fixed interval is either a laggy transcript
// or a request every half-second all afternoon.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { call, BridgeError } from "../bridge";
import { emptyThread, reduceEvents } from "./model";
import type {
  GateCard, HarnessChoice, HarnessEvent, HarnessId, ThreadSummary, ThreadView, WorkSummary,
} from "./types";

const OPEN_KEY = "new-jarvis:harness-open";

/** Hard while it works, lazy while it waits for us, never once it has ended. */
function pollEvery(status: ThreadSummary["status"] | "none"): number | null {
  switch (status) {
    case "thinking":
    case "starting":
      return 450;
    case "waiting":
      return 900;
    case "ready":
    case "idle":
      return 2_500;
    default:
      return null;
  }
}

export interface UseHarness {
  choices: HarnessChoice[];
  threads: ThreadSummary[];
  /** The thread on screen, or null when none is open. */
  thread: ThreadSummary | null;
  view: ThreadView;
  work: WorkSummary | null;
  diff: string;
  diffTruncated: boolean;
  gate: GateCard | null;
  busy: boolean;
  error: string;
  /** True while a start/land/discard is in flight, so buttons can say so. */
  working: string;
  refreshChoices: () => void;
  start: (opts: { harness: HarnessId; title: string; strict?: boolean; laneWrites?: boolean }) => Promise<void>;
  open: (id: string) => void;
  close: () => void;
  say: (text: string) => Promise<void>;
  decide: (gateId: string, allow: boolean) => Promise<void>;
  interrupt: () => Promise<void>;
  stop: () => Promise<void>;
  loadDiff: () => Promise<void>;
  land: (opts: { message: string; merge: boolean }) => Promise<string>;
  discard: () => Promise<void>;
}

export function useHarness({ paired }: { paired: boolean }): UseHarness {
  const [choices, setChoices] = useState<HarnessChoice[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [id, setId] = useState<string>("");
  const [thread, setThread] = useState<ThreadSummary | null>(null);
  const [view, setView] = useState<ThreadView>(emptyThread);
  const [work, setWork] = useState<WorkSummary | null>(null);
  const [diff, setDiff] = useState("");
  const [diffTruncated, setDiffTruncated] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");

  const cursor = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const say = useRef<(t: string) => Promise<void>>(async () => {});

  // --- discovery ----------------------------------------------------------

  const refreshChoices = useCallback(() => {
    if (!paired) return;
    void (async () => {
      try {
        const data = await call<{ harnesses: HarnessChoice[] }>("harness/list");
        if (alive.current) setChoices(data.harnesses ?? []);
      } catch {
        // The capability row already says the agent is down; a second message
        // here would just be the same fact in a different font.
        if (alive.current) setChoices([]);
      }
      try {
        const data = await call<{ threads: ThreadSummary[] }>("harness/threads");
        if (alive.current) setThreads(data.threads ?? []);
      } catch {
        if (alive.current) setThreads([]);
      }
    })();
  }, [paired]);

  useEffect(() => {
    alive.current = true;
    refreshChoices();
    return () => {
      alive.current = false;
    };
  }, [refreshChoices]);

  // Reattach to whatever was open before the reload, but only if the bridge
  // still has it — a thread dies with the bridge, and a stale id on screen
  // would be a thread you cannot type into and cannot close.
  useEffect(() => {
    if (id || !threads.length) return;
    let saved = "";
    try {
      saved = window.localStorage.getItem(OPEN_KEY) ?? "";
    } catch {
      saved = "";
    }
    if (saved && threads.some((t) => t.id === saved)) setId(saved);
  }, [threads, id]);

  // --- the poll -----------------------------------------------------------

  const pull = useCallback(async () => {
    if (!id) return;
    try {
      const data = await call<{
        events: HarnessEvent[];
        cursor: number;
        dropped: boolean;
        session: ThreadSummary;
      }>("harness/events", { id, since: cursor.current });
      if (!alive.current) return;

      if (data.dropped) {
        // We fell behind the bridge's ring. Re-read the whole thread rather
        // than splicing a transcript with a hole in it.
        cursor.current = 0;
        setView(emptyThread());
        return;
      }
      cursor.current = data.cursor;
      setThread(data.session);
      if (data.events.length) setView((prev) => reduceEvents(prev, data.events));
      setError("");
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof BridgeError && e.status === 404) {
        // The bridge restarted under us. Say so once and let go of the thread —
        // INCLUDING dropping it from the list, because a thread the bridge has
        // never heard of sitting under "still running on this PC" is the one
        // piece of this surface that would be simply untrue.
        setError("That thread ended when the local agent restarted.");
        setThreads((prev) => prev.filter((t) => t.id !== id));
        setId("");
        setThread(null);
        try {
          window.localStorage.removeItem(OPEN_KEY);
        } catch { /* nothing to forget. */ }
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    if (!id || !paired) return;
    let stop = false;
    const tick = async () => {
      await pull();
      if (stop || !alive.current) return;
      const every = pollEvery(thread?.status ?? "starting");
      if (every == null) return;
      timer.current = setTimeout(tick, every);
    };
    void tick();
    return () => {
      stop = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // `thread?.status` is in the deps on purpose: the rate follows the thread.
  }, [id, paired, pull, thread?.status]);

  // --- opening and closing ------------------------------------------------

  const open = useCallback((next: string) => {
    cursor.current = 0;
    setView(emptyThread());
    setWork(null);
    setDiff("");
    setError("");
    setId(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next);
    } catch { /* a thread you cannot reattach to is still a thread. */ }
  }, []);

  const close = useCallback(() => {
    setId("");
    setThread(null);
    setView(emptyThread());
    setWork(null);
    setDiff("");
    try {
      window.localStorage.removeItem(OPEN_KEY);
    } catch { /* nothing to forget. */ }
  }, []);

  const start = useCallback(
    async (opts: { harness: HarnessId; title: string; strict?: boolean; laneWrites?: boolean }) => {
      setWorking("Cutting a worktree…");
      setError("");
      try {
        const data = await call<{ session: ThreadSummary }>("harness/start", {
          harness: opts.harness,
          title: opts.title,
          strict: Boolean(opts.strict),
          laneWrites: Boolean(opts.laneWrites),
        });
        setThreads((prev) => [...prev, data.session]);
        open(data.session.id);
        setThread(data.session);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setWorking("");
      }
    },
    [open],
  );

  // --- steering -----------------------------------------------------------

  say.current = useCallback(
    async (text: string) => {
      if (!id) return;
      try {
        await call("harness/say", { id, text });
        await pull();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [id, pull],
  );

  const decide = useCallback(
    async (gateId: string, allow: boolean) => {
      if (!id) return;
      // Clear the card before the round trip. The harness is blocked on this
      // answer, so the owner's tap has already decided; leaving the card up
      // until the poll catches up reads as a button that did nothing.
      setView((prev) => (prev.liveGate?.gateId === gateId ? { ...prev, liveGate: null } : prev));
      try {
        await call("harness/decide", { id, gateId, allow });
        await pull();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [id, pull],
  );

  const interrupt = useCallback(async () => {
    if (!id) return;
    try {
      await call("harness/interrupt", { id });
      await pull();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id, pull]);

  const stop = useCallback(async () => {
    if (!id) return;
    setWorking("Stopping…");
    try {
      await call("harness/stop", { id });
      await pull();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking("");
    }
  }, [id, pull]);

  // --- the worktree -------------------------------------------------------

  const loadDiff = useCallback(async () => {
    if (!id) return;
    setWorking("Reading the patch…");
    try {
      const data = await call<{ diff: string; truncated: boolean; work: WorkSummary }>("harness/diff", { id });
      setDiff(data.diff ?? "");
      setDiffTruncated(Boolean(data.truncated));
      setWork(data.work ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking("");
    }
  }, [id]);

  const land = useCallback(
    async (opts: { message: string; merge: boolean }) => {
      if (!id) return "";
      setWorking(opts.merge ? "Committing and merging…" : "Committing…");
      try {
        const data = await call<{ why: string; session: ThreadSummary }>("harness/land", {
          id,
          message: opts.message,
          merge: opts.merge,
        });
        setThread(data.session);
        await loadDiff();
        return data.why ?? "";
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        return "";
      } finally {
        setWorking("");
      }
    },
    [id, loadDiff],
  );

  const discard = useCallback(async () => {
    if (!id) return;
    setWorking("Removing the worktree…");
    try {
      await call("harness/discard", { id });
      setThreads((prev) => prev.filter((t) => t.id !== id));
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking("");
    }
  }, [id, close]);

  // Poll the worktree's shape alongside the thread, so the Workbench's counts
  // grow while the harness works instead of only when the diff is opened.
  useEffect(() => {
    if (!id || !paired) return;
    let stop = false;
    const tick = async () => {
      try {
        const data = await call<{ work: WorkSummary }>("harness/status", { id });
        if (!stop && alive.current) setWork(data.work ?? null);
      } catch { /* the thread poll already reports why. */ }
      if (!stop && alive.current) setTimeout(tick, 6_000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [id, paired]);

  const sayFn = useCallback((text: string) => say.current(text), []);

  return useMemo(
    () => ({
      choices,
      threads,
      thread,
      view,
      work,
      diff,
      diffTruncated,
      gate: view.liveGate ?? thread?.gate ?? null,
      busy: Boolean(thread?.busy) || thread?.status === "thinking",
      error,
      working,
      refreshChoices,
      start,
      open,
      close,
      say: sayFn,
      decide,
      interrupt,
      stop,
      loadDiff,
      land,
      discard,
    }),
    [
      choices, threads, thread, view, work, diff, diffTruncated, error, working,
      refreshChoices, start, open, close, sayFn, decide, interrupt, stop, loadDiff, land, discard,
    ],
  );
}
