"use client";

// ---------------------------------------------------------------------------
// One rail entry for the whole "what can this thing do" question.
//
// Two faces, because they answer different halves of it and used to be two
// separate places:
//
//   Capabilities  what Jarvis can REACH — keys, the local agent, connections
//   Models        which AI model does which job, scanned out of the code
//
// Kept as one entry rather than two on purpose. The rail went from thirteen
// tabs to five in this shell and adding a tenth Toolbox tab for something this
// closely related would be undoing that.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { ToolsTab } from "../jarvis/ToolsTab";
import { Armory } from "./Armory";

const FACES = [
  { id: "capabilities", label: "Capabilities" },
  { id: "models", label: "Models" },
] as const;

type Face = (typeof FACES)[number]["id"];

export function ArmoryTab({
  bridge,
  bridgeUp,
}: {
  bridge: Partial<Record<"browser" | "shell" | "files" | "system" | "vault", boolean>>;
  bridgeUp: boolean;
}) {
  const [face, setFace] = useState<Face>("capabilities");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-line-soft px-3 py-1.5">
        {FACES.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFace(f.id)}
            aria-current={face === f.id ? "page" : undefined}
            className={`rounded px-2 py-1 text-[11px] transition ${
              face === f.id ? "bg-elevated text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {face === "capabilities" ? <Armory bridge={bridge} bridgeUp={bridgeUp} /> : <ToolsTab />}
      </div>
    </div>
  );
}
