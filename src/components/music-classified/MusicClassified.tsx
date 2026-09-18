"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { ArtistSidebar } from "./ArtistSidebar";
import { BlueprintBox } from "./BlueprintBox";
import { LensPicker } from "./LensPicker";
import { LevelSidebar } from "./LevelSidebar";
import { SongPanel } from "./SongPanel";
import { SongTable } from "./SongTable";
import { describe, fileIdentity, identify, postJson, STEP_LABEL, type Step } from "./api";
import * as store from "@/lib/music-classified/store";
import { LENSES, LEVELS, levelInfo } from "@/lib/music-classified/levels";
import { deleteAudio, getAudio, putAudio } from "@/lib/music-classified/media";
import { analyzeUpload } from "@/lib/music-classified/measure";
import { artistsOf, inScope, scopeKey, searchSongs, sortSongs } from "@/lib/music-classified/query";
import type { Scope, SortBy, SortDir } from "@/lib/music-classified/query";
import { titleFromFile } from "@/lib/music-classified/wav";
import type { Identity } from "@/lib/music-classified/identify";
import type { ClassifyResult, LensId, Library, Song } from "@/lib/music-classified/types";
import { useRemotePull } from "@/lib/sync/useSync";

const EMPTY: Library = { songs: [], tree: {}, blueprints: [], defaultLenses: [] };

type Tab = "library" | "mine";
const TAB_KEY = "music-classified:tab";
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|aiff?|webm)$/i;

/** A hue-carrying style object, so one CSS rule can colour every level swatch. */
function hueStyle(hue: number): React.CSSProperties {
  return { "--h": hue } as React.CSSProperties;
}

