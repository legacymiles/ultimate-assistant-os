"use client";

// ---------------------------------------------------------------------------
// Watching a film render.
//
// A film is hours on a 6 GB card, so this has one job: make the wait legible.
// It shows the same three things a lab report would — how far in, how long
// left, and what has actually landed — and nothing it cannot back up. The ETA
// comes from the bridge's measured seconds-per-frame on THIS PC, not from a
// guess, and the bar inside a running shot stops just short of full rather
// than pretending a slow render finished.
//
// Every clip becomes playable the moment it exists, because a shot the owner
// can already watch is worth more than a film they are still waiting for.
// ---------------------------------------------------------------------------

import { Icon } from "../icons";
import { formatEta, timecode } from "@/lib/studio/storyboard";
import type { FilmView } from "@/lib/studio/film";

const STATUS_COPY: Record<FilmView["status"], string> = {
  queued: "Queued on this PC",
  rendering: "Rendering the shots, in order",
  stitching: "Cutting the shots together",
  done: "Done",
  error: "Stopped",
};

export function FilmProgress({
  view,
  film,
  onCancel,
  onSave,
}: {
  view: FilmView;
  /** The finished, stitched film, once it exists. */
  film?: { url: string } | null;
  onCancel?: () => void;
  onSave?: () => void;
}) {
  const total = view.shots.length;
  // Frame-weighted, so a 15-second shot moves the bar further than a 4-second
  // one — the same weighting the ETA uses, so the two never disagree.
  const frames = view.shots.map((s) => 107 + 17 * Math.max(0, Math.ceil((Math.round(s.durationSec * 24) - 107) / 17)));
  const all = frames.reduce((a, b) => a + b, 0) || 1;
  const covered = view.shots.reduce((t, s, i) => t + (frames[i] * Math.min(100, s.percent)) / 100, 0);
  const percent = view.status === "done" ? 100 : Math.min(99, Math.round((covered / all) * 100));
  const running = view.status === "rendering" || view.status === "queued" || view.status === "stitching";

  return (
    <section aria-label="Film render" className="overflow-hidden rounded-xl border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 pt-2.5">
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{view.title}</h3>
        <p
          className="text-[11px] tabular-nums text-ink-muted"
          aria-live="polite"
          aria-atomic="true"
        >
          {view.status === "done"
            ? `${view.doneShots} of ${total} shot${total === 1 ? "" : "s"} · cut together`
            : view.status === "error"
              ? "Stopped"
              : `${percent}% · ${formatEta(view.etaSeconds)}`}
        </p>
      </header>

      {/* The bar. One authored movement: the fill eases out to its new length,
          and while something is actually rendering a slow sheen crosses it, so
          a bar that has not moved for four minutes still reads as alive. */}
      <div className="px-3">
        <div
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-panel-2"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${view.title}: ${STATUS_COPY[view.status]}`}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-700 ease-out ${
              view.status === "error" ? "bg-amber-400" : "bg-ink"
            }`}
            style={{ width: `${Math.max(percent, 1.5)}%` }}
          />
          {running && (
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-[filmsheen_2.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/25 to-transparent motion-reduce:hidden"
              aria-hidden
            />
          )}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-ink-faint">
          <span>{STATUS_COPY[view.status]}</span>
          {view.elapsedSeconds > 0 && (
            <span className="tabular-nums">· {timecode(view.elapsedSeconds)} so far</span>
          )}
          {view.secondsPerFrame > 0 && (
            <span className="tabular-nums" title="Measured on this PC from the shots it has already rendered.">
              · {view.secondsPerFrame.toFixed(2)} s/frame here
            </span>
          )}
          {running && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="ml-auto underline transition hover:text-ink-muted"
            >
              Stop after this shot
            </button>
          )}
        </p>
      </div>

      {/* One row per shot: the number, the name, its own bar, its own clock. */}
      <ol className="mt-2 divide-y divide-line-soft border-t border-line-soft">
        {view.shots.map((s) => (
          <li key={s.n} className="flex items-center gap-2.5 px-3 py-1.5">
            <span className="w-4 shrink-0 text-right text-[10.5px] tabular-nums text-ink-faint">{s.n}</span>
            {s.url ? (
              <video
                src={s.url}
                muted
                loop
                playsInline
                onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
                onMouseLeave={(e) => e.currentTarget.pause()}
                className="h-8 w-14 shrink-0 rounded border border-line object-cover"
                aria-label={`Shot ${s.n}, hover to play`}
              />
            ) : (
              <span
                className={`grid h-8 w-14 shrink-0 place-items-center rounded border border-line text-ink-faint ${
                  s.status === "rendering" ? "bg-panel-2" : ""
                }`}
                aria-hidden
              >
                {s.status === "error" ? (
                  <Icon.Close width={11} height={11} className="text-amber-400" />
                ) : s.status === "rendering" ? (
                  <Icon.Film width={11} height={11} className="animate-pulse" />
                ) : (
                  <Icon.Film width={11} height={11} className="opacity-40" />
                )}
              </span>
            )}

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 truncate text-[11.5px] text-ink">{s.title}</span>
                {s.chained && (
                  <span
                    className="inline-flex shrink-0 items-center gap-0.5 text-[9px] uppercase tracking-[0.1em] text-accent"
                    title="Rendered from the last frame of the shot above — one unbroken take."
                  >
                    <Icon.Link width={8} height={8} /> same take
                  </span>
                )}
              </span>
              {/* The track stays darker than the panel so an untouched shot
                  reads as empty rather than as a filled bar, and the shot
                  actually in the machine is the brightest line in the list. */}
              {s.error ? (
                <span className="mt-0.5 block text-[10px] leading-snug text-amber-400">{s.error}</span>
              ) : (
                <span className="mt-1.5 block h-[3px] w-full overflow-hidden rounded-full bg-line-soft">
                  <span
                    className={`block h-full rounded-full transition-[width] duration-700 ease-out ${
                      s.status === "rendering" ? "bg-ink" : "bg-ink-muted"
                    }`}
                    style={{ width: `${s.status === "done" ? 100 : s.percent}%` }}
                  />
                </span>
              )}
            </span>

            <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-ink-faint">
              {s.status === "done"
                ? timecode(s.seconds)
                : s.status === "rendering"
                  ? `${s.percent}%`
                  : s.status === "cancelled"
                    ? "stopped"
                    : s.status === "error"
                      ? "failed"
                      : `${s.durationSec}s`}
            </span>
          </li>
        ))}
      </ol>

      {view.error && (
        <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-snug text-amber-400">{view.error}</p>
      )}

      {film && (
        <div className="border-t border-line">
          <video src={film.url} controls playsInline className="block w-full bg-canvas" />
          <div className="flex items-center gap-2 px-3 py-2">
            <p className="min-w-0 flex-1 text-[11px] text-ink-muted">
              {view.doneShots} {view.doneShots === 1 ? "shot" : "shots"}, cut together and saved to your Studio gallery.
            </p>
            {onSave && (
              <button
                type="button"
                onClick={onSave}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink"
              >
                <Icon.Download width={11} height={11} /> Save the file
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
