"use client";

// ---------------------------------------------------------------------------
// The shot plan, in the chat — a call sheet you can type on.
//
// Two bands of information, because they are two different kinds of decision.
// The HEADER holds what is true of the whole film — world, wardrobe, light,
// grade, glass, palette — and every field there is repeated verbatim into every
// shot, which is the reason a dozen separate generations read as one film.
// Under it the SHOT TABLE holds one row per cut, dense and tabular the way an
// edit list is, with the numbers in tabular figures so the durations and the
// lenses line up down the column and a wrong one is visible without reading.
//
// Everything is editable in place: no modal, no edit mode, no save button. The
// sheet is the film, so typing in it changes the film. The woven H3 prompt sits
// one disclosure below each row, and editing THAT pins it — from then on the
// owner's words are rendered instead of the weave, and the row says so.
// ---------------------------------------------------------------------------

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import {
  MAX_SHOTS,
  MAX_SHOT_SEC,
  MIN_SHOT_SEC,
  blankShot,
  etaSeconds,
  formatEta,
  h3Form,
  normalise,
  runtimeSec,
  shotPrompt,
  timecode,
  type Shot,
  type Storyboard,
} from "@/lib/studio/storyboard";

const FIELD =
  "w-full resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-ink transition "
  + "placeholder:text-ink-faint hover:border-line focus:border-ink-faint focus:bg-canvas focus:outline-none";

/**
 * An in-place field that looks like the sheet until you put a caret in it.
 *
 * Multiline fields grow to their content rather than scrolling inside a fixed
 * box. On this sheet that is not a nicety: the world, the wardrobe and the
 * grade are the exact strings repeated into every shot's prompt, so a value
 * the owner cannot read in full is a continuity break they cannot see.
 */
