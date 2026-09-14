"use client";

import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { postJson } from "./api";
import { Prose } from "./Prose";
import { CONFIDENCE, LevelBadge, StarButton } from "./SongTable";
import { allGenres, allSubgenres } from "@/lib/music-classified/classify";
import { LENSES, LEVELS, levelInfo } from "@/lib/music-classified/levels";
import { audioUrl } from "@/lib/music-classified/media";
import { artistsOf } from "@/lib/music-classified/query";
import { fullTree } from "@/lib/music-classified/store";
import type { LensId, Library, Song } from "@/lib/music-classified/types";

interface Props {
  song: Song;
  lib: Library;
  busy: boolean;
  onClose: () => void;
  onPatch: (patch: Partial<Song>) => void;
  onDescriptions: (descriptions: Song["descriptions"]) => void;
  onDelete: () => void;
  onReanalyze: () => void;
}

/** A text field that saves on blur/Enter, so a half-typed genre never becomes a playlist. */
function CommitInput({
  value,
  onCommit,
  list,
  placeholder,
  className = "",
}: {
  value: string;
  onCommit: (v: string) => void;
  list?: string;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onCommit(v);
    else setDraft(value);
  };
  return (
    <input
      value={draft}
      list={list}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      className={
        "w-full rounded-lg border border-line bg-canvas px-2 py-1 text-[13px] text-ink outline-none focus:border-brand " +
        className
      }
    />
  );
}

function Chips({ items }: { items: string[] }) {
  if (!items.length) return <span className="text-ink-faint">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((m) => (
        <span key={m} className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-ink-muted">
          {m}
        </span>
      ))}
    </span>
  );
}

/** Plays an upload from this device's storage; says so plainly when it was uploaded elsewhere. */
function OwnPlayer({ audioId }: { audioId?: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setUrl(undefined);
    if (!audioId) return setUrl(null);
    void audioUrl(audioId).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [audioId]);
  if (url === undefined) return null;
  if (!url)
    return (
      <p className="rounded-lg border border-line-soft px-2 py-1.5 text-[11px] text-ink-faint">
        The audio is saved on the device you uploaded it from — the filing and descriptions are here, the file isn&apos;t.
      </p>
    );
  return <audio controls src={url} className="h-9 w-full" preload="metadata" />;
}

