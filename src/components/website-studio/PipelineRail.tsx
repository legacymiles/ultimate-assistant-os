"use client";

// ---------------------------------------------------------------------------
// The pipeline rail — the one standout on this page.
//
// The eight stages of the Super Harness as a single filament the build travels
// along, with one thing on it that is not a stage: the LIVE GATE. Everything
// left of the gate is the first website; the gate is the moment it is actually
// on an address the owner can open; the two stages right of it are the deep
// work that only starts afterwards. The order was a sentence in a brief that
// nothing enforced — drawing the gate is how it became a thing you can see.
//
// Reduced motion: the travelling light stops, every state stays legible, and
// the gate still reads as a gate. Nothing here is decoration.
// ---------------------------------------------------------------------------

import { PHASE_LABEL, stageStates, type StageFacts } from "@/lib/website-studio/pipeline";

interface Props {
  facts: StageFacts;
  /** Drawn small, inside the side panel, rather than across the page. */
  compact?: boolean;
}

export function PipelineRail({ facts, compact }: Props) {
  const rows = stageStates(facts);
  const gateAt = rows.findIndex((r) => r.stage.phase === "after-live");

  return (
    <div
      className={`ws-rail${compact ? " compact" : ""}`}
      data-standout={compact ? undefined : "pipeline rail with the live gate"}
      data-live={facts.live ? "yes" : "no"}
    >
      <ol className="ws-rail-track">
        {rows.map((r, i) => (
          <li key={`${r.stage.id}-${i}`} className="ws-rail-item">
            {i === gateAt && (
              <span className={`ws-gate${facts.live ? " open" : ""}`} aria-hidden={false}>
                <span className="ws-gate-bar" aria-hidden />
                <span className="ws-gate-word">{facts.live ? "Site live" : "Site goes live here"}</span>
              </span>
            )}
            <span className={`ws-stage-node state-${r.state}`} title={`${PHASE_LABEL[r.stage.phase]} — ${r.note}`}>
              <span className="ws-stage-dot" aria-hidden />
              <span className="ws-stage-text">
                <b>{r.stage.label}</b>
                <i>{r.note}</i>
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="ws-rail-say">
        {facts.factoryDone
          ? "Everything shipped — the site is live and the deep work is merged."
          : facts.live && facts.factoryStarted
            ? "Live. Software Factory is deepening it in the background; each merged change shows up on a refresh."
            : facts.live && facts.idle
              ? "Live, with nothing building. The deeper backend work runs on the next build."
              : facts.live
                ? "Live. Software Factory starts on this site now that it has an address."
                : facts.buildStarted
                  ? "Building the first working site. Nothing waits on the factory."
                  : "The first site ships before Software Factory touches it."}
      </p>
    </div>
  );
}
