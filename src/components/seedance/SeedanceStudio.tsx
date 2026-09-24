"use client";

// ---------------------------------------------------------------------------
// Seedance Studio — the cutting room.
//
// Video prompts run end to end under the song; lip-sync ranges say which
// seconds get sung. All the geometry rules live in src/lib/seedance/reel.ts;
// this file owns the state, the playhead and the renders.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeSong, fileToMediaRef, renderBlock } from "@/lib/seedance/client";
import { timecode } from "@/lib/seedance/constants";
import {
  DEFAULT_LIP_SEC,
  MIN_LIP_SEC,
  addBlock,
  blankLip,
  clampLip,
  duplicateBlock,
  firstFreeSlot,
  layout,
  placedAt,
  removeBlock,
  reorder,
  resizeBlock,
  songSec,
  spanSec,
} from "@/lib/seedance/reel";
import { KEY as SEEDANCE_KEY, blankReel, loadReels, saveReel } from "@/lib/seedance/repo";
import type { AspectRatio, Reel, VideoPrompt } from "@/lib/seedance/types";
import { useRemotePull } from "@/lib/sync/useSync";
import type { CinemaSelection } from "@/lib/studio/cinema";
import { Icon } from "../icons";
import { PromptSheet, type SheetTarget } from "./PromptSheet";
import { ShotList } from "./ShotList";
import { Spine } from "./Spine";
import { Stage } from "./Stage";
import { SeedanceChat } from "./SeedanceChat";
import { ScoreSheet } from "./ScoreSheet";
import { placeShots, type Score } from "@/lib/seedance/score";

