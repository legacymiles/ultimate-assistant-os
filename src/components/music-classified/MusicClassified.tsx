"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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

  const where =
    tab === "mine"
      ? [scope.artist ?? "All my music", scope.level !== undefined && `${scope.level} · ${levelInfo(scope.level).name}`]
      : scope.level === undefined
        ? ["All songs"]
        : [`${scope.level} · ${levelInfo(scope.level).name}`, scope.genre, scope.subgenre];
  const scopeLabel = [favOnly && "Favorites", ...where].filter(Boolean).join(" › ");
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
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <button
          onClick={() => setNavOpen((v) => !v)}
          className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:text-ink lg:hidden"
          aria-label="Toggle sidebar"
        >
          <Icon.Menu width={14} height={14} />
        </button>
        <Link
          href="/"
          className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink sm:inline-flex"
        >
          <Icon.ArrowLeft width={13} height={13} />
          Hub
        </Link>
        <span className="hidden text-sm font-semibold text-ink xl:inline">Music Classified</span>

        <div className="flex shrink-0 rounded-lg border border-line p-0.5" role="tablist">
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
              className={
                "rounded-md px-2.5 py-1 text-[12px] font-medium transition " +
                (tab === id ? "bg-brand text-white" : "text-ink-muted hover:text-ink")
              }
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative mx-1 min-w-0 flex-1">
          <Icon.Search
            width={14}
            height={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={favOnly ? "Search your favorites…" : "Search songs, sounds, moods, descriptions…"}
            className="w-full rounded-lg border border-line bg-canvas py-1.5 pl-8 pr-2 text-[13px] text-ink outline-none focus:border-brand"
          />
        </div>
        <button
          onClick={exportJson}
          className="hidden rounded-lg border border-line p-1.5 text-ink-muted transition hover:text-ink sm:block"
          title="Export JSON"
          aria-label="Export JSON"
        >
          <Icon.Download width={14} height={14} />
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          className="hidden rounded-lg border border-line p-1.5 text-ink-muted transition hover:text-ink sm:block"
          title="Import JSON"
          aria-label="Import JSON"
        >
          <Icon.Upload width={14} height={14} />
        </button>
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
      </header>

      {/* The tab's main action, always on screen. */}
      {tab === "library" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) void run({ input });
          }}
          className="relative shrink-0 border-b border-line bg-panel/70 px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Icon.Sparkles
                width={13}
                height={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-brand"
              />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={step !== "idle"}
                placeholder="Song name, or a YouTube / Apple Music / Spotify link"
                className="w-full rounded-lg border border-line bg-canvas py-1.5 pl-8 pr-2 text-[13px] text-ink outline-none focus:border-brand disabled:opacity-60"
              />
            </div>
            <LensPicker lenses={lenses} onToggle={toggleLens} />
            {step === "idle" ? (
              <button
                type="submit"
                disabled={!input.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
              >
                <Icon.Plus width={12} height={12} />
                Classify
              </button>
            ) : (
              <button
                type="button"
                onClick={() => abort.current?.abort()}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink"
              >
                Cancel
              </button>
            )}
          </div>
          {progressText && <p className="mt-1.5 animate-pulse font-mono text-[11px] text-ink-faint">{progressText}</p>}
          {error && <p className="mt-1.5 text-[12px] text-rose-300">{error}</p>}
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
          className={
            "relative shrink-0 border-b px-3 py-2 transition " +
            (dragging ? "border-brand bg-brand/10" : "border-line bg-panel/70")
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Icon.Users
                width={13}
                height={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-brand"
              />
              <input
                value={artistInput}
                onChange={(e) => setArtistInput(e.target.value)}
                disabled={step !== "idle"}
                list="mc-upload-artists"
                placeholder="Artist name (who made these songs)"
                className="w-full rounded-lg border border-line bg-canvas py-1.5 pl-8 pr-2 text-[13px] text-ink outline-none focus:border-brand disabled:opacity-60"
              />
              <datalist id="mc-upload-artists">{artists.map((a) => <option key={a} value={a} />)}</datalist>
            </div>
            <LensPicker lenses={lenses} onToggle={toggleLens} />
            {step === "idle" ? (
              <button
                type="button"
                onClick={() => (artistInput.trim() ? audioInput.current?.click() : setError("Type the artist first — My Music is organised by artist."))}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2"
              >
                <Icon.Upload width={12} height={12} />
                Upload songs
              </button>
            ) : (
              <button
                type="button"
                onClick={() => abort.current?.abort()}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:text-ink"
              >
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
          <p className="mt-1.5 font-mono text-[11px] text-ink-faint">
            {progressText ? (
              <span className="animate-pulse">{progressText}</span>
            ) : (
              "Drop audio files here or pick them. The AI listens to each one and files it; the audio stays on this device."
            )}
          </p>
          {error && <p className="mt-1 text-[12px] text-rose-300">{error}</p>}
        </div>
      )}

      {(flash || alts) && (
        <div className="animate-fade-in shrink-0 border-b border-line-soft bg-panel px-3 py-1.5 text-[12px] text-ink-muted">
          {flash && <p>{flash}</p>}
          {alts && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-ink-faint">Wrong song?</span>
              {alts.options.map((o) => (
                <button
                  key={`${o.title}|${o.artist}`}
                  onClick={() => void run({ identity: o }, alts.songId)}
                  disabled={step !== "idle"}
                  className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-muted transition hover:border-brand hover:text-ink disabled:opacity-40"
                >
                  {o.title} — {o.artist}
                </button>
              ))}
              <button
                onClick={() => {
                  setAlts(null);
                  setFlash("");
                }}
                className="ml-auto font-mono text-[11px] text-ink-faint hover:text-ink"
              >
                dismiss
              </button>
            </div>
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <div
          className={
            // With a record open, three panes crush the song column below xl,
            // so the sidebar steps aside (still reachable via the menu).
            "w-60 shrink-0 border-r border-line bg-panel " +
            (record ? "xl:static xl:block " : "lg:static lg:block ") +
            (navOpen ? "absolute inset-y-0 left-0 z-30 shadow-2xl" : "hidden")
          }
        >
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

        <main className="flex min-w-0 flex-1 flex-col">
          {/* Favorites + the 1–10 filter, in one strip, above everything. */}
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line-soft px-3 py-1.5">
            <button
              onClick={() => setFavOnly((v) => !v)}
              aria-pressed={favOnly}
              className={
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12px] transition " +
                (favOnly
                  ? "border-amber-400/50 bg-amber-400/15 text-amber-200"
                  : "border-line text-ink-muted hover:text-ink")
              }
            >
              <span className={favOnly ? "text-amber-300" : ""}>{favOnly ? "★" : "☆"}</span>
              Favorites
              <span className="font-mono text-[10px] text-ink-faint">{favCount}</span>
            </button>
            <span className="mx-1 h-4 w-px bg-line" />
            <button
              onClick={() => setScope(levelBase)}
              className={
                "rounded-md px-1.5 py-0.5 font-mono text-[11px] transition " +
                (scope.level === undefined ? "bg-panel-2 text-ink" : "text-ink-faint hover:text-ink")
              }
            >
              All
            </button>
            {LEVELS.map((l) => {
              const n = inScope(pool, { ...levelBase, level: l.n }).length;
              const on = scope.level === l.n;
              return (
                <button
                  key={l.n}
                  onClick={() => setScope(on ? levelBase : { ...levelBase, level: l.n })}
                  title={`${l.n} · ${l.name} — ${n} song${n === 1 ? "" : "s"}`}
                  className="h-5 min-w-[22px] rounded px-1 font-mono text-[11px] font-semibold transition"
                  style={{
                    background: on ? `hsl(${l.hue} 80% 66%)` : `hsl(${l.hue} 40% 50% / ${n ? 0.18 : 0.06})`,
                    color: on ? "rgba(0,0,0,.8)" : `hsl(${l.hue} 70% ${n ? 72 : 45}%)`,
                  }}
                >
                  {l.n}
                </button>
              );
            })}
            <p className="ml-auto truncate pl-2 font-mono text-[11px] text-ink-faint">
              {scopeLabel}
              <span className="ml-2 text-ink-muted">
                {visible.length}
                {visible.length !== scoped.length && `/${scoped.length}`}
              </span>
            </p>
          </div>

          <BlueprintBox
            key={blueprintKey}
            scope={blueprintKey}
            scopeLabel={tab === "mine" ? `${scopeLabel} (the user's own songs)` : scopeLabel}
            songs={scoped}
            blueprint={lib.blueprints.find((b) => b.scope === blueprintKey)}
            onSaved={(bp) => setLib(store.saveBlueprint(bp))}
          />

          <div className="min-h-0 flex-1 overflow-auto">
            {!ready ? (
              <p className="px-4 py-20 text-center text-sm text-ink-faint">Loading your library…</p>
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
          <div className="fixed inset-0 z-40 bg-panel lg:static lg:z-auto lg:w-[400px] lg:shrink-0 lg:border-l lg:border-line">
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