function Field({
  value,
  onChange,
  placeholder,
  multiline,
  className = "",
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // These fields are border-box, so the border has to be added back: setting
    // the height to scrollHeight alone leaves the last line a couple of pixels
    // short, which on a two-line value reads as a clipped sentence.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, []);
  // On mount and on every change, including one made somewhere else — the
  // shots reorder, and a row must not keep the height of its old contents.
  useLayoutEffect(fit, [fit, value, multiline]);
  // And whenever the column itself changes width. A height measured on a wide
  // screen clips the same text on a phone, which is exactly where the sheet
  // is least forgiving about a half-visible line.
  const lastWidth = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Width only. Watching height would re-fire on the very height this sets.
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width === lastWidth.current) return;
      lastWidth.current = width;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  if (!multiline) {
    return (
      <input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${FIELD} ${className}`}
      />
    );
  }
  return (
    <textarea
      ref={ref}
      aria-label={label}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        fit();
      }}
      placeholder={placeholder}
      rows={1}
      className={`${FIELD} overflow-hidden leading-snug ${className}`}
    />
  );
}

/** A header fact: the label above, the value below, both on one baseline grid. */
function Fact({
  label,
  value,
  onChange,
  placeholder,
  span = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  span?: string;
}) {
  return (
    <div className={span}>
      <p className="px-1.5 text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      <Field
        label={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        multiline
        className="text-[11.5px]"
      />
    </div>
  );
}

export function StoryboardCard({
  board,
  onChange,
  onRender,
  busy,
  done,
  soundtrack,
}: {
  board: Storyboard;
  onChange: (b: Storyboard) => void;
  onRender: (b: Storyboard) => void;
  /** A film from this sheet is already rendering. */
  busy: boolean;
  /** The sheet has been superseded — an older turn, or already shot. */
  done: boolean;
  /** The name of the track that will be laid under it, if one is attached. */
  soundtrack?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const runtime = runtimeSec(board);
  const eta = useMemo(() => etaSeconds(board), [board]);

  const set = (patch: Partial<Storyboard>) => onChange({ ...board, ...patch });
  const setShot = (i: number, patch: Partial<Shot>) =>
    onChange(normalise({ ...board, shots: board.shots.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));

  const addShot = (at: number) =>
    onChange(
      normalise({
        ...board,
        shots: [...board.shots.slice(0, at), blankShot(board, at), ...board.shots.slice(at)],
      }),
    );

  const removeShot = (i: number) =>
    onChange(normalise({ ...board, shots: board.shots.filter((_, k) => k !== i) }));

  const move = (i: number, by: number) => {
    const to = i + by;
    if (to < 0 || to >= board.shots.length) return;
    const shots = [...board.shots];
    [shots[i], shots[to]] = [shots[to], shots[i]];
    onChange(normalise({ ...board, shots }));
  };

  return (
    <section
      aria-label={`Shot plan: ${board.title}`}
      className="mt-2 overflow-hidden rounded-xl border border-line bg-canvas"
    >
      {/* ---- the masthead ---- */}
      <header className="border-b border-line bg-panel px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Field
            label="Film title"
            value={board.title}
            onChange={(title) => set({ title })}
            className="!w-auto min-w-[10ch] flex-1 text-[15px] font-semibold tracking-[-0.01em]"
          />
          <p className="flex shrink-0 items-center gap-2.5 text-[10.5px] tabular-nums text-ink-muted">
            <span>
              {board.shots.length} {board.shots.length === 1 ? "cut" : "cuts"}
            </span>
            <span className="h-2.5 w-px bg-line" aria-hidden />
            <span>{timecode(runtime)}</span>
            <span className="h-2.5 w-px bg-line" aria-hidden />
            <span>{board.aspectRatio}</span>
          </p>
        </div>
        <Field
          label="Logline"
          value={board.logline}
          onChange={(logline) => set({ logline })}
          placeholder="One sentence: what happens."
          multiline
          className="mt-0.5 text-[11.5px] text-ink-muted"
        />

        {/* Two columns, never four: every value here is a sentence that is
            copied word for word into every shot, so it has to be readable at
            full length rather than trimmed to fit a tidy grid. */}
        <div className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-2">
          <Fact label="World" value={board.world} onChange={(world) => set({ world })} placeholder="Where, and what it feels like" />
          <Fact label="Wardrobe" value={board.wardrobe} onChange={(wardrobe) => set({ wardrobe })} placeholder="Exactly what everyone wears" />
          <Fact label="Light" value={board.lighting} onChange={(lighting) => set({ lighting })} placeholder="The light, unchanged all film" />
          <Fact label="Grade" value={board.grade} onChange={(grade) => set({ grade })} placeholder="The colour, unchanged all film" />
          <Fact label="Glass" value={board.lens} onChange={(lens) => set({ lens })} placeholder="The lens set" />
          <Fact label="Look" value={board.look} onChange={(look) => set({ look })} placeholder="Live action, anime, 3D…" />
          <Fact label="Sound" value={board.soundscape} onChange={(soundscape) => set({ soundscape })} placeholder="What the scene sounds like" />
          <Fact label="Score" value={board.music} onChange={(music) => set({ music })} placeholder="The music under it, or none" />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {board.palette.length > 0 && (
            <span className="flex items-center gap-1" aria-label="Palette">
              {board.palette.map((c) => (
                <span
                  key={c}
                  title={c}
                  className="h-3.5 w-3.5 rounded-[3px] border border-line"
                  style={{ background: c }}
                />
              ))}
            </span>
          )}
          {board.cast.length > 0 && (
            <ul className="flex flex-wrap items-center gap-1">
              {board.cast.map((c) => (
                <li
                  key={c.id}
                  title={c.look}
                  className="rounded border border-line px-1.5 py-px text-[10px] tracking-[0.06em] text-ink-muted"
                >
                  {c.name}
                  {c.subject ? <span className="ml-1 tabular-nums text-ink-faint">S{c.subject}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {soundtrack && (
            <span className="flex items-center gap-1 text-[10px] text-ink-muted">
              <Icon.Waveform width={10} height={10} /> {soundtrack} under the cut
            </span>
          )}
        </div>
      </header>

      {/* ---- the shots ---- */}
      <ol className="divide-y divide-line-soft">
        {board.shots.map((shot, i) => {
          const chained = i > 0 && shot.link === "continuous";
          const prompt = shotPrompt(board, i);
          const isOpen = open === shot.id;
          return (
            <li key={shot.id} className="group relative px-3 py-2">
              {/* The join to the shot above, stated once and stated plainly. */}
              {i > 0 && (
                <button
                  type="button"
                  disabled={done}
                  onClick={() => setShot(i, { link: chained ? "cut" : "continuous" })}
                  title={
                    chained
                      ? "Rendered from the last frame of the shot above — one unbroken take. Click for a hard cut."
                      : "A new angle, matched to the shot above. Click to make it one unbroken take."
                  }
                  className={`mb-1.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9.5px] uppercase tracking-[0.12em] transition disabled:cursor-default ${
                    chained
                      ? "border-accent/45 text-accent"
                      : "border-line text-ink-faint hover:text-ink-muted"
                  }`}
                >
                  {chained ? <Icon.Link width={9} height={9} /> : <Icon.Scissors width={9} height={9} />}
                  {chained ? "same take" : "cut"}
                </button>
              )}

              <div className="flex gap-2.5">
                <span className="mt-1 w-5 shrink-0 text-right text-[11px] font-semibold tabular-nums text-ink-faint">
                  {i + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                    {/* The title takes a whole row before it will shrink: a
                        clipped shot name is the one thing on this sheet you
                        navigate by. The metrics wrap under it instead. */}
                    <Field
                      label={`Shot ${i + 1} title`}
                      value={shot.title}
                      onChange={(title) => setShot(i, { title })}
                      className="!w-auto min-w-[22ch] flex-1 text-[12.5px] font-medium"
                    />
                    <label className="flex items-center rounded-md border border-transparent pl-1 text-[11px] tabular-nums text-ink-muted transition hover:border-line focus-within:border-ink-faint">
                      <input
                        aria-label={`Shot ${i + 1} duration in seconds`}
                        type="number"
                        min={MIN_SHOT_SEC}
                        max={MAX_SHOT_SEC}
                        value={shot.durationSec}
                        onChange={(e) => setShot(i, { durationSec: Math.min(MAX_SHOT_SEC, Math.max(MIN_SHOT_SEC, Number(e.target.value) || MIN_SHOT_SEC)) })}
                        className="w-10 bg-transparent py-1 text-right focus:outline-none"
                      />
                      <span className="pr-1 text-ink-faint">s</span>
                    </label>
                    <label className="flex items-center rounded-md border border-transparent pl-1 text-[11px] tabular-nums text-ink-muted transition hover:border-line focus-within:border-ink-faint">
                      <input
                        aria-label={`Shot ${i + 1} focal length in millimetres`}
                        type="number"
                        min={8}
                        max={300}
                        value={shot.lensMm}
                        onChange={(e) => setShot(i, { lensMm: Math.min(300, Math.max(8, Number(e.target.value) || 35)) })}
                        className="w-11 bg-transparent py-1 text-right focus:outline-none"
                      />
                      <span className="pr-1 text-ink-faint">mm</span>
                    </label>
                    <Field
                      label={`Shot ${i + 1} framing`}
                      value={shot.framing}
                      onChange={(framing) => setShot(i, { framing })}
                      placeholder="framing"
                      className="!w-auto min-w-[9ch] max-w-[14ch] flex-1 text-[11px] text-ink-muted"
                    />
                    <Field
                      label={`Shot ${i + 1} camera move`}
                      value={shot.move}
                      onChange={(m) => setShot(i, { move: m })}
                      placeholder="camera move"
                      className="!w-auto min-w-[11ch] flex-[2] text-[11px] text-ink-muted"
                    />
                  </div>

                  <Field
                    label={`Shot ${i + 1} action`}
                    value={shot.action}
                    onChange={(action) => setShot(i, { action })}
                    placeholder="What physically happens across these seconds."
                    multiline
                    className="mt-0.5 text-[12px] leading-relaxed"
                  />

                  <div className="grid gap-x-3 sm:grid-cols-2">
                    <Field
                      label={`Shot ${i + 1} ends on`}
                      value={shot.endsOn}
                      onChange={(endsOn) => setShot(i, { endsOn })}
                      placeholder="Ends on… (the next shot opens here)"
                      multiline
                      className="text-[11px] text-ink-muted"
                    />
                    <Field
                      label={`Shot ${i + 1} dialogue`}
                      value={shot.dialogue}
                      onChange={(dialogue) => setShot(i, { dialogue })}
                      placeholder="Spoken line, if any"
                      multiline
                      className="text-[11px] text-ink-muted"
                    />
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : shot.id)}
                      aria-expanded={isOpen}
                      className="inline-flex items-center gap-1 text-[10px] text-ink-faint transition hover:text-ink"
                    >
                      <Icon.Chevron
                        width={10}
                        height={10}
                        className={`transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                      />
                      {shot.prompt ? "Your prompt" : "H3 prompt"}
                      <span className="ml-0.5 rounded border border-line px-1 text-[9px] uppercase tracking-[0.1em]">
                        {h3Form(board, i)}
                      </span>
                    </button>
                    {shot.references.length > 0 && (
                      <span className="text-[10px] tabular-nums text-ink-faint">
                        refs {shot.references.map((n) => `S${n}`).join(" ")}
                      </span>
                    )}
                    {shot.prompt && (
                      <button
                        type="button"
                        onClick={() => setShot(i, { prompt: undefined })}
                        className="text-[10px] text-ink-faint underline transition hover:text-ink"
                      >
                        Re-weave from the sheet
                      </button>
                    )}
                  </div>

                  {isOpen && (
                    <textarea
                      aria-label={`Shot ${i + 1} prompt`}
                      value={prompt}
                      onChange={(e) => setShot(i, { prompt: e.target.value })}
                      rows={8}
                      spellCheck={false}
                      className="mt-1 w-full resize-y rounded-lg border border-line bg-panel px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-ink-muted focus:border-ink-faint focus:outline-none"
                    />
                  )}
                </div>

                {!done && (
                  <div className="flex shrink-0 flex-col gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move shot ${i + 1} earlier`}
                      className="rounded p-0.5 text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:opacity-25"
                    >
                      <Icon.Chevron width={11} height={11} className="-rotate-90" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === board.shots.length - 1}
                      aria-label={`Move shot ${i + 1} later`}
                      className="rounded p-0.5 text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:opacity-25"
                    >
                      <Icon.Chevron width={11} height={11} className="rotate-90" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeShot(i)}
                      disabled={board.shots.length < 2}
                      aria-label={`Delete shot ${i + 1}`}
                      className="rounded p-0.5 text-ink-faint transition hover:bg-panel-2 hover:text-ink disabled:opacity-25"
                    >
                      <Icon.Close width={11} height={11} />
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* ---- what it will cost in time, and the one button ---- */}
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-panel px-3 py-2">
        {!done && board.shots.length < MAX_SHOTS && (
          <button
            type="button"
            onClick={() => addShot(board.shots.length)}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-line px-2 py-1 text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink"
          >
            <Icon.Plus width={11} height={11} /> Add a cut
          </button>
        )}
        <p className="text-[10.5px] leading-tight text-ink-faint">
          {board.shots.length} {board.shots.length === 1 ? "clip" : "clips"} rendered in order on this PC and cut
          together — <span className="tabular-nums text-ink-muted">about {formatEta(eta).replace(" left", "")}</span>.
        </p>
        <button
          type="button"
          onClick={() => onRender(board)}
          disabled={busy || done || !board.shots.some((s) => s.action.trim())}
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-canvas transition hover:opacity-90 disabled:opacity-40"
        >
          <Icon.Film width={13} height={13} />
          {busy ? "Rendering…" : done ? "Shot" : "Make the film"}
        </button>
      </footer>
    </section>
  );
}
