"use client";

// ---------------------------------------------------------------------------
// Follow a handed-off build without the owner pressing anything (checklist A1).
//
// In Queue is the only place that knows whether Claude Code has picked the
// build up, so this reads it on a slow loop: every POLL_MS while there is still
// something to wait for, immediately when the tab comes back to the front, and
// not at all while the tab is hidden or the build has finished. The panel it
// feeds therefore shows the real phase and the agent's real notes, instead of a
// spinner that means nothing.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { readBuildState } from "./queue";
import type { BuildState } from "./plan";

const POLL_MS = 6_000;

export function useBuildWatch(queueId: string | undefined, filedAt: string | undefined): { live: BuildState; refresh: () => void } {
  const [live, setLive] = useState<BuildState>({ phase: queueId ? "queued" : "filing", queueId, at: filedAt });
  const stateRef = useRef(live);
  stateRef.current = live;
  const reading = useRef(false);

  // A new hand-off (or a different project) starts from "queued" again rather
  // than showing the last build's phase for a few seconds.
  useEffect(() => {
    const next: BuildState = { phase: queueId ? "queued" : "filing", queueId, at: filedAt };
    stateRef.current = next;
    setLive(next);
  }, [queueId, filedAt]);

  const read = useCallback(async () => {
    if (!queueId || reading.current) return;
    reading.current = true;
    try {
      const next = await readBuildState(queueId, stateRef.current);
      stateRef.current = next;
      setLive(next);
    } finally {
      reading.current = false;
    }
  }, [queueId]);

  // `phase` is a dependency on purpose: the loop stops itself once the build
  // has left the queue, and this is what starts it again if the phase ever
  // comes back (a re-queue, or a bad read that said "gone" once).
  const phase = live.phase;
  useEffect(() => {
    if (!queueId || phase === "done" || phase === "gone") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      if (typeof document === "undefined" || document.visibilityState === "visible") await read();
      if (stopped) return;
      // Nothing more will change on its own once it has left the queue.
      const now = stateRef.current.phase;
      if (now === "done" || now === "gone") return;
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();

    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      const now = stateRef.current.phase;
      if (now === "done" || now === "gone") return;
      void read();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [queueId, phase, read]);

  return { live, refresh: () => void read() };
}
