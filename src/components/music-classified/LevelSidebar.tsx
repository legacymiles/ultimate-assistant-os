"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { LEVELS } from "@/lib/music-classified/levels";
import type { Scope } from "@/lib/music-classified/query";
import type { Song, Tree } from "@/lib/music-classified/types";

interface Props {
  songs: Song[];
  tree: Tree;
  scope: Scope;
  onScope: (s: Scope) => void;
  onAddGenre: (level: number, genre: string) => void;
  onAddSubgenre: (level: number, genre: string, sub: string) => void;
}

function AddInline({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="mcl-addlink">
        <Icon.Plus width={10} height={10} /> {placeholder}
      </button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onAdd(value.trim());
        setValue("");
        setOpen(false);
      }}
      className="mcl-addform"
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => !value.trim() && setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </form>
  );
}

export function LevelSidebar({ songs, tree, scope, onScope, onAddGenre, onAddSubgenre }: Props) {
  const count = (level: number, genre?: string, sub?: string) =>
    songs.filter((s) => s.level === level && (!genre || s.genre === genre) && (!sub || s.subgenre === sub)).length;
  const max = Math.max(1, ...LEVELS.map((l) => count(l.n)));

  return (
    <nav className="pb-4 pt-1">
      <button
        onClick={() => onScope({})}
        className={"mcl-navitem" + (scope.level === undefined ? " is-on" : "")}
      >
        <span className="mcl-navitem__name block truncate">All songs</span>
        <span className="mcl-navitem__n">{songs.length}</span>
      </button>

      <p className="mcl-rail__label">Energy · slow → hype</p>

      {LEVELS.map((lvl) => {
        const n = count(lvl.n);
        const open = scope.level === lvl.n;
        const genres = Object.entries(tree[lvl.n] ?? {});
        return (
          <div key={lvl.n}>
            <button
              onClick={() => onScope(open && !scope.genre ? {} : { level: lvl.n })}
              title={`${lvl.feel} · typically ${lvl.bpm} BPM`}
              style={{ "--h": lvl.hue } as React.CSSProperties}
              className={"mcl-navitem" + (open && !scope.genre ? " is-on" : "")}
            >
              <span
                className="mcl-navitem__chip"
                style={{ background: `hsl(${lvl.hue} 82% ${n ? 64 : 38}%)` }}
              >
                {lvl.n}
              </span>
              <span className="min-w-0 flex-1">
                <span className={"mcl-navitem__name block truncate" + (n ? "" : " is-empty")}>{lvl.name}</span>
                <span className="mcl-navitem__meter">
                  <span style={{ width: `${(n / max) * 100}%` }} />
                </span>
              </span>
              <span className="mcl-navitem__n">{n || ""}</span>
            </button>

            {open && (
              <div className="mcl-navsub">
                {genres.map(([genre, subs]) => {
                  const gOpen = scope.genre === genre;
                  return (
                    <div key={genre}>
                      <button
                        onClick={() => onScope(gOpen && !scope.subgenre ? { level: lvl.n } : { level: lvl.n, genre })}
                        className={"mcl-navsub__item" + (gOpen && !scope.subgenre ? " is-on" : "")}
                      >
                        <Icon.Chevron
                          width={10}
                          height={10}
                          className={"shrink-0 transition " + (gOpen ? "rotate-90" : "")}
                        />
                        <span className="min-w-0 flex-1 truncate">{genre}</span>
                        <span className="mcl-navitem__n">{count(lvl.n, genre) || ""}</span>
                      </button>
                      {gOpen && (
                        <div className="ml-3 border-l pl-1" style={{ borderColor: "var(--color-line-soft)" }}>
                          {subs.map((sub) => (
                            <button
                              key={sub}
                              onClick={() => onScope({ level: lvl.n, genre, subgenre: sub })}
                              className={"mcl-navsub__item" + (scope.subgenre === sub ? " is-on" : "")}
                              style={{ fontSize: "0.74rem" }}
                            >
                              <span className="min-w-0 flex-1 truncate">{sub}</span>
                              <span className="mcl-navitem__n">{count(lvl.n, genre, sub) || ""}</span>
                            </button>
                          ))}
                          <AddInline placeholder="sub-genre" onAdd={(v) => onAddSubgenre(lvl.n, genre, v)} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {!genres.length && <p className="mcl-rail__hint">No playlists yet.</p>}
                <AddInline placeholder="genre playlist" onAdd={(v) => onAddGenre(lvl.n, v)} />
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
