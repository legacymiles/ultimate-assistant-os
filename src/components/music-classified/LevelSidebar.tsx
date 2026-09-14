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
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] text-ink-faint transition hover:text-brand"
      >
        <Icon.Plus width={9} height={9} /> {placeholder}
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
      className="px-2 py-0.5"
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => !value.trim() && setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder={placeholder}
        className="w-full rounded border border-line bg-canvas px-1.5 py-0.5 text-[12px] text-ink outline-none focus:border-brand"
      />
    </form>
  );
}

export function LevelSidebar({ songs, tree, scope, onScope, onAddGenre, onAddSubgenre }: Props) {
  const count = (level: number, genre?: string, sub?: string) =>
    songs.filter((s) => s.level === level && (!genre || s.genre === genre) && (!sub || s.subgenre === sub)).length;
  const max = Math.max(1, ...LEVELS.map((l) => count(l.n)));

  return (
    <nav className="h-full overflow-y-auto py-2 text-[13px]">
      <button
        onClick={() => onScope({})}
        className={
          "mx-2 mb-1 flex w-[calc(100%-1rem)] items-center justify-between rounded-lg px-2 py-1.5 transition " +
          (scope.level === undefined ? "bg-brand/15 text-ink" : "text-ink-muted hover:bg-panel-2")
        }
      >
        <span className="font-medium">All songs</span>
        <span className="font-mono text-[11px] text-ink-faint">{songs.length}</span>
      </button>

      <p className="px-4 pb-1 pt-3 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
        Energy · slow → hype
      </p>

      {LEVELS.map((lvl) => {
        const n = count(lvl.n);
        const open = scope.level === lvl.n;
        const genres = Object.entries(tree[lvl.n] ?? {});
        return (
          <div key={lvl.n} className="mx-2">
            <button
              onClick={() => onScope(open && !scope.genre ? {} : { level: lvl.n })}
              title={`${lvl.feel} · typically ${lvl.bpm} BPM`}
              className={
                "group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition " +
                (open && !scope.genre ? "bg-brand/15" : "hover:bg-panel-2")
              }
            >
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md font-mono text-[12px] font-bold text-black/80"
                style={{ background: `hsl(${lvl.hue} 80% ${n ? 66 : 40}%)` }}
              >
                {lvl.n}
              </span>
              <span className="min-w-0 flex-1">
                <span className={"block truncate " + (n ? "text-ink" : "text-ink-faint")}>{lvl.name}</span>
                <span className="mt-0.5 block h-0.5 rounded bg-line-soft">
                  <span
                    className="block h-full rounded"
                    style={{ width: `${(n / max) * 100}%`, background: `hsl(${lvl.hue} 80% 62%)` }}
                  />
                </span>
              </span>
              <span className="font-mono text-[11px] text-ink-faint">{n || ""}</span>
            </button>

            {open && (
              <div className="animate-fade-in mb-1 ml-5 border-l border-line-soft pl-1.5">
                {genres.map(([genre, subs]) => {
                  const gOpen = scope.genre === genre;
                  return (
                    <div key={genre}>
                      <button
                        onClick={() => onScope(gOpen && !scope.subgenre ? { level: lvl.n } : { level: lvl.n, genre })}
                        className={
                          "flex w-full items-center justify-between rounded-md px-2 py-1 text-left transition " +
                          (gOpen && !scope.subgenre ? "bg-brand/15 text-ink" : "text-ink-muted hover:bg-panel-2")
                        }
                      >
                        <span className="flex min-w-0 items-center gap-1">
                          <Icon.Chevron
                            width={9}
                            height={9}
                            className={"shrink-0 transition " + (gOpen ? "rotate-90" : "")}
                          />
                          <span className="truncate">{genre}</span>
                        </span>
                        <span className="font-mono text-[10px] text-ink-faint">{count(lvl.n, genre) || ""}</span>
                      </button>
                      {gOpen && (
                        <div className="ml-3 border-l border-line-soft pl-1">
                          {subs.map((sub) => (
                            <button
                              key={sub}
                              onClick={() => onScope({ level: lvl.n, genre, subgenre: sub })}
                              className={
                                "flex w-full items-center justify-between rounded-md px-2 py-0.5 text-left text-[12px] transition " +
                                (scope.subgenre === sub ? "bg-brand/15 text-ink" : "text-ink-muted hover:bg-panel-2")
                              }
                            >
                              <span className="truncate">{sub}</span>
                              <span className="font-mono text-[10px] text-ink-faint">
                                {count(lvl.n, genre, sub) || ""}
                              </span>
                            </button>
                          ))}
                          <AddInline placeholder="sub-genre" onAdd={(v) => onAddSubgenre(lvl.n, genre, v)} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {!genres.length && (
                  <p className="px-2 py-1 text-[11px] text-ink-faint">No playlists yet.</p>
                )}
                <AddInline placeholder="genre playlist" onAdd={(v) => onAddGenre(lvl.n, v)} />
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
