"use client";

// ---------------------------------------------------------------------------
// What the owner sees after "Build it".
//
// This panel used to describe a QUEUE: the request had been filed, and nothing
// would happen until the owner remembered to go and tell Claude Code to work
// it. That was honest about the old mechanism and useless as a product — the
// button said Build and nothing was built.
//
// Now the build is real and running on their own PC, so this panel is the
// build: what it is doing this second, what it has read and changed, the one
// question it is blocked on, and at the end the repository and the live
// address. The owner watches an app get made instead of watching a spinner.
//
// The four questions it still has to answer, because they did not stop being
// good questions: what is happening, how far along, where will it be, and is
// this saved if I close the page (R5, A1, R3).
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { DEPTH_LABEL, depthOf } from "@/lib/app-builder/depth";
import { latestWord, PHASE_LABEL, projectSlug, stalled, stalledWhy, tally as toolTally, type BuildPhase } from "@/lib/app-builder/build";
import { landsIn, relTime } from "@/lib/app-builder/plan";
import { reviewHref } from "@/lib/app-builder/review";
import type { BuilderProject } from "@/lib/app-builder/types";
import type { UseBuild } from "@/lib/app-builder/useBuild";
import type { Busy } from "@/lib/app-builder/useAppBuilder";
import type { BridgeHealth } from "@/lib/new-jarvis/bridge";

function Check() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden focusable="false">
      <path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TONE: Record<BuildPhase, "wait" | "work" | "ask" | "done" | "gone"> = {
  starting: "work",
  working: "work",
  asking: "ask",
  done: "done",
  failed: "gone",
  stopped: "gone",
};

/** One sentence that is true right now. */
function sub(phase: BuildPhase, project: BuilderProject, build: UseBuild): string {
  const started = project.handoff?.thread?.at;
  switch (phase) {
    case "starting":
      return build.starting || "Making the project folder and handing over the brief.";
    case "asking":
      return "Claude is stopped, waiting for you to answer below. Nothing happens until you do.";
    case "done":
      return build.links.url || build.links.repo
        ? "Finished, pushed and live."
        : "Claude has stopped working. Read its last words below to see how far it got.";
    case "failed":
      // The commonest failure by far, and the one that otherwise looks like success.
      if (stalled(build.view)) return stalledWhy();
      return "It hit something it could not get past. Its last words are below.";
    case "stopped":
      return "You stopped it. The project folder keeps everything it had written.";
    default:
      return `Running since ${relTime(started) || "just now"}.${build.summary?.detail ? ` ${build.summary.detail}` : ""}`;
  }
}

