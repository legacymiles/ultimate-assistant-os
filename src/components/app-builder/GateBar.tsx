"use client";

// ---------------------------------------------------------------------------
// The question, where it cannot be missed.
//
// The build stops and asks before anything destructive or anything outside its
// own folder. That is right. What was wrong is WHERE it asked: inside the
// Blueprint panel, below the end goal, the audience, the money and the judge —
// so on a normal screen the card sat off the bottom of a scrollable column.
// The owner saw "Waiting on your answer" in the corner, went looking for
// something to answer, and found a page that appeared to be loading.
//
// A question that blocks the whole build belongs at the top of the whole app,
// not at the bottom of one of its panels.
// ---------------------------------------------------------------------------

import type { GateCard } from "@/lib/new-jarvis/harness/types";

export function GateBar({ gate, onDecide }: { gate: GateCard; onDecide: (gateId: string, allow: boolean) => void }) {
  const what = gate.command || gate.path || "";
  return (
    <div className="ab-gatebar" role="alertdialog" aria-live="assertive" aria-labelledby="ab-gatebar-title">
      <div className="ab-gatebar-what">
        <p id="ab-gatebar-title" className="ab-gatebar-title">
          <span className={`ab-gatebar-risk is-${gate.risk}`}>{gate.risk === "grave" ? "Careful" : "Asking"}</span>
          {gate.title || gate.name}
        </p>
        {what && <code className="ab-gatebar-cmd">{what}</code>}
        {gate.why && <p className="ab-gatebar-why">{gate.why}</p>}
      </div>
      <div className="ab-gatebar-row">
        <button className="ab-primary-sm" onClick={() => onDecide(gate.gateId, true)} autoFocus>
          Allow it
        </button>
        <button className="ab-ghost is-no" onClick={() => onDecide(gate.gateId, false)}>
          Not this time
        </button>
      </div>
    </div>
  );
}
