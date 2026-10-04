"use client";

// ---------------------------------------------------------------------------
// Running several harness threads at once.
//
// `useHarness` drives ONE thread and owns a cursor, a poll timer and an idea of
// "the open thread". Three of those fight each other three ways, so a bake-off
// composes the same bridge calls instead and keeps one fold per lane — using
// the EXISTING `reduceEvents`, because a second reducer is a second thing that
// can disagree with the bridge about what a transcript says.
//
// Three decisions worth stating:
//
//   Lanes START IN SEQUENCE, not with Promise.all. Each start cuts a git
//   worktree from the same base and git serialises on the index anyway, so
//   firing three at once buys nothing and turns one failure into three
//   confusing ones.
//
//   Polling ROUND-ROBINS one lane per tick. Three lanes each polled every 450ms
//   is seven requests a second at a local bridge for no extra information.
//
//   A lane that fails KEEPS ITS PLACE, carrying the error. "Why did this skill's
//   lane fail" is itself a result of a bake-off; a lane that disappears or
//   silently restarts destroys the comparison it exists to make.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { call } from "@/lib/new-jarvis/bridge";
import { emptyThread, reduceEvents } from "@/lib/new-jarvis/harness/model";
import type {
  GateCard,
  HarnessChoice,
  HarnessEvent,
  HarnessId,
  ThreadSummary,
  ThreadView,
} from "@/lib/new-jarvis/harness/types";

/** The first port a lane is served on. One per lane, upward. */
export const FIRST_PORT = 3311;

export type LaneStatus =
  | "idle"
  | "starting"
  | "building"
  | "waiting"
  | "done"
  | "failed"
  | "serving";

export interface Lane {
  /** The design skill this lane is testing. Also its identity in the UI. */
  skill: string;
  /** Harness thread id, empty until it starts. */
  id: string;
  cursor: number;
  view: ThreadView;
  summary: ThreadSummary | null;
  /** Shown verbatim, never swallowed. */
  error: string;
  /** The dev server serving this lane's worktree. */
  port: number;
  url: string;
  /** Next is still compiling — not a failure. */
  compiling: boolean;
  /** The brief this lane was sent, kept so it can be copied when the bridge is off. */
  brief: string;
}

function newLane(skill: string, brief: string, port: number): Lane {
  return {
    skill,
    id: "",
    cursor: 0,
    view: emptyThread(),
    summary: null,
    error: "",
    port,
    url: "",
    compiling: false,
    brief,
  };
}

/** Hard while it works, lazy while it waits, never once it has ended. */
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

export function laneStatus(lane: Lane): LaneStatus {
  if (lane.error) return "failed";
  if (!lane.id) return "idle";
  if (lane.url) return "serving";
  switch (lane.summary?.status) {
    case "starting":
      return "starting";
    case "thinking":
      return "building";
    case "waiting":
      return "waiting";
    case "ended":
      return "done";
    default:
      return lane.summary ? "building" : "starting";
  }
}

/**
 * How hot a lane's ingot burns, 0–1.
 *
 * This is the only place the sculpture and the harness meet, and it is a pure
 * function of state on purpose — the 3D reads it, it never reads the 3D.
 */
export function laneHeat(lane: Lane): number {
  switch (laneStatus(lane)) {
    case "building":
      return 1;
    case "waiting":
      return 0.55;
    case "starting":
      return 0.3;
    case "serving":
    case "done":
      return 0.12;
    case "failed":
    case "idle":
    default:
      return 0;
  }
}

export interface UseBakeOff {
  choices: HarnessChoice[];
  harness: HarnessId;
  setHarness: (id: HarnessId) => void;
  lanes: Lane[];
  running: boolean;
  /** A sentence to show instead of a dead button, when the bridge is off. */
  blocked: string;
  working: string;
  start: (briefs: Array<{ skill: string; brief: string; title: string }>) => Promise<void>;
  decide: (laneSkill: string, gateId: string, allow: boolean) => Promise<void>;
  serve: (laneSkill: string) => Promise<void>;
  land: (laneSkill: string, message: string) => Promise<void>;
  discardOthers: (winnerSkill: string) => Promise<void>;
  stopAll: () => Promise<void>;
  reset: () => void;
}

