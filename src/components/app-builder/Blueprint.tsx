"use client";

// The pipeline strip and the hand-off: what the agent understood the app is
// for, the skills every build runs (in order, with `commercial` sitting at the
// depth the app earns), how far the build goes, where it lands for review, and
// the three ways out — build it from In Queue, file the features as board
// cards, or copy the master prompt.
//
// Once it has been handed off this panel stops being a launcher and becomes
// BuildStatus: the live state of the build, rather than a button that spins.

import { useMemo, useState } from "react";
import { DEPTH_BLURB, DEPTH_LABEL, DEPTHS, depthOf, depthSteps } from "@/lib/app-builder/depth";
import { checklistLines, masterPrompt, pipeline, tally } from "@/lib/app-builder/engine";
import { etaFor, type BuildState } from "@/lib/app-builder/plan";
import { APP_TYPE_LABEL, type BuilderProject, type Depth } from "@/lib/app-builder/types";
import type { Busy, QueueStep } from "@/lib/app-builder/useAppBuilder";
import { BuildStatus } from "./BuildStatus";

export function Pipeline({ project }: { project: BuilderProject | null }) {
  const u = project?.understanding;
  const t = tally(project?.features ?? []);
  const hasFeatures = project?.stage === "features";
  const watched = Boolean(project?.teardown || project?.sources?.length);
  if (project?.edit) {
    const queued = Boolean(project.handoff?.queueId);
    const edit = [
      { skill: "felix", label: "Felix", state: "done", note: "end goal first" },
      { skill: "prompt-enhancer", label: "Prompt enhancer", state: t.accepted ? "done" : "now", note: "exact changes" },
      { skill: "interactive-web-studio", label: "Match the site", state: "done", note: "no redesign" },
      { skill: "claude-security", label: "Claude Security", state: queued ? "now" : "wait", note: "scan the diff" },
      { skill: "client_review_preview", label: "Preview → client", state: queued ? "now" : "wait", note: project.edit.version },
    ];
    return (
      <ol className="ab-pipeline" aria-label="What this client edit runs">
        {edit.map((s) => (
          <li key={s.skill} className={`ab-step is-${s.state}`} title={s.skill}>
            <span className="ab-step-dot" aria-hidden />
            <span className="ab-step-label">{s.label}</span>
            <span className="ab-step-note">{s.note}</span>
          </li>
        ))}
      </ol>
    );
  }
  const depth = project ? depthOf(project).depth : "commercial";
  const steps = [
    ...(watched
      ? [{ skill: "reverse-engineer-anything", label: "Reverse engineer", state: project?.teardown ? "done" : "now", note: "rea + video-analyzer" }]
      : []),
    { skill: "felix", label: "Felix", state: hasFeatures ? "done" : project?.stage === "interview" ? "now" : "wait", note: "end goal first" },
    { skill: "prompt-enhancer", label: "Prompt enhancer", state: t.accepted ? "done" : hasFeatures ? "now" : "wait", note: "sharp brief" },
    ...(depth === "plain"
      ? []
      : [
          {
            skill: depth === "commercial-2x" ? "commercial 2x" : "commercial",
            label: depth === "commercial-2x" ? "Commercial 2x" : "Commercial",
            state: hasFeatures ? "done" : "wait",
            note: `steps ${depthSteps(depth, u?.appType).join(",")}`,
          },
        ]),
    { skill: u?.designSkill ?? "interactive-web-studio", label: u?.designSkill ?? "Design skill", state: hasFeatures ? "done" : "wait", note: "drives the look" },
    { skill: "impeccable", label: "Impeccable", state: hasFeatures ? "done" : "wait", note: "closing craft pass" },
    { skill: "software-factory", label: "Software factory", state: project?.handoff?.cards?.length ? "done" : t.accepted ? "now" : "wait", note: "board cards" },
    { skill: "claude-security", label: "Claude Security", state: project?.handoff?.queueId ? "now" : "wait", note: "scan before launch" },
  ];
  return (
    <ol className="ab-pipeline" aria-label="Skills every build runs">
      {steps.map((s, i) => (
        <li key={s.skill + i} className={`ab-step is-${s.state}`} title={s.skill}>
          <span className="ab-step-dot" aria-hidden />
          <span className="ab-step-label">{s.label}</span>
          <span className="ab-step-note">{s.note}</span>
        </li>
      ))}
    </ol>
  );
}

