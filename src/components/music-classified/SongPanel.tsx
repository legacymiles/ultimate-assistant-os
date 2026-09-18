"use client";

import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { postJson } from "./api";
import { Prose } from "./Prose";
import { CONFIDENCE, LevelBadge, StarButton, levelStyle } from "./SongTable";
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
  style,
}: {
  value: string;
  onCommit: (v: string) => void;
  list?: string;
  placeholder?: string;
  style?: React.CSSProperties;
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
      className="mcl-input"
      style={style}
    />
  );
}

function Chips({ items }: { items: string[] }) {
  if (!items.length) return <span className="mcl-muted">—</span>;
  return (
    <span className="mcl-chips">
      {items.map((m) => (
        <span key={m} className="mcl-chip">
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
      <p className="mcl-note">
        The audio is saved on the device you uploaded it from — the filing and descriptions are here, the file isn&apos;t.
      </p>
    );
  return <audio controls src={url} style={{ width: "100%", height: 36 }} preload="metadata" />;
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
    <aside className="flex min-h-0 flex-1 flex-col">
      <div className="mcl-panel__head">
        {song.artwork ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={song.artwork} alt="" className="mcl-panel__art" />
        ) : (
          <span className="mcl-panel__art mcl-art--none">♪</span>
        )}
        <div className="min-w-0 flex-1">
          {own ? (
            <div className="flex flex-col gap-1.5">
              <CommitInput
                value={song.title}
                onCommit={(title) => onPatch({ title })}
                style={{ fontWeight: 600, fontSize: "0.9rem" }}
              />
              <CommitInput value={song.artist} list="mc-artists" onCommit={(artist) => onPatch({ artist })} />
              <datalist id="mc-artists">{artists.map((a) => <option key={a} value={a} />)}</datalist>
            </div>
          ) : (
            <>
              <h2 className="mcl-scope__name" style={{ fontSize: "1.02rem" }}>
                {song.title}
              </h2>
              <p className="mcl-row__sub" style={{ fontSize: "0.8rem" }}>
                {song.artist || "Unknown artist"}
              </p>
              <p className="mcl-row__faint truncate">
                {[song.album, song.year, song.sourceGenre].filter(Boolean).join(" · ")}
              </p>
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <button onClick={onClose} className="mcl-iconbtn" aria-label="Close">
            <Icon.Close width={14} height={14} />
          </button>
          <StarButton on={Boolean(song.favorite)} onToggle={() => onPatch({ favorite: !song.favorite })} label={song.title} />
        </div>
      </div>

      <div className="mcl-panel__body mcl-scroll">
        {own && (
          <div className="mcl-card">
            <OwnPlayer audioId={song.audioId} />
            {song.fileName && (
              <p className="mcl-row__faint truncate" style={{ marginTop: "0.4rem" }}>
                {song.fileName}
              </p>
            )}
          </div>
        )}

        {/* Filing */}
        <section className="mcl-card">
          <span className="mcl-card__label">Filed as</span>
          <div className="mb-2.5 flex items-center gap-2.5">
            <LevelBadge level={song.level} size="lg" />
            <div className="min-w-0 flex-1">
              <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--color-ink)" }}>
                Level {song.level} · {info.name}
              </p>
              <p
                className="mcl-row__faint"
                style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
                title={conf.hint}
              >
                <span className="mcl-conf" style={{ background: conf.color }} />
                {conf.label}
                {song.filedBy === "offline" && " · filed offline"}
              </p>
            </div>
          </div>

          <div className="mcl-radio" role="radiogroup" aria-label="Energy level">
            {LEVELS.map((l) => (
              <button
                key={l.n}
                role="radio"
                aria-checked={song.level === l.n}
                title={`${l.n} · ${l.name}`}
                onClick={() => onPatch({ level: l.n })}
                style={levelStyle(l.hue)}
              >
                {l.n}
              </button>
            ))}
          </div>

          {song.levelReason && (
            <p style={{ marginTop: "0.6rem", fontSize: "0.78rem", fontStyle: "italic", color: "var(--color-ink-muted)" }}>
              {song.levelReason}
            </p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mcl-flabel">Genre</span>
              <CommitInput value={song.genre} list="mc-genres" onCommit={(genre) => onPatch({ genre })} />
            </label>
            <label className="block">
              <span className="mcl-flabel">Sub-genre</span>
              <CommitInput value={song.subgenre} list="mc-subs" onCommit={(subgenre) => onPatch({ subgenre })} />
            </label>
          </div>
          <datalist id="mc-genres">{genres.map((g) => <option key={g} value={g} />)}</datalist>
          <datalist id="mc-subs">{subs.map((s) => <option key={s} value={s} />)}</datalist>
        </section>

        {/* Sound profile */}
        <section className="mcl-card">
          <span className="mcl-card__label">How it sounds</span>
          <dl className="mcl-facts">
            <dt>Tempo</dt>
            <dd>
              {p.bpm ? `${p.bpm} BPM` : "—"}
              {song.measured && (
                <span
                  style={{ marginLeft: "0.4rem", fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "#6ee7b7" }}
                  title="Measured from the audio in your browser"
                >
                  measured {song.measured.bpm}
                </span>
              )}
            </dd>
            <dt>Key</dt>
            <dd>{p.key || "—"}</dd>
            {p.energy !== null && (
              <>
                <dt>Energy</dt>
                <dd className="flex items-center gap-2">
                  <span className="mcl-meter">
                    <span style={{ width: `${p.energy}%`, background: `hsl(${info.hue} 82% 62%)` }} />
                  </span>
                  <span className="mcl-row__num">{p.energy}</span>
                </dd>
              </>
            )}
            <dt>Mood</dt>
            <dd>
              <Chips items={p.mood} />
            </dd>
            <dt>Instruments</dt>
            <dd>
              <Chips items={p.instruments} />
            </dd>
            {p.vocals && (
              <>
                <dt>Vocals</dt>
                <dd style={{ color: "var(--color-ink-muted)" }}>{p.vocals}</dd>
              </>
            )}
            {p.production && (
              <>
                <dt>Production</dt>
                <dd style={{ color: "var(--color-ink-muted)" }}>{p.production}</dd>
              </>
            )}
            {p.era && (
              <>
                <dt>Era</dt>
                <dd style={{ color: "var(--color-ink-muted)" }}>{p.era}</dd>
              </>
            )}
            {p.similarArtists.length > 0 && (
              <>
                <dt>Sounds like</dt>
                <dd>
                  <Chips items={p.similarArtists} />
                </dd>
              </>
            )}
            {song.measured && (
              <>
                <dt>Measured</dt>
                <dd className="mcl-row__faint">
                  {[song.measured.key, song.measured.percussion, song.measured.brightness, song.measured.dynamics].join(" · ")}
                </dd>
              </>
            )}
          </dl>
          {song.tags.length > 0 && (
            <div style={{ marginTop: "0.6rem" }}>
              <Chips items={song.tags} />
            </div>
          )}
        </section>

        {/* Descriptions */}
        <section className="mcl-card">
          <span className="mcl-card__label">Descriptions</span>
          {have.length > 0 ? (
            <>
              <div className="mb-2 flex flex-wrap gap-1">
                {have.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setTab(l.id)}
                    className={"mcl-tagbtn" + (tab === l.id ? " is-on" : "")}
                    style={tab === l.id ? { background: "var(--color-brand)", color: "#fff", borderColor: "transparent" } : undefined}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              {tab && song.descriptions[tab] && <Prose text={song.descriptions[tab]!} />}
            </>
          ) : (
            <p style={{ fontSize: "0.78rem", color: "var(--color-ink-faint)" }}>
              No descriptions yet — pick a way to describe it below.
            </p>
          )}

          <div className="mcl-note" style={{ marginTop: "0.75rem", background: "transparent" }}>
            <p style={{ marginBottom: "0.5rem" }}>
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
                    className={"mcl-tagbtn" + (on ? " is-on" : "")}
                    style={song.descriptions[l.id] ? { fontStyle: "italic" } : undefined}
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
                className="mcl-btn mcl-btn--primary mcl-btn--sm"
                style={{ marginTop: "0.6rem" }}
              >
                <Icon.Sparkles width={11} height={11} />
                {describing ? "Writing…" : `Describe (${picking.length})`}
              </button>
            )}
            {error && <p className="mcl-error" style={{ marginTop: "0.4rem" }}>{error}</p>}
          </div>
        </section>

        {/* Notes */}
        <section className="mcl-card">
          <span className="mcl-card__label">Your notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== song.notes && onPatch({ notes })}
            rows={3}
            placeholder={own ? "What's working, what to fix in the next version…" : "What you love about it, the part to steal…"}
            className="mcl-textarea"
          />
        </section>

        {song.links.length > 0 && (
          <section className="mcl-card">
            <span className="mcl-card__label">Links</span>
            {song.links.map((l) => (
              <a
                key={l}
                href={l}
                target="_blank"
                rel="noreferrer"
                className="mcl-row__faint flex items-center gap-1.5 truncate"
                style={{ padding: "0.15rem 0", display: "flex" }}
              >
                <Icon.Link width={10} height={10} className="shrink-0" />
                <span className="truncate">{l.replace(/^https?:\/\/(www\.)?/, "")}</span>
              </a>
            ))}
          </section>
        )}
      </div>

      <div className="mcl-panel__foot">
        <button
          onClick={onReanalyze}
          disabled={busy}
          className="mcl-btn mcl-btn--sm"
          title={own ? "Have the AI listen to the file again" : "Look it up again and re-file"}
        >
          <Icon.Refresh width={12} height={12} />
          {own ? "Listen again" : "Re-analyze"}
        </button>
        <span className="flex-1" />
        <button
          onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
          className="mcl-btn mcl-btn--sm"
          style={
            confirmDelete
              ? { borderColor: "rgba(244,63,94,.4)", background: "rgba(244,63,94,.14)", color: "#fda4af", fontWeight: 600 }
              : undefined
          }
        >
          <Icon.Trash width={12} height={12} />
          {confirmDelete ? "Really delete?" : "Delete"}
        </button>
      </div>
    </aside>
  );
}
