"use client";

import Link from "next/link";
import { Icon } from "../icons";
import { methodName } from "@/lib/video-studio/registry";
import { PROJECT_STATUS_LABEL } from "@/lib/video-studio/types";
import { Brief } from "./Brief";
import { Integrations } from "./Integrations";
import { Methods } from "./Methods";
import { Plan } from "./Plan";
import { Workspace } from "./Workspace";
import { useStudio, type View } from "./studio";
import { Empty, Panel, timeAgo } from "./ui";
import "./video-studio.css";

// ---------------------------------------------------------------------------
// Video Studio Arena.
//
// One place for every video idea instead of an app per engine. The frame is
// deliberately quiet — the work is the video, the plan and the status list —
// and the flow across the top is the whole product:
//
//   Prompt → Choose Method → Production Plan → Generate → Preview
// ---------------------------------------------------------------------------

const FLOW: { id: View; label: string }[] = [
  { id: "brief", label: "Prompt" },
  { id: "method", label: "Method" },
  { id: "plan", label: "Plan" },
  { id: "workspace", label: "Preview" },
];

export function VideoStudio() {
  const s = useStudio();
  const readyMethods = s.methods.filter((m) => m.capability?.state === "ready").length;

  return (
    <div className="vsa">
      <header className="vsa-head">
        <div className="vsa-head-l">
          <Link href="/" className="vsa-back" aria-label="Back to the hub">
            <Icon.ArrowLeft width={14} height={14} />
          </Link>
          <button type="button" className="vsa-brand" onClick={() => s.setView("home")}>
            VIDEO STUDIO <span>ARENA</span>
          </button>
          <span className="vsa-tag">one prompt · five engines · one video</span>
        </div>

        <nav className="vsa-flow" aria-label="Flow">
          {FLOW.map((stage) => {
            const enabled =
              stage.id === "brief" ||
              (stage.id === "method" && s.brief.prompt.length > 7) ||
              (stage.id === "plan" && Boolean(s.plan)) ||
              (stage.id === "workspace" && Boolean(s.project));
            return (
              <button
                key={stage.id}
                type="button"
                className={`vsa-flow-step ${s.view === stage.id ? "is-on" : ""}`}
                disabled={!enabled}
                onClick={() => s.setView(stage.id)}
              >
                {stage.label}
              </button>
            );
          })}
        </nav>

        <div className="vsa-head-r">
          <button
            type="button"
            className={`vsa-btn is-small ${s.view === "integrations" ? "is-primary" : ""}`}
            onClick={() => s.setView("integrations")}
          >
            <Icon.Server width={13} height={13} /> {readyMethods}/{s.methods.length} ready
          </button>
          <button type="button" className="vsa-btn is-small is-primary" onClick={s.startNew}>
            <Icon.Plus width={13} height={13} /> New video
          </button>
        </div>
      </header>

      {s.error && (
        <div className="vsa-banner" role="alert">
          <span>{s.error}</span>
          <button type="button" onClick={() => s.setError(null)} aria-label="Dismiss">
            <Icon.Close width={12} height={12} />
          </button>
        </div>
      )}

      {s.busy && <div className="vsa-busy">{s.busy}…</div>}

      <main className="vsa-main">
        {s.view === "home" && <Home s={s} />}
        {s.view === "brief" && <Brief s={s} />}
        {s.view === "method" && <Methods s={s} />}
        {s.view === "plan" && <Plan s={s} />}
        {s.view === "workspace" && <Workspace s={s} />}
        {s.view === "integrations" && <Integrations s={s} />}
      </main>
    </div>
  );
}

function Home({ s }: { s: ReturnType<typeof useStudio> }) {
  return (
    <div className="vsa-screen">
      <Panel className="vsa-hero">
        <h1>
          Describe a video. Choose the engine that should make it.
          <span>The studio writes the plan, rewrites it in that engine&apos;s terms, and renders it.</span>
        </h1>
        <button type="button" className="vsa-btn is-primary is-big" onClick={s.startNew}>
          Start a video
        </button>
        <div className="vsa-hero-engines">
          {s.methods
            .filter((m) => !m.hidden)
            .map((m) => (
              <span key={m.id} className={`vsa-hero-engine is-${m.capability?.state ?? "not-connected"}`}>
                {m.name}
              </span>
            ))}
        </div>
      </Panel>

      <Panel title="Your projects" hint="Every version of every idea, newest first.">
        {s.projects.length ? (
          <table className="vsa-projects">
            <thead>
              <tr>
                <th>Project</th>
                <th>Method</th>
                <th>Status</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.projects.map((project) => (
                <tr key={project.id} onDoubleClick={() => void s.openProject(project.id)}>
                  <td>
                    <button type="button" className="vsa-link" onClick={() => void s.openProject(project.id)}>
                      {project.title}
                    </button>
                    {project.versionLabel && <span className="vsa-version">{project.versionLabel}</span>}
                  </td>
                  <td>{methodName(project.methodId)}</td>
                  <td>
                    <span className={`vsa-status is-${project.status}`}>{PROJECT_STATUS_LABEL[project.status]}</span>
                  </td>
                  <td>{timeAgo(project.updatedAt)}</td>
                  <td className="vsa-row-actions">
                    <button
                      type="button"
                      className="vsa-icon-btn"
                      onClick={() => void s.remove(project.id)}
                      aria-label={`Delete ${project.title}`}
                    >
                      <Icon.Trash width={13} height={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="Nothing here yet">
            <span>Your first video is one prompt away.</span>
          </Empty>
        )}
      </Panel>
    </div>
  );
}
