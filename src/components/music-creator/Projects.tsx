"use client";

// ---------------------------------------------------------------------------
// Music Creator — Projects.
//
// Every tool writes into the same project store, so this list is the studio's
// memory rather than one tool's history. A project reopens in the tool that
// made it, with its takes attached.
//
// Renders are not stored here as audio: `Render.fileId` is a handle to a file
// on the GPU server. That is stated on the card, because a rented box that has
// since been destroyed takes its files with it, and a project whose takes have
// gone quiet should say why rather than look broken.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { toolById } from "@/lib/music-creator/tools";
import { useStudio } from "./studio";

export function Projects() {
  const { projects, openProject, deleteProject, duplicateProject, go } = useStudio();
  const [confirming, setConfirming] = useState<string | null>(null);

  const sorted = useMemo(() => [...projects].sort((a, b) => b.updated - a.updated), [projects]);

  if (!sorted.length) {
    return (
      <div className="mc-empty">
        <p>No projects yet.</p>
        <button type="button" className="mc-btn mc-btn-go" onClick={() => go({ kind: "home" })}>
          Open a tool
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mc-panel-h">
        <h3>Projects</h3>
        <span className="mc-tag2">{sorted.length} saved</span>
      </div>

      <ul className="mc-list">
        {sorted.map((p) => {
          const tool = toolById(p.toolId);
          const takes = p.renders.filter((r) => !r.error).length;
          const failed = p.renders.length - takes;
          return (
            <li key={p.id} className="mc-item">
              <div className="mc-item-m">
                <strong>{p.title || "Untitled"}</strong>
                <span>
                  {tool?.title ?? p.toolId} · {new Date(p.updated).toLocaleString()} ·{" "}
                  {takes} take{takes === 1 ? "" : "s"}
                  {failed ? ` · ${failed} failed` : ""}
                </span>
              </div>
              <div className="mc-item-a">
                <button type="button" className="mc-btn mc-btn-s" onClick={() => openProject(p)}>
                  <Icon.Launch width={12} height={12} /> Open
                </button>
                <button type="button" className="mc-btn mc-btn-s" onClick={() => duplicateProject(p.id)}>
                  <Icon.Copy width={12} height={12} /> Duplicate
                </button>
                {confirming === p.id ? (
                  <>
                    <button
                      type="button"
                      className="mc-btn mc-btn-s mc-btn-bad"
                      onClick={() => {
                        deleteProject(p.id);
                        setConfirming(null);
                      }}
                    >
                      Delete for good
                    </button>
                    <button type="button" className="mc-btn mc-btn-s" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" className="mc-btn mc-btn-s" onClick={() => setConfirming(p.id)}>
                    <Icon.Trash width={12} height={12} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mc-note">
        Projects hold their words, style, score and the handles to their takes — the audio itself stays on the GPU
        server that made it, so takes from a server you have since shut down will no longer play. Download the ones
        worth keeping.
      </p>
    </div>
  );
}