export function BuildStatus({
  project,
  busy,
  build,
  bridge,
  onBuildAgain,
  onStop,
}: {
  project: BuilderProject;
  busy: Busy;
  build: UseBuild;
  bridge: BridgeHealth;
  onBuildAgain: () => void;
  onStop: () => void;
}) {
  const [copied, setCopied] = useState<"link" | "path" | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);

  const { phase, view, gate, links } = build;
  const tone = TONE[phase];
  const counts = toolTally(view);
  const now = latestWord(view);
  const lands = landsIn(project);
  const { depth, why: depthWhy } = depthOf(project);
  const review = project.handoff?.review;
  const built = project.handoff?.built;
  const folder = build.summary?.worktree?.path ?? built?.path ?? `${lands.where}`;
  const reviewUrl = review ? `${typeof window === "undefined" ? "" : window.location.origin}${reviewHref(review.token)}` : "";

  // Follow the narration while it is running, but never yank the view while
  // the owner is reading a gate they have to answer.
  useEffect(() => {
    if (phase === "working") logEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [view.turns.length, now, phase]);

  const copy = async (what: "link" | "path", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard refused — the text is on screen to select by hand */
    }
  };

  return (
    <section className={`ab-build-status is-${tone}`} aria-label="The build">
      <header className="ab-bhead" role="status" aria-live="polite">
        <span className="ab-bdot" aria-hidden />
        <div className="ab-bhead-words">
          <h3>{PHASE_LABEL[phase]}</h3>
          <p>{sub(phase, project, build)}</p>
        </div>
        {(phase === "working" || phase === "asking") && (
          <span className="ab-bcounts" title="What it has done so far">
            <b>{counts.changes}</b> written · <b>{counts.runs}</b> run
          </span>
        )}
      </header>

      {/* The one question that stops everything. */}
      {gate && (
        <div className="ab-bgate">
          <p className="ab-bgate-head">
            <span className={`ab-bgate-risk is-${gate.risk}`}>{gate.risk === "grave" ? "Careful" : gate.risk === "act" ? "Asking" : "Reading"}</span>
            {gate.title || gate.name}
          </p>
          {gate.why && <p className="ab-bgate-why">{gate.why}</p>}
          {(gate.command || gate.path) && <pre className="ab-bgate-what">{gate.command || gate.path}</pre>}
          <div className="ab-brow">
            <button className="ab-primary-sm" onClick={() => void build.decide(gate.gateId, true)}>
              Allow it
            </button>
            <button className="ab-ghost is-no" onClick={() => void build.decide(gate.gateId, false)}>
              Not this time
            </button>
          </div>
        </div>
      )}

      {/* What it is doing, in its own words. */}
      {phase !== "done" && now && (
        <p className="ab-bnow">
          <span className="ab-pulse" aria-hidden />
          {now}
        </p>
      )}

      {view.turns.length > 0 && (
        <details className="ab-blog" open={phase === "working" || phase === "asking"}>
          <summary>Everything it has done ({counts.reads + counts.changes + counts.runs} steps)</summary>
          <ol className="ab-blog-rows">
            {view.turns.flatMap((t) =>
              t.tools.map((tool) => (
                // Keyed by turn AND call: a retried call reuses its id, and
                // the reducer replaces rather than appends, so the id alone is
                // not unique across the thread.
                <li key={`${t.id}-${tool.callId}`} className={`is-${tool.status} is-${tool.kindOf}`}>
                  <span className="ab-blog-kind">{tool.kindOf}</span>
                  <span className="ab-blog-what">{tool.title || tool.path || tool.command || tool.name}</span>
                </li>
              )),
            )}
          </ol>
          <div ref={logEnd} />
        </details>
      )}

      {/* Finished: the two links that matter. */}
      {(links.repo || links.url || built?.repo || built?.url) && (
        <div className="ab-bbuilt">
          <p className="ab-bbuilt-head">
            <Check /> {project.understanding?.name ?? "The app"} is built
          </p>
          <div className="ab-brow">
            {(links.url || built?.url) && (
              <a className="ab-primary-sm" href={links.url || built?.url} target="_blank" rel="noreferrer">
                Open it <Arrow />
              </a>
            )}
            {(links.repo || built?.repo) && (
              <a className="ab-ghost" href={links.repo || built?.repo} target="_blank" rel="noreferrer">
                The repository <Arrow />
              </a>
            )}
          </div>
        </div>
      )}

      <dl className="ab-bfacts">
        <div>
          <dt>Depth</dt>
          <dd>
            {DEPTH_LABEL[depth]} — {depthWhy}
          </dd>
        </div>
        <div>
          <dt>Folder</dt>
          <dd>
            <code>{folder}</code>{" "}
            <button className="ab-blink-btn" onClick={() => copy("path", folder)}>
              {copied === "path" ? "Copied" : "Copy"}
            </button>
          </dd>
        </div>
        <div>
          <dt>Saved?</dt>
          <dd>
            Yes. The build runs on your PC, not in this tab — close the page, switch to your phone, and this screen comes back to the same build. Everything
            it writes is committed in <code>{projectSlug(project)}</code>&rsquo;s own repository.
          </dd>
        </div>
        {build.error && (
          <div>
            <dt>Note</dt>
            <dd className="is-warn">{build.error}</dd>
          </div>
        )}
      </dl>

      {review && (
        <div className="ab-breview">
          <p className="ab-breview-head">
            Review link · {review.number}
            {review.clientName ? ` · ${review.clientName}` : ""}
          </p>
          <p className="ab-breview-note">
            The finished app posts itself here. Open it and tap anything on the page to ask for a change — the change comes back to App Builder as an edit.
          </p>
          <div className="ab-bsay-row">
            <code>{reviewUrl}</code>
            <button className="ab-ghost" onClick={() => copy("link", reviewUrl)}>
              {copied === "link" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
      {project.handoff?.reviewError && (
        <p className="ab-bwarn" role="status">
          {project.handoff.reviewError} You can open one by hand in Client Review.
        </p>
      )}

      <div className="ab-brow">
        {review && (
          <a className="ab-ghost" href={reviewHref(review.token)} target="_blank" rel="noreferrer">
            Open the review link
            <Arrow />
          </a>
        )}
        {(phase === "done" || phase === "failed" || phase === "stopped") && (
          <button className="ab-ghost" disabled={busy !== null || !bridge.paired} onClick={onBuildAgain}>
            {busy === "build" ? "Starting…" : "Build it again"}
          </button>
        )}
        {(phase === "working" || phase === "asking" || phase === "starting") &&
          (confirmStop ? (
            <span className="ab-bconfirm">
              Stop the build?
              <button className="ab-ghost is-no" onClick={onStop}>
                Yes, stop it
              </button>
              <button className="ab-ghost" onClick={() => setConfirmStop(false)}>
                Keep going
              </button>
            </span>
          ) : (
            <button className="ab-ghost" onClick={() => setConfirmStop(true)}>
              Stop the build
            </button>
          ))}
      </div>
    </section>
  );
}
