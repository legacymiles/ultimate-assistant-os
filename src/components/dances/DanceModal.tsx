"use client";

// ---------------------------------------------------------------------------
// The record. Full-size video, everything known about the dance, and the score.
//
// This is also the only place a dance can be edited or deleted, which keeps the
// wall a pure browsing surface — nothing on a drifting tile can be clicked by
// accident into a destructive action.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";

import type { Dance } from "@/lib/dances/types";

interface Props {
  dance: Dance;
  onClose: () => void;
  onChange: (patch: Partial<Dance>) => void;
  onDelete: () => void;
}

export function DanceModal({ dance, onClose, onChange, onDelete }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [caching, setCaching] = useState<"idle" | "working" | string>("idle");
  const v = dance.video;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cacheLocally = async () => {
    if (!v || v.kind !== "youtube") return;
    setCaching("working");
    try {
      const res = await fetch("/api/dances/clip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: v.ref }),
      });
      const json = await res.json();
      if (json.ok) {
        onChange({ video: { ...v, kind: "local", ref: `${v.ref}.mp4` } });
        setCaching("idle");
      } else {
        setCaching(json.error ?? "Could not cache that clip.");
      }
    } catch {
      setCaching("Could not reach the server.");
    }
  };

  return (
    <div className="dm__backdrop" onClick={onClose} role="presentation">
      <div
        className="dm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={dance.name}
      >
        <button type="button" className="dm__close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div className="dm__media">
          {v?.kind === "youtube" && (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${v.ref}?autoplay=1&loop=1&playlist=${v.ref}&modestbranding=1&playsinline=1&rel=0`}
              title={dance.name}
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
              frameBorder="0"
            />
          )}
          {v?.kind === "local" && (
            <video src={`/dances/${v.ref}`} controls autoPlay loop playsInline />
          )}
          {!v && <div className="dm__novideo">No playable video for this dance yet.</div>}
        </div>

        <div className="dm__body">
          <h2 className="dm__name">
            {dance.name}
            {dance.nameProvisional && <em className="dm__draft">auto-named — edit me</em>}
          </h2>

          <dl className="dm__facts">
            {dance.song && (
              <>
                <dt>Song</dt>
                <dd>
                  {dance.song}
                  {dance.artist ? ` · ${dance.artist}` : ""}
                </dd>
              </>
            )}
            {dance.creator && (
              <>
                <dt>Choreographer</dt>
                <dd>{dance.creator}</dd>
              </>
            )}
            {dance.year && (
              <>
                <dt>Broke in</dt>
                <dd>{dance.year}</dd>
              </>
            )}
            {dance.difficulty && (
              <>
                <dt>Difficulty</dt>
                <dd>{"●".repeat(dance.difficulty)}{"○".repeat(5 - dance.difficulty)}</dd>
              </>
            )}
            {v?.channel && (
              <>
                <dt>Video from</dt>
                <dd>
                  {v.channel}
                  {v.kind === "youtube" && (
                    <>
                      {" · "}
                      <a
                        href={`https://www.youtube.com/watch?v=${v.ref}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        open
                      </a>
                    </>
                  )}
                </dd>
              </>
            )}
            {dance.tiktokUrl && (
              <>
                <dt>Original</dt>
                <dd>
                  <a href={dance.tiktokUrl} target="_blank" rel="noreferrer">
                    on TikTok
                  </a>
                </dd>
              </>
            )}
          </dl>

          {dance.why && <p className="dm__why">{dance.why}</p>}

          {dance.tags.length > 0 && (
            <ul className="dm__tags">
              {dance.tags.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}

          <label className="dm__score">
            <span>
              Your score{" "}
              <strong>{dance.score === undefined ? "unrated" : dance.score}</strong>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={dance.score ?? 50}
              onChange={(e) => onChange({ score: Number(e.target.value) })}
            />
            {dance.score !== undefined && (
              <button type="button" className="dm__clear" onClick={() => onChange({ score: undefined })}>
                clear
              </button>
            )}
          </label>

          <label className="dm__notes">
            <span>Notes</span>
            <textarea
              value={dance.notes ?? ""}
              placeholder="Where you saw it, who did it best, which part you can't get…"
              onChange={(e) => onChange({ notes: e.target.value })}
              rows={3}
            />
          </label>

          <div className="dm__actions">
            {v?.kind === "youtube" && (
              <button type="button" className="btn" onClick={cacheLocally} disabled={caching === "working"}>
                {caching === "working" ? "Caching…" : "Cache clip locally"}
              </button>
            )}
            {typeof caching === "string" && caching !== "idle" && caching !== "working" && (
              <span className="dm__err">{caching}</span>
            )}
            <span className="dm__spacer" />
            {confirmDelete ? (
              <>
                <span className="dm__err">Delete for good?</span>
                <button type="button" className="btn btn--danger" onClick={onDelete}>
                  Yes, delete
                </button>
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn btn--quiet" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