export function SeedanceStudio() {
  const [reel, setReel] = useState<Reel>(() => blankReel());
  /**
   * The shot plan the director wrote, when there is one.
   *
   * It is kept beside the reel rather than inside it because the two answer
   * different questions: the reel is what renders, the score is why. But the
   * REEL is the source of truth for anything both of them know about — see
   * `liveScore`.
   */
  const [score, setScore] = useState<Score | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [renderingAll, setRenderingAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reelRef = useRef(reel);
  useEffect(() => {
    reelRef.current = reel;
  }, [reel]);

  const songInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // A reel saved on another device lands in localStorage first, then the same
  // restore path below runs again against the settled copy.
  useRemotePull(SEEDANCE_KEY, () => {
    const list = loadReels();
    if (list.length) setReel(list[0]);
  });

  useEffect(() => {
    const list = loadReels();
    if (list.length) setReel(list[0]);
  }, []);

  const say = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 3200);
  }, []);

  const placed = useMemo(() => layout(reel), [reel]);
  const total = spanSec(reel);
  const current = useMemo(() => placedAt(reel, playheadSec), [reel, playheadSec]);
  const renderedCount = reel.prompts.filter((b) => b.status === "done").length;

  // ----- playback ----------------------------------------------------------
  // Timestamp-based, so the rate stays correct even if two intervals ever tick
  // (React StrictMode double-mounts in dev).
  const startRef = useRef(0);
  useEffect(() => {
    if (!playing) return;
    startRef.current = performance.now() - playheadSec * 1000;
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - startRef.current) / 1000;
      if (elapsed >= total) {
        setPlayheadSec(total);
        setPlaying(false);
        audioRef.current?.pause();
      } else {
        setPlayheadSec(Math.round(elapsed * 10) / 10);
      }
    }, 80);
    return () => window.clearInterval(id);
    // playheadSec is read once to resume; listing it would restart every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      audioRef.current?.pause();
      return;
    }
    const from = playheadSec >= total ? 0 : playheadSec;
    setPlayheadSec(from);
    setPlaying(true);
    const audio = audioRef.current;
    if (audio && reel.song?.url) {
      audio.currentTime = Math.min(from, songSec(reel));
      void audio.play().catch(() => {});
    }
  };

  const scrub = (sec: number) => {
    setPlayheadSec(Math.round(sec * 10) / 10);
    const audio = audioRef.current;
    if (audio && reel.song?.url) audio.currentTime = Math.min(sec, songSec(reel));
  };

  // ----- reel mutations ----------------------------------------------------
  const patch = (p: Partial<Reel>) => setReel((r) => ({ ...r, ...p }));

  const patchBlock = (id: string, bp: Partial<VideoPrompt>) =>
    setReel((r) => ({
      ...r,
      prompts: r.prompts.map((b) => (b.id === id ? { ...b, ...bp } : b)),
    }));

  // Side effects (picking the new block, selecting it) stay out of the state
  // updater — an updater has to be pure or StrictMode runs it twice.
  const addPrompt = (afterIndex?: number) => {
    const before = reelRef.current.prompts;
    const next = addBlock(before, afterIndex);
    setReel((r) => ({ ...r, prompts: next }));
    const fresh = next.find((b) => !before.some((o) => o.id === b.id));
    if (fresh) setSelectedId(fresh.id);
  };

  const resizePrompt = (index: number, durationSec: number) =>
    setReel((r) => ({ ...r, prompts: resizeBlock(r.prompts, index, durationSec) }));

  const reorderPrompt = (index: number, to: number) =>
    setReel((r) => ({ ...r, prompts: reorder(r.prompts, index, to) }));

  const deletePrompt = (index: number) => {
    const victim = reelRef.current.prompts[index];
    setReel((r) => ({ ...r, prompts: removeBlock(r.prompts, index) }));
    if (victim && selectedId === victim.id) setSelectedId(null);
  };

  const duplicatePrompt = (index: number) => {
    const before = reelRef.current.prompts;
    const next = duplicateBlock(before, index);
    setReel((r) => ({ ...r, prompts: next }));
    const fresh = next.find((b) => !before.some((o) => o.id === b.id));
    if (fresh) setSelectedId(fresh.id);
  };

  const addRefs = async (id: string, files: FileList) => {
    const refs = await Promise.all(Array.from(files).map(fileToMediaRef));
    setReel((r) => ({
      ...r,
      prompts: r.prompts.map((b) => (b.id === id ? { ...b, refs: [...b.refs, ...refs] } : b)),
    }));
  };

  const removeRef = (id: string, refId: string) =>
    setReel((r) => ({
      ...r,
      prompts: r.prompts.map((b) =>
        b.id === id ? { ...b, refs: b.refs.filter((x) => x.id !== refId) } : b,
      ),
    }));

  // ----- the lip-sync lane -------------------------------------------------
  const addLip = (atSec?: number) => {
    const r = reelRef.current;
    const span = spanSec(r);
    let slot =
      atSec === undefined ? firstFreeSlot(r.lipsync, span, DEFAULT_LIP_SEC) : null;
    if (atSec !== undefined) {
      const fit = clampLip(r.lipsync, "__new__", atSec, DEFAULT_LIP_SEC, span);
      slot = fit.durationSec >= MIN_LIP_SEC ? fit : firstFreeSlot(r.lipsync, span, DEFAULT_LIP_SEC);
    }
    if (!slot) {
      say("No room for another lip-sync range — trim one, or load a longer song.");
      return;
    }
    const range = blankLip(slot.startSec, slot.durationSec);
    setReel((cur) => ({ ...cur, lipsync: [...cur.lipsync, range] }));
    setSelectedId(range.id);
  };

  const moveLip = (id: string, startSec: number, durationSec: number) =>
    setReel((r) => {
      const fit = clampLip(r.lipsync, id, startSec, durationSec, spanSec(r));
      return { ...r, lipsync: r.lipsync.map((x) => (x.id === id ? { ...x, ...fit } : x)) };
    });

  const nudgeLip = (id: string, delta: number) => {
    const x = reelRef.current.lipsync.find((r) => r.id === id);
    if (x) moveLip(id, x.startSec + delta, x.durationSec);
  };

  const deleteLip = (id: string) => {
    setReel((r) => ({ ...r, lipsync: r.lipsync.filter((x) => x.id !== id) }));
    setSelectedId((s) => (s === id ? null : s));
  };

  // ----- the song ----------------------------------------------------------
  const onSongFile = async (file: File) => {
    const url = URL.createObjectURL(file);
    const decoded = await decodeSong(file);
    const durationSec = Math.max(2, Math.round((decoded?.durationSec ?? 60) * 10) / 10);
    setReel((r) => ({
      ...r,
      song: { name: file.name, type: file.type, url, durationSec, peaks: decoded?.peaks },
      // A shorter song cannot hold ranges that used to fit, so they are pulled
      // back inside it rather than sitting silently past the end.
      lipsync: r.lipsync
        .filter((x) => x.startSec < durationSec)
        .map((x) => ({ ...x, durationSec: Math.min(x.durationSec, durationSec - x.startSec) })),
    }));
    if (!decoded) say("Loaded the song, but this browser could not decode it for a waveform.");
  };

  /**
   * The director's plan, laid onto the timeline.
   *
   * This is the hook-up: a score's cuts become the video-prompt blocks and its
   * lip-sync ranges become the lip-sync lane, so the plan lands in the three
   * lanes the owner already knows how to edit instead of living in a sheet of
   * its own. After this, dragging a lip-sync range on the timeline is what
   * decides which cuts sing — there is no second copy to disagree with.
   */
  const applyScore = useCallback((next: Score) => {
    const placed = placeShots(next);
    setScore(next);
    setReel((r) => ({
      ...r,
      name: next.name || r.name,
      direction: next.logline || r.direction,
      aspectRatio: next.aspectRatio,
      prompts: placed.map((p) => ({
        id: p.shot.id,
        prompt: p.shot.action,
        cinema: {},
        refs: [],
        durationSec: p.durationSec,
        status: "idle" as const,
      })),
      lipsync: next.lipsync.map((l) => ({ ...l })),
    }));
    setSelectedId(null);
  }, []);

  /**
   * The score as it stands NOW — its own fields, but the timeline's lip sync.
   *
   * Without this the sheet and the lanes drift apart the first time a range is
   * dragged: the sheet would still be describing the plan as written, while the
   * film renders what the timeline says. One of them has to win, and it is the
   * one the owner is actually editing.
   */
  const liveScore = useMemo(
    () => (score ? { ...score, lipsync: reel.lipsync } : null),
    [score, reel.lipsync],
  );

  const clearSong = () =>
    setReel((r) => {
      if (r.song?.url) URL.revokeObjectURL(r.song.url);
      return { ...r, song: null };
    });

  // ----- rendering ---------------------------------------------------------
  const renderOne = useCallback(async (index: number) => {
    const r = reelRef.current;
    const ps = layout(r)[index];
    if (!ps) return;
    const id = ps.block.id;
    patchBlock(id, { status: "generating", error: undefined });
    const res = await renderBlock(r, ps);
    if (res.status === "done") {
      patchBlock(id, {
        status: "done",
        engine: res.engine,
        videoUrl: res.videoUrl,
        posterHue: res.posterHue,
      });
    } else {
      patchBlock(id, { status: "error", error: res.error ?? "The render failed." });
    }
  }, []);

  const renderAll = async () => {
    setRenderingAll(true);
    for (let i = 0; i < reelRef.current.prompts.length; i++) await renderOne(i);
    setRenderingAll(false);
  };

  const onSave = () => {
    saveReel(reelRef.current);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  // ----- the sheet ---------------------------------------------------------
  const target: SheetTarget | null = useMemo(() => {
    if (!selectedId) return null;
    const ps = placed.find((p) => p.block.id === selectedId);
    if (ps) return { kind: "prompt", placed: ps };
    const range = reel.lipsync.find((x) => x.id === selectedId);
    if (range) {
      const coveredCount = placed.filter(
        (p) =>
          Math.min(p.startSec + p.durationSec, range.startSec + range.durationSec) -
            Math.max(p.startSec, range.startSec) >
          0,
      ).length;
      return { kind: "lip", range, coveredCount };
    }
    return null;
  }, [selectedId, placed, reel.lipsync]);

  // Selecting a block parks the playhead on it, so the stage shows what the
  // sheet is editing without a second gesture.
  useEffect(() => {
    if (!target || playing) return;
    const at = target.kind === "prompt" ? target.placed.startSec : target.range.startSec;
    setPlayheadSec(at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "Escape" && selectedId) {
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, playheadSec, selectedId, total]);

  const selectedIndex =
    target?.kind === "prompt" ? target.placed.index : -1;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      {/* Top rail */}
      <header className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          aria-label="Back to hub"
        >
          <Icon.ArrowLeft width={14} height={14} />
          <span className="hidden sm:inline">Hub</span>
        </Link>
        <span className="hidden text-sm font-semibold text-ink sm:inline">Seedance Studio</span>
        <input
          value={reel.name}
          onChange={(e) => patch({ name: e.target.value })}
          aria-label="Reel name"
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-ink outline-none transition hover:border-line focus:border-accent focus:bg-canvas"
        />

        {notice && (
          <span className="hidden max-w-[320px] truncate rounded-md border border-line bg-panel-2 px-2 py-1 text-[10.5px] text-ink-muted md:inline">
            {notice}
          </span>
        )}

        <button
          onClick={onSave}
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          {saved ? "Saved" : "Save"}
        </button>
        <button
          onClick={renderAll}
          disabled={renderingAll || !reel.prompts.length}
          // The label collapses to the icon on a phone, so the button has to
          // carry its own name there.
          aria-label={
            renderingAll ? "Rendering the reel" : `Render all ${reel.prompts.length} prompts`
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-canvas transition hover:bg-accent-2 disabled:opacity-50"
        >
          {renderingAll ? (
            <Icon.Refresh width={13} height={13} className="animate-spin" />
          ) : (
            <Icon.Sparkles width={13} height={13} />
          )}
          <span className="hidden sm:inline">
            {renderingAll ? "Rendering the reel…" : `Render all ${reel.prompts.length}`}
          </span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          {/* Capped side by side, because the timeline is the point and the stage
              must not push it below the fold. Stacked (narrow) the column
              scrolls instead, so the cap would only squash both panels. */}
          <div className="grid shrink-0 gap-3 lg:max-h-[420px] lg:grid-cols-[minmax(280px,340px)_1fr]">
            <Stage
              reel={reel}
              placed={current}
              playing={playing}
              playheadSec={playheadSec}
              totalSec={total}
              renderedCount={renderedCount}
              totalCount={reel.prompts.length}
              onTogglePlay={togglePlay}
              onRewind={() => scrub(0)}
              onOpen={() => current && setSelectedId(current.block.id)}
            />
            <SeedanceChat
              reel={reel}
              onScore={applyScore}
              onSong={onSongFile}
              onCinema={(cinema: CinemaSelection) => patch({ cinema })}
              onAspect={(aspectRatio: AspectRatio) => patch({ aspectRatio })}
            />
          </div>

          <Spine
            reel={reel}
            selectedId={selectedId}
            playheadSec={playheadSec}
            onScrub={scrub}
            onSelect={setSelectedId}
            onAddPrompt={addPrompt}
            onResizePrompt={resizePrompt}
            onReorderPrompt={reorderPrompt}
            onDeletePrompt={deletePrompt}
            onAddLip={addLip}
            onMoveLip={moveLip}
            onNudgeLip={nudgeLip}
            onDeleteLip={deleteLip}
            onPickSong={() => songInputRef.current?.click()}
            onClearSong={clearSong}
          />

          {liveScore && (
            <ScoreSheet
              score={liveScore}
              reel={reel}
              onChange={setScore}
              onSelectShot={setSelectedId}
              onRenderShot={(i) => void renderOne(i)}
            />
          )}

          <ShotList
            reel={reel}
            placed={placed}
            selectedId={selectedId}
            playheadSec={playheadSec}
            onSelect={setSelectedId}
            onRender={(i) => void renderOne(i)}
            onAdd={() => addPrompt()}
          />
        </div>

        {target && (
          <div className="fixed inset-0 z-50 bg-canvas lg:static lg:z-auto lg:w-[400px] lg:shrink-0 lg:bg-transparent">
            <PromptSheet
              reel={reel}
              target={target}
              onClose={() => setSelectedId(null)}
              onPatch={(p) => target.kind === "prompt" && patchBlock(target.placed.block.id, p)}
              onResize={(d) => selectedIndex >= 0 && resizePrompt(selectedIndex, d)}
              onAddRefs={(files) =>
                target.kind === "prompt" && void addRefs(target.placed.block.id, files)
              }
              onRemoveRef={(refId) =>
                target.kind === "prompt" && removeRef(target.placed.block.id, refId)
              }
              onRender={() => selectedIndex >= 0 && void renderOne(selectedIndex)}
              onDuplicate={() => selectedIndex >= 0 && duplicatePrompt(selectedIndex)}
              onAddAfter={() => selectedIndex >= 0 && addPrompt(selectedIndex)}
              onDelete={() => selectedIndex >= 0 && deletePrompt(selectedIndex)}
              onMoveLip={(s, d) => target.kind === "lip" && moveLip(target.range.id, s, d)}
              onDeleteLip={() => target.kind === "lip" && deleteLip(target.range.id)}
            />
          </div>
        )}
      </div>

      {/* Hidden inputs / audio */}
      <input
        ref={songInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) void onSongFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {reel.song?.url && <audio ref={audioRef} src={reel.song.url} className="hidden" />}
      <span className="sr-only" aria-live="polite">
        {notice ?? `Playhead at ${timecode(playheadSec, true)}`}
      </span>
    </div>
  );
}