export function SongPanel({ song, lib, busy, onClose, onPatch, onDescriptions, onDelete, onReanalyze }: Props) {
  const own = song.kind === "own";
  const have = LENSES.filter((l) => song.descriptions[l.id]);
  const [tab, setTab] = useState<LensId | null>(have[0]?.id ?? null);
  const [picking, setPicking] = useState<LensId[]>([]);
  const [describing, setDescribing] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notes, setNotes] = useState(song.notes);

  useEffect(() => {
    setTab(LENSES.find((l) => song.descriptions[l.id])?.id ?? null);
    setPicking([]);
    setError("");
    setConfirmDelete(false);
    setNotes(song.notes);
    // Only when a different song opens — not on every edit to this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id]);

  // A description that lands while this song is open (written in parallel
  // after filing) should show without a click.
  useEffect(() => {
    if (!tab || !song.descriptions[tab]) setTab(LENSES.find((l) => song.descriptions[l.id])?.id ?? null);
  }, [song.descriptions, tab]);

  const describe = async () => {
    if (!picking.length) return;
    setDescribing(true);
    setError("");
    try {
      const { descriptions } = await postJson<{ descriptions: Song["descriptions"] }>(
        "/api/music-classified/describe",
        { song, lenses: picking },
      );
      onDescriptions(descriptions);
      setTab(picking.find((id) => descriptions[id]) ?? tab);
      setPicking([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDescribing(false);
    }
  };

  const p = song.profile;
  const conf = CONFIDENCE[song.confidence] ?? CONFIDENCE.guess;
  const info = levelInfo(song.level);
  const tree = fullTree(lib);
  const genres = allGenres(tree);
  const subs = allSubgenres(tree, song.genre);
  const artists = artistsOf(lib.songs.filter((s) => s.kind === "own")).map((a) => a.name);

  return (
    <aside className="flex h-full flex-col">
      <div className="flex shrink-0 items-start gap-3 border-b border-line p-3">
        {song.artwork ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={song.artwork} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-panel-2 text-xl text-ink-faint">♪</span>
        )}
        <div className="min-w-0 flex-1">
          {own ? (
            <div className="space-y-1">
              <CommitInput value={song.title} onCommit={(title) => onPatch({ title })} className="font-semibold" />
              <CommitInput value={song.artist} list="mc-artists" onCommit={(artist) => onPatch({ artist })} />
              <datalist id="mc-artists">{artists.map((a) => <option key={a} value={a} />)}</datalist>
            </div>
          ) : (
            <>
              <h2 className="text-[15px] font-semibold leading-tight text-ink">{song.title}</h2>
              <p className="truncate text-[13px] text-ink-muted">{song.artist || "Unknown artist"}</p>
              <p className="truncate font-mono text-[11px] text-ink-faint">
                {[song.album, song.year, song.sourceGenre].filter(Boolean).join(" · ")}
              </p>
            </>
          )}
        </div>
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
            aria-label="Close"
          >
            <Icon.Close width={14} height={14} />
          </button>
          <StarButton on={Boolean(song.favorite)} onToggle={() => onPatch({ favorite: !song.favorite })} label={song.title} />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {own && (
          <section className="space-y-1">
            <OwnPlayer audioId={song.audioId} />
            {song.fileName && <p className="truncate font-mono text-[10px] text-ink-faint">{song.fileName}</p>}
          </section>
        )}

        {/* Filing */}
        <section>
          <div className="mb-1.5 flex items-center gap-2">
            <LevelBadge level={song.level} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">
                Level {song.level} · {info.name}
              </p>
              <p className="flex items-center gap-1.5 font-mono text-[10px] text-ink-faint" title={conf.hint}>
                <span className={"h-1.5 w-1.5 rounded-full " + conf.className} />
                {conf.label}
                {song.filedBy === "offline" && " · filed offline"}
              </p>
            </div>
          </div>
          <div className="mb-2 grid grid-cols-10 gap-0.5" role="radiogroup" aria-label="Energy level">
            {LEVELS.map((l) => (
              <button
                key={l.n}
                role="radio"
                aria-checked={song.level === l.n}
                title={`${l.n} · ${l.name}`}
                onClick={() => onPatch({ level: l.n })}
                className="h-6 rounded font-mono text-[11px] font-semibold transition"
                style={{
                  background: song.level === l.n ? `hsl(${l.hue} 80% 66%)` : `hsl(${l.hue} 40% 50% / 0.15)`,
                  color: song.level === l.n ? "rgba(0,0,0,.8)" : `hsl(${l.hue} 70% 70%)`,
                }}
              >
                {l.n}
              </button>
            ))}
          </div>
          {song.levelReason && <p className="mb-2 text-[12px] italic text-ink-muted">{song.levelReason}</p>}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-widest text-ink-faint">Genre</span>
              <CommitInput value={song.genre} list="mc-genres" onCommit={(genre) => onPatch({ genre })} />
            </label>
            <label className="block">
              <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-widest text-ink-faint">Sub-genre</span>
              <CommitInput value={song.subgenre} list="mc-subs" onCommit={(subgenre) => onPatch({ subgenre })} />
            </label>
          </div>
          <datalist id="mc-genres">{genres.map((g) => <option key={g} value={g} />)}</datalist>
          <datalist id="mc-subs">{subs.map((s) => <option key={s} value={s} />)}</datalist>
        </section>

        {/* Sound profile */}
        <section>
          <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">How it sounds</h3>
          <dl className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1.5 text-[12px]">
            <dt className="text-ink-faint">Tempo</dt>
            <dd className="text-ink">
              {p.bpm ? `${p.bpm} BPM` : "—"}
              {song.measured && (
                <span className="ml-1.5 font-mono text-[10px] text-emerald-300" title="Measured from the audio in your browser">
                  measured {song.measured.bpm}
                </span>
              )}
            </dd>
            <dt className="text-ink-faint">Key</dt>
            <dd className="text-ink">{p.key || "—"}</dd>
            {p.energy !== null && (
              <>
                <dt className="text-ink-faint">Energy</dt>
                <dd className="flex items-center gap-2">
                  <span className="h-1 flex-1 rounded bg-panel-2">
                    <span
                      className="block h-full rounded"
                      style={{ width: `${p.energy}%`, background: `hsl(${info.hue} 80% 62%)` }}
                    />
                  </span>
                  <span className="font-mono text-[11px] text-ink-muted">{p.energy}</span>
                </dd>
              </>
            )}
            <dt className="text-ink-faint">Mood</dt>
            <dd><Chips items={p.mood} /></dd>
            <dt className="text-ink-faint">Instruments</dt>
            <dd><Chips items={p.instruments} /></dd>
            {p.vocals && (<><dt className="text-ink-faint">Vocals</dt><dd className="text-ink-muted">{p.vocals}</dd></>)}
            {p.production && (<><dt className="text-ink-faint">Production</dt><dd className="text-ink-muted">{p.production}</dd></>)}
            {p.era && (<><dt className="text-ink-faint">Era</dt><dd className="text-ink-muted">{p.era}</dd></>)}
            {p.similarArtists.length > 0 && (<><dt className="text-ink-faint">Sounds like</dt><dd><Chips items={p.similarArtists} /></dd></>)}
            {song.measured && (
              <>
                <dt className="text-ink-faint">Measured</dt>
                <dd className="font-mono text-[11px] text-ink-muted">
                  {[song.measured.key, song.measured.percussion, song.measured.brightness, song.measured.dynamics].join(" · ")}
                </dd>
              </>
            )}
          </dl>
          {song.tags.length > 0 && (
            <div className="mt-2">
              <Chips items={song.tags} />
            </div>
          )}
        </section>

        {/* Descriptions */}
        <section>
          <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">Descriptions</h3>
          {have.length > 0 ? (
            <>
              <div className="mb-2 flex flex-wrap gap-1">
                {have.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setTab(l.id)}
                    className={
                      "rounded-md px-2 py-0.5 text-[11px] transition " +
                      (tab === l.id ? "bg-brand text-white" : "bg-panel-2 text-ink-muted hover:text-ink")
                    }
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              {tab && song.descriptions[tab] && <Prose text={song.descriptions[tab]!} />}
            </>
          ) : (
            <p className="text-[12px] text-ink-faint">No descriptions yet — pick a way to describe it below.</p>
          )}

          <div className="mt-3 rounded-lg border border-line-soft p-2">
            <p className="mb-1.5 text-[11px] text-ink-faint">
              Describe it another way (or rewrite one){own ? " — written from the sound profile above" : ""}:
            </p>
            <div className="flex flex-wrap gap-1">
              {LENSES.map((l) => {
                const on = picking.includes(l.id);
                return (
                  <button
                    key={l.id}
                    title={l.hint}
                    onClick={() => setPicking(on ? picking.filter((x) => x !== l.id) : [...picking, l.id])}
                    className={
                      "rounded-md border px-2 py-0.5 text-[11px] transition " +
                      (on ? "border-brand bg-brand/15 text-ink" : "border-line text-ink-muted hover:text-ink") +
                      (song.descriptions[l.id] ? " italic" : "")
                    }
                  >
                    {song.descriptions[l.id] ? "↻ " : "+ "}
                    {l.label}
                  </button>
                );
              })}
            </div>
            {picking.length > 0 && (
              <button
                onClick={describe}
                disabled={describing}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1 text-[12px] font-semibold text-white transition hover:bg-brand-2 disabled:opacity-50"
              >
                <Icon.Sparkles width={11} height={11} />
                {describing ? "Writing…" : `Describe (${picking.length})`}
              </button>
            )}
            {error && <p className="mt-1.5 text-[12px] text-rose-300">{error}</p>}
          </div>
        </section>

        {/* Notes */}
        <section>
          <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">Your notes</h3>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== song.notes && onPatch({ notes })}
            rows={3}
            placeholder={own ? "What's working, what to fix in the next version…" : "What you love about it, the part to steal…"}
            className="w-full resize-y rounded-lg border border-line bg-canvas px-2 py-1.5 text-[13px] text-ink outline-none focus:border-brand"
          />
        </section>

        {song.links.length > 0 && (
          <section>
            <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">Links</h3>
            {song.links.map((l) => (
              <a
                key={l}
                href={l}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 truncate py-0.5 font-mono text-[11px] text-ink-muted transition hover:text-brand"
              >
                <Icon.Link width={10} height={10} className="shrink-0" />
                <span className="truncate">{l.replace(/^https?:\/\/(www\.)?/, "")}</span>
              </a>
            ))}
          </section>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line p-2">
        <button
          onClick={onReanalyze}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-muted transition hover:text-ink disabled:opacity-50"
          title={own ? "Have the AI listen to the file again" : "Look it up again and re-file"}
        >
          <Icon.Refresh width={12} height={12} />
          {own ? "Listen again" : "Re-analyze"}
        </button>
        <span className="flex-1" />
        <button
          onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
          className={
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] transition " +
            (confirmDelete
              ? "border-rose-500/30 bg-rose-500/10 font-semibold text-rose-300"
              : "border-line text-ink-muted hover:text-rose-300")
          }
        >
          <Icon.Trash width={12} height={12} />
          {confirmDelete ? "Really delete?" : "Delete"}
        </button>
      </div>
    </aside>
  );
}
