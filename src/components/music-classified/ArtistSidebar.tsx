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
    <nav className="pb-4 pt-1">
      <button onClick={() => onScope({})} className={"mcl-navitem" + (!scope.artist ? " is-on" : "")}>
        <span className="mcl-navitem__name block truncate">All my music</span>
        <span className="mcl-navitem__n">{songs.length}</span>
      </button>

      <p className="mcl-rail__label">Artists</p>

      {artists.map((a) => {
        const open = scope.artist?.toLowerCase() === a.name.toLowerCase();
        const mine = inScope(songs, { artist: a.name });
        const hue = artistHue(a.name);
        return (
          <div key={a.name}>
            <button
              onClick={() => onScope(open && scope.level === undefined ? {} : { artist: a.name })}
              className={"mcl-navitem" + (open && scope.level === undefined ? " is-on" : "")}
            >
              <span
                className="mcl-navitem__avatar"
                style={{ background: `hsl(${hue} 70% 68%)` }}
                aria-hidden
              >
                {a.name[0]?.toUpperCase()}
              </span>
              <span className="mcl-navitem__name block truncate">{a.name}</span>
              <span className="mcl-navitem__n">{a.count}</span>
            </button>

            {open && (
              <div className="mcl-navsub">
                {LEVELS.map((l) => {
                  const n = mine.filter((s) => s.level === l.n).length;
                  if (!n) return null;
                  return (
                    <button
                      key={l.n}
                      onClick={() => onScope(scope.level === l.n ? { artist: a.name } : { artist: a.name, level: l.n })}
                      className={"mcl-navsub__item" + (scope.level === l.n ? " is-on" : "")}
                    >
                      <span
                        className="grid h-4 w-4 shrink-0 place-items-center rounded font-mono text-[0.6rem] font-bold text-black/80"
                        style={{ background: `hsl(${l.hue} 82% 64%)` }}
                      >
                        {l.n}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{l.name}</span>
                      <span className="mcl-navitem__n">{n}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {!artists.length && (
        <p className="mcl-rail__hint">
          Upload songs to start — each one is filed under its artist, then by energy level.
        </p>
      )}
    </nav>
  );
}
