"use client";

// ---------------------------------------------------------------------------
// What the owner sees after "Build it".
//
// This panel exists because the old answer was a spinner. Pressing Build it
// files a request in In Queue; the thing that builds the app is Claude Code on
// the owner's own PC, which only looks at the queue when it is asked to. So a
// spinner was not just unhelpful, it was wrong — nothing was loading, something
// was waiting, and the owner was the one who had to start it.
//
// It answers the four questions, in the order they are asked: what happens next
// (five steps, the owner's own marked as theirs), how long (an honest range,
// labelled a guess), where will it be (the folder and repo), and is this saved
// if I leave (yes, and it says why). Then it follows the build on its own:
// picked up by whom, every note the agent writes, the result line at the end
// (R5, A1, R3, D6).
// ---------------------------------------------------------------------------

import { useState } from "react";
import { DEPTH_LABEL, depthOf } from "@/lib/app-builder/depth";
import { tally } from "@/lib/app-builder/engine";
import { buildSteps, landsIn, relTime, yourMove, type BuildState, type BuildStep } from "@/lib/app-builder/plan";
import { QUEUE_HREF } from "@/lib/app-builder/queue";
import { reviewHref } from "@/lib/app-builder/review";
import type { BuilderProject } from "@/lib/app-builder/types";
import type { Busy } from "@/lib/app-builder/useAppBuilder";

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

/** The headline: one sentence that is true right now. */
function headline(live: BuildState, p: BuilderProject): { tone: "wait" | "work" | "done" | "gone"; title: string; sub: string } {
  if (live.phase === "done") {
    return {
      tone: "done",
      title: p.edit ? "Edits built" : "Built",
      sub: `${live.doneBy || "Claude Code"} finished it ${relTime(live.doneAt)}.`,
    };
  }
  if (live.phase === "working") {
    return {
      tone: "work",
      title: "Building now",
      sub: `${live.startedBy || "Claude Code"} picked it up ${relTime(live.startedAt)} and is working through the pipeline.`,
    };
  }
  if (live.phase === "gone") {
    return { tone: "gone", title: "No longer in the queue", sub: "It was taken out, or it finished long enough ago that the log has forgotten it." };
  }
  if (live.phase === "filing") return { tone: "wait", title: "Filing the build", sub: "Saving the brief and the accepted features to the server." };
  return {
    tone: "wait",
    title: "Queued — waiting on you",
    sub: `Filed ${relTime(live.at)}. Nothing is running until you start Claude Code.`,
  };
}

function StepRow({ step, n, notes }: { step: BuildStep; n: number; notes?: { at: string; text: string; by: string }[] }) {
  return (
    <li className={`ab-bstep is-${step.state}${step.yours && step.state === "now" ? " is-yours" : ""}`}>
      <span className="ab-bstep-mark" aria-hidden>
        {step.state === "done" ? <Check /> : <i />}
      </span>
      <div className="ab-bstep-body">
        <p className="ab-bstep-title">
          <span className="ab-bstep-n">{n}</span>
          {step.title}
          {step.yours && step.state === "now" && <em className="ab-bstep-yours">your move</em>}
          {step.at && <time className="ab-bstep-at">{relTime(step.at)}</time>}
        </p>
        <p className="ab-bstep-detail">{step.detail}</p>
        {notes && notes.length > 0 && (
          <ol className="ab-notes">
            {notes.map((note, i) => (
              <li key={`${note.at}-${i}`}>
                <span className="ab-note-at">{relTime(note.at)}</span>
                <span className="ab-note-text">{note.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

export function BuildStatus({
  project,
  busy,
  live,
  onRefresh,
  onQueueAgain,
  onCancel,
}: {
  project: BuilderProject;
  busy: Busy;
  /** Hoisted to the shell so the top bar and this panel can never disagree. */
  live: BuildState;
  onRefresh: () => void;
  onQueueAgain: () => void;
  onCancel: () => void;
}) {
  const queueId = project.handoff?.queueId;
  const [copied, setCopied] = useState<"say" | "link" | null>(null);
  const [confirming, setConfirming] = useState(false);

  const head = headline(live, project);
  const steps = buildSteps(project, live);
  const mine = yourMove(live);
  const lands = landsIn(project);
  const t = tally(project.features);
  const { depth, why: depthWhy } = depthOf(project);
  const review = project.handoff?.review;
  const reviewUrl = review ? `${typeof window === "undefined" ? "" : window.location.origin}${reviewHref(review.token)}` : "";

  const copy = async (what: "say" | "link", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard refused — the text is on screen to select by hand */
    }
  };

  return (
    <section className={`ab-build-status is-${head.tone}`} aria-label="Where this build is">
      {/* The phase changes on its own while the owner reads, so it is
          announced rather than only drawn. */}
      <header className="ab-bhead" role="status" aria-live="polite">
        <span className="ab-bdot" aria-hidden />
        <div className="ab-bhead-words">
          <h3>{head.title}</h3>
          <p>{head.sub}</p>
        </div>
        {queueId && <code className="ab-bid">{queueId}</code>}
      </header>

      {/* The one thing the owner has to do, where they cannot miss it. */}
      {mine && (
        <div className="ab-bsay">
          <p className="ab-bsay-note">{mine.note}</p>
          <div className="ab-bsay-row">
            <code>{mine.say}</code>
            <button className="ab-ghost" onClick={() => copy("say", mine.say)}>
              {copied === "say" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <ol className="ab-bsteps">
        {steps.map((s, i) => (
          <StepRow key={s.id} step={s} n={i + 1} notes={s.id === "build" ? live.notes : undefined} />
        ))}
      </ol>

      <dl className="ab-bfacts">
        <div>
          <dt>Depth</dt>
          <dd>
            {DEPTH_LABEL[depth]} — {depthWhy}
          </dd>
        </div>
        <div>
          <dt>Lands in</dt>
          <dd>
            <code>{lands.where}</code>
          </dd>
        </div>
        <div>
          <dt>Saved?</dt>
          <dd>
            Yes. The request is on the server in In Queue and this project is saved to your account, so you can close the page, switch to your phone, and come
            back to this exact screen.
          </dd>
        </div>
        {live.error ? (
          <div>
            <dt>Reading</dt>
            <dd className="is-warn">{live.error}</dd>
          </div>
        ) : live.readAt ? (
          <div>
            <dt>Checked</dt>
            <dd>
              {relTime(live.readAt)} — this updates itself.{" "}
              <button className="ab-blink-btn" onClick={onRefresh}>
                Check now
              </button>
            </dd>
          </div>
        ) : null}
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
        <a className="ab-ghost" href={QUEUE_HREF}>
          Open In Queue
          <Arrow />
        </a>
        {review && (
          <a className="ab-ghost" href={reviewHref(review.token)} target="_blank" rel="noreferrer">
            Open the review link
            <Arrow />
          </a>
        )}
        {(live.phase === "done" || live.phase === "gone") && (
          <button className="ab-ghost" disabled={!t.accepted || busy !== null} onClick={onQueueAgain}>
            {busy === "queue" ? "Queuing…" : "Build it again"}
          </button>
        )}
        {live.phase === "queued" &&
          queueId &&
          (confirming ? (
            <span className="ab-bconfirm">
              Take it out of the queue?
              <button className="ab-ghost is-no" disabled={busy !== null} onClick={onCancel}>
                {busy === "cancel" ? "Removing…" : "Yes, remove it"}
              </button>
              <button className="ab-ghost" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button className="ab-ghost" onClick={() => setConfirming(true)}>
              Take it out of the queue
            </button>
          ))}
      </div>
    </section>
  );
}