export function useBakeOff({ paired }: { paired: boolean }): UseBakeOff {
  const [choices, setChoices] = useState<HarnessChoice[]>([]);
  const [harness, setHarness] = useState<HarnessId>("claude");
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [blocked, setBlocked] = useState("");
  const [working, setWorking] = useState("");

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turn = useRef(0);
  const alive = useRef(true);
  const lanesRef = useRef<Lane[]>([]);
  lanesRef.current = lanes;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // --- which harnesses this machine can run -------------------------------

  const refreshChoices = useCallback(async () => {
    if (!paired) {
      setChoices([]);
      setBlocked("The local agent is not running on this PC, so nothing can be built from here.");
      return;
    }
    try {
      const data = await call<{ harnesses: HarnessChoice[] }>("harness/list", {});
      setChoices(data.harnesses);
      const usable = data.harnesses.filter((h) => h.available);
      if (!usable.length) {
        // Both reasons, verbatim. "No harness available" is a dead end; the
        // `why` strings are the fix.
        setBlocked(data.harnesses.map((h) => h.why).filter(Boolean).join("  ·  "));
      } else {
        setBlocked("");
        setHarness((current) =>
          usable.some((h) => h.id === current) ? current : usable[0].id,
        );
      }
    } catch (err) {
      setBlocked((err as Error).message);
    }
  }, [paired]);

  useEffect(() => {
    void refreshChoices();
  }, [refreshChoices]);

  // --- the poll -----------------------------------------------------------

  const patch = useCallback((skill: string, next: Partial<Lane>) => {
    setLanes((prev) => prev.map((l) => (l.skill === skill ? { ...l, ...next } : l)));
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const live = lanes.filter((l) => l.id && !l.error && l.summary?.status !== "ended");
    if (!live.length) return;

    const waits = live
      .map((l) => pollEvery(l.summary?.status ?? "starting"))
      .filter((n): n is number => n !== null);
    if (!waits.length) return;
    const wait = Math.max(220, Math.min(...waits));

    timer.current = setTimeout(async () => {
      if (!alive.current) return;
      // One lane per tick. Three lanes do not cost three times the requests.
      const lane = live[turn.current++ % live.length];
      try {
        const res = await call<{
          events: HarnessEvent[];
          cursor: number;
          dropped: boolean;
          session: ThreadSummary;
        }>("harness/events", { id: lane.id, since: lane.cursor });
        if (!alive.current) return;
        if (res.dropped) {
          // The cursor fell behind the bridge's ring. Starting from the oldest
          // kept event would leave a hole nothing afterwards reveals.
          patch(lane.skill, { view: emptyThread(), cursor: 0, summary: res.session });
          return;
        }
        setLanes((prev) =>
          prev.map((l) =>
            l.skill === lane.skill
              ? {
                  ...l,
                  view: reduceEvents(l.view, res.events),
                  cursor: res.cursor,
                  summary: res.session,
                }
              : l,
          ),
        );
      } catch (err) {
        patch(lane.skill, { error: (err as Error).message });
      }
    }, wait);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [lanes, patch]);

  // --- starting -----------------------------------------------------------

  const start = useCallback(
    async (briefs: Array<{ skill: string; brief: string; title: string }>) => {
      setLanes(briefs.map((b, i) => newLane(b.skill, b.brief, FIRST_PORT + i)));
      setWorking("Cutting worktrees…");
      // In sequence: git serialises on the index, and three simultaneous
      // failures are three times harder to read than one.
      for (const b of briefs) {
        if (!alive.current) return;
        setWorking(`Starting ${b.skill}…`);
        try {
          const { session } = await call<{ session: ThreadSummary }>("harness/start", {
            harness,
            title: b.title,
            laneWrites: true,
          });
          patch(b.skill, { id: session.id, summary: session });
          await call("harness/say", { id: session.id, text: b.brief });
        } catch (err) {
          patch(b.skill, { error: (err as Error).message });
        }
      }
      setWorking("");
    },
    [harness, patch],
  );

  const decide = useCallback(
    async (laneSkill: string, gateId: string, allow: boolean) => {
      const lane = lanesRef.current.find((l) => l.skill === laneSkill);
      if (!lane?.id) return;
      try {
        await call("harness/decide", { id: lane.id, gateId, allow });
      } catch (err) {
        patch(laneSkill, { error: (err as Error).message });
      }
    },
    [patch],
  );

  const serve = useCallback(
    async (laneSkill: string) => {
      const lane = lanesRef.current.find((l) => l.skill === laneSkill);
      if (!lane?.id) return;
      patch(laneSkill, { compiling: true, error: "" });
      try {
        const res = await call<{ url: string; ready: boolean }>("harness/preview", {
          id: lane.id,
          port: lane.port,
        });
        // `ready: false` is not a failure — a cold worktree's first Next compile
        // can outlast the bridge's wait.
        patch(laneSkill, { url: res.url, compiling: !res.ready });
      } catch (err) {
        patch(laneSkill, { compiling: false, error: (err as Error).message });
      }
    },
    [patch],
  );

  const land = useCallback(
    async (laneSkill: string, message: string) => {
      const lane = lanesRef.current.find((l) => l.skill === laneSkill);
      if (!lane?.id) return;
      setWorking("Landing…");
      try {
        await call("harness/land", {
          id: lane.id,
          message,
          merge: true,
          attribution: "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>",
        });
      } catch (err) {
        patch(laneSkill, { error: (err as Error).message });
      } finally {
        setWorking("");
      }
    },
    [patch],
  );

  const discardOthers = useCallback(async (winnerSkill: string) => {
    setWorking("Discarding the others…");
    for (const lane of lanesRef.current) {
      if (!lane.id || lane.skill === winnerSkill) continue;
      try {
        await call("harness/discard", { id: lane.id });
      } catch {
        // A lane that cannot be discarded is a worktree to clean up by hand,
        // not a reason to leave the winner unlanded.
      }
    }
    setWorking("");
  }, []);

  const stopAll = useCallback(async () => {
    for (const lane of lanesRef.current) {
      if (!lane.id) continue;
      try {
        await call("harness/preview/stop", { id: lane.id });
        await call("harness/stop", { id: lane.id });
      } catch {
        // Already gone is the outcome we wanted.
      }
    }
  }, []);

  const reset = useCallback(() => setLanes([]), []);

  const running = useMemo(
    () => lanes.some((l) => l.id && !l.error && l.summary?.status !== "ended"),
    [lanes],
  );

  return {
    choices,
    harness,
    setHarness,
    lanes,
    running,
    blocked,
    working,
    start,
    decide,
    serve,
    land,
    discardOthers,
    stopAll,
    reset,
  };
}

/** The one gate currently blocking any lane, with the lane it belongs to. */
export function liveGateOf(lanes: Lane[]): { lane: Lane; gate: GateCard } | null {
  for (const lane of lanes) {
    const gate = lane.view.liveGate ?? lane.summary?.gate ?? null;
    if (gate && !gate.answered) return { lane, gate };
  }
  return null;
}