export function MusicClassified() {
  const [lib, setLib] = useState<Library>(EMPTY);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("library");
  const [favOnly, setFavOnly] = useState(false);
  const [scope, setScope] = useState<Scope>({});
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortBy>("added");
  const [dir, setDir] = useState<SortDir>("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [flash, setFlash] = useState("");
  const [input, setInput] = useState("");
  const [artistInput, setArtistInput] = useState("");
  const [lenses, setLenses] = useState<LensId[]>([]);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");
  const [alts, setAlts] = useState<{ songId: string; options: Identity[] } | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [queue, setQueue] = useState<{ done: number; total: number; current: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const l = store.getLibrary();
    setLib(l);
    setLenses(l.defaultLenses);
    try {
      if (window.localStorage.getItem(TAB_KEY) === "mine") setTab("mine");
    } catch {
      /* storage blocked — start on the library */
    }
    setReady(true);
    return () => abort.current?.abort();
  }, []);

  useRemotePull(store.KEY, () => {
    const l = store.getLibrary();
    setLib(l);
    setLenses(l.defaultLenses);
  });

  useEffect(() => {
    if (!flash || alts) return;
    const t = setTimeout(() => setFlash(""), 8000);
    return () => clearTimeout(t);
  }, [flash, alts]);

  const switchTab = (t: Tab) => {
    if (t === tab) return;
    setTab(t);
    setScope({});
    setSelectedId(null);
    setAlts(null);
    setError("");
    try {
      window.localStorage.setItem(TAB_KEY, t);
    } catch {
      /* not remembered — fine */
    }
  };

  // Tab → favourites → sidebar scope → search. The sidebar and level chips
  // count against `pool`, so with Favorites on every number means favourites.
  const tabSongs = useMemo(
    () => lib.songs.filter((s) => (tab === "mine" ? s.kind === "own" : s.kind !== "own")),
    [lib.songs, tab],
  );
  const favCount = useMemo(() => tabSongs.filter((s) => s.favorite).length, [tabSongs]);
  const pool = useMemo(() => (favOnly ? tabSongs.filter((s) => s.favorite) : tabSongs), [tabSongs, favOnly]);
  const scoped = useMemo(() => inScope(pool, scope), [pool, scope]);
  const visible = useMemo(() => sortSongs(searchSongs(scoped, query), sort, dir), [scoped, query, sort, dir]);
  const record = lib.songs.find((s) => s.id === selectedId) ?? null;

  /** The level chips keep the artist on My Music, and drop genre/sub-genre on the Library. */
  const levelBase: Scope = tab === "mine" && scope.artist ? { artist: scope.artist } : {};
  const artists = useMemo(() => artistsOf(lib.songs.filter((s) => s.kind === "own")).map((a) => a.name), [lib.songs]);

  // Where you are, as breadcrumbs. The first one is the headline; the rest
  // read as the finer slices of it.
  const crumbs = useMemo(() => {
    const parts: string[] = [];
    if (favOnly) parts.push("Favorites");
    if (tab === "mine") {
      parts.push(scope.artist ?? "All my music");
      if (scope.level !== undefined) parts.push(`${scope.level} · ${levelInfo(scope.level).name}`);
    } else if (scope.level === undefined) {
      parts.push("All songs");
    } else {
      parts.push(`${scope.level} · ${levelInfo(scope.level).name}`);
      if (scope.genre) parts.push(scope.genre);
      if (scope.subgenre) parts.push(scope.subgenre);
    }
    return parts;
  }, [favOnly, tab, scope]);
  const scopeLabel = crumbs.join(" › ");
  const blueprintKey = (tab === "mine" ? "mine:" : "") + (favOnly ? "fav:" : "") + scopeKey(scope);

  const toggleLens = (id: LensId) => {
    const next = lenses.includes(id) ? lenses.filter((l) => l !== id) : [...lenses, id];
    setLenses(next);
    setLib(store.setDefaultLenses(next));
  };

  const sortBy = (by: SortBy) => {
    if (by === sort) return setDir((d) => (d === "asc" ? "desc" : "asc"));
    setSort(by);
    setDir(by === "added" ? "desc" : "asc");
  };

  const begin = () => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError("");
    setAlts(null);
    setFlash("");
    return ctrl;
  };

  /**
   * Library: identify → measure the preview → file → describe in parallel.
   * `replaceId` re-files an existing song in place (Re-analyze, or "wrong song").
   */
  const run = async (source: { input: string } | { identity: Identity }, replaceId?: string) => {
    if (step !== "idle") return;
    const ctrl = begin();
    try {
      let identity: Identity;
      let alternatives: Identity[] = [];
      let warning: string | undefined;
      if ("input" in source) {
        setStep("finding");
        const found = await identify(source.input, ctrl.signal);
        ({ identity, alternatives } = found);
        warning = found.warning;
        const dup = !replaceId && store.findDuplicate(store.getLibrary(), identity);
        if (dup) {
          if (identity.link && !dup.links.includes(identity.link)) {
            setLib(store.updateSong(dup.id, { links: [...dup.links, identity.link] }));
          }
          setSelectedId(dup.id);
          setInput("");
          setFlash(`"${dup.title}" is already filed at ${dup.level} › ${dup.genre} › ${dup.subgenre} — opened it.`);
          return;
        }
      } else {
        identity = source.identity;
      }

      // File first with no lenses — a short, fast reply — then write each
      // description in its own parallel call so they appear as they land.
      const { draft, aiAvailable, warning: fileWarning } = await fileIdentity(
        identity,
        store.getLibrary().tree,
        [],
        setStep,
        ctrl.signal,
      );

      let id: string;
      let next: Library;
      if (replaceId) {
        next = store.reanalyze(replaceId, draft);
        id = replaceId;
      } else {
        const added = store.addSong(draft);
        next = added.lib;
        id = added.id;
      }
      setLib(next);
      setSelectedId(id);
      setInput("");
      const notes = [warning, fileWarning].filter(Boolean).join(" ");
      setFlash(
        `Filed "${draft.title}" → ${draft.level} ${levelInfo(draft.level).name} › ${draft.genre} › ${draft.subgenre}.` +
          (notes ? ` ${notes}` : ""),
      );
      if (alternatives.length) setAlts({ songId: id, options: alternatives });

      const song = next.songs.find((s) => s.id === id);
      if (song && aiAvailable && lenses.length) {
        setStep("describing");
        setProgress({ done: 0, total: lenses.length });
        const failed: string[] = [];
        await Promise.all(
          lenses.map(async (lens) => {
            try {
              const { descriptions } = await describe(song, [lens], ctrl.signal);
              setLib(store.mergeDescriptions(id, descriptions));
            } catch (err) {
              if ((err as Error).name !== "AbortError") {
                failed.push(LENSES.find((l) => l.id === lens)?.label ?? lens);
              }
            } finally {
              setProgress((p) => ({ ...p, done: p.done + 1 }));
            }
          }),
        );
        if (failed.length) setError(`Couldn't write: ${failed.join(", ")}. Open the song to try again.`);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      if (abort.current === ctrl) setStep("idle");
    }
  };

  /** My Music: decode + measure in the browser, cut a clip, let the AI listen and file it. */
  const listen = async (file: File, title: string, artist: string, signal: AbortSignal) => {
    setStep("measuring");
    const { measured, clip, durationSec } = await analyzeUpload(file);
    setStep("filing");
    const current = store.getLibrary();
    const artistSongs = current.songs
      .filter((s) => s.kind === "own" && s.artist.trim().toLowerCase() === artist.toLowerCase() && s.title !== title)
      .slice(0, 40)
      .map((s) => ({ title: s.title, level: s.level, genre: s.genre, subgenre: s.subgenre }));
    const res = await postJson<ClassifyResult>(
      "/api/music-classified/listen",
      { title, artist, measured, clip, tree: store.fullTree(current), lenses, artistSongs },
      signal,
    );
    return { ...res, durationSec };
  };

  const upload = async (files: File[]) => {
    if (step !== "idle") return;
    const audio = files.filter((f) => f.type.startsWith("audio/") || AUDIO_EXT.test(f.name));
    if (!audio.length) return setError("Those aren't audio files — upload MP3, WAV, M4A, FLAC or similar.");
    // Match an existing artist's spelling so "nova" doesn't start a second Nova.
    const typed = artistInput.trim();
    if (!typed) return setError("Type the artist first — My Music is organised by artist.");
    const artist = artists.find((a) => a.toLowerCase() === typed.toLowerCase()) ?? typed;

    const ctrl = begin();
    const problems: string[] = [];
    let added = 0;
    try {
      for (const [i, file] of audio.entries()) {
        if (ctrl.signal.aborted) break;
        setQueue({ done: i, total: audio.length, current: file.name });
        const title = titleFromFile(file.name);
        try {
          const res = await listen(file, title, artist, ctrl.signal);
          const audioId = await putAudio(file);
          const { lib: next, id } = store.addSong({
            ...res.draft,
            kind: "own",
            title,
            artist,
            audioId: audioId ?? undefined,
            durationSec: res.durationSec,
            fileName: file.name,
          });
          setLib(next);
          setSelectedId(id);
          added++;
          if (res.warning && !problems.includes(res.warning)) problems.push(res.warning);
          if (!audioId) problems.push("This browser wouldn't store the audio, so it can't be played back here.");
        } catch (err) {
          if ((err as Error).name === "AbortError") break;
          problems.push(`${file.name}: ${(err as Error).message}.`);
        }
      }
    } finally {
      setQueue(null);
      if (abort.current === ctrl) setStep("idle");
    }
    setScope({ artist });
    setFlash(
      `Added ${added} song${added === 1 ? "" : "s"} by ${artist}.` + (problems.length ? ` ${[...new Set(problems)].join(" ")}` : ""),
    );
  };

  const relisten = async (song: Song) => {
    if (step !== "idle") return;
    const blob = song.audioId ? await getAudio(song.audioId) : null;
    if (!blob) {
      setError("The audio for this song is on the device you uploaded it from — upload it again here to re-listen.");
      return;
    }
    const ctrl = begin();
    try {
      const file = new File([blob], song.fileName ?? "song", { type: blob.type });
      const res = await listen(file, song.title, song.artist, ctrl.signal);
      setLib(
        store.reanalyze(song.id, {
          ...res.draft,
          kind: "own",
          title: song.title,
          artist: song.artist,
          audioId: song.audioId,
          durationSec: res.durationSec,
          fileName: song.fileName,
        }),
      );
      setFlash(
        `Listened again: "${song.title}" → ${res.draft.level} › ${res.draft.genre} › ${res.draft.subgenre}.` +
          (res.warning ? ` ${res.warning}` : ""),
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      if (abort.current === ctrl) setStep("idle");
    }
  };

  const exportJson = () => {
    const blob = new Blob([store.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `music-classified-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      setLib(store.importJson(await file.text()));
      setSelectedId(null);
      setFlash("Imported — the library was replaced.");
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "That file couldn't be read.");
    }
  };

  const progressText = queue
    ? `Listening to ${queue.current} (${queue.done + 1}/${queue.total})${step === "measuring" ? " — measuring tempo & key…" : " — the AI is listening…"}`
    : step === "describing"
      ? `${STEP_LABEL.describing} ${progress.done}/${progress.total}`
      : step !== "idle"
        ? STEP_LABEL[step]
        : "";

  const emptyText =
    favOnly && !favCount
      ? "No favorites here yet — tap ☆ on any song to add it."
      : tab === "mine"
        ? tabSongs.length
          ? "No songs match. Pick another artist or level, or clear the search."
          : "No songs yet. Type the artist name above, then upload audio files — or drop them on the bar."
        : lib.songs.some((s) => s.kind !== "own")
          ? "No songs here. Pick another level, or clear the search."
          : "Your library is empty. Type a song you love above — or paste a link — and hit Classify.";

  return (
    <div className="mcl">
      <header className="mcl-top">
        <div className="mcl-top__row">
          <button
            onClick={() => setNavOpen((v) => !v)}
            className="mcl-iconbtn mcl-nav-toggle"
            aria-label="Toggle navigation"
            aria-expanded={navOpen}
          >
            <Icon.Sidebar width={15} height={15} />
          </button>

          <div className="mcl-brand">
            <span className="mcl-mark" aria-hidden />
            <span className="mcl-brand__text">
              <span className="mcl-brand__name">Music Classified</span>
              <span className="mcl-brand__sub">Every song, filed by energy</span>
            </span>
          </div>

          <div className="mcl-tabs" role="tablist">
            {(
              [
                ["library", "Library"],
                ["mine", "My Music"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => switchTab(id)}
                className="mcl-tab"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mcl-search">
            <Icon.Search width={15} height={15} className="mcl-search__icon" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={favOnly ? "Search your favorites…" : "Search songs, sounds, moods, descriptions…"}
              aria-label="Search songs"
            />
          </div>

          <div className="mcl-top__actions">
            <Link href="/" className="mcl-iconbtn" title="Back to the hub" aria-label="Back to the hub">
              <Icon.Home width={15} height={15} />
            </Link>
            <div className="mcl-menu">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="mcl-iconbtn"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Library data"
                title="Library data"
              >
                <Icon.Database width={15} height={15} />
              </button>
              {menuOpen && (
                <>
                  <button
                    className="mcl-menu__scrim"
                    aria-hidden
                    tabIndex={-1}
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="mcl-menu__pop" role="menu">
                    <button
                      role="menuitem"
                      className="mcl-menu__item"
                      onClick={() => {
                        setMenuOpen(false);
                        exportJson();
                      }}
                    >
                      <Icon.Download width={14} height={14} />
                      Export library
                    </button>
                    <button
                      role="menuitem"
                      className="mcl-menu__item"
                      onClick={() => {
                        setMenuOpen(false);
                        fileInput.current?.click();
                      }}
                    >
                      <Icon.Upload width={14} height={14} />
                      Import library
                    </button>
                  </div>
                </>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importJson(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </header>

      {/* The tab's main action, always on screen. */}
      {tab === "library" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) void run({ input });
          }}
          className="mcl-console"
        >
          <div className="mcl-console__row">
            <div className="mcl-field">
              <Icon.Sparkles width={14} height={14} className="mcl-field__icon" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={step !== "idle"}
                placeholder="Song name, or a YouTube / Apple Music / Spotify link"
                aria-label="Song to classify"
              />
            </div>
            <LensPicker lenses={lenses} onToggle={toggleLens} />
            {step === "idle" ? (
              <button type="submit" disabled={!input.trim()} className="mcl-btn mcl-btn--primary">
                <Icon.Plus width={13} height={13} />
                Classify
              </button>
            ) : (
              <button type="button" onClick={() => abort.current?.abort()} className="mcl-btn">
                Cancel
              </button>
            )}
          </div>
          {progressText && <p className="mcl-console__note is-busy">{progressText}</p>}
          {error && <p className="mcl-console__note mcl-error">{error}</p>}
        </form>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void upload([...e.dataTransfer.files]);
          }}
          className={"mcl-console" + (dragging ? " is-drag" : "")}
        >
          <div className="mcl-console__row">
            <div className="mcl-field">
              <Icon.Users width={14} height={14} className="mcl-field__icon" />
              <input
                value={artistInput}
                onChange={(e) => setArtistInput(e.target.value)}
                disabled={step !== "idle"}
                list="mc-upload-artists"
                placeholder="Artist name (who made these songs)"
                aria-label="Artist name"
              />
              <datalist id="mc-upload-artists">{artists.map((a) => <option key={a} value={a} />)}</datalist>
            </div>
            <LensPicker lenses={lenses} onToggle={toggleLens} />
            {step === "idle" ? (
              <button
                type="button"
                onClick={() => (artistInput.trim() ? audioInput.current?.click() : setError("Type the artist first — My Music is organised by artist."))}
                className="mcl-btn mcl-btn--primary"
              >
                <Icon.Upload width={13} height={13} />
                Upload songs
              </button>
            ) : (
              <button type="button" onClick={() => abort.current?.abort()} className="mcl-btn">
                Cancel
              </button>
            )}
            <input
              ref={audioInput}
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                if (files.length) void upload(files);
              }}
            />
          </div>
          <p className={"mcl-console__note" + (progressText ? " is-busy" : "")}>
            {progressText ||
              "Drop audio files here or pick them. The AI listens to each one and files it; the audio stays on this device."}
          </p>
          {error && <p className="mcl-console__note mcl-error">{error}</p>}
        </div>
      )}

      {(flash || alts) && (
        <div className="mcl-flash">
          {flash && <span>{flash}</span>}
          {alts && (
            <>
              <span className="mcl-muted">Wrong song?</span>
              {alts.options.map((o) => (
                <button
                  key={`${o.title}|${o.artist}`}
                  onClick={() => void run({ identity: o }, alts.songId)}
                  disabled={step !== "idle"}
                  className="mcl-flash__alt"
                >
                  {o.title} — {o.artist}
                </button>
              ))}
              <button
                onClick={() => {
                  setAlts(null);
                  setFlash("");
                }}
                className="mcl-muted"
                style={{ marginLeft: "auto", fontSize: "0.72rem" }}
              >
                dismiss
              </button>
            </>
          )}
        </div>
      )}

      <div className="mcl-body">
        {/* Drawer scrim — the rail is an overlay below 1024px. */}
        <div
          className={"mcl-rail__scrim" + (navOpen ? " is-on" : "")}
          onClick={() => setNavOpen(false)}
          aria-hidden
        />

        {/* With a record open, three panes crush the song column below xl, so
            the rail steps aside (still reachable via the top-bar toggle). */}
        <div className={"mcl-rail mcl-scroll" + (navOpen ? " is-open" : "") + (record ? " is-crowded" : "")}>
          {tab === "library" ? (
            <LevelSidebar
              songs={pool}
              tree={lib.tree}
              scope={scope}
              onScope={(s) => {
                setScope(s);
                setNavOpen(false);
              }}
              onAddGenre={(level, genre) => setLib(store.addGenre(level, genre))}
              onAddSubgenre={(level, genre, sub) => setLib(store.addSubgenre(level, genre, sub))}
            />
          ) : (
            <ArtistSidebar
              songs={pool}
              scope={scope}
              onScope={(s) => {
                setScope(s);
                setNavOpen(false);
              }}
            />
          )}
        </div>

        <main className="mcl-stage">
          {/* Where you are, the favourites filter, and the 1–10 spectrum. */}
          <div className="mcl-scope">
            <div className="mcl-scope__head">
              <div className="mcl-scope__crumbs">
                <span className="mcl-scope__name">{crumbs[0]}</span>
                {crumbs.slice(1).map((c) => (
                  <Fragment key={c}>
                    <span className="mcl-scope__sep" aria-hidden>
                      ›
                    </span>
                    <span className="mcl-scope__crumb">{c}</span>
                  </Fragment>
                ))}
              </div>
              <span className="mcl-scope__count">
                <b>{visible.length}</b>
                {visible.length !== scoped.length && ` / ${scoped.length}`} songs
              </span>
            </div>

            <div className="mcl-scope__tools">
              <button
                onClick={() => setFavOnly((v) => !v)}
                aria-pressed={favOnly}
                title="Show favorites only"
                className={"mcl-pill" + (favOnly ? " is-fav" : "")}
              >
                <span>{favOnly ? "★" : "☆"}</span>
                Favorites
                <span className="mcl-pill__n">{favCount}</span>
              </button>

              <div className="mcl-spectrum">
                <button
                  onClick={() => setScope(levelBase)}
                  title="Every energy level"
                  className={"mcl-stop is-all" + (scope.level === undefined ? " is-on" : "")}
                >
                  <b>All</b>
                  <i>{pool.length}</i>
                </button>
                {LEVELS.map((l) => {
                  const n = inScope(pool, { ...levelBase, level: l.n }).length;
                  const on = scope.level === l.n;
                  return (
                    <button
                      key={l.n}
                      onClick={() => setScope(on ? levelBase : { ...levelBase, level: l.n })}
                      title={`${l.n} · ${l.name} — ${l.feel}. Typically ${l.bpm} BPM. ${n} song${n === 1 ? "" : "s"}.`}
                      className={"mcl-stop" + (on ? " is-on" : "") + (n ? "" : " is-empty")}
                      style={hueStyle(l.hue)}
                    >
                      <b>{l.n}</b>
                      <i>{n}</i>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <BlueprintBox
            key={blueprintKey}
            scope={blueprintKey}
            scopeLabel={tab === "mine" ? `${scopeLabel} (the user's own songs)` : scopeLabel}
            songs={scoped}
            blueprint={lib.blueprints.find((b) => b.scope === blueprintKey)}
            onSaved={(bp) => setLib(store.saveBlueprint(bp))}
          />

          <div className="mcl-list mcl-scroll">
            {!ready ? (
              <p className="mcl-empty">Loading your library…</p>
            ) : (
              <SongTable
                songs={visible}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onFavorite={(id) => setLib(store.toggleFavorite(id))}
                sort={sort}
                dir={dir}
                onSort={sortBy}
                empty={emptyText}
              />
            )}
          </div>
        </main>

        {record && (
          <div className="mcl-panel">
            <SongPanel
              song={record}
              lib={lib}
              busy={step !== "idle"}
              onClose={() => setSelectedId(null)}
              onPatch={(patch) => setLib(store.updateSong(record.id, patch))}
              onDescriptions={(d) => setLib(store.mergeDescriptions(record.id, d))}
              onDelete={() => {
                if (record.audioId) void deleteAudio(record.audioId);
                setLib(store.deleteSong(record.id));
                setSelectedId(null);
              }}
              onReanalyze={() =>
                record.kind === "own"
                  ? void relisten(record)
                  : void run({ input: record.artist ? `${record.title} by ${record.artist}` : record.title }, record.id)
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
