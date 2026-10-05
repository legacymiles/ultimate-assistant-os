// ---------------------------------------------------------------------------
// What a lane's state actually says.
//
// Every case here comes from the first real three-lane run. The headline one:
// a lane reported "needs you" for four minutes while it was demonstrably
// writing components, because the status was read off the bridge's status WORD
// and the bridge never took "waiting" back after a gate was answered. A chip
// that cries for attention when none is needed is worse than no chip.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { emptyThread } from "@/lib/new-jarvis/harness/model";
import type { GateCard, ThreadSummary } from "@/lib/new-jarvis/harness/types";

import { laneGate, laneHeat, laneStatus, type Lane } from "./useBakeOff";

function lane(over: Partial<Lane> = {}): Lane {
  return {
    skill: "impeccable",
    id: "t1",
    cursor: 0,
    view: emptyThread(),
    summary: null,
    error: "",
    port: 3311,
    url: "",
    compiling: false,
    brief: "",
    route: "/apps/thing",
    nudges: 0,
    ...over,
  };
}

const summary = (status: ThreadSummary["status"], gate: GateCard | null = null) =>
  ({ status, gate }) as unknown as ThreadSummary;

const card = (over: Partial<GateCard> = {}): GateCard =>
  ({
    gateId: "g1",
    name: "Bash",
    title: "npm test",
    why: "",
    risk: "act",
    patch: "",
    command: "npm test",
    path: "",
    askedAt: 0,
    ...over,
  }) as GateCard;

describe("laneStatus", () => {
  it("is idle before the thread exists", () => {
    expect(laneStatus(lane({ id: "" }))).toBe("idle");
  });

  it("is failed whenever there is an error, whatever the bridge says", () => {
    expect(laneStatus(lane({ error: "boom", summary: summary("thinking") }))).toBe("failed");
  });

  it("says 'needs you' only when a gate is actually parked", () => {
    const parked = lane({ summary: summary("waiting", card()) });
    expect(laneStatus(parked)).toBe("waiting");
  });

  it("does NOT say 'needs you' for a stale waiting status with no gate", () => {
    // The exact bug: the bridge left the status at "waiting" after the gate was
    // answered, and the lane cried for attention while it worked.
    const stale = lane({ summary: summary("waiting", null) });
    expect(laneStatus(stale)).not.toBe("waiting");
  });

  it("ignores a gate that has already been answered", () => {
    const answered = lane({ summary: summary("waiting", card({ answered: true })) });
    expect(laneStatus(answered)).not.toBe("waiting");
  });

  it("calls an idle turn 'paused', not 'finished' — a whole app is rarely one turn", () => {
    expect(laneStatus(lane({ summary: summary("idle") }))).toBe("paused");
  });

  it("is done only when the thread has actually ended", () => {
    expect(laneStatus(lane({ summary: summary("ended") }))).toBe("done");
  });

  it("is serving once a preview URL exists", () => {
    expect(laneStatus(lane({ url: "http://127.0.0.1:3311/apps/thing", summary: summary("idle") })))
      .toBe("serving");
  });

  it("lets a parked gate outrank a running preview — the gate is the blocking thing", () => {
    const both = lane({ url: "http://127.0.0.1:3311/x", summary: summary("thinking", card()) });
    expect(laneStatus(both)).toBe("waiting");
  });
});

describe("laneGate", () => {
  it("prefers the folded view's live gate over the polled summary", () => {
    const view = { ...emptyThread(), liveGate: card({ gateId: "fromView" }) };
    const l = lane({ view, summary: summary("waiting", card({ gateId: "fromSummary" })) });
    expect(laneGate(l)?.gateId).toBe("fromView");
  });

  it("is null when nothing is parked", () => {
    expect(laneGate(lane({ summary: summary("thinking") }))).toBeNull();
  });
});

describe("laneHeat", () => {
  it("burns hottest while building and goes cold when it fails", () => {
    expect(laneHeat(lane({ summary: summary("thinking") }))).toBe(1);
    expect(laneHeat(lane({ error: "x" }))).toBe(0);
  });

  it("holds part-heat at a gate and while paused, so a stalled lane still reads as alive", () => {
    expect(laneHeat(lane({ summary: summary("waiting", card()) }))).toBeGreaterThan(0);
    expect(laneHeat(lane({ summary: summary("idle") }))).toBeGreaterThan(0);
  });

  it("nearly cools once the build is being served", () => {
    const serving = laneHeat(lane({ url: "http://127.0.0.1:3311/x", summary: summary("idle") }));
    expect(serving).toBeLessThan(0.25);
    expect(serving).toBeGreaterThan(0);
  });
});
