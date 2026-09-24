"use client";

// ---------------------------------------------------------------------------
// The score board — a shot plan you read against a song.
//
// Three things had to be true at once, and they decide the whole layout.
//
//   IT IS A SHEET, NOT A GALLERY. Eighteen cuts with times, lengths, lyrics and
//   continuity on them is tabular data, and the owner reads dense tables faster
//   than cards. So: one row per cut, tabular numerals, the numbers in columns
//   you can scan down, and the editor opens INSIDE the row rather than in a
//   modal that hides the rest of the film.
//
//   THE CLOCK IS ALWAYS VISIBLE. Every row's time only means something against
//   the song, so the ruler at the top is not decoration — it is the axis the
//   table is sorted by, and selecting a row lights its slot up there.
//
//   LIP SYNC IS THE LOUDEST THING ON IT. Amber, in both lanes, on the row and
//   in its own board underneath, because "which cuts sing" is the question this
//   app exists to answer and it must be answerable without reading a word.
//
// Colour law, inherited from the cutting room and not re-litigated here:
// cyan is the song, amber is lip sync, indigo is a shot playing under the music.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { PLAYS, SINGS, timecode } from "@/lib/seedance/constants";
import {
  coverage,
  placeShots,
  renderSec,
  scoreNotes,
  shotPrompt,
  sungShots,
  type PlacedShot,
  type Score,
  type ScoreShot,
} from "@/lib/seedance/score";
import { barTimes } from "@/lib/seedance/audio/timeline";
import { MAX_SHOT_SEC, MIN_SHOT_SEC, MAX_SHOTS } from "@/lib/studio/storyboard";

/** Which board is on screen. "both" draws the film, then the sung cuts again. */
type View = "all" | "sings" | "both";

export interface ScoreBoardProps {
  score: Score;
  onChange: (next: Score) => void;
  /** Normalised 0–1 peaks of the song. Session-only, so absent after a reload. */
  peaks?: number[];
  /** Kick off the whole film. Absent while one is already running. */
  onRender?: () => void;
  /** Re-render one cut on its own, as a preview. */
  onRenderShot?: (index: number) => void;
  /** Per-cut preview clips, by placed index. */
  clips?: Record<number, string>;
  /** Which cut is being re-rendered right now. */
  busyShot?: number | null;
  busy?: boolean;
}

