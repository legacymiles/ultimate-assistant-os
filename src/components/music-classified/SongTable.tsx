"use client";

import { levelInfo } from "@/lib/music-classified/levels";
import type { SortBy, SortDir } from "@/lib/music-classified/query";
import type { Confidence, Song } from "@/lib/music-classified/types";

export function LevelBadge({ level, size = "sm" }: { level: number; size?: "sm" | "lg" }) {
  const info = levelInfo(level);
  return (
    <span
      title={`${info.n} · ${info.name} — ${info.feel}`}
      className={
        "inline-grid shrink-0 place-items-center rounded-md font-mono font-bold text-black/80 " +
        (size === "lg" ? "h-9 w-9 text-[16px]" : "h-5 w-5 text-[11px]")
      }
      style={{ background: `hsl(${info.hue} 80% 66%)` }}
    >
      {level}
    </span>
  );
}

export const CONFIDENCE: Record<Confidence, { label: string; className: string; hint: string }> = {
  known: { label: "known", className: "bg-emerald-400", hint: "The AI recognises this exact recording" },
  heard: { label: "heard", className: "bg-sky-400", hint: "The AI listened to your upload" },
  inferred: { label: "inferred", className: "bg-amber-400", hint: "Reasoned from the artist and genre — check it" },
  guess: { label: "guess", className: "bg-rose-400", hint: "Little to go on — treat the filing as a starting point" },
};

export function StarButton({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={on}
      aria-label={on ? `Remove ${label} from favorites` : `Add ${label} to favorites`}
      title={on ? "Favorite — click to remove" : "Add to favorites"}
      className={
        "grid h-6 w-6 place-items-center rounded text-[15px] leading-none transition " +
        (on ? "text-amber-300" : "text-ink-faint/50 hover:text-amber-300")
      }
    >
      {on ? "★" : "☆"}
    </button>
  );
}

function fmtDuration(sec?: number): string {
  if (!sec) return "";
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

const COLS: { key: SortBy | null; label: string; className: string }[] = [
  { key: null, label: "★", className: "w-8" },
  { key: "title", label: "Song", className: "min-w-0" },
  { key: "level", label: "Lvl", className: "w-12" },
  { key: "genre", label: "Genre › sub", className: "hidden w-44 md:table-cell" },
  { key: "bpm", label: "BPM", className: "hidden w-14 sm:table-cell" },
  { key: null, label: "Key", className: "hidden w-24 lg:table-cell" },
  { key: "added", label: "Added", className: "hidden w-24 xl:table-cell" },
];

interface Props {
  songs: Song[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFavorite: (id: string) => void;
  sort: SortBy;
  dir: SortDir;
  onSort: (by: SortBy) => void;
  empty: string;
}

export function SongTable({ songs, selectedId, onSelect, onFavorite, sort, dir, onSort, empty }: Props) {
  if (!songs.length) return <p className="px-4 py-20 text-center text-sm text-ink-muted">{empty}</p>;

  return (
    <table className="w-full table-fixed border-collapse text-[13px]">
      <thead className="sticky top-0 z-10 bg-canvas">
        <tr className="border-b border-line">
          {COLS.map((col) => (
            <th
              key={col.label}
              className={
                "px-2 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-widest text-ink-faint " +
                col.className
              }
            >
              {col.key ? (
                <button
                  onClick={() => onSort(col.key as SortBy)}
                  className="inline-flex items-center gap-1 transition hover:text-ink"
                >
                  {col.label}
                  {sort === col.key && <span className="text-brand">{dir === "asc" ? "↑" : "↓"}</span>}
                </button>
              ) : (
                col.label
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {songs.map((s) => {
          const conf = CONFIDENCE[s.confidence] ?? CONFIDENCE.guess;
          return (
            <tr
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={
                "cursor-pointer border-b border-line-soft transition " +
                (s.id === selectedId ? "bg-brand/10" : "hover:bg-panel-2/70")
              }
            >
              <td className="px-1 py-1">
                <StarButton on={Boolean(s.favorite)} onToggle={() => onFavorite(s.id)} label={s.title} />
              </td>
              <td className="min-w-0 px-2 py-1">
                <div className="flex items-center gap-2">
                  {s.artwork ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.artwork} alt="" className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" />
                  ) : (
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-panel-2 text-ink-faint">♪</span>
                  )}
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-ink">{s.title}</span>
                      <span
                        className={"h-1.5 w-1.5 shrink-0 rounded-full " + conf.className}
                        title={`${conf.label}: ${conf.hint}`}
                      />
                    </span>
                    <span className="block truncate text-[12px] text-ink-faint">
                      {s.artist || "Unknown artist"}
                      {s.kind === "own" && s.durationSec ? ` · ${fmtDuration(s.durationSec)}` : ""}
                      <span className="md:hidden"> · {s.genre}</span>
                    </span>
                  </span>
                </div>
              </td>
              <td className="px-2 py-1">
                <LevelBadge level={s.level} />
              </td>
              <td className="hidden px-2 py-1 md:table-cell">
                <span className="block truncate text-[12px] text-ink-muted">{s.genre}</span>
                <span className="block truncate font-mono text-[10px] text-ink-faint">{s.subgenre}</span>
              </td>
              <td className="hidden px-2 py-1 font-mono text-[12px] tabular-nums text-ink-muted sm:table-cell">
                {s.profile.bpm ?? "—"}
              </td>
              <td className="hidden truncate px-2 py-1 font-mono text-[11px] text-ink-muted lg:table-cell">
                {s.profile.key || "—"}
              </td>
              <td className="hidden px-2 py-1 font-mono text-[11px] text-ink-faint xl:table-cell">
                {s.addedAt.slice(0, 10)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
