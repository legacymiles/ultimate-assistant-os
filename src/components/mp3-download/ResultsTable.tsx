"use client";

// Stage 1's answer: every recording the catalogue thinks you might have meant.
// A table, because the columns are the question — five versions of the same
// song differ only by album, year and length, and cards would hide exactly
// those three things.

import { useRef } from "react";
import { formatDuration, releaseYear } from "@/lib/mp3-download/match";
import type { Track } from "@/lib/mp3-download/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { PlayButton } from "./bits";

export function ResultsTable({
  tracks,
  playingId,
  playing,
  loading,
  onPreview,
  onPick,
  pickedId,
}: {
  tracks: Track[];
  playingId: string | null;
  playing: boolean;
  loading: boolean;
  onPreview: (track: Track) => void;
  onPick: (track: Track) => void;
  pickedId: string | null;
}) {
  const rows = useRef<(HTMLTableRowElement | null)[]>([]);

  const move = (from: number, delta: number) => {
    const next = rows.current[from + delta];
    next?.focus();
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            <th scope="col" className="w-10 py-2 pl-3 pr-1" />
            <th scope="col" className="py-2 pr-3 font-semibold">
              Recording
            </th>
            <th scope="col" className="hidden py-2 pr-3 font-semibold md:table-cell">
              Album
            </th>
            <th scope="col" className="w-14 py-2 pr-3 text-right font-semibold">
              Year
            </th>
            <th scope="col" className="w-16 py-2 pr-3 text-right font-semibold">
              Length
            </th>
            <th scope="col" className="w-28 py-2 pr-3" />
          </tr>
        </thead>
        <tbody>
          {tracks.map((t, i) => {
            const isPlaying = playingId === t.id;
            const isPicked = pickedId === t.id;
            return (
              <tr
                key={t.id}
                ref={(el) => {
                  rows.current[i] = el;
                }}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    move(i, 1);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    move(i, -1);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    onPick(t);
                  } else if (e.key === " ") {
                    e.preventDefault();
                    onPreview(t);
                  }
                }}
                className={cn(
                  "group border-b border-line-soft align-middle outline-none transition-colors last:border-0",
                  "hover:bg-panel-2/70 focus-visible:bg-panel-2 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand/70",
                  isPicked && "bg-brand/10",
                )}
              >
                <td className="py-2 pl-3 pr-1">
                  <PlayButton
                    active={isPlaying}
                    playing={isPlaying && playing}
                    loading={isPlaying && loading}
                    onClick={() => onPreview(t)}
                    label={t.title}
                  />
                </td>

                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2.5">
                    {t.artworkUrl ? (
                      // Apple's artwork CDN, not an asset of ours; next/image
                      // would want a remote-pattern allowlist for no gain.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.artworkUrl}
                        alt=""
                        width={36}
                        height={36}
                        loading="lazy"
                        className="h-9 w-9 shrink-0 rounded border border-line object-cover"
                      />
                    ) : (
                      <span className="h-9 w-9 shrink-0 rounded border border-line bg-panel-2" />
                    )}
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold leading-tight text-ink">
                          {t.title}
                        </span>
                        {t.explicit && (
                          <span
                            title="Explicit"
                            className="shrink-0 rounded-sm border border-line px-1 text-[9px] font-bold leading-[14px] text-ink-muted"
                          >
                            E
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-ink-muted">
                        {t.artist}
                      </span>
                    </span>
                  </div>
                </td>

                <td className="hidden max-w-[16rem] truncate py-2 pr-3 text-[12px] text-ink-muted md:table-cell">
                  {t.album || "—"}
                </td>
                <td className="py-2 pr-3 text-right font-mono text-[11.5px] tabular-nums text-ink-muted">
                  {releaseYear(t.releaseDate)}
                </td>
                <td className="py-2 pr-3 text-right font-mono text-[11.5px] tabular-nums text-ink-muted">
                  {formatDuration(t.durationMs)}
                </td>

                <td className="py-2 pr-3 text-right">
                  <button
                    type="button"
                    onClick={() => onPick(t)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-semibold transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
                      isPicked
                        ? "border-brand bg-brand text-white"
                        // Always visible on touch: a control that appears on
                        // hover simply does not exist on a phone.
                        : "border-line bg-panel-2 text-ink-muted hover:border-brand/50 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:focus-visible:opacity-100",
                    )}
                  >
                    {isPicked ? "Confirming" : "This one"}
                    <Icon.ArrowRight width={12} height={12} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
