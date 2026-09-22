"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { videoUrl } from "@/lib/video-studio/client";
import { DIRECTOR_ID, methodById, methodName } from "@/lib/video-studio/registry";
import { formatTime, sceneRange } from "@/lib/video-studio/plan";
import { PROJECT_STATUS_LABEL, type RunStep } from "@/lib/video-studio/types";
import type { Studio } from "./studio";
import { Empty, Panel, timeAgo } from "./ui";

// Step 4. The project workspace: the video first, then everything that made
// it. The status list is the real state of the run — every line came from the
// server's run loop or from the runner on the PC, and a line only turns green
// when the work behind it actually finished.

const MARK: Record<RunStep["state"], string> = {
  pending: "○",
  running: "⟳",
  done: "✓",
  failed: "✕",
  skipped: "–",
};

export function Workspace({ s }: { s: Studio }) {
  const project = s.project;
  const [compareWith, setCompareWith] = useState<string>("");

  if (!project) {
    return (
      <div className="vsa-screen">
        <Empty title="No project open">
          <button type="button" className="vsa-btn is-primary" onClick={s.startNew}>
            Start a new video
          </button>
        </Empty>
      </div>
    );
  }

  const plan = project.plan;
  const method = methodById(project.methodId);
  const hasVideo = Boolean(project.videoKey);
  const sceneClips = project.scenes.filter((scene) => scene.state === "done" && scene.clipKey);
  const other = s.versions.find((v) => v.id === compareWith);

  return (
    <div className="vsa-screen vsa-workspace">
      <Panel className="vsa-stage-panel">
        <div className={`vsa-stage vsa-ar-${project.brief.aspectRatio.replace(":", "-")}`}>
          {hasVideo ? (
            <video key={project.updatedAt} src={videoUrl(project.id)} controls playsInline preload="metadata" />
          ) : sceneClips.length ? (
            <video key={sceneClips[0].index} src={videoUrl(project.id, sceneClips[0].index)} controls playsInline />
          ) : (
            <div className="vsa-stage-empty">
              <strong>{PROJECT_STATUS_LABEL[project.status]}</strong>
              <span>{project.error ?? "The preview appears here once a scene has rendered."}</span>
            </div>
          )}
        </div>

        {other && (
          <div className={`vsa-stage vsa-ar-${other.brief.aspectRatio.replace(":", "-")}`}>
            {other.videoKey ? (
              <video key={other.id} src={videoUrl(other.id)} controls playsInline preload="metadata" />
            ) : (
              <div className="vsa-stage-empty">
                <strong>{other.versionLabel ?? "Other version"}</strong>
                <span>{PROJECT_STATUS_LABEL[other.status]} — nothing to play yet.</span>
              </div>
            )}
          </div>
        )}
      </Panel>

      <div className="vsa-ws-bar">
        <div className="vsa-ws-title">
          <h2>{project.title}</h2>
          <div className="vsa-ws-facts">
            <span className={`vsa-status is-${project.status}`}>{PROJECT_STATUS_LABEL[project.status]}</span>
            <span>{methodName(project.methodId)}</span>
            <span>{formatTime(plan?.durationSec ?? project.brief.durationSec)}</span>
            <span>{project.brief.aspectRatio}</span>
            {project.renderedBy && <span>rendered by {project.renderedBy}</span>}
            {project.versionLabel && <span className="vsa-version">{project.versionLabel}</span>}
          </div>
        </div>

        <div className="vsa-ws-actions">
          <button type="button" className="vsa-btn" disabled={Boolean(s.busy)} onClick={() => void s.rerender()}>
            <Icon.Refresh width={13} height={13} /> Render again
          </button>
          <button type="button" className="vsa-btn" onClick={() => s.setView("plan")}>
            <Icon.Edit width={13} height={13} /> Edit plan
          </button>
          <button type="button" className="vsa-btn" onClick={() => s.setView("brief")}>
            Edit prompt
          </button>
          <MethodSwitcher s={s} />
          <a
            className={`vsa-btn ${hasVideo ? "is-primary" : "is-disabled"}`}
            href={hasVideo ? videoUrl(project.id) : undefined}
            download
            aria-disabled={!hasVideo}
          >
            <Icon.Download width={13} height={13} /> Export
          </a>
        </div>
      </div>

      {project.error && <p className="vsa-error">{project.error}</p>}

      <div className="vsa-ws-grid">
        <Panel title="Render status" hint="The real state of the run — not a progress bar.">
          {project.steps.length ? (
            <ul className="vsa-steps">
              {project.steps.map((step) => (
                <li key={step.id} className={`is-${step.state}`}>
                  <span className="vsa-step-mark" aria-hidden>
                    {MARK[step.state]}
                  </span>
                  <span className="vsa-step-label">{step.label}</span>
                  {step.detail && <span className="vsa-step-detail">{step.detail}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="vsa-hint">Nothing has been rendered yet.</p>
          )}
        </Panel>

        <Panel title="Scenes" hint="Regenerate one without redoing the rest.">
          {plan ? (
            <ol className="vsa-ws-scenes">
              {plan.scenes.map((scene) => {
                const run = project.scenes.find((r) => r.index === scene.index);
                const ready = run?.state === "done" && run.clipKey;
                return (
                  <li key={scene.id} className={`is-${run?.state ?? "pending"}`}>
                    <div className="vsa-ws-scene-head">
                      <strong>
                        {scene.index}. {scene.title}
                      </strong>
                      <span className="vsa-ws-scene-time">{sceneRange(scene)}</span>
                      <span className="vsa-ws-scene-engine">{methodName(scene.methodId)}</span>
                    </div>
                    <p>{scene.description}</p>
                    {run?.error && <p className="vsa-error is-inline">{run.error}</p>}
                    <div className="vsa-ws-scene-actions">
                      <button
                        type="button"
                        className="vsa-btn is-small"
                        disabled={Boolean(s.busy)}
                        onClick={() => void s.regenerateScene(scene.index)}
                      >
                        Regenerate scene
                      </button>
                      {ready && (
                        <a className="vsa-btn is-small is-ghost" href={videoUrl(project.id, scene.index)} download>
                          Download clip
                        </a>
                      )}
                      {run && run.attempts > 0 && (
                        <span className="vsa-hint">
                          {run.attempts} attempt{run.attempts === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="vsa-hint">No plan on this project.</p>
          )}
        </Panel>

        <Panel title="Method comparison" hint="Run the same plan through another engine and watch them side by side.">
          <div className="vsa-versions">
            {s.versions.map((version) => (
              <button
                key={version.id}
                type="button"
                className={`vsa-version-chip ${version.id === project.id ? "is-current" : ""} ${
                  version.id === compareWith ? "is-compare" : ""
                }`}
                onClick={() =>
                  version.id === project.id
                    ? undefined
                    : setCompareWith(version.id === compareWith ? "" : version.id)
                }
                onDoubleClick={() => void s.openProject(version.id)}
                title={version.id === project.id ? "This version" : "Click to compare, double-click to open"}
              >
                <strong>{version.versionLabel ?? "Version A"}</strong>
                <span>{methodName(version.methodId)}</span>
                <em>{PROJECT_STATUS_LABEL[version.status]}</em>
              </button>
            ))}
          </div>
          <div className="vsa-duplicate">
            <span className="vsa-hint">Try this plan with:</span>
            {s.methods
              .filter((m) => !m.hidden && m.id !== project.methodId)
              .map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="vsa-btn is-small"
                  disabled={Boolean(s.busy)}
                  onClick={() => void s.duplicate(m.id)}
                >
                  {m.name}
                </button>
              ))}
            {project.methodId !== DIRECTOR_ID && (
              <button
                type="button"
                className="vsa-btn is-small"
                disabled={Boolean(s.busy)}
                onClick={() => void s.duplicate(DIRECTOR_ID)}
              >
                AI Director
              </button>
            )}
          </div>
          <p className="vsa-hint">No scores, no winner — look at them and decide.</p>
        </Panel>

        <Panel title="Production record">
          <dl className="vsa-record">
            <div>
              <dt>Prompt</dt>
              <dd>{project.brief.prompt}</dd>
            </div>
            <div>
              <dt>Skill used</dt>
              <dd>
                <code>{plan?.skill ?? method?.meta.skill ?? "—"}</code>
              </dd>
            </div>
            {method && method.meta.companionSkills.length > 0 && (
              <div>
                <dt>Routes to</dt>
                <dd className="vsa-skill-list">
                  {method.meta.companionSkills.map((skill) => (
                    <code key={skill}>{skill}</code>
                  ))}
                </dd>
              </div>
            )}
            <div>
              <dt>Created</dt>
              <dd>{timeAgo(project.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{timeAgo(project.updatedAt)}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Generation history">
          <ol className="vsa-history">
            {project.history.map((entry, i) => (
              <li key={`${entry.at}-${i}`}>
                <span className="vsa-history-kind">{entry.kind}</span>
                <span>{entry.summary}</span>
                <time>{timeAgo(entry.at)}</time>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}

function MethodSwitcher({ s }: { s: Studio }) {
  const project = s.project!;
  return (
    <select
      className="vsa-select"
      value={project.methodId}
      onChange={(e) => void s.switchMethod(e.target.value)}
      disabled={Boolean(s.busy)}
      aria-label="Change method"
      title="Change method"
    >
      <option value={DIRECTOR_ID}>AI Director</option>
      {s.methods
        .filter((m) => !m.hidden)
        .map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
    </select>
  );
}