export function Blueprint({
  project,
  busy,
  step,
  live,
  onRefresh,
  onQueue,
  onCancel,
  onCards,
  onRename,
  onDepth,
  onNoReview,
}: {
  project: BuilderProject;
  busy: Busy;
  step: QueueStep;
  live: BuildState;
  onRefresh: () => void;
  onQueue: (clientName?: string) => void;
  onCancel: () => void;
  onCards: () => void;
  onRename: (name: string) => void;
  onDepth: (depth: Depth) => void;
  onNoReview: (off: boolean) => void;
}) {
  const u = project.understanding!;
  const t = tally(project.features);
  const prompt = useMemo(() => masterPrompt(project), [project]);
  const codes = useMemo(() => checklistLines(project).map((c) => c.id), [project]);
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(false);
  const [naming, setNaming] = useState(false);
  const [who, setWho] = useState("");
  const filed = project.handoff?.cards?.length ?? 0;
  const { depth, why: depthWhy } = depthOf(project);
  const eta = etaFor(t.accepted, depth);
  const handedOff = Boolean(project.handoff?.queueId);
  /** Queued or being built: the brief is already written, so the depth is set. */
  const inFlight = handedOff && (live.phase === "queued" || live.phase === "working" || live.phase === "filing");
  const wantsReview = !project.edit && !project.noReview;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setShow(true);
    }
  };

  return (
    <section className="ab-blueprint" aria-label="Blueprint and hand-off">
      {(project.teardown || project.sources?.length) && <Recording project={project} />}
      {project.edit && <ClientEditPanel project={project} />}
      <div className="ab-purpose">
        <div className="ab-purpose-top">
          {naming ? (
            <input
              className="ab-name-input"
              aria-label="App name"
              defaultValue={u.name}
              autoFocus
              maxLength={48}
              onBlur={(e) => {
                onRename(e.target.value);
                setNaming(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <button className="ab-name" onClick={() => setNaming(true)} title="Rename">
              {u.name}
            </button>
          )}
          <span className="ab-type">{APP_TYPE_LABEL[u.appType]}</span>
        </div>
        <dl className="ab-facts">
          <div>
            <dt>End goal</dt>
            <dd>{u.endGoal || u.purpose}</dd>
          </div>
          <div>
            <dt>Beyond</dt>
            <dd>{u.beyond}</dd>
          </div>
          <div>
            <dt>For</dt>
            <dd>{u.audience}</dd>
          </div>
          <div>
            <dt>Money</dt>
            <dd>{u.model}</dd>
          </div>
          <div>
            <dt>Look</dt>
            <dd>
              <code>{u.designSkill}</code> — {u.designWhy}
            </dd>
          </div>
          <div>
            <dt>Judge</dt>
            <dd>
              <ul>
                {u.judge.map((j) => (
                  <li key={j}>{j}</li>
                ))}
              </ul>
            </dd>
          </div>
          <div>
            <dt>Checklist</dt>
            <dd className="ab-codes">{codes.join(" ")}</dd>
          </div>
        </dl>
      </div>

      {/* Handed off already: the live state of the build, not a launcher. */}
      {handedOff && (
        <BuildStatus project={project} busy={busy} live={live} onRefresh={onRefresh} onQueueAgain={() => onQueue(who || undefined)} onCancel={onCancel} />
      )}

      <div className="ab-launch">
        {!project.edit && (
          <fieldset className="ab-depth" disabled={inFlight}>
            <legend>How far it goes</legend>
            <div className="ab-depth-row" role="radiogroup" aria-label="Build depth">
              {DEPTHS.map((d) => (
                <button
                  key={d}
                  role="radio"
                  aria-checked={depth === d}
                  className="ab-depth-opt"
                  disabled={inFlight}
                  onClick={() => onDepth(d)}
                  title={DEPTH_BLURB[d]}
                >
                  {DEPTH_LABEL[d]}
                </button>
              ))}
            </div>
            <p className="ab-depth-why">
              {inFlight
                ? "Locked while this build is in the queue — the brief Claude Code reads is already written. Take it out of the queue to change it."
                : `${DEPTH_BLURB[depth]} ${project.depth ? "Your choice." : `Chosen because ${depthWhy}.`}`}
            </p>
          </fieldset>
        )}

        {!project.edit && !handedOff && (
          <div className="ab-prereview">
            <label className="ab-check">
              <input type="checkbox" checked={wantsReview} onChange={(e) => onNoReview(!e.target.checked)} />
              <span>
                Open a Client Review link for it
                <em>The finished app posts itself there; tapping the page sends edits straight back here.</em>
              </span>
            </label>
            {wantsReview && (
              <input
                className="ab-who"
                value={who}
                onChange={(e) => setWho(e.target.value)}
                placeholder="Who’s reviewing it? (optional)"
                aria-label="Who is reviewing it"
                maxLength={60}
              />
            )}
          </div>
        )}

        <button className="ab-primary ab-build" disabled={!t.accepted || busy !== null} onClick={() => onQueue(who || undefined)}>
          {busy === "queue"
            ? step === "review"
              ? "Opening the review link…"
              : step === "noting"
                ? "Telling Client Review…"
                : "Filing it in In Queue…"
            : handedOff
              ? "Queue the build again"
              : project.edit
                ? `Build ${t.accepted} edit${t.accepted === 1 ? "" : "s"} · ${project.edit.version}`
                : `Build it · ${t.accepted} feature${t.accepted === 1 ? "" : "s"}`}
          <span aria-hidden>→</span>
        </button>
        <p className="ab-launch-note">
          {t.accepted
            ? t.proposed
              ? `${t.proposed} still open — undecided features are left out.`
              : "Every feature decided."
            : "Accept at least one feature to build."}{" "}
          {project.edit
            ? `Claude Code builds them on ${project.edit.branch}, opens a pull request for you to merge, and posts the preview to ${project.edit.clientName || "the client"}'s review link.`
            : `This files one request in In Queue — it does not start a build. Claude Code on your PC or VPS runs it the next time you say "work my Jarvis queue", and a build this size usually takes ${eta.label} once it starts.`}
        </p>
        <div className="ab-launch-row">
          <button className="ab-ghost" disabled={!t.accepted || busy !== null} onClick={onCards}>
            {busy === "board" ? "Filing cards…" : filed ? `Board · ${filed} filed` : `Send ${t.accepted} card${t.accepted === 1 ? "" : "s"} to board`}
          </button>
          <button className="ab-ghost" disabled={!t.accepted} onClick={copy}>
            {copied ? "Copied ✓" : "Copy master prompt"}
          </button>
          <button className="ab-ghost" aria-expanded={show} onClick={() => setShow((s) => !s)}>
            {show ? "Hide prompt" : "View prompt"}
          </button>
        </div>
        {project.handoff?.cards?.length ? (
          <ul className="ab-cards">
            {project.handoff.cards.map((c) => (
              <li key={c.number}>
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer">
                    #{c.number}
                  </a>
                ) : (
                  `#${c.number}`
                )}{" "}
                {c.title}
              </li>
            ))}
          </ul>
        ) : null}
        {show && <pre className="ab-prompt">{prompt}</pre>}
        <details className="ab-skills">
          <summary>The pipeline this build runs</summary>
          <ol>
            {pipeline(u, project.teardown, Boolean(project.sources?.length), Boolean(project.edit), depth).map((s) => (
              <li key={s.skill}>
                <code>{s.skill}</code> — {s.role}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </section>
  );
}

/** What the agent took apart from the attached recordings. */
export function Recording({ project }: { project: BuilderProject }) {
  const t = project.teardown;
  return (
    <div className="ab-recording">
      <div className="ab-rec-head">
        <span className="ab-rec-title">{t ? (t.mode === "recreate" ? "Recreating the recording" : "Changing the recording") : "Recording"}</span>
        <span className="ab-rec-sub">reverse-engineered · rea + video-analyzer</span>
      </div>
      {project.sources?.length ? (
        <ul className="ab-sources">
          {project.sources.map((s) => (
            <li key={s.id} title={s.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {s.thumb ? <img src={s.thumb} alt="" /> : <span className="ab-src-blank" />}
              <span>{s.kind === "video" ? `▶ ${s.duration ? `${Math.round(s.duration)}s` : "clip"}` : "pic"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {t ? (
        <>
          <p className="ab-rec-summary">{t.summary}</p>
          {t.flow.length > 0 && (
            <ol className="ab-flow">
              {t.flow.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ol>
          )}
          {t.screens.length > 0 && (
            <div className="ab-screens">
              {t.screens.map((s) => (
                <span key={s.name} className="ab-screen" title={`${s.purpose}${s.elements.length ? ` — ${s.elements.join(", ")}` : ""}`}>
                  {s.name}
                </span>
              ))}
            </div>
          )}
          {t.changes.length > 0 && (
            <p className="ab-rec-line">
              <b>Your changes:</b> {t.changes.join("; ")}
            </p>
          )}
          {t.unknowns.length > 0 && (
            <p className="ab-rec-line ab-rec-faint">
              <b>Not visible — to confirm:</b> {t.unknowns.join("; ")}
            </p>
          )}
        </>
      ) : (
        <p className="ab-rec-summary ab-rec-faint">Not watched yet — the frames go with the build so Claude Code on your PC can take it apart.</p>
      )}
    </div>
  );
}

/** A client edit from Client Review: whose site, which version, where it builds. */
export function ClientEditPanel({ project }: { project: BuilderProject }) {
  const e = project.edit!;
  return (
    <div className="ab-recording ab-edit">
      <div className="ab-rec-head">
        <span className="ab-rec-title">
          Client edit · {e.fromVersion ? `${e.fromVersion} → ` : ""}
          {e.version}
        </span>
        <span className="ab-rec-sub">from Client Review · {e.clientName || "client"}</span>
      </div>
      <dl className="ab-facts">
        <div>
          <dt>Repo</dt>
          <dd>{e.repo ? <code>{e.repo}</code> : <span className="is-warn">Not set — add it in Client Review</span>}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>
            <code>{e.branch}</code> off <code>{e.baseBranch}</code>
          </dd>
        </div>
        {e.fromUrl && (
          <div>
            <dt>Client sees</dt>
            <dd>
              <a href={e.fromUrl} target="_blank" rel="noreferrer">
                {e.fromUrl}
              </a>
            </dd>
          </div>
        )}
        <div>
          <dt>Goes live</dt>
          <dd>When you merge the pull request. The preview goes to the client first.</dd>
        </div>
      </dl>
      <a className="ab-ghost ab-edit-back" href="/apps/client-review">
        Open Client Review ↗
      </a>
    </div>
  );
}
