"use client";

// ---------------------------------------------------------------------------
// One tile. A poster until it's hovered (or tapped), then the player.
//
// The rule the whole board leans on: a player is mounted ONLY while the tile is
// active. Every other tile is one <img>, which is what keeps a board of a few
// hundred clips smooth and stops a mouse crossing it from spawning a dozen
// embeds at once.
// ---------------------------------------------------------------------------

import { useState } from "react";

import { PLATFORM_LABEL } from "@/lib/social-import/platform";
import { embedUrl, mediaUrl, playbackLimit, posterUrl } from "@/lib/viral-studio/playback";
import type { Clip, TabId } from "@/lib/viral-studio/types";

export interface PendingClip {
  tempId: string;
  url: string;
  tab: TabId;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface Props {
  clip: Clip;
  active: boolean;
  sound: boolean;
  flash: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

export function ClipTile({ clip, active, sound, flash, onEnter, onLeave, onToggle, onDelete }: Props) {
  const [posterFailed, setPosterFailed] = useState(false);
  const embed = active ? embedUrl(clip, sound) : null;
  const limit = playbackLimit(clip);
  const label = PLATFORM_LABEL[clip.platform] ?? "Link";
  const title = clip.title || (clip.author ? `@${clip.author.replace(/^@/, "")}` : hostOf(clip.url));

  return (
    <article
      className={`vsc-tile${active ? " is-active" : ""}${flash ? " is-flash" : ""}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <button
        type="button"
        className="vsc-tile__hit"
        onClick={onToggle}
        onFocus={onEnter}
        onBlur={onLeave}
        aria-label={`${active ? "Stop" : "Play"} ${title}`}
      />

      <div className="vsc-tile__media" aria-hidden="true">
        {posterFailed ? (
          <div className="vsc-tile__blank">
            <span>{label}</span>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- covers come from
          // several CDNs (and our own redirect route); next/image would need an
          // allowlist for each with nothing gained on a fixed-size poster.
          <img src={posterUrl(clip)} alt="" decoding="async" onError={() => setPosterFailed(true)} />
        )}

        {active && clip.play.kind === "file" && (
          <video className="vsc-tile__player" src={mediaUrl(clip.play.key)} autoPlay muted={!sound} loop playsInline />
        )}
        {embed && (
          <iframe
            className={`vsc-tile__player${clip.play.kind === "instagram" ? " is-interactive" : ""}`}
            src={embed}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
        {active && limit && clip.play.kind === "none" && <div className="vsc-tile__limit">{limit}</div>}
      </div>

      <div className="vsc-tile__top">
        <span className={`vsc-chip vsc-chip--${clip.platform}`}>{label}</span>
        {active && clip.play.kind !== "none" && (
          <span className="vsc-live" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
        )}
      </div>

      <div className="vsc-tile__actions">
        <a className="vsc-icon-btn" href={clip.url} target="_blank" rel="noreferrer" title="Open original" aria-label="Open original">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 3h7v7M13 3 4 12" />
          </svg>
        </a>
        <button type="button" className="vsc-icon-btn vsc-icon-btn--danger" onClick={onDelete} title="Delete (or press Delete while hovering)" aria-label={`Delete ${title}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div className="vsc-tile__meta">
        <p className="vsc-tile__title">{title}</p>
        <p className="vsc-tile__sub">
          {clip.author && clip.title ? <span>@{clip.author.replace(/^@/, "")}</span> : null}
          <span>{ago(clip.addedAt)}</span>
        </p>
        {clip.note && <p className="vsc-tile__note">{clip.note}</p>}
      </div>
    </article>
  );
}

export function PendingTile({ pending, onCancel }: { pending: PendingClip; onCancel: () => void }) {
  return (
    <article className="vsc-tile is-pending" aria-busy="true">
      <div className="vsc-tile__media">
        <div className="vsc-tile__shimmer" />
      </div>
      <div className="vsc-tile__actions is-visible">
        <button type="button" className="vsc-icon-btn vsc-icon-btn--danger" onClick={onCancel} aria-label="Cancel">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div className="vsc-tile__meta">
        <p className="vsc-tile__title">Grabbing video…</p>
        <p className="vsc-tile__sub">
          <span>{hostOf(pending.url)}</span>
        </p>
      </div>
    </article>
  );
}
