"use client";

// ---------------------------------------------------------------------------
// The stem rack — one record's parts, next to the other record's parts.
//
// The owner's ask, in their words: each stem should play on its own, so that
// clicking song A plays A's vocal and clicking song B plays B's vocal, rather
// than either whole song. That is what this is: a grid of stems down the side,
// A and B across the top, and one click per cell.
//
// ----- three honest states per cell -----------------------------------------
//
// A cell is never just "a play button". It is one of:
//
//   SPLIT — the separation has already been paid for, so it plays instantly
//     from the account's library, and keeps playing with the GPU asleep.
//   NOT SPLIT YET — pressing it spends a GPU job (minutes, one at a time). The
//     button says so, because a click that silently starts a rented GPU is a
//     trap.
//   IMPOSSIBLE HERE — this server's separator cannot make this stem. The row
//     says which separator would, and nothing is offered in its place: a
//     backing track labelled "drums" would be a worse answer than none.
//
// ----- one player, deliberately ----------------------------------------------
//
// A single <audio> element for the whole rack, so pressing B while A is playing
// swaps instantly instead of stacking two stems on top of each other. The level
// meter is written straight to the DOM from the analyser rather than through
// state: it moves sixty times a second and nothing else on the screen needs to
// re-render when it does.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../icons";
import { fileUrl, playUrl } from "@/lib/music-creator/client";
import type { Side } from "@/lib/music-creator/mashup";
import {
  type StemCut,
  type StemId,
  type StemLib,
  type StemOffer,
  findCut,
  readStemLib,
  stemById,
  withCut,
} from "@/lib/music-creator/stems";
import type { Project, Render } from "@/lib/music-creator/types";
import { useStudio } from "../studio";
import type { SideClip } from "./SongPicker";

export interface RackSide {
  side: Side;
  /** How the column is titled. */
  name: string;
  /** False when this side has no audio in the tab, so nothing can be split. */
  hasAudio: boolean;
  /** True when the only audio is a 30-second catalogue preview. */
  preview?: boolean;
}

// ----- separating a stem -----------------------------------------------------

/**
 * The one place a stem is separated, shared by Mashup and Remix.
 *
 * Both tools want the same thing of it: spend a GPU job, file the take as an
 * ordinary render (so it is copied into the account's library and keeps playing
 * once the pod sleeps), and record the cut against the side it came from so
 * nothing is ever separated twice. Keeping it here rather than in each tool is
 * what makes "the layered mashup reuses whatever the rack split" true instead
 * of aspirational.
 */
export function useStemSplitter(opts: {
  projectId: string;
  clipFor: (side: Side) => SideClip | null;
  nameFor: (side: Side) => string;
  patch: (fn: (current: Project) => Partial<Project>) => void;
  onError: (message: string) => void;
}): { split: (side: Side, stemId: StemId) => Promise<StemCut | null>; splitting: string | null } {
  const { runAndFile } = useStudio();
  const [splitting, setSplitting] = useState<string | null>(null);
  const { projectId, clipFor, nameFor, patch, onError } = opts;

  const split = useCallback(
    async (side: Side, stemId: StemId): Promise<StemCut | null> => {
      const stem = stemById(stemId);
      const clip = clipFor(side);
      if (!stem) return null;
      if (!clip) {
        onError(
          `${nameFor(side)} has no audio in this tab, so nothing can be separated out of it. Pick a track with a ` +
            "preview, or drop its file in.",
        );
        return null;
      }
      setSplitting(`${side}:${stemId}`);
      try {
        const take = await runAndFile(
          projectId,
          "stem",
          "jobs/separate",
          { audio_b64: clip.dataUrl, filename: clip.name, mode: stem.mode },
          `${stem.label} from ${nameFor(side)}`,
        );
        if (!take) return null;
        if (take.error || !take.fileId) {
          onError(take.error ?? `The ${stem.label.toLowerCase()} separation produced no file.`);
          return null;
        }
        const cut: StemCut = {
          stemId,
          renderId: take.id,
          fileId: take.fileId,
          by: typeof take.meta?.method === "string" ? take.meta.method : undefined,
          preview: clip.preview,
          at: Date.now(),
        };
        patch((now) => ({
          data: { ...(now.data ?? {}), stemLib: withCut(readStemLib(now.data?.stemLib), side, cut) },
        }));
        return cut;
      } finally {
        setSplitting(null);
      }
    },
    [clipFor, nameFor, onError, patch, projectId, runAndFile],
  );

  return { split, splitting };
}

/** `${side}:${stemId}` — what is playing, and which cell to light up. */
type CellKey = string;

function cellKey(side: Side, stem: StemId): CellKey {
  return `${side}:${stem}`;
}

/**
 * One <audio>, one analyser, and a meter written by hand.
 *
 * `createMediaElementSource` may only be called once per element, so the graph
 * is built on first play and kept. Everything is same-origin (the hub proxies
 * both the library and the GPU server), which is what makes the analyser legal
 * here at all — a cross-origin element would silently feed it zeroes.
 */
