"use client";

import Link from "next/link";
import { Icon } from "../icons";
import { Brief } from "./Brief";
import { Sheet } from "./Sheet";
import { VideoStage } from "./VideoStage";
import { useStudio } from "./studio";
import "./smart-shot.css";

const STAGES: { id: "brief" | "storyboard" | "video"; label: string }[] = [
  { id: "brief", label: "Prompt + images" },
  { id: "storyboard", label: "Editable shot plan" },
  { id: "video", label: "H3 video" },
];

export function SmartShot() {
  const s = useStudio();
  const p = s.project;
  const canStoryboard = !!p.plan;

  return (
    <div className="ss">
      <header className="ss-head">
        <div className="ss-head-l">
          <Link href="/" className="ss-back" aria-label="Back to the hub">
            <Icon.ArrowLeft width={14} height={14} />
          </Link>
          <div>
            <div className="ss-brand">
              SMART SHOT <span>VIDEOS</span>
            </div>
            <div className="ss-tag">prompt → editable storyboard → MiniMax H3 video</div>
          </div>
        </div>
        <nav className="ss-steps" aria-label="Stages">
          {STAGES.map((st, i) => {
            const enabled = st.id === "brief" || canStoryboard;
            return (
              <button key={st.id} type="button" className={`ss-step ${p.stage === st.id ? "is-on" : ""}`} disabled={!enabled} onClick={() => s.setStage(st.id)}>
                <i>{i + 1}</i> {st.label}
              </button>
            );
          })}
        </nav>
        <div className="ss-head-r">
          <select
            className="ss-select"
            value={p.id}
            onChange={(e) => (e.target.value === "__new" ? s.create() : s.open(e.target.value))}
            aria-label="Project"
          >
            {!s.projects.some((x) => x.id === p.id) && <option value={p.id}>{p.title || "Untitled"} (unsaved)</option>}
            {s.projects.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title || "Untitled"}
              </option>
            ))}
            <option value="__new">+ New project</option>
          </select>
          {s.projects.some((x) => x.id === p.id) && (
            <button type="button" className="ss-x" onClick={() => confirm("Delete this project and its storyboard?") && s.remove(p.id)} aria-label="Delete project">
              <Icon.Trash width={13} height={13} />
            </button>
          )}
        </div>
      </header>

      {(s.error || s.notice) && (
        <div className={`ss-banner ${s.error ? "is-error" : ""}`}>
          <span>{s.error || s.notice}</span>
          <button type="button" onClick={s.dismiss} aria-label="Dismiss">
            <Icon.Close width={12} height={12} />
          </button>
        </div>
      )}

      <main className="ss-main">
        {p.stage === "brief" || !p.plan ? (
          <Brief
            brief={p.brief}
            uploads={p.uploads}
            onBrief={(brief) => s.commit((x) => ({ ...x, brief }))}
            onUploads={(uploads) => s.commit((x) => ({ ...x, uploads }))}
            onPlan={() => void s.plan().catch(() => undefined)}
            onCreate={s.createVideo}
            busy={s.busy}
          />
        ) : p.stage === "storyboard" ? (
          <Sheet s={s} />
        ) : (
          <VideoStage s={s} />
        )}
        {s.busy && p.stage !== "brief" && (
          <div className="ss-busy">
            <span className="ss-spinner" /> {s.busy}
          </div>
        )}
      </main>
    </div>
  );
}
