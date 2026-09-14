"use client";

import { LEVELS } from "@/lib/music-classified/levels";
import { artistsOf, inScope, type Scope } from "@/lib/music-classified/query";
import type { Song } from "@/lib/music-classified/types";

interface Props {
  songs: Song[];
  scope: Scope;
  onScope: (s: Scope) => void;
}

/** A stable colour per artist, so the same name always reads the same. */
function artistHue(name: string): number {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** My Music: artists first, then the energy levels that artist's songs sit at. */
export function ArtistSidebar({ songs, scope, onScope }: Props) {
  const artists = artistsOf(songs);
  return (
    <nav className="h-full overflow-y-auto py-2 text-[13px]">
      <button
        onClick={() => onScope({})}
        className={
          "mx-2 mb-1 flex w-[calc(100%-1rem)] items-center justify-between rounded-lg px-2 py-1.5 transition " +
          (!scope.artist ? "bg-brand/15 text-ink" : "text-ink-muted hover:bg-panel-2")
        }
      >
        <span className="font-medium">All my music</span>
        <span className="font-mono text-[11px] text-ink-faint">{songs.length}</span>
      </button>

      <p className="px-4 pb-1 pt-3 font-mono text-[10px] uppercase tracking-widest text-ink-faint">Artists</p>

      {artists.map((a) => {
        const open = scope.artist?.toLowerCase() === a.name.toLowerCase();
        const mine = inScope(songs, { artist: a.name });
        const hue = artistHue(a.name);
        return (
          <div key={a.name} className="mx-2">
            <button
              onClick={() => onScope(open && scope.level === undefined ? {} : { artist: a.name })}
              className={
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition " +
                (open && scope.level === undefined ? "bg-brand/15" : "hover:bg-panel-2")
              }
            >
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-black/80"
                style={{ background: `hsl(${hue} 70% 68%)` }}
              >
                {a.name[0]?.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">{a.name}</span>
              <span className="font-mono text-[11px] text-ink-faint">{a.count}</span>
            </button>
            {open && (
              <div className="animate-fade-in mb-1 ml-5 border-l border-line-soft pl-1.5">
                {LEVELS.map((l) => {
                  const n = mine.filter((s) => s.level === l.n).length;
                  if (!n) return null;
                  return (
                    <button
                      key={l.n}
                      onClick={() => onScope(scope.level === l.n ? { artist: a.name } : { artist: a.name, level: l.n })}
                      className={
                        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] transition " +
                        (scope.level === l.n ? "bg-brand/15 text-ink" : "text-ink-muted hover:bg-panel-2")
                      }
                    >
                      <span
                        className="grid h-4 w-4 place-items-center rounded font-mono text-[10px] font-bold text-black/80"
                        style={{ background: `hsl(${l.hue} 80% 66%)` }}
                      >
                        {l.n}
                      </span>
                      <span className="flex-1 truncate">{l.name}</span>
                      <span className="font-mono text-[10px] text-ink-faint">{n}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {!artists.length && (
        <p className="px-4 py-2 text-[12px] leading-relaxed text-ink-faint">
          Upload songs to start — each one is filed under its artist, then by energy level.
        </p>
      )}
    </nav>
  );
}
