"use client";

// Stage 2. The whole point of the app: before anything is downloaded, prove
// that this is the recording you meant. Thirty seconds of the actual audio
// next to every field the catalogue holds — the two things that settle it.

import { formatDuration } from "@/lib/mp3-download/match";
import type { Track } from "@/lib/mp3-download/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { Pause, Play } from "./bits";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line-soft py-2 last:border-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] leading-snug text-ink">{children}</dd>
    </div>
  );
}

function fullDate(iso: string): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function Dossier({
  track,
  playing,
  loading,
  position,
  duration,
  error,
  onToggle,
  onSeek,
  onConfirm,
  onReject,
}: {
  track: Track;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  error: string | null;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const total = duration || 30;
  const played = Math.min(100, (position / total) * 100);

  return (
    <div className="mp3dl-locked grid gap-6 p-4 sm:p-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* The audition */}
      <div>
        <div className="relative overflow-hidden rounded-xl border border-line shadow-[0_18px_40px_-24px_rgb(0_0_0_/_0.9)]">
          {track.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.artworkUrl} alt="" width={300} height={300} className="block w-full" />
          ) : (
            <div className="flex aspect-square items-center justify-center bg-panel-2">
              <Icon.Note width={36} height={36} className="text-ink-faint" />
            </div>
          )}
        </div>

        {track.previewUrl ? (
          <div className="mt-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onToggle}
                className={cn(
                  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
                  playing
                    ? "border-brand bg-brand text-white shadow-[0_6px_18px_-8px_rgb(99_102_241_/_0.95)]"
                    : "border-line bg-panel-2 text-ink hover:border-brand/50",
                )}
                aria-label={playing ? "Pause the preview" : "Play the preview"}
              >
                {playing ? (
                  <Pause width={16} height={16} />
                ) : (
                  <Play width={16} height={16} className="translate-x-px" />
                )}
              </button>

              <div className="min-w-0 flex-1">
                <input
                  type="range"
                  className="mp3dl-scrub"
                  min={0}
                  max={Math.round(total)}
                  step={0.5}
                  value={Math.min(position, total)}
                  onChange={(e) => onSeek(Number(e.target.value))}
                  style={{ ["--played" as string]: played + "%" }}
                  aria-label="Scrub the preview"
                />
                <div className="mt-0.5 flex justify-between font-mono text-[10.5px] tabular-nums text-ink-muted">
                  <span>{formatDuration(position * 1000)}</span>
                  <span>{loading ? "loading" : formatDuration(total * 1000)} preview</span>
                </div>
              </div>
            </div>
            {error && <p className="mt-2 text-[11.5px] leading-snug text-amber-300">{error}</p>}
          </div>
        ) : (
          <p className="mt-3 text-[11.5px] leading-snug text-ink-muted">
            No preview clip for this release — confirm it on the metadata instead.
          </p>
        )}
      </div>

      {/* The record */}
      <div className="min-w-0">
        <h2 className="text-balance text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink sm:text-[26px]">
          {track.title}
        </h2>
        <p className="mt-1 text-[14px] text-ink-muted">{track.artist}</p>

        <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
          <Field label="Album">{track.album || "—"}</Field>
          <Field label="Released">{fullDate(track.releaseDate)}</Field>
          <Field label="Length">
            <span className="font-mono tabular-nums">{formatDuration(track.durationMs)}</span>
          </Field>
          <Field label="Genre">{track.genre || "—"}</Field>
          <Field label="Position">
            {track.trackNumber
              ? `Track ${track.trackNumber}${track.trackCount ? " of " + track.trackCount : ""}` +
                (track.discNumber > 1 ? `, disc ${track.discNumber}` : "")
              : "—"}
          </Field>
          <Field label="Advisory">{track.explicit ? "Explicit" : "Clean"}</Field>
        </dl>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white shadow-[0_8px_22px_-12px_rgb(99_102_241_/_1)] transition hover:bg-brand-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            <Icon.Check width={14} height={14} />
            That is the song — find it
          </button>
          <button
            type="button"
            onClick={onReject}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
          >
            <Icon.ArrowLeft width={14} height={14} />
            Not this one
          </button>
          {track.storeUrl && (
            <a
              href={track.storeUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-ink-muted underline decoration-line underline-offset-4 transition hover:text-ink hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
            >
              Check it on Apple Music
              <Icon.Launch width={11} height={11} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