export function ScoreBoard({
  score,
  onChange,
  peaks,
  onRender,
  onRenderShot,
  clips,
  busyShot,
  busy = false,
}: ScoreBoardProps) {
  const [view, setView] = useState<View>("both");
  const [open, setOpen] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState<string | null>(null);

  const placed = useMemo(() => placeShots(score), [score]);
  const sung = useMemo(() => sungShots(placed), [placed]);
  const notes = useMemo(() => scoreNotes(score), [score]);
  const bars = useMemo(() => (score.timeline ? barTimes(score.timeline.grid) : []), [score.timeline]);
  const duration = score.timeline?.durationSec ?? 0;
  const errors = notes.filter((n) => n.kind === "error").length;

  // ----- edits -----
  const patch = (id: string, fields: Partial<ScoreShot>) =>
    onChange({ ...score, shots: score.shots.map((s) => (s.id === id ? { ...s, ...fields } : s)) });

  const remove = (id: string) =>
    onChange({ ...score, shots: score.shots.filter((s) => s.id !== id) });

  /** Put a new cut in the middle of this one — the way you split a long shot. */
  const split = (p: PlacedShot) => {
    if (score.shots.length >= MAX_SHOTS) return;
    const mid = snap(p.startSec + p.durationSec / 2);
    if (mid <= p.startSec + 0.1 || mid >= p.endSec - 0.1) return;
    onChange({
      ...score,
      shots: [
        ...score.shots,
        {
          ...p.shot,
          id: `shot-${Date.now().toString(36)}`,
          title: `${p.shot.title} (b)`,
          atSec: mid,
          link: "continuous",
          locked: false,
          prompt: undefined,
          panel: undefined,
        },
      ],
    });
  };

  /** The nearest bar line, when the grid is worth trusting. */
  const snap = (sec: number): number => {
    if (!bars.length || (score.timeline?.grid.confidence ?? 0) < 0.4) return Math.round(sec * 100) / 100;
    return bars.reduce((a, b) => (Math.abs(b - sec) < Math.abs(a - sec) ? b : a));
  };

  const snapAll = () =>
    onChange({
      ...score,
      shots: score.shots.map((s) => (s.locked ? s : { ...s, atSec: snap(s.atSec) })),
    });

  /**
   * Make this cut sing, or stop it singing.
   *
   * The lip-sync ranges stay the single source of truth — a shot does not carry
   * a "sings" flag, it OVERLAPS a range — so turning a cut on lays a range
   * exactly across it, and turning it off clears the ranges it overlaps. That
   * keeps the lane, the row and the board underneath from ever disagreeing, and
   * it makes the commonest edit in this app one click on the answer to the
   * question the column is already asking.
   */
  const toggleSings = (p: PlacedShot) => {
    if (p.sings) {
      const kept = score.lipsync.flatMap((r) => {
        const from = r.startSec;
        const to = r.startSec + r.durationSec;
        if (to <= p.startSec || from >= p.endSec) return [r];
        // A range reaching past this cut keeps the parts outside it, so
        // silencing one shot cannot silence its neighbour as well.
        const out = [];
        if (from < p.startSec) out.push({ ...r, durationSec: p.startSec - from });
        if (to > p.endSec) {
          out.push({ ...r, id: `${r.id}-b`, startSec: p.endSec, durationSec: to - p.endSec });
        }
        return out;
      });
      onChange({ ...score, lipsync: kept });
      return;
    }
    onChange({
      ...score,
      lipsync: [
        ...score.lipsync,
        { id: `lip-${Date.now().toString(36)}`, startSec: p.startSec, durationSec: p.durationSec },
      ],
    });
  };

  const rows = view === "sings" ? sung : placed;

  return (
    <section className="rounded-xl border border-line bg-panel" aria-label="Shot plan">
      <Header
        score={score}
        placed={placed}
        sung={sung}
        errors={errors}
        view={view}
        setView={setView}
        onSnapAll={bars.length ? snapAll : undefined}
        onRender={onRender}
        busy={busy}
      />

      <Ruler
        score={score}
        placed={placed}
        peaks={peaks}
        bars={bars}
        selected={open}
        onSelect={setOpen}
      />

      {notes.length > 0 && <Notes notes={notes} placed={placed} onSelect={setOpen} />}

      <Board
        rows={rows}
        score={score}
        duration={duration}
        open={open}
        setOpen={setOpen}
        showPrompt={showPrompt}
        setShowPrompt={setShowPrompt}
        patch={patch}
        remove={remove}
        split={split}
        snap={snap}
        toggleSings={toggleSings}
        onRenderShot={onRenderShot}
        clips={clips}
        busyShot={busyShot}
        label={view === "sings" ? "The cuts that sing" : "The film"}
      />

      {view === "both" && (
        <div className="border-t border-line">
          {sung.length ? (
            <Board
              rows={sung}
              score={score}
              duration={duration}
              open={open}
              setOpen={setOpen}
              showPrompt={showPrompt}
              setShowPrompt={setShowPrompt}
              patch={patch}
              remove={remove}
              split={split}
              snap={snap}
              toggleSings={toggleSings}
              onRenderShot={onRenderShot}
              clips={clips}
              busyShot={busyShot}
              label="The cuts that sing"
              sungOnly
            />
          ) : (
            <p className="px-3 py-4 text-xs text-ink-muted">
              <span style={{ color: SINGS.text }}>Nothing sings yet.</span> Drop a lip-sync range onto
              the song and whichever cuts it lands on become performance shots — their words will
              outrank their prompt.
            </p>
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-ink-faint">
        <span>
          Covers{" "}
          <b className="text-ink-muted tabular-nums">{Math.round(coverage(score) * 100)}%</b> of the
          song
        </span>
        <span>
          A clip can be {MIN_SHOT_SEC}–{MAX_SHOT_SEC}s, so a cut's length is the distance to the next one
        </span>
        <span>
          Rendered free on this PC, one cut at a time ·{" "}
          <b className="text-ink-muted tabular-nums">
            {estimate(placed)}
          </b>{" "}
          for all {placed.length}
        </span>
      </footer>
    </section>
  );
}

/** Rough wall-clock for the queue, at this PC's measured rate. */
function estimate(placed: PlacedShot[]): string {
  // 2.76 s per frame at 24 fps, measured on the owner's RTX 3050.
  const seconds = placed.reduce((t, p) => t + renderSec(p.durationSec) * 24 * 2.76, 0);
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return hours ? `~${hours}h ${mins}m` : `~${mins}m`;
}

// ----- header ----------------------------------------------------------------

function Header({
  score,
  placed,
  sung,
  errors,
  view,
  setView,
  onSnapAll,
  onRender,
  busy,
}: {
  score: Score;
  placed: PlacedShot[];
  sung: PlacedShot[];
  errors: number;
  view: View;
  setView: (v: View) => void;
  onSnapAll?: () => void;
  onRender?: () => void;
  busy: boolean;
}) {
  const t = score.timeline;
  const facts = [
    t ? timecode(t.durationSec) : null,
    t?.bpm ? `${t.bpm} BPM` : "free time",
    t?.key || null,
    `${placed.length} cut${placed.length === 1 ? "" : "s"}`,
  ].filter(Boolean);

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-ink">{score.name}</h3>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
          {facts.map((f) => (
            <span key={f} className="tabular-nums">
              {f}
            </span>
          ))}
          {sung.length > 0 && (
            <span className="tabular-nums" style={{ color: SINGS.text }}>
              {sung.length} sing
            </span>
          )}
          <span className="capitalize">{score.mode.replace(/-/g, " ")}</span>
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Which cuts to show"
        className="ml-auto flex rounded-lg border border-line p-0.5"
      >
        {(
          [
            { id: "all", label: "All cuts" },
            { id: "sings", label: `Sings${sung.length ? ` · ${sung.length}` : ""}` },
            { id: "both", label: "Both" },
          ] as const
        ).map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={`rounded-md px-2.5 py-1 text-xs transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              view === v.id ? "bg-panel-2 text-ink" : "text-ink-muted hover:text-ink"
            }`}
            style={view === v.id && v.id === "sings" ? { color: SINGS.text } : undefined}
          >
            {v.label}
          </button>
        ))}
      </div>

      {onSnapAll && (
        <button
          onClick={onSnapAll}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted transition hover:border-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          title="Move every unlocked cut onto its nearest measured bar line"
        >
          <Icon.Target width={12} height={12} />
          Snap to bars
        </button>
      )}

      {onRender && (
        <button
          onClick={onRender}
          disabled={busy || !placed.length}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-[#06121a] transition hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          title={
            errors
              ? `${errors} problem${errors === 1 ? "" : "s"} to fix first — the film will render anyway, but not as planned`
              : "Render every cut in order and lay the song under it"
          }
        >
          {busy ? <Icon.Refresh width={12} height={12} className="animate-spin" /> : <Icon.Film width={12} height={12} />}
          {busy ? "Rendering…" : "Make the film"}
        </button>
      )}
    </header>
  );
}

// ----- the ruler -------------------------------------------------------------

/**
 * The song, and everything measured on it.
 *
 * Four strips on one axis, because they only mean anything stacked: what the
 * arrangement is doing, what the waveform is doing, where the cuts fall, and
 * where the singing is. A cut that misses a bar line is visible here as a
 * misalignment rather than as a number somebody has to check.
 */
function Ruler({
  score,
  placed,
  peaks,
  bars,
  selected,
  onSelect,
}: {
  score: Score;
  placed: PlacedShot[];
  peaks?: number[];
  bars: number[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const t = score.timeline;
  const duration = t?.durationSec ?? 0;
  if (!t || duration <= 0) {
    return (
      <p className="border-b border-line px-3 py-4 text-xs text-ink-muted">
        No track measured yet — attach a song and the clock appears here.
      </p>
    );
  }
  const pc = (sec: number) => `${Math.max(0, Math.min(100, (sec / duration) * 100))}%`;
  // Enough bar lines to read as a grid, not so many they become a grey block.
  const showBars = bars.length && bars.length <= 160 ? bars : [];

  return (
    <div className="border-b border-line px-3 py-2">
      {/* sections */}
      <div className="relative h-5">
        {t.sections.map((s) => (
          <div
            key={s.id}
            className="absolute top-0 flex h-5 items-center overflow-hidden border-l border-line pl-1"
            style={{ left: pc(s.startSec), width: pc(s.endSec - s.startSec) }}
            title={`${s.provisional} · ${timecode(s.startSec)}–${timecode(s.endSec)} · energy ${s.level} · ${s.bars} bars`}
          >
            <span className="truncate text-[10px] uppercase tracking-wide text-ink-faint">
              {s.provisional}
            </span>
          </div>
        ))}
      </div>

      {/* the song */}
      <div className="relative h-12 overflow-hidden rounded bg-panel-2">
        {showBars.map((b, i) => (
          <span
            key={`${b}-${i}`}
            aria-hidden
            className="absolute top-0 h-full w-px"
            style={{ left: pc(b), background: "hsl(190 80% 60% / 0.10)" }}
          />
        ))}
        {peaks?.length ? (
          <svg
            viewBox={`0 0 ${peaks.length} 100`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            aria-hidden
          >
            <path
              d={peaks
                .map((p, i) => `M${i} ${50 - p * 48}V${50 + p * 48}`)
                .join("")}
              stroke="var(--color-accent)"
              strokeOpacity="0.5"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          <div className="absolute inset-x-0 top-1/2 h-px bg-accent/25" aria-hidden />
        )}
        {t.hits.map((h, i) => (
          <span
            key={`${h.atSec}-${i}`}
            className={`absolute top-0 h-full ${h.drop ? "w-0.5" : "w-px"}`}
            style={{
              left: pc(h.atSec),
              background: h.drop ? "var(--color-accent)" : "hsl(190 80% 70% / 0.45)",
            }}
            title={`${h.drop ? "Drop" : "Accent"} at ${h.atSec.toFixed(2)}s (×${h.strength})`}
          />
        ))}
      </div>

      {/* the cuts */}
      <div className="relative mt-1 h-7">
        {placed.map((p) => {
          const on = selected === p.shot.id;
          const skin = p.sings ? SINGS : PLAYS;
          return (
            <button
              key={p.shot.id}
              onClick={() => onSelect(on ? null : p.shot.id)}
              aria-pressed={on}
              className="absolute top-0 h-7 overflow-hidden rounded border px-1 text-left text-[10px] transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              style={{
                left: pc(p.startSec),
                width: pc(p.durationSec),
                background: skin.fill,
                borderColor: on ? skin.edgeOn : skin.edge,
                color: skin.text,
                ...(on ? { boxShadow: `0 2px 10px -2px ${skin.edgeOn}` } : {}),
              }}
              title={`${p.shot.title} · ${timecode(p.startSec)} · ${p.durationSec.toFixed(1)}s${
                p.sings ? " · sings" : ""
              }`}
            >
              <span className="block truncate leading-7 tabular-nums">
                {p.index + 1}
                {p.fault && <span className="ml-1 text-[#ffb4a0]">!</span>}
              </span>
            </button>
          );
        })}
      </div>

      {/* lip sync */}
      <div
        className="relative mt-1 h-3 rounded"
        style={{ background: SINGS.bed }}
        aria-label="Lip-sync ranges"
      >
        {score.lipsync.map((r) => (
          <span
            key={r.id}
            className="absolute top-0 h-3 rounded"
            style={{
              left: pc(r.startSec),
              width: pc(r.durationSec),
              background: SINGS.fill,
              border: `1px solid ${SINGS.edge}`,
            }}
            title={`Sings ${timecode(r.startSec)}–${timecode(r.startSec + r.durationSec)}`}
          />
        ))}
        {!score.lipsync.length && (
          <span className="absolute left-1 top-0 text-[9px] leading-3 text-ink-faint">
            no lip sync
          </span>
        )}
      </div>
    </div>
  );
}

// ----- what is wrong ---------------------------------------------------------

function Notes({
  notes,
  placed,
  onSelect,
}: {
  notes: ReturnType<typeof scoreNotes>;
  placed: PlacedShot[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const errors = notes.filter((n) => n.kind === "error");
  const rest = notes.filter((n) => n.kind !== "error");
  const shown = open ? notes : errors.length ? errors.slice(0, 4) : rest.slice(0, 2);

  const tone = {
    error: { color: "#ffb4a0", label: "Fix" },
    warn: { color: "#f0c674", label: "Check" },
    info: { color: "var(--color-ink-muted)", label: "Note" },
  } as const;

  return (
    <div className="border-b border-line bg-panel-2/50 px-3 py-2">
      <ul className="space-y-1">
        {shown.map((n, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
            <span
              className="mt-px shrink-0 font-semibold uppercase tracking-wide"
              style={{ color: tone[n.kind].color }}
            >
              {tone[n.kind].label}
            </span>
            {n.shot !== null && placed[n.shot] && (
              <button
                onClick={() => onSelect(placed[n.shot!].shot.id)}
                className="shrink-0 tabular-nums text-ink-muted underline decoration-dotted underline-offset-2 transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Cut {n.shot + 1}
              </button>
            )}
            <span className="text-ink-muted">{n.text}</span>
          </li>
        ))}
      </ul>
      {notes.length > shown.length && (
        <button
          onClick={() => setOpen(true)}
          className="mt-1 text-[11px] text-ink-faint underline decoration-dotted underline-offset-2 transition hover:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {notes.length - shown.length} more
        </button>
      )}
      {open && notes.length > 6 && (
        <button
          onClick={() => setOpen(false)}
          className="ml-2 mt-1 text-[11px] text-ink-faint underline decoration-dotted underline-offset-2 transition hover:text-ink-muted"
        >
          fewer
        </button>
      )}
    </div>
  );
}

// ----- the sheet -------------------------------------------------------------

function Board({
  rows,
  score,
  duration,
  open,
  setOpen,
  showPrompt,
  setShowPrompt,
  patch,
  remove,
  split,
  snap,
  toggleSings,
  onRenderShot,
  clips,
  busyShot,
  label,
  sungOnly = false,
}: {
  rows: PlacedShot[];
  score: Score;
  duration: number;
  open: string | null;
  setOpen: (id: string | null) => void;
  showPrompt: string | null;
  setShowPrompt: (id: string | null) => void;
  patch: (id: string, fields: Partial<ScoreShot>) => void;
  remove: (id: string) => void;
  split: (p: PlacedShot) => void;
  snap: (sec: number) => number;
  toggleSings: (p: PlacedShot) => void;
  onRenderShot?: (index: number) => void;
  clips?: Record<number, string>;
  busyShot?: number | null;
  label: string;
  sungOnly?: boolean;
}) {
  return (
    <div>
      <h4
        className="flex items-center gap-2 px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: sungOnly ? SINGS.text : "var(--color-ink-faint)" }}
      >
        {sungOnly && <Icon.Mic width={11} height={11} />}
        {label}
        <span className="font-normal normal-case tracking-normal text-ink-faint tabular-nums">
          {rows.length}
        </span>
        {sungOnly && (
          <span className="font-normal normal-case tracking-normal text-ink-faint">
            — on these, the words outrank the prompt
          </span>
        )}
      </h4>

      {!rows.length ? (
        <p className="px-3 pb-3 text-xs text-ink-muted">Nothing here yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-y border-line text-[10px] uppercase tracking-wide text-ink-faint">
                <th className="w-10 px-2 py-1.5 font-medium">#</th>
                <th className="w-20 px-2 py-1.5 font-medium">At</th>
                <th className="w-14 px-2 py-1.5 font-medium">Len</th>
                <th className="w-16 px-2 py-1.5 font-medium">Sings</th>
                <th className="px-2 py-1.5 font-medium">Cut</th>
                <th className="px-2 py-1.5 font-medium">Because</th>
                <th className="w-24 px-2 py-1.5 font-medium">Join</th>
                <th className="w-20 px-2 py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <Row
                  key={`${sungOnly ? "s" : "a"}-${p.shot.id}`}
                  p={p}
                  score={score}
                  duration={duration}
                  open={open === p.shot.id}
                  onOpen={() => setOpen(open === p.shot.id ? null : p.shot.id)}
                  showPrompt={showPrompt === p.shot.id}
                  onShowPrompt={() => setShowPrompt(showPrompt === p.shot.id ? null : p.shot.id)}
                  patch={patch}
                  remove={remove}
                  split={split}
                  snap={snap}
                  toggleSings={toggleSings}
                  onRenderShot={onRenderShot}
                  clip={clips?.[p.index]}
                  busy={busyShot === p.index}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({
  p,
  score,
  duration,
  open,
  onOpen,
  showPrompt,
  onShowPrompt,
  patch,
  remove,
  split,
  snap,
  toggleSings,
  onRenderShot,
  clip,
  busy,
}: {
  p: PlacedShot;
  score: Score;
  duration: number;
  open: boolean;
  onOpen: () => void;
  showPrompt: boolean;
  onShowPrompt: () => void;
  patch: (id: string, fields: Partial<ScoreShot>) => void;
  remove: (id: string) => void;
  split: (p: PlacedShot) => void;
  snap: (sec: number) => number;
  toggleSings: (p: PlacedShot) => void;
  onRenderShot?: (index: number) => void;
  clip?: string;
  busy: boolean;
}) {
  const { shot } = p;
  const skin = p.sings ? SINGS : PLAYS;
  const set = (fields: Partial<ScoreShot>) => patch(shot.id, fields);

  return (
    <>
      <tr
        className={`border-b border-line-soft align-top transition ${open ? "bg-panel-2" : "hover:bg-panel-2/60"}`}
        // The one place a colour carries meaning in the table: a 2px edge on a
        // singing row, matching the lane and the board below it.
        style={p.sings ? { boxShadow: `inset 2px 0 0 ${skin.edge}` } : undefined}
      >
        <td className="px-2 py-1.5 tabular-nums text-ink-faint">{p.index + 1}</td>
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.01"
              min={0}
              max={duration || undefined}
              value={shot.atSec}
              onChange={(e) => set({ atSec: Math.max(0, Number(e.target.value) || 0) })}
              disabled={shot.locked}
              aria-label={`Cut ${p.index + 1} start, seconds`}
              className="w-14 rounded border border-line bg-panel px-1 py-0.5 text-right tabular-nums text-ink disabled:opacity-50 focus:border-accent focus:outline-none"
            />
            <button
              onClick={() => set({ atSec: snap(shot.atSec) })}
              disabled={shot.locked}
              title="Snap to the nearest bar line"
              aria-label={`Snap cut ${p.index + 1} to the nearest bar`}
              className="text-ink-faint transition hover:text-accent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Icon.Target width={11} height={11} />
            </button>
          </div>
          <span className="mt-0.5 block text-[10px] tabular-nums text-ink-faint">
            {timecode(p.startSec, true)}
          </span>
        </td>
        <td className="px-2 py-1.5">
          <span
            className={`tabular-nums ${p.fault ? "font-semibold text-[#ffb4a0]" : "text-ink-muted"}`}
            title={
              p.fault === "short"
                ? `Under the ${MIN_SHOT_SEC}s floor`
                : p.fault === "long"
                  ? `Over the ${MAX_SHOT_SEC}s ceiling`
                  : `Renders as ${renderSec(p.durationSec).toFixed(2)}s and is trimmed back to ${p.durationSec.toFixed(2)}s`
            }
          >
            {p.durationSec.toFixed(1)}s
          </span>
        </td>
        <td className="px-2 py-1.5">
          <button
            onClick={() => toggleSings(p)}
            aria-pressed={p.sings}
            title={
              p.sings
                ? "This cut sings. Click to drop the lip-sync range and let it play under the music."
                : "Click to lay a lip-sync range across this cut — the words will then outrank its prompt."
            }
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={
              p.sings
                ? { background: SINGS.fill, color: SINGS.text }
                : { color: "var(--color-ink-faint)" }
            }
          >
            {p.sings ? (
              <>
                <Icon.Mic width={9} height={9} />
                {Math.round((p.sungSec / Math.max(0.01, p.durationSec)) * 100)}%
              </>
            ) : (
              "under"
            )}
          </button>
        </td>
        <td className="px-2 py-1.5">
          <input
            value={shot.title}
            onChange={(e) => set({ title: e.target.value })}
            aria-label={`Cut ${p.index + 1} title`}
            className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-medium text-ink transition hover:border-line focus:border-accent focus:outline-none"
          />
          <p className="px-1 text-[10px] leading-snug text-ink-faint line-clamp-2">{shot.action}</p>
          {p.words && (
            <p
              className="mt-0.5 px-1 text-[10px] leading-snug line-clamp-2"
              style={{ color: p.sings ? SINGS.text : "var(--color-ink-faint)" }}
              title={p.words}
            >
              “{p.words}”
            </p>
          )}
        </td>
        <td className="px-2 py-1.5">
          <input
            value={shot.because}
            onChange={(e) => set({ because: e.target.value })}
            placeholder="what in the audio put it here"
            aria-label={`Why cut ${p.index + 1} is here`}
            className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-ink-muted transition placeholder:text-ink-faint hover:border-line focus:border-accent focus:outline-none"
          />
          {p.section && (
            <span className="px-1 text-[10px] text-ink-faint">{p.section.provisional}</span>
          )}
        </td>
        <td className="px-2 py-1.5">
          <select
            value={shot.link}
            onChange={(e) => set({ link: e.target.value === "continuous" ? "continuous" : "cut" })}
            disabled={p.index === 0}
            aria-label={`How cut ${p.index + 1} joins the one before`}
            className="w-full rounded border border-line bg-panel px-1 py-0.5 text-ink disabled:opacity-50 focus:border-accent focus:outline-none"
          >
            <option value="cut">cut</option>
            <option value="continuous">continuous</option>
          </select>
        </td>
        <td className="px-2 py-1.5">
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => set({ locked: !shot.locked })}
              title={shot.locked ? "Unlock: a re-plan may move this cut" : "Lock this cut's time"}
              aria-label={shot.locked ? `Unlock cut ${p.index + 1}` : `Lock cut ${p.index + 1}`}
              className={`transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                shot.locked ? "text-accent" : "text-ink-faint hover:text-ink"
              }`}
            >
              {shot.locked ? <Icon.Lock width={12} height={12} /> : <Icon.Unlock width={12} height={12} />}
            </button>
            <button
              onClick={onOpen}
              aria-expanded={open}
              title={open ? "Close" : "Open this cut"}
              className="text-ink-faint transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Icon.Chevron
                width={12}
                height={12}
                className={`transition-transform ${open ? "rotate-180" : ""}`}
              />
            </button>
          </div>
        </td>
      </tr>

      {open && (
        <tr className="border-b border-line bg-panel-2">
          <td colSpan={8} className="px-3 py-3">
            <Editor
              p={p}
              score={score}
              set={set}
              remove={() => remove(shot.id)}
              split={() => split(p)}
              showPrompt={showPrompt}
              onShowPrompt={onShowPrompt}
              onRenderShot={onRenderShot}
              clip={clip}
              busy={busy}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ----- the editor ------------------------------------------------------------

const field =
  "w-full rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";
const legend = "mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint";

function Editor({
  p,
  score,
  set,
  remove,
  split,
  showPrompt,
  onShowPrompt,
  onRenderShot,
  clip,
  busy,
}: {
  p: PlacedShot;
  score: Score;
  set: (fields: Partial<ScoreShot>) => void;
  remove: () => void;
  split: () => void;
  showPrompt: boolean;
  onShowPrompt: () => void;
  onRenderShot?: (index: number) => void;
  clip?: string;
  busy: boolean;
}) {
  const { shot } = p;
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const woven = useMemo(() => shotPrompt(score, p.index), [score, p.index]);

  return (
    <div className="space-y-3">
      {p.sings && (
        <p
          className="rounded-lg px-2.5 py-2 text-[11px] leading-relaxed"
          style={{ background: SINGS.fill, color: SINGS.text }}
        >
          <b>This cut sings, so the audio outranks everything below.</b> The performer will be on
          camera with their face and mouth large and unobstructed, framed no wider than a medium
          shot, mouthing{" "}
          {p.words ? <>“{p.words}”</> : <>the vocal line (no words were transcribed for this stretch)</>}
          . Whatever the action says becomes the world that performance happens in. Move the lip-sync
          range if that is not what you want.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={legend}>Action — what physically happens</span>
          <textarea
            value={shot.action}
            onChange={(e) => set({ action: e.target.value })}
            rows={3}
            className={field}
          />
        </label>

        <label className="block">
          <span className={legend}>Location</span>
          <input
            value={shot.location}
            onChange={(e) => set({ location: e.target.value })}
            list={`places-${shot.id}`}
            placeholder="the stairwell"
            className={field}
          />
          <datalist id={`places-${shot.id}`}>
            {score.places.map((pl) => (
              <option key={pl.id} value={pl.name} />
            ))}
          </datalist>
        </label>

        <label className="block">
          <span className={legend}>Who is in it</span>
          <input
            value={shot.cast.join(", ")}
            onChange={(e) =>
              set({ cast: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
            }
            placeholder={score.cast.map((c) => c.name).join(", ") || "nobody named yet"}
            className={field}
          />
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className={legend}>Framing</span>
            <input value={shot.framing} onChange={(e) => set({ framing: e.target.value })} className={field} />
          </label>
          <label className="block">
            <span className={legend}>Lens</span>
            <input
              type="number"
              value={shot.lensMm}
              onChange={(e) => set({ lensMm: Number(e.target.value) || 35 })}
              className={`${field} text-right tabular-nums`}
            />
          </label>
          <label className="block">
            <span className={legend}>Stop</span>
            <input value={shot.aperture} onChange={(e) => set({ aperture: e.target.value })} className={field} />
          </label>
        </div>

        <label className="block">
          <span className={legend}>Camera move</span>
          <input value={shot.move} onChange={(e) => set({ move: e.target.value })} className={field} />
        </label>

        <label className="block sm:col-span-2">
          <span className={legend}>Camera note — the geometry behind the move</span>
          <textarea
            value={shot.cameraNote}
            onChange={(e) => set({ cameraNote: e.target.value })}
            rows={2}
            placeholder="travel distance, focal length at each end, what stays locked"
            className={field}
          />
        </label>

        <label className="block">
          <span className={legend}>Carried over from the cut before</span>
          <input value={shot.carry} onChange={(e) => set({ carry: e.target.value })} className={field} />
        </label>

        <label className="block">
          <span className={legend}>Ends on — what the next cut opens with</span>
          <input value={shot.endsOn} onChange={(e) => set({ endsOn: e.target.value })} className={field} />
        </label>
      </div>

      {/* beats */}
      <div>
        <span className={legend}>
          The clock inside this cut{" "}
          {p.durationSec > 6 && !shot.beats.length && (
            <b className="text-[#f0c674]">— {p.durationSec.toFixed(1)}s with no beats renders as a held pose</b>
          )}
        </span>
        <div className="space-y-1">
          {shot.beats.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="number"
                step="0.5"
                min={0}
                max={p.durationSec}
                value={b.at}
                onChange={(e) =>
                  set({
                    beats: shot.beats.map((x, k) =>
                      k === i ? { ...x, at: Math.max(0, Number(e.target.value) || 0) } : x,
                    ),
                  })
                }
                aria-label={`Beat ${i + 1} time`}
                className="w-16 rounded-lg border border-line bg-panel px-2 py-1 text-right text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
              />
              <input
                value={b.text}
                onChange={(e) =>
                  set({ beats: shot.beats.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) })
                }
                aria-label={`Beat ${i + 1}`}
                className={field}
              />
              <button
                onClick={() => set({ beats: shot.beats.filter((_, k) => k !== i) })}
                aria-label={`Remove beat ${i + 1}`}
                className="shrink-0 text-ink-faint transition hover:text-[#ffb4a0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <Icon.Close width={12} height={12} />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() =>
            set({
              beats: [
                ...shot.beats,
                { at: Math.min(p.durationSec, (shot.beats[shot.beats.length - 1]?.at ?? 0) + 2), text: "" },
              ],
            })
          }
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Icon.Plus width={11} height={11} /> Add a beat
        </button>
      </div>

      {/* the prompt */}
      <div>
        <button
          onClick={onShowPrompt}
          aria-expanded={showPrompt}
          className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Icon.Chevron
            width={11}
            height={11}
            className={`transition-transform ${showPrompt ? "rotate-180" : ""}`}
          />
          {showPrompt ? "Hide" : "Show"} the prompt this renders from
          {shot.prompt && <span className="text-accent">· hand-edited</span>}
        </button>
        {showPrompt && (
          <div className="mt-1.5">
            <textarea
              ref={promptRef}
              value={shot.prompt ?? woven}
              onChange={(e) => set({ prompt: e.target.value })}
              rows={10}
              spellCheck={false}
              className={`${field} font-mono text-[11px] leading-relaxed`}
            />
            <div className="mt-1 flex items-center gap-3">
              {shot.prompt && (
                <button
                  onClick={() => set({ prompt: undefined })}
                  className="text-[11px] text-ink-muted underline decoration-dotted underline-offset-2 transition hover:text-ink"
                >
                  Discard my edits and rebuild it from the board
                </button>
              )}
              <span className="text-[11px] text-ink-faint">
                {(shot.prompt ?? woven).length} characters
              </span>
            </div>
          </div>
        )}
      </div>

      {clip && (
        <div>
          <span className={legend}>This cut, rendered on its own</span>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={clip} controls playsInline className="max-h-56 w-full rounded-lg bg-black" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
        {onRenderShot && (
          <button
            onClick={() => onRenderShot(p.index)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-muted transition hover:border-accent hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            title="Render just this cut, to see it before committing an hour to the whole film"
          >
            {busy ? (
              <Icon.Refresh width={11} height={11} className="animate-spin" />
            ) : (
              <Icon.Play width={11} height={11} />
            )}
            {busy ? "Rendering this cut…" : clip ? "Render it again" : "Render just this cut"}
          </button>
        )}
        <button
          onClick={split}
          disabled={p.durationSec < MIN_SHOT_SEC * 2}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          title={
            p.durationSec < MIN_SHOT_SEC * 2
              ? `Too short to split — both halves would be under ${MIN_SHOT_SEC}s`
              : "Add a cut in the middle of this one"
          }
        >
          <Icon.Scissors width={11} height={11} /> Split
        </button>
        <button
          onClick={remove}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-muted transition hover:border-[#ffb4a0] hover:text-[#ffb4a0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          title="Delete this cut — the one before it runs on in its place"
        >
          <Icon.Trash width={11} height={11} /> Delete
        </button>
      </div>
    </div>
  );
}
