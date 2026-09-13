"use client";

// One take: the video when it's done, honest progress while it isn't, and
// exactly what was sent — prompt, model, settings — one click away.

import { useEffect, useState } from "react";

import { mediaUrl } from "@/lib/dance-studio/client";
import { isActive } from "@/lib/dance-studio/limits";
import type { Generation, ReferenceDance } from "@/lib/dance-studio/types";

const STATUS_LABEL: Record<Generation["status"], string> = {
  queued: "Queued",
  generating: "Generating",
  saving: "Saving video",
  done: "Done",
  error: "Failed",
};

function elapsed(fromIso: string, toIso?: string): string {
  const s = Math.max(0, Math.round(((toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

interface Props {
  generation: Generation;
  dance?: ReferenceDance;
  onRegenerate?: () => void;
  onDelete?: () => void;
  busy?: boolean;
}

export function GenerationTile({ generation: g, dance, onRegenerate, onDelete, busy }: Props) {
  const active = isActive(g.status);
  const [, setNow] = useState(0);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  return (
    <article className="ds-gtile">
      <div className="ds-gtile__media">
        {g.status === "done" && g.videoKey ? (
          <video src={mediaUrl(g.videoKey)} controls loop playsInline preload="metadata" />
        ) : (
          <div className={`ds-gtile__state is-${g.status}`}>
            {active && <span className="ds-spinner" />}
            <strong>{STATUS_LABEL[g.status]}</strong>
            {active && <small>{elapsed(g.startedAt ?? g.createdAt)} · usually 2–6 min</small>}
            {g.status === "error" && <small>{g.error}</small>}
          </div>
        )}
      </div>

      <div className="ds-gtile__body">
        <div className="ds-gtile__title">
          <strong>{g.characterName}</strong>
          {dance && <span className="ds-muted">× {dance.name}</span>}
          <span className={`ds-chip is-${g.status}`}>{STATUS_LABEL[g.status]}</span>
        </div>
        <small className="ds-muted">
          {new Date(g.createdAt).toLocaleString()}
          {g.completedAt ? ` · rendered in ${elapsed(g.startedAt ?? g.createdAt, g.completedAt)}` : ""}
        </small>

        <details>
          <summary>Prompt &amp; settings</summary>
          <dl className="ds-kv">
            <dt>Model</dt>
            <dd>{g.model}</dd>
            <dt>Provider</dt>
            <dd>{g.providerId}</dd>
            <dt>Output</dt>
            <dd>
              {g.settings.durationSec}s · {g.settings.aspectRatio} · {g.settings.resolution === "2k" ? "2K" : "768p"}
            </dd>
            <dt>Extra images</dt>
            <dd>{g.settings.useExtraImages ? "yes" : "no"}</dd>
            {g.estimatedCostUsd !== undefined && (
              <>
                <dt>Est. cost</dt>
                <dd>${g.estimatedCostUsd.toFixed(2)}</dd>
              </>
            )}
            {g.userPrompt && (
              <>
                <dt>Your prompt</dt>
                <dd>{g.userPrompt}</dd>
              </>
            )}
          </dl>
          <pre>{g.prompt}</pre>
          {g.warnings.length > 0 && <p className="ds-warn">Provider notes: {g.warnings.join("; ")}</p>}
        </details>

        {(onRegenerate || onDelete || g.videoKey) && (
          <div className="ds-gtile__actions">
            {onRegenerate && (
              <button type="button" className="btn" onClick={onRegenerate} disabled={busy}>
                Regenerate
              </button>
            )}
            {g.videoKey && (
              <a className="btn btn--quiet" href={mediaUrl(g.videoKey)} target="_blank" rel="noreferrer">
                Open
              </a>
            )}
            {onDelete &&
              (confirm ? (
                <>
                  <button type="button" className="btn btn--danger" onClick={onDelete}>
                    Delete take
                  </button>
                  <button type="button" className="btn btn--quiet" onClick={() => setConfirm(false)}>
                    Keep
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn--quiet" onClick={() => setConfirm(true)}>
                  Delete
                </button>
              ))}
          </div>
        )}
      </div>
    </article>
  );
}