function useStemPlayer(onLevel: (level: number) => void) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const graph = useRef<{ ctx: AudioContext; analyser: AnalyserNode } | null>(null);
  const frame = useRef(0);
  const [playing, setPlaying] = useState<CellKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meter = useCallback(() => {
    const node = graph.current;
    if (!node) return;
    const data = new Uint8Array(node.analyser.fftSize);
    const tick = () => {
      node.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      onLevel(Math.min(1, Math.sqrt(sum / data.length) * 2.6));
      frame.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(tick);
  }, [onLevel]);

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    onLevel(0);
    const el = audio.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    setPlaying(null);
  }, [onLevel]);

  const play = useCallback(
    async (key: CellKey, src: string) => {
      setError(null);
      if (playing === key) {
        stop();
        return;
      }
      const el = audio.current;
      if (!el) return;
      el.src = src;
      try {
        if (!graph.current) {
          const Ctor =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctor) {
            const ctx = new Ctor();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            ctx.createMediaElementSource(el).connect(analyser);
            analyser.connect(ctx.destination);
            graph.current = { ctx, analyser };
          }
        }
        await graph.current?.ctx.resume().catch(() => {});
        await el.play();
        setPlaying(key);
        meter();
      } catch (err) {
        // A stem still on a sleeping GPU is the usual cause, and it is worth
        // naming rather than leaving a dead button.
        setError(
          `That stem would not play (${(err as Error).message}). If it was never saved to your account it only ` +
            "exists on the GPU, which may be asleep.",
        );
        setPlaying(null);
      }
    },
    [meter, playing, stop],
  );

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      void graph.current?.ctx.close().catch(() => {});
    },
    [],
  );

  return { audio, play, stop, playing, error };
}

export function StemRack({
  sides,
  lib,
  offers,
  renders,
  busy,
  splitting,
  onSplit,
}: {
  sides: RackSide[];
  lib: StemLib;
  offers: StemOffer[];
  renders: Render[];
  /** True while any GPU job is running — a second one would abort the first. */
  busy: boolean;
  /** The cell whose split is running now, as `side:stem`. */
  splitting: string | null;
  onSplit: (side: Side, stemId: StemId) => void;
}) {
  const bar = useRef<HTMLSpanElement | null>(null);
  const onLevel = useCallback((level: number) => {
    const el = bar.current;
    if (el) el.style.transform = `scaleX(${level.toFixed(3)})`;
  }, []);
  const { audio, play, stop, playing, error } = useStemPlayer(onLevel);

  const srcFor = (cut: StemCut): string => {
    const render = renders.find((r) => r.id === cut.renderId);
    return (render && playUrl(render)) || fileUrl(cut.fileId);
  };

  const nowPlaying = playing
    ? (() => {
        const [side, stem] = playing.split(":");
        const column = sides.find((s) => s.side === side);
        const row = offers.find((o) => o.stem.id === stem);
        return row && column ? `${row.stem.label.toLowerCase()} · ${column.name}` : null;
      })()
    : null;

  return (
    <div className="mct-rack">
      <div className="mct-rack-h">
        <strong>Hear one part at a time</strong>
        <span className="mct-rack-now">
          {nowPlaying ? (
            <>
              <span className="mct-rack-meter">
                <span ref={bar} />
              </span>
              {nowPlaying}
              <button type="button" className="mc-btn mc-btn-s" onClick={stop}>
                Stop
              </button>
            </>
          ) : (
            "nothing playing"
          )}
        </span>
      </div>

      <table className="mct-rack-t">
        <thead>
          <tr>
            <th scope="col">Stem</th>
            {sides.map((s) => (
              <th key={s.side} scope="col">
                <span className="mct-ab">{s.side.toUpperCase()}</span> {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {offers.map(({ stem, by, why }) => (
            <tr key={stem.id} className={by ? "" : "is-dead"}>
              <th scope="row">
                <span className="mct-rack-tag">{stem.tag}</span>
                <span className="mct-rack-l">
                  <strong>{stem.label}</strong>
                  <em>{by ? stem.what : why}</em>
                </span>
              </th>
              {sides.map((column) => {
                const cut = findCut(lib, column.side, stem.id);
                const key = cellKey(column.side, stem.id);
                const isPlaying = playing === key;
                const isSplitting = splitting === key;

                if (!by) {
                  return (
                    <td key={column.side}>
                      <span className="mct-rack-no">—</span>
                    </td>
                  );
                }
                if (cut) {
                  return (
                    <td key={column.side}>
                      <div className="mct-rack-cell">
                        <button
                          type="button"
                          className={`mct-rack-play ${isPlaying ? "is-on" : ""}`}
                          onClick={() => void play(key, srcFor(cut))}
                        >
                          {isPlaying ? <Icon.Pause width={12} height={12} /> : <Icon.Play width={12} height={12} />}
                          {isPlaying ? "Playing" : "Play"}
                        </button>
                        <a className="mct-rack-dl" href={srcFor(cut)} download title={`Download ${column.name} — ${stem.label}`}>
                          <Icon.Download width={11} height={11} />
                        </a>
                        {cut.preview && <em className="mct-rack-30">30s</em>}
                      </div>
                    </td>
                  );
                }
                return (
                  <td key={column.side}>
                    <button
                      type="button"
                      className="mct-rack-split"
                      onClick={() => onSplit(column.side, stem.id)}
                      disabled={!column.hasAudio || busy}
                      title={
                        !column.hasAudio
                          ? `${column.name} has no audio loaded in this tab`
                          : busy
                            ? "The GPU runs one job at a time — this is available when the current one finishes"
                            : `Separate ${stem.label.toLowerCase()} out of ${column.name} on the GPU`
                      }
                    >
                      {isSplitting ? (
                        "Splitting…"
                      ) : (
                        <>
                          <Icon.Layers width={11} height={11} /> Split
                        </>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* One element for the whole rack: pressing B while A plays swaps. */}
      <audio ref={audio} preload="none" onEnded={stop} className="mc-sr" />

      {error && <p className="mc-note is-bad">{error}</p>}
      <p className="mc-note">
        Each cell is one separated file. <strong>Split</strong> spends a GPU job and is remembered afterwards, so
        comparing the same stem again is instant and the layered mashup below reuses whatever is already here.
        {sides.some((s) => s.preview) && " A side marked 30s was split out of the catalogue preview, not a whole record."}
      </p>
    </div>
  );
}
