"use client";

import { levelInfo } from "@/lib/music-classified/levels";
import type { SortBy, SortDir } from "@/lib/music-classified/query";
import type { Confidence, Song } from "@/lib/music-classified/types";

/** Level badges, meters and the spectrum all take their colour from `--h`. */
export function levelStyle(hue: number): React.CSSProperties {
  return { "--h": hue } as React.CSSProperties;
}

export function LevelBadge({ level, size = "sm" }: { level: number; size?: "sm" | "lg" }) {
  const info = levelInfo(level);
  return (
    <span
      title={`${info.n} · ${info.name} — ${info.feel}`}
      className={"mcl-badge " + (size === "lg" ? "mcl-badge--lg" : "mcl-badge--sm")}
      style={levelStyle(info.hue)}
    >
      {level}
    </span>
  );
}

export const CONFIDENCE: Record<Confidence, { label: string; color: string; hint: string }> = {
  known: { label: "known", color: "#34d399", hint: "The AI recognises this exact recording" },
  heard: { label: "heard", color: "#38bdf8", hint: "The AI listened to your upload" },
  inferred: { label: "inferred", color: "#fbbf24", hint: "Reasoned from the artist and genre — check it" },
  guess: { label: "guess", color: "#fb7185", hint: "Little to go on — treat the filing as a starting point" },
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
      className={"mcl-star" + (on ? " is-on" : "")}
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
  { key: null, label: "★", className: "w-10" },
  { key: "title", label: "Song", className: "min-w-0" },
  { key: "level", label: "Lvl", className: "w-14" },
  { key: "genre", label: "Genre › sub", className: "hidden w-44 md:table-cell" },
  { key: "bpm", label: "BPM", className: "hidden w-16 sm:table-cell" },
  // Key and Added are the first to go: the panel takes 400px of the stage, and
  // a squeezed Song column is worse than one fewer number.
  { key: null, label: "Key", className: "hidden w-24 xl:table-cell" },
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
  if (!songs.length) return <p className="mcl-empty">{empty}</p>;

  return (
    <table className="mcl-table table-fixed">
      <thead>
        <tr>
          {COLS.map((col) => (
            <th key={col.label} className={col.className}>
              {col.key ? (
                <button onClick={() => onSort(col.key as SortBy)}>
                  {col.label}
                  {sort === col.key && <span style={{ color: "var(--color-brand)" }}>{dir === "asc" ? "↑" : "↓"}</span>}
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
              className={"mcl-row" + (s.id === selectedId ? " is-on" : "")}
            >
              <td className="text-center">
                <StarButton on={Boolean(s.favorite)} onToggle={() => onFavorite(s.id)} label={s.title} />
              </td>
              <td>
                <div className="flex items-center gap-2.5">
                  {s.artwork ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.artwork} alt="" className="mcl-art" loading="lazy" />
                  ) : (
                    <span className="mcl-art mcl-art--none">♪</span>
                  )}
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="mcl-row__title truncate">{s.title}</span>
                      <span
                        className="mcl-conf"
                        style={{ background: conf.color }}
                        title={`${conf.label}: ${conf.hint}`}
                      />
                    </span>
                    <span className="mcl-row__sub truncate">
                      {s.artist || "Unknown artist"}
                      {s.kind === "own" && s.durationSec ? ` · ${fmtDuration(s.durationSec)}` : ""}
                      <span className="md:hidden"> · {s.genre}</span>
                    </span>
                  </span>
                </div>
              </td>
              <td>
                <LevelBadge level={s.level} />
              </td>
              <td className="hidden md:table-cell">
                <span className="mcl-row__genre truncate">{s.genre}</span>
                <span className="mcl-row__subgenre truncate">{s.subgenre}</span>
              </td>
              <td className="hidden sm:table-cell">
                <span className="mcl-row__num">{s.profile.bpm ?? "—"}</span>
              </td>
              <td className="hidden xl:table-cell">
                <span className="mcl-row__num truncate">{s.profile.key || "—"}</span>
              </td>
              <td className="hidden xl:table-cell">
                <span className="mcl-row__faint">{s.addedAt.slice(0, 10)}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
