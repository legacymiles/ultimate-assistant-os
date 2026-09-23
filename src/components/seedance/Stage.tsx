"use client";

// ---------------------------------------------------------------------------
// The stage (what is under the playhead) and the film panel (what every prompt
// inherits). Together they are the two things you look at that are not the
// timeline: one shot, and the whole picture.
// ---------------------------------------------------------------------------

import { ASPECT_CSS, ASPECT_RATIOS, SINGS, blockSkin, timecode } from "@/lib/seedance/constants";
import { mergedCinema, paletteOf, posterOf } from "@/lib/seedance/prompt";
import type { AspectRatio, PlacedPrompt, Reel } from "@/lib/seedance/types";
import type { CinemaSelection } from "@/lib/studio/cinema";
import { selectionCount } from "@/lib/studio/cinema";
import { Icon } from "../icons";
import { CinemaBar } from "../jarvis/CinemaDeck";

export function Stage({
  reel,
  placed,
  playing,
  playheadSec,
  totalSec,
  renderedCount,
  totalCount,
  onTogglePlay,
  onRewind,
  onOpen,
}: {
  reel: Reel;
  placed: PlacedPrompt | null;
  playing: boolean;
  playheadSec: number;
  totalSec: number;
  renderedCount: number;
  totalCount: number;
  onTogglePlay: () => void;
  onRewind: () => void;
  onOpen: () => void;
}) {
  const block = placed?.block;
  const skin = blockSkin(Boolean(placed?.lipSynced));
  const merged = placed ? mergedCinema(reel, placed.block) : {};
  const palette = paletteOf(merged);
  const poster = block ? posterOf(block) : null;

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div className="relative min-h-0 flex-1 bg-black/60 p-2">
        <div
          className="relative mx-auto h-full max-h-[200px] overflow-hidden rounded-lg border border-line-soft"
          style={{ aspectRatio: ASPECT_CSS[reel.aspectRatio] }}
        >
          {block?.videoUrl ? (
            <video
              key={block.id}
              src={block.videoUrl}
              className="h-full w-full object-cover"
              autoPlay={playing}
              loop
              muted
              playsInline
            />
          ) : poster ? (
            <>
              {/* Until a clip exists, the block's own image stands in for it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/85 to-black/10" />
            </>
          ) : (
            <>
              {/* No image either: the shot's own grade, so an unrendered reel
                  still previews as the film it is going to be. */}
              <span
                aria-hidden
                className="absolute inset-0"
                style={{
                  background: palette
                    ? `linear-gradient(153deg, ${palette.slice(0, 6).join(", ")})`
                    : `linear-gradient(153deg, hsl(${skin.hue} 60% 22%), hsl(${skin.hue} 40% 8%))`,
                }}
              />
              <span aria-hidden className="absolute inset-0 bg-black/35" />
            </>
          )}

          {!block?.videoUrl && (
            <div className="absolute inset-0 flex flex-col justify-end gap-1 p-3">
              <span
                className="flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: placed?.lipSynced ? SINGS.text : skin.text }}
              >
                {placed?.lipSynced && <Icon.Mic width={10} height={10} />}
                {placed ? (placed.lipSynced ? "Lip sync" : "Under music") : "Nothing here yet"}
              </span>
              <p className="line-clamp-3 text-[12px] leading-snug text-ink">
                {block?.prompt?.trim() ||
                  (placed ? "No prompt on this shot yet." : "The cut ends before this point.")}
              </p>
            </div>
          )}

          {placed && (
            <button
              onClick={onOpen}
              className="absolute inset-0 focus-visible:outline-none"
              aria-label="Open this shot's prompt"
            />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-2.5 py-2">
        <button
          onClick={onRewind}
          aria-label="Back to the top"
          className="rounded-md p-1.5 text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          <Icon.Rewind width={14} height={14} />
        </button>
        <button
          onClick={onTogglePlay}
          aria-label={playing ? "Pause" : "Play the reel"}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-canvas transition hover:bg-accent-2"
        >
          {playing ? <Icon.Pause width={14} height={14} /> : <Icon.Play width={14} height={14} />}
        </button>
        <span className="text-[11.5px] font-medium tabular-nums text-ink">
          {timecode(playheadSec, true)}
          <span className="text-ink-faint"> / {timecode(totalSec)}</span>
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-ink-muted">
          {renderedCount}/{totalCount} rendered
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

export function FilmPanel({
  reel,
  onDirection,
  onCinema,
  onAspect,
}: {
  reel: Reel;
  onDirection: (v: string) => void;
  onCinema: (s: CinemaSelection) => void;
  onAspect: (a: AspectRatio) => void;
}) {
  const set = selectionCount(reel.cinema);
  return (
    <section className="flex min-h-0 flex-col gap-2.5 overflow-hidden rounded-xl border border-line bg-panel p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">The film</h2>
        <span className="text-[10px] text-ink-faint">
          {set
            ? `${set} rail${set === 1 ? "" : "s"} set — every prompt inherits them`
            : "Every prompt inherits this"}
        </span>
        <div className="ml-auto flex overflow-hidden rounded-md border border-line">
          {ASPECT_RATIOS.map((a) => (
            <button
              key={a.value}
              onClick={() => onAspect(a.value)}
              aria-pressed={reel.aspectRatio === a.value}
              title={a.note}
              className={
                "px-2 py-1 text-[10px] font-medium tabular-nums transition " +
                (reel.aspectRatio === a.value
                  ? "bg-accent/15 text-accent"
                  : "text-ink-muted hover:bg-panel-2 hover:text-ink")
              }
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={reel.direction}
        onChange={(e) => onDirection(e.target.value)}
        rows={3}
        placeholder="The whole video in a sentence — who it is about, where it lives, what it is doing to the viewer…"
        className="w-full resize-none rounded-lg border border-line bg-canvas px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent/25"
      />

      <CinemaBar
        selection={reel.cinema}
        onSelection={onCinema}
        text={reel.direction}
        onText={onDirection}
      />
    </section>
  );
}
