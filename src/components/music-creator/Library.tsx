"use client";

// ---------------------------------------------------------------------------
// Music Creator — Finished songs.
//
// Every finished take from every project, as one dense list with one player.
// The studio home shows all of them with a filter per tool; each tool's page
// shows only its own at the bottom. Playback reads the account's library copy
// (see lib/music-creator/library.ts), so nothing here needs the GPU — a song
// made last week plays instantly, it is never rendered again.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { playUrl } from "@/lib/music-creator/client";
import { TOOLS, toolById } from "@/lib/music-creator/tools";
import type { Project, Render, RenderKind } from "@/lib/music-creator/types";
import { TakeActions } from "./parts";
import { useStudio } from "./studio";

/** Takes that are a finished piece of music (not stems or score transcriptions). */
const FINISHED: RenderKind[] = ["song", "mix", "vocal"];

interface Row {
  project: Project;
  render: Render;
}

export function finishedSongs(projects: Project[], toolId?: string): Row[] {
  const rows: Row[] = [];
  for (const project of projects) {
    if (toolId && project.toolId !== toolId) continue;
    for (const render of project.renders) {
      if (!render.error && (render.fileId || render.saved) && FINISHED.includes(render.kind)) {
        rows.push({ project, render });
      }
    }
  }
  return rows.sort((a, b) => b.render.created - a.render.created);
}

/**
 * @param toolId  Show only this tool's songs (a tool page). Omit on the studio
 *                home, where the list gets a filter per tool instead.
 */
export function FinishedSongs({ toolId }: { toolId?: string }) {
  const { projects, openProject } = useStudio();
  const [filter, setFilter] = useState<string>("all");
  const [playing, setPlaying] = useState<string | null>(null);

  const all = useMemo(() => finishedSongs(projects, toolId), [projects, toolId]);
  const rows = toolId || filter === "all" ? all : all.filter((r) => r.project.toolId === filter);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of all) c[r.project.toolId] = (c[r.project.toolId] ?? 0) + 1;
    return c;
  }, [all]);

  const current = all.find((r) => r.render.id === playing) ?? null;
  const src = current ? playUrl(current.render) : null;

  return (
    <section className="mc-area mc-lib">
      <div className="mc-area-h">
        <h2>
          <Icon.FolderOpen width={16} height={16} /> Finished songs <i>{all.length}</i>
        </h2>
        <p>
          {toolId
            ? `Everything made in ${toolById(toolId)?.title ?? "this tool"}, saved to your account. Press play any time — nothing re-renders.`
            : "Every song you've made, saved to your account. Filter by the tool that made it; press play any time — nothing re-renders."}
        </p>
      </div>

      {!toolId && all.length > 0 && (
        <div className="mc-lib-filters" role="tablist" aria-label="Filter by tool">
          <button type="button" className={`mc-chip ${filter === "all" ? "is-on" : ""}`} onClick={() => setFilter("all")}>
            All <i>{all.length}</i>
          </button>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`mc-chip ${filter === t.id ? "is-on" : ""}`}
              onClick={() => setFilter(t.id)}
              disabled={!counts[t.id]}
            >
              {t.title} <i>{counts[t.id] ?? 0}</i>
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="mc-empty">
          {all.length === 0 ? "No finished songs yet. Render one and it lands here." : "Nothing from this tool yet."}
        </p>
      ) : (
        <ul className="mc-lib-list">
          {rows.map(({ project, render }) => {
            const on = playing === render.id;
            return (
              <li key={render.id} className={`mc-lib-row ${on ? "is-on" : ""}`}>
                <button
                  type="button"
                  className="mc-lib-play"
                  onClick={() => setPlaying(on ? null : render.id)}
                  aria-label={on ? `Stop ${project.title}` : `Play ${project.title}`}
                >
                  {on ? <Icon.Square width={11} height={11} /> : <PlayGlyph />}
                </button>
                <div className="mc-lib-m">
                  <strong>{project.title || "Untitled"}</strong>
                  <span>{render.label}</span>
                </div>
                {!toolId && <span className="mc-lib-tool">{toolById(project.toolId)?.title ?? project.toolId}</span>}
                <span className="mc-take-kind">{render.kind}</span>
                <time>{new Date(render.created).toLocaleDateString()}</time>
                <div className="mc-lib-a">
                  <TakeActions projectId={project.id} render={render} />
                  <button type="button" className="mc-btn mc-btn-s" onClick={() => openProject(project)}>
                    <Icon.Launch width={12} height={12} /> Open
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {current && src && (
        <div className="mc-lib-now">
          <div className="mc-lib-m">
            <strong>{current.project.title || "Untitled"}</strong>
            <span>{current.render.label}</span>
          </div>
          <audio key={src} src={src} controls autoPlay onEnded={() => setPlaying(null)} />
        </div>
      )}
    </section>
  );
}

function PlayGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" />
    </svg>
  );
}
