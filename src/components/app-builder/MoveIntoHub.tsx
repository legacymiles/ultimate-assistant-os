"use client";

// ---------------------------------------------------------------------------
// Moving a finished app into the hub, and retiring the standalone afterwards.
//
// The lifecycle the owner asked for: every app is born standalone, with its own
// folder and its own repository, because that is the shape you can hand to a
// client. Some of them later belong beside the other forty, at /apps/<slug>.
//
// The two halves are deliberately separate, and in this order:
//
//   Moving in only ever ADDS. It reads the standalone folder without touching
//   it and opens a pull request. If it goes wrong it costs a branch.
//
//   Retiring DELETES a GitHub repository, which cannot be undone. So it is not
//   part of the move, it waits until the owner says the pull request has
//   actually merged, and it asks them to type the app's name first. Nothing
//   here deletes anything on its own.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { hubSlug } from "@/lib/app-builder/absorb";
import { latestWord, type BuildPhase } from "@/lib/app-builder/build";
import type { BuilderProject } from "@/lib/app-builder/types";
import type { UseBuild } from "@/lib/app-builder/useBuild";
import type { Busy } from "@/lib/app-builder/useAppBuilder";

/**
 * The thread's phases, said in the language of a move.
 *
 * `PHASE_LABEL` is written for a build ("Starting the build", "Built"), which
 * is the wrong sentence on a thread that is moving a finished app rather than
 * making one.
 */
const MOVE_LABEL: Record<BuildPhase, string> = {
  starting: "Starting",
  working: "Working",
  asking: "Waiting on your answer",
  done: "Finished",
  failed: "Stopped",
  stopped: "Stopped",
};

export function MoveIntoHub({
  project,
  busy,
  moving,
  onMove,
  onRetire,
}: {
  project: BuilderProject;
  busy: Busy;
  moving: UseBuild;
  onMove: () => void;
  onRetire: () => void;
}) {
  const [typed, setTyped] = useState("");
  const built = project.handoff?.built;
  const absorb = project.handoff?.absorb;
  const slug = hubSlug(project);
  const name = project.understanding?.name ?? slug;

  // Nothing to move until there is something built, in a folder we know about.
  if (!built?.path || project.edit) return null;

  if (absorb?.retiredAt) {
    return (
      <section className="ab-move is-done" aria-label="Where this app lives">
        <p className="ab-move-head">Lives in the hub</p>
        <p className="ab-move-note">
          It is <code>/apps/{slug}</code> here now, and its standalone repository is retired.
        </p>
      </section>
    );
  }

  // The move is running, or has run.
  if (absorb) {
    const word = latestWord(moving.view);
    return (
      <section className="ab-move is-working" aria-label="Moving into the hub">
        <p className="ab-move-head">
          Moving into the hub
          <span className="ab-move-phase">{MOVE_LABEL[moving.phase]}</span>
        </p>
        {word && !absorb.prUrl && <p className="ab-move-note">{word}</p>}
        {moving.gate && (
          <div className="ab-brow">
            <span className="ab-move-note">{moving.gate.title || moving.gate.name}</span>
            <button className="ab-primary-sm" onClick={() => void moving.decide(moving.gate!.gateId, true)}>
              Allow it
            </button>
            <button className="ab-ghost is-no" onClick={() => void moving.decide(moving.gate!.gateId, false)}>
              Not this time
            </button>
          </div>
        )}

        {absorb.prUrl ? (
          <>
            <p className="ab-move-note">
              The pull request is open. Nothing has changed in the hub until you merge it — and nothing is deleted until you retire the standalone below.
            </p>
            <div className="ab-brow">
              <a className="ab-primary-sm" href={absorb.prUrl} target="_blank" rel="noreferrer">
                Review and merge it
              </a>
            </div>
            <div className="ab-retire">
              <p className="ab-retire-head">Once you have merged it</p>
              <p className="ab-move-note">
                Retiring deletes <code>{name}</code>&rsquo;s own GitHub repository and its folder on your PC. That cannot be undone, so type{" "}
                <b>{name}</b> to confirm — and only after the pull request has actually merged, or the hub will not have the code.
              </p>
              <div className="ab-bsay-row">
                <input
                  className="ab-who"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={`Type ${name}`}
                  aria-label={`Type ${name} to confirm retiring its standalone repository`}
                />
                <button
                  className="ab-ghost is-no"
                  disabled={typed.trim().toLowerCase() !== name.trim().toLowerCase() || busy !== null}
                  onClick={onRetire}
                >
                  {busy === "retire" ? "Retiring…" : "Retire the standalone"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="ab-move-note ab-move-faint">
            It reads <code>{built.path}</code> without touching it, brings the app in as <code>/apps/{slug}</code> with a catalog entry, and opens a pull
            request for you. Your standalone repo stays exactly as it is.
          </p>
        )}
        {moving.error && <p className="ab-bwarn">{moving.error}</p>}
      </section>
    );
  }

  return (
    <section className="ab-move" aria-label="Move into the hub">
      <p className="ab-move-head">Keep it standalone, or move it in</p>
      <p className="ab-move-note">
        {name} has its own folder and its own repository, which is what you hand to a client. If it belongs beside your other apps instead, this brings it in
        as <code>/apps/{slug}</code> — onto the hub&rsquo;s catalog, AI provider and sync — and opens a pull request for you to merge. Nothing is deleted
        until you say so afterwards.
      </p>
      <div className="ab-brow">
        <button className="ab-ghost" disabled={busy !== null} onClick={onMove}>
          {busy === "absorb" ? "Starting…" : "Move into Jarvis"}
        </button>
      </div>
    </section>
  );
}
