"use client";

// Every reference dance, each with all the takes made from it — so Dance 001
// reads as one row: the original clip, then Character A, Character B, and any
// regenerations, side by side.

import { useState } from "react";

import { api, mediaUrl, sendJson } from "@/lib/dance-studio/client";
import type { Generation, StudioState } from "@/lib/dance-studio/types";
import { PLATFORM_LABEL } from "@/lib/social-import/platform";

import type { GenerateIntent } from "./DanceStudio";
import { GenerationTile } from "./GenerationTile";

interface Props {
  state: StudioState;
  onChanged: () => Promise<void>;
  onGenerate: (intent: GenerateIntent) => void;
}

export function DanceLibrary({ state, onChanged, onGenerate }: Props) {
  const { dances, generations } = state.library;
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  // Numbered oldest-first, so a dance keeps its number as new ones arrive.
  const numberOf = new Map([...dances].reverse().map((d, i) => [d.id, String(i + 1).padStart(3, "0")]));

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError({ id, message: (err as Error).message });
      await onChanged();
    } finally {
      setBusyId("");
    }
  }

  const regenerate = (g: Generation) =>
    run(g.danceId, () =>
      sendJson("/api/dance-studio/generations", {
        danceId: g.danceId,
        characterId: g.characterId,
        userPrompt: g.userPrompt,
        settings: { resolution: g.settings.resolution, useExtraImages: g.settings.useExtraImages },
      }),
    );

  if (!dances.length) {
    return (
      <div className="ds-empty ds-card">
        <p>Your dance library is empty. Generate once and the reference dance and its result are filed here.</p>
        <button type="button" className="btn btn--primary" onClick={() => onGenerate({})}>
          Add a dance
        </button>
      </div>
    );
  }

  return (
    <div className="ds-lib">
      {dances.map((d) => {
        const takes = generations.filter((g) => g.danceId === d.id);
        const cast = new Set(takes.map((g) => g.characterId)).size;
        return (
          <section key={d.id} className="ds-dance">
            <div className="ds-dance__ref">
              <video
                src={mediaUrl(d.videoKey)}
                poster={d.posterKey ? mediaUrl(d.posterKey) : undefined}
                muted
                loop
                playsInline
                preload={d.posterKey ? "none" : "metadata"}
                onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
                onMouseLeave={(e) => e.currentTarget.pause()}
              />
              <small>Reference</small>
            </div>

            <div className="ds-dance__main">
              <header className="ds-dance__head">
                <div className="ds-dance__title">
                  <span className="ds-dance__num">Dance {numberOf.get(d.id)}</span>
                  {renaming?.id === d.id ? (
                    <form
                      className="ds-urlrow"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const name = renaming.name;
                        setRenaming(null);
                        void run(d.id, () => sendJson(`/api/dance-studio/dances/${d.id}`, { name }, "PATCH"));
                      }}
                    >
                      <input className="ds-input" autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: d.id, name: e.target.value })} />
                      <button className="btn" type="submit">
                        Save
                      </button>
                    </form>
                  ) : (
                    <h3>{d.name}</h3>
                  )}
                  <p className="ds-muted">
                    {d.durationSec.toFixed(1)}s clip
                    {d.clipStartSec !== undefined ? ` (from ${d.clipStartSec.toFixed(1)}s of the original)` : ""} · added{" "}
                    {new Date(d.createdAt).toLocaleDateString()} · {takes.length} take{takes.length === 1 ? "" : "s"}, {cast} character{cast === 1 ? "" : "s"}
                    {d.source?.url && (
                      <>
                        {" · "}
                        <a href={d.source.url} target="_blank" rel="noreferrer">
                          original on {d.source.platform === "upload" ? "upload" : PLATFORM_LABEL[d.source.platform]}
                        </a>
                      </>
                    )}
                    {d.originalKey && (
                      <>
                        {" · "}
                        <a href={mediaUrl(d.originalKey)} target="_blank" rel="noreferrer">
                          stored original
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <div className="ds-dance__actions">
                  <button type="button" className="btn btn--primary" onClick={() => onGenerate({ danceId: d.id })}>
                    Generate with a character
                  </button>
                  <button type="button" className="btn btn--quiet" onClick={() => setRenaming({ id: d.id, name: d.name })}>
                    Rename
                  </button>
                  {confirmDelete === d.id ? (
                    <>
                      <button type="button" className="btn btn--danger" onClick={() => run(d.id, () => api(`/api/dance-studio/dances/${d.id}`, { method: "DELETE" }))}>
                        Delete dance + {takes.length} take{takes.length === 1 ? "" : "s"}
                      </button>
                      <button type="button" className="btn btn--quiet" onClick={() => setConfirmDelete("")}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--quiet" onClick={() => setConfirmDelete(d.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </header>

              {error?.id === d.id && <p className="dm__err">{error.message}</p>}

              {takes.length ? (
                <div className="ds-dance__gens">
                  {takes.map((g) => (
                    <GenerationTile
                      key={g.id}
                      generation={g}
                      busy={busyId === d.id}
                      onRegenerate={() => regenerate(g)}
                      onDelete={() => run(d.id, () => api(`/api/dance-studio/generations/${g.id}`, { method: "DELETE" }))}
                    />
                  ))}
                </div>
              ) : (
                <p className="ds-muted">No takes yet.</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
