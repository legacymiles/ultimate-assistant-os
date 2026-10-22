"use client";

// ---------------------------------------------------------------------------
// One clip on the wall.
//
//   rest   the real thumbnail, in black and white
//   scan   (hovered) the WebGL trail paints its colour in where the pointer goes
//   live   colour floods the frame and the clip plays — our own saved video
//          inside the reveal itself, or the network's player faded in on top
//
// Only the active tile mounts anything heavier than an <img>: one WebGL
// context and at most one player on the page, however many clips there are.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";

import { PLATFORM_LABEL } from "@/lib/social-import/platform";
import { HEAT_LABEL, heatOf, shortCount } from "@/lib/viral-studio/filters";
import { embedUrl, mediaUrl, playbackLimit, posterUrl } from "@/lib/viral-studio/playback";
import { songLine } from "@/lib/viral-studio/song";
import { FULL, contentRegion, regionCover, sharpRegion, type Region } from "@/lib/viral-studio/trail";
import type { Clip, TabId } from "@/lib/viral-studio/types";

import { TrailReveal } from "./TrailReveal";

export interface PendingClip {
  tempId: string;
  url: string;
  tab: TabId;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^(www|m|vm|vt)\./, "");
  } catch {
    return url;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

interface Props {
  clip: Clip;
  active: boolean;
  sound: boolean;
  flash: boolean;
  /** The newest clip, shown large. */
  lead?: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onToggle: () => void;
  onDelete: () => void;
  /** Audio tab: name the song in this clip. */
  onFindSong?: () => void;
  /** The song finder is listening to this clip right now. */
  finding?: boolean;
  /** Open the mood / category picker for this clip. */
  onEditTags?: () => void;
}

export function ClipTile({ clip, active, sound, flash, lead = false, onEnter, onLeave, onToggle, onDelete, onFindSong, finding = false, onEditTags }: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [vid, setVid] = useState<HTMLVideoElement | null>(null);
  const [posterOk, setPosterOk] = useState<boolean | null>(null);
  const [live, setLive] = useState(false);
  const [plain, setPlain] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const seed = useRef<[number, number] | null>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const [region, setRegion] = useState<Region>(FULL);
  const [artSize, setArtSize] = useState<[number, number]>([3, 4]);

  // The tile's real shape (the lead clip is not 3:4), for framing a trimmed still.
  useEffect(() => {
    const el = artRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setArtSize([r.width, r.height]);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Find letterbox bars in the still so it can fill the tile edge to edge. */
  const measure = (el: HTMLImageElement) => {
    try {
      const c = document.createElement("canvas");
      c.width = 60;
      c.height = 80;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(el, 0, 0, 60, 80);
      const px = ctx.getImageData(0, 0, 60, 80).data;
      setRegion(sharpRegion(px, 60, 80, contentRegion(px, 60, 80)));
    } catch {
      // An unreadable still just isn't trimmed.
    }
  };
  const framed =
    img && region !== FULL && img.naturalWidth ? regionCover(img.naturalWidth, img.naturalHeight, region, artSize[0], artSize[1]).css : null;

  /** Light on the lifted tile follows the pointer (a sheen and a slight tilt). */
  const onArtMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || !artRef.current) return;
    const r = artRef.current.getBoundingClientRect();
    artRef.current.style.setProperty("--mx", ((e.clientX - r.left) / r.width).toFixed(3));
    artRef.current.style.setProperty("--my", ((e.clientY - r.top) / r.height).toFixed(3));
  };

  const poster = posterUrl(clip);
  const isFile = clip.play.kind === "file";
  // Mounted (hidden) as soon as the tile is active, so the player is already
  // buffering while the scan plays and appears the moment colour floods in.
  const embed = active ? embedUrl(clip, sound) : null;
  const limit = playbackLimit(clip);
  const label = PLATFORM_LABEL[clip.platform] ?? "Link";
  const handle = clip.author ? `@${clip.author.replace(/^@/, "")}` : "";
  const heat = heatOf(clip.stats);
  const title = clip.title || handle || hostOf(clip.url);

  // Back to rest whenever the tile stops being the active one.
  useEffect(() => {
    if (active) {
      if (prefersReducedMotion()) {
        setPlain(true);
        setLive(true);
      }
      return;
    }
    setLive(false);
    setPlain(false);
    setFrameReady(false);
    seed.current = null;
  }, [active]);

  useEffect(() => {
    if (vid) vid.muted = !sound;
  }, [vid, sound]);

  const showReveal = active && !plain && (posterOk || isFile);

  // No still to scan (the cover couldn't be fetched): go straight to playing.
  useEffect(() => {
    if (active && !isFile && posterOk === false) setLive(true);
  }, [active, isFile, posterOk]);
  const vertical = clip.vertical !== false;

  return (
    <article
      ref={setHost}
      className={`vsc-tile${lead ? " is-lead" : ""}${active ? " is-active" : ""}${live ? " is-live" : ""}${plain && active ? " is-plain" : ""}${flash ? " is-flash" : ""}`}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        const r = e.currentTarget.querySelector(".vsc-tile__art")?.getBoundingClientRect();
        if (r) seed.current = [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
        onEnter();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onLeave();
      }}
    >
      <div className="vsc-tile__art" ref={artRef} onPointerMove={onArtMove}>
        <button
          type="button"
          className="vsc-tile__hit"
          onClick={onToggle}
          onFocus={onEnter}
          onBlur={onLeave}
          aria-label={`${active ? "Stop" : "Play"} ${title}`}
          aria-pressed={active}
        />

        {poster && posterOk !== false ? (
          // eslint-disable-next-line @next/next/no-img-element -- our own poster
          // route; next/image would re-encode a frame the reveal reads as-is.
          <img
            ref={setImg}
            className={`vsc-tile__poster${framed ? " is-framed" : ""}`}
            style={framed ? { left: `${framed.left}%`, top: `${framed.top}%`, width: `${framed.width}%`, height: `${framed.height}%` } : undefined}
            src={poster}
            alt=""
            crossOrigin="anonymous"
            decoding="async"
            loading="lazy"
            onLoad={(e) => {
              setPosterOk(true);
              measure(e.currentTarget);
            }}
            onError={() => setPosterOk(false)}
          />
        ) : isFile && clip.play.kind === "file" ? (
          // No saved cover: the clip's own opening frame is the still.
          <video className="vsc-tile__poster" src={`${mediaUrl(clip.play.key)}#t=0.5`} preload="metadata" muted playsInline crossOrigin="anonymous" />
        ) : (
          <div className="vsc-tile__blank">
            <span>{label}</span>
          </div>
        )}

        {active && isFile && clip.play.kind === "file" && (
          <video
            ref={setVid}
            className={`vsc-tile__video${plain ? " is-shown" : ""}`}
            src={mediaUrl(clip.play.key)}
            crossOrigin="anonymous"
            autoPlay
            muted={!sound}
            loop
            playsInline
          />
        )}

        {showReveal && (
          <TrailReveal
            host={host}
            image={posterOk ? img : null}
            video={vid}
            seed={seed.current}
            region={region}
            onFlooded={() => setLive(true)}
            onUnsupported={() => {
              setPlain(true);
              setLive(true);
            }}
          />
        )}

        {embed && (
          <iframe
            className={`vsc-tile__frame${vertical ? " is-vertical" : " is-landscape"}${frameReady && live ? " is-ready" : ""}${clip.play.kind === "instagram" ? " is-interactive" : ""}`}
            src={embed}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => window.setTimeout(() => setFrameReady(true), 250)}
          />
        )}

        {live && limit && <p className="vsc-tile__limit">{limit}</p>}

        {live && clip.play.kind !== "none" && (
          <span className="vsc-playing" aria-hidden="true">
            <span className="vsc-eq">
              <i />
              <i />
              <i />
            </span>
            {sound ? "Playing" : "Muted"}
          </span>
        )}

        <span className="vsc-tile__sheen" aria-hidden="true" />

        <div className="vsc-tile__actions">
          <a className="vsc-round" href={clip.url} target="_blank" rel="noreferrer" title={`Open on ${label}`} aria-label={`Open on ${label}`}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3.5h6.5V10M12.5 3.5 4 12" />
            </svg>
          </a>
          <button type="button" className="vsc-round vsc-round--delete" onClick={onDelete} title="Delete (Del)" aria-label={`Delete ${title}`}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <div className="vsc-tile__caption">
        <h3 className="vsc-tile__title">{title}</h3>
        {/* The subtitle: only a real song gets one, and only on the audio tab. */}
        {clip.tab === "audio" && clip.sound === "song" && clip.song ? (
          clip.song.link ? (
            <a className="vsc-tile__song" href={clip.song.link} target="_blank" rel="noreferrer" title="Play the song">
              <SongIcon />
              <span>{songLine(clip.song)}</span>
            </a>
          ) : (
            <p className="vsc-tile__song">
              <SongIcon />
              <span>{songLine(clip.song)}</span>
            </p>
          )
        ) : null}
        <p className="vsc-tile__meta">
          <span>{label}</span>
          {handle && clip.title ? <span>{handle}</span> : null}
          {clip.stats?.views ? <span>{shortCount(clip.stats.views)} views</span> : null}
          <span>{ago(clip.addedAt)}</span>
        </p>
        <div className="vsc-tile__tags">
          {clip.tab === "audio" && clip.sound !== "song" && onFindSong ? (
            <button type="button" className={`vsc-findsong${finding ? " is-listening" : ""}`} onClick={onFindSong} disabled={finding}>
              <SongIcon />
              {finding ? "Listening…" : clip.sound === "original" ? "Original sound · check again" : "Find song"}
            </button>
          ) : null}
          {heat ? <span className={`vsc-chip is-heat is-${heat}`}>{HEAT_LABEL[heat]}</span> : null}
          {[...(clip.tags?.moods ?? []), ...(clip.tags?.categories ?? []).filter((c) => c !== "Song")].slice(0, 3).map((t) => (
            <span key={t} className="vsc-chip">
              {t}
            </span>
          ))}
          {onEditTags ? (
            <button type="button" className="vsc-chip is-edit" onClick={onEditTags} aria-label={`Edit tags for ${title}`}>
              {clip.tags?.moods.length || clip.tags?.categories.length ? "Edit" : "+ Tags"}
            </button>
          ) : null}
        </div>
        {clip.note && <p className="vsc-tile__note">{clip.note}</p>}
      </div>
    </article>
  );
}

export function PendingTile({ pending, onCancel }: { pending: PendingClip; onCancel: () => void }) {
  return (
    <article className="vsc-tile is-pending" aria-busy="true">
      <div className="vsc-tile__art">
        <div className="vsc-tile__shimmer" />
        <div className="vsc-tile__actions is-visible">
          <button type="button" className="vsc-round vsc-round--delete" onClick={onCancel} aria-label="Cancel">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
            </svg>
          </button>
        </div>
      </div>
      <div className="vsc-tile__caption">
        <h3 className="vsc-tile__title">Getting the video…</h3>
        <p className="vsc-tile__meta">
          <span>{hostOf(pending.url)}</span>
        </p>
      </div>
    </article>
  );
}

function SongIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="vsc-songicon">
      <path d="M6 12.2V3.6l7-1.4v8.4" />
      <circle cx="4.4" cy="12.2" r="1.6" />
      <circle cx="11.4" cy="10.6" r="1.6" />
    </svg>
  );
}
