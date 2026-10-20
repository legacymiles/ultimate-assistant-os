"use client";

// The pipeline strip and the hand-off: what the agent understood the app is
// for, the skills every build runs (always the same six, in order), and the
// three ways out — build it from In Queue, file the features as board cards,
// or copy the master prompt.

import { useMemo, useState } from "react";
import { checklistLines, masterPrompt, pipeline, tally } from "@/lib/app-builder/engine";
import { APP_TYPE_LABEL, type BuilderProject } from "@/lib/app-builder/types";
import type { Busy } from "@/lib/app-builder/useAppBuilder";

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
  const steps = [
    ...(watched
      ? [{ skill: "reverse-engineer-anything", label: "Reverse engineer", state: project?.teardown ? "done" : "now", note: "rea + video-analyzer" }]
      : []),
    { skill: "felix", label: "Felix", state: hasFeatures ? "done" : project?.stage === "interview" ? "now" : "wait", note: "end goal first" },
    { skill: "prompt-enhancer", label: "Prompt enhancer", state: t.accepted ? "done" : hasFeatures ? "now" : "wait", note: "sharp brief" },
    { skill: u?.designSkill ?? "interactive-web-studio", label: u?.designSkill ?? "Design skill", state: hasFeatures ? "done" : "wait", note: "drives the look" },
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
  onQueue,
  onCards,
  onRename,
}: {
  project: BuilderProject;
  busy: Busy;
  onQueue: () => void;
  onCards: () => void;
  onRename: (name: string) => void;
}) {
  const u = project.understanding!;
  const t = tally(project.features);
  const prompt = useMemo(() => masterPrompt(project), [project]);
  const codes = useMemo(() => checklistLines(project).map((c) => c.id), [project]);
  const [copied, setCopied] = useState(false);
  const [show, setShow] = useState(false);
  const [naming, setNaming] = useState(false);
  const filed = project.handoff?.cards?.length ?? 0;

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

      <div className="ab-launch">
        <button className="ab-primary ab-build" disabled={!t.accepted || busy !== null} onClick={onQueue}>
          {busy === "queue"
            ? "Queuing…"
            : project.handoff?.queueId
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
            : "Claude Code on your PC/VPS picks it up from In Queue and runs the whole pipeline."}
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
            {pipeline(u, project.teardown, Boolean(project.sources?.length), Boolean(project.edit)).map((s) => (
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
