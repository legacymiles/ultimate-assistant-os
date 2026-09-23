"use client";

// ---------------------------------------------------------------------------
// The shot plan, in the chat — a call sheet you can type on.
//
// Laid out the way a real one is, in named sections, because the sheet has to
// answer four different questions and they are not the same question:
//
//   SHARED CHOICES  what is true of every frame — genre, look, glass, light,
//                   grade, palette. Every field here is repeated VERBATIM into
//                   every shot, which is the only reason a dozen separate
//                   generations read as one film.
//   CAST            who must not change, with their faces next to their
//                   description, and — when the story turns on it — what they
//                   change INTO and at which cut.
//   STORYBOARD      one row per cut: the drawn panel on the left, the call
//                   sheet on the right, and the join to the cut above stated
//                   on the panel's own axis so the chain is visible down the
//                   left edge of the sheet.
//   CONTINUITY      what is wrong with the plan, before it costs an hour.
//
// Everything is editable in place: no modal, no edit mode, no save button. The
// sheet is the film, so typing in it changes the film. The woven H3 prompt sits
// one disclosure below each row, and editing THAT pins it — from then on the
// owner's words are rendered instead of the weave, and the row says so.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { drawPanel, type PanelFace } from "@/lib/studio/panels";
import {
  MAX_SHOTS,
  MAX_SHOT_SEC,
  MIN_SHOT_SEC,
  blankShot,
  boardNotes,
  etaSeconds,
  fitRuntime,
  formatEta,
  h3Form,
  normalise,
  parseRuntime,
  runtimeRange,
  runtimeSec,
  shotPrompt,
  timecode,
  type Beat,
  type BoardNote,
  type Shot,
  type Storyboard,
} from "@/lib/studio/storyboard";

const FIELD =
  "w-full resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-ink transition "
  + "placeholder:text-ink-faint hover:border-line focus:border-ink-faint focus:bg-canvas focus:outline-none";

/** The small caps used for every label on the sheet, as a call sheet sets them. */
const KEY = "text-[9.5px] uppercase tracking-[0.14em] text-ink-faint";

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
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  label: string;
  disabled?: boolean;
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
        disabled={disabled}
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
      disabled={disabled}
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
      <p className={`px-1.5 ${KEY}`}>{label}</p>
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

/** A named band of the sheet, ruled off rather than boxed. */
function Section({
  n,
  title,
  aside,
  children,
}: {
  n: number;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className={`${KEY} shrink-0`}>
          <span className="tabular-nums text-ink-muted">{n}</span>
          <span className="mx-1.5 text-line" aria-hidden>
            ·
          </span>
          {title}
        </h3>
        <span className="h-px flex-1 bg-line-soft" aria-hidden />
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * The film's running time, as a field rather than a readout.
 *
 * Runtime is the first question anyone asks of a film and, on a shot plan, the
 * one number you cannot type: it is the sum of a dozen little ones. So it is
 * asked for here, before the render, and answered two ways — because they are
 * two different edits. SPREAD is arithmetic on the cuts that already exist:
 * instant, free, and it keeps every beat the owner wrote. RE-PLAN hands the
 * sheet back to Jarvis to rewrite at the new length, which is the only way the
 * number of cuts can change, and therefore the only way to reach a runtime
 * these rows cannot hold.
 */
function Runtime({
  board,
  onChange,
  onReplan,
  disabled,
}: {
  board: Storyboard;
  onChange: (b: Storyboard) => void;
  onReplan?: (targetSec: number) => void;
  disabled: boolean;
}) {
  const runtime = runtimeSec(board);
  const [text, setText] = useState(() => timecode(runtime));
  // The seconds can move from anywhere on this sheet — a shot's duration, a cut
  // added, a row deleted — and the field must not keep showing the old total.
  useEffect(() => setText(timecode(runtime)), [runtime]);

  const target = parseRuntime(text);
  const { min, max } = runtimeRange(board.shots.length);
  const pending = target !== null && target !== runtime;
  const reachable = target !== null && target >= min && target <= max;

  const spread = () => {
    if (!reachable || target === null) return;
    onChange(fitRuntime(board, target));
  };

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <label className="flex items-center gap-1.5 rounded-md border border-line bg-canvas px-1.5 py-1 transition focus-within:border-ink-faint">
        <Icon.Clock width={11} height={11} className="shrink-0 text-ink-faint" />
        <span className={KEY}>Runtime</span>
        <input
          aria-label="Total running time of the film"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              spread();
            }
            if (e.key === "Escape") setText(timecode(runtime));
          }}
          inputMode="numeric"
          className="w-12 bg-transparent text-right text-[11.5px] tabular-nums text-ink focus:outline-none disabled:text-ink-muted"
        />
      </label>

      {pending ? (
        <>
          {reachable && (
            <button
              type="button"
              onClick={spread}
              className="rounded-md border border-line px-2 py-1 text-[10.5px] text-ink-muted transition hover:border-ink-faint hover:text-ink"
            >
              Spread over {board.shots.length} {board.shots.length === 1 ? "cut" : "cuts"}
            </button>
          )}
          {onReplan && (
            <button
              type="button"
              onClick={() => onReplan(target!)}
              className="inline-flex items-center gap-1 rounded-md border border-accent/45 px-2 py-1 text-[10.5px] text-accent transition hover:bg-accent/10"
            >
              <Icon.Refresh width={10} height={10} />
              Re-plan at {timecode(target!)}
            </button>
          )}
          {!reachable && (
            <span className="text-[10px] leading-tight text-ink-faint">
              {board.shots.length} {board.shots.length === 1 ? "cut" : "cuts"} hold{" "}
              <span className="tabular-nums">
                {timecode(min)}–{timecode(max)}
              </span>
              . Re-planning changes how many there are.
            </span>
          )}
        </>
      ) : (
        text !== timecode(runtime) &&
        target === null && <span className="text-[10px] text-ink-faint">Seconds, or m:ss.</span>
      )}
    </div>
  );
}

/**
 * The clock inside one shot.
 *
 * A shot given seconds and no clock spends them on a held pose — six and a
 * half seconds of a family standing still is what that looks like — so the
 * beats are on the sheet at the same level as the action, not hidden behind a
 * disclosure. Each row owns the span from its own second to the next one's.
 */
function Beats({
  shot,
  index,
  onChange,
  disabled,
}: {
  shot: Shot;
  index: number;
  onChange: (beats: Beat[]) => void;
  disabled: boolean;
}) {
  const set = (i: number, patch: Partial<Beat>) =>
    onChange(shot.beats.map((b, k) => (k === i ? { ...b, ...patch } : b)));

  return (
    <div className="mt-0.5">
      {shot.beats.map((beat, i) => {
        const end = shot.beats[i + 1]?.at ?? shot.durationSec;
        return (
          <div key={i} className="flex items-baseline gap-1.5">
            <label className="flex shrink-0 items-baseline rounded border border-transparent transition focus-within:border-ink-faint hover:border-line">
              <input
                aria-label={`Shot ${index + 1} beat ${i + 1} at second`}
                type="number"
                min={0}
                max={MAX_SHOT_SEC}
                step={0.5}
                value={beat.at}
                disabled={disabled}
                onChange={(e) => set(i, { at: Math.max(0, Math.min(MAX_SHOT_SEC, Number(e.target.value) || 0)) })}
                className="w-8 bg-transparent py-0.5 text-right text-[10.5px] tabular-nums text-accent focus:outline-none"
              />
              <span className="pr-0.5 text-[9.5px] tabular-nums text-ink-faint">–{end.toFixed(1)}s</span>
            </label>
            <Field
              label={`Shot ${index + 1} beat ${i + 1}`}
              value={beat.text}
              disabled={disabled}
              onChange={(text) => set(i, { text })}
              placeholder="what happens at this second"
              multiline
              className="!w-auto min-w-[12ch] flex-1 !py-0.5 text-[11px] leading-snug text-ink-muted"
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(shot.beats.filter((_, k) => k !== i))}
                aria-label={`Delete beat ${i + 1} of shot ${index + 1}`}
                className="shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition hover:bg-panel-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Icon.Close width={9} height={9} />
              </button>
            )}
          </div>
        );
      })}
      {!disabled && shot.beats.length < 10 && (
        <button
          type="button"
          onClick={() =>
            onChange([
              ...shot.beats,
              {
                // A new beat lands halfway between the last one and the end,
                // which is where the gap actually is.
                at: shot.beats.length
                  ? Math.min(MAX_SHOT_SEC, Math.round((shot.beats[shot.beats.length - 1].at + shot.durationSec) / 2 * 2) / 2)
                  : 0,
                text: "",
              },
            ])
          }
          className="mt-0.5 inline-flex items-center gap-1 px-1.5 text-[10px] text-ink-faint transition hover:text-ink"
        >
          <Icon.Plus width={9} height={9} /> beat
        </button>
      )}
    </div>
  );
}

/** The drawn board for one cut, or the space where one would go. */
function Panel({
  shot,
  index,
  aspect,
  drawing,
  onDraw,
  disabled,
}: {
  shot: Shot;
  index: number;
  aspect: string;
  drawing: boolean;
  onDraw: () => void;
  disabled: boolean;
}) {
  const ratio = aspect === "9:16" ? "9 / 16" : aspect === "1:1" ? "1 / 1" : "16 / 9";
  return (
    <div className="w-[84px] shrink-0 sm:order-1 sm:w-[132px]">
      <div
        style={{ aspectRatio: ratio }}
        className="relative overflow-hidden rounded-md border border-line bg-panel-2"
      >
        {shot.panel ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL from this browser
          <img
            src={shot.panel}
            alt={`Storyboard panel for shot ${index + 1}: ${shot.title}`}
            className="h-full w-full animate-[fadeIn_420ms_cubic-bezier(0.16,1,0.3,1)] object-cover"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-[9.5px] tabular-nums text-ink-faint">
            {drawing ? "" : index + 1}
          </span>
        )}
        {drawing && (
          <span className="absolute inset-0 grid place-items-center bg-canvas/70 backdrop-blur-[1px]">
            <span className="h-3 w-3 animate-spin rounded-full border border-accent border-t-transparent" />
          </span>
        )}
        {!disabled && !drawing && (
          <button
            type="button"
            onClick={onDraw}
            aria-label={shot.panel ? `Redraw the panel for shot ${index + 1}` : `Draw the panel for shot ${index + 1}`}
            className={`absolute inset-0 grid place-items-center text-[10px] transition ${
              shot.panel
                ? "bg-canvas/0 text-transparent hover:bg-canvas/70 hover:text-ink focus-visible:bg-canvas/70 focus-visible:text-ink"
                : "text-ink-faint hover:bg-panel hover:text-ink"
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <Icon.Brush width={10} height={10} />
              {shot.panel ? "redraw" : "draw"}
            </span>
          </button>
        )}
      </div>
      <p className="mt-0.5 text-center text-[9.5px] tabular-nums text-ink-faint">{shot.durationSec}s</p>
    </div>
  );
}

/** One member of the cast: their face, their description, and any turn. */
function CastTile({
  member,
  face,
  shotCount,
  onChange,
  onRemoveTurn,
  disabled,
}: {
  member: Storyboard["cast"][number];
  face?: PanelFace;
  shotCount: number;
  onChange: (patch: Partial<Storyboard["cast"][number]>) => void;
  onRemoveTurn: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-2">
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border border-line bg-panel-2">
        {face ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL from this browser
          <img src={face.dataUrl} alt={member.name} className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-[9px] tabular-nums text-ink-faint">
            {member.subject ? `S${member.subject}` : "—"}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <Field
          label={`${member.name} name`}
          value={member.name}
          disabled={disabled}
          onChange={(name) => onChange({ name: name.toUpperCase() })}
          className="!py-0 text-[11px] font-semibold tracking-[0.06em]"
        />
        <Field
          label={`${member.name} look`}
          value={member.look}
          disabled={disabled}
          onChange={(look) => onChange({ look })}
          placeholder="Face, build, hair, skin, marks"
          multiline
          className="!py-0 text-[10.5px] leading-snug text-ink-muted"
        />
        {member.turnsAt !== null ? (
          <div className="mt-0.5 rounded-md border border-amber-500/30 bg-amber-500/[0.04] px-1.5 py-1">
            <div className="flex items-center gap-1">
              <Icon.Refresh width={9} height={9} className="shrink-0 text-amber-400" />
              <span className="text-[9.5px] uppercase tracking-[0.12em] text-amber-400">turns at cut</span>
              <input
                aria-label={`${member.name} turns at cut`}
                type="number"
                min={1}
                max={shotCount}
                value={member.turnsAt}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ turnsAt: Math.max(1, Math.min(shotCount, Number(e.target.value) || 1)) })
                }
                className="w-7 rounded border border-transparent bg-transparent text-right text-[10.5px] tabular-nums text-amber-400 transition hover:border-line focus:border-ink-faint focus:outline-none"
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={onRemoveTurn}
                  aria-label={`${member.name} does not change`}
                  className="ml-auto rounded p-0.5 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
                >
                  <Icon.Close width={9} height={9} />
                </button>
              )}
            </div>
            <Field
              label={`${member.name} turns into`}
              value={member.turnsInto}
              disabled={disabled}
              onChange={(turnsInto) => onChange({ turnsInto })}
              placeholder="What they become — skin, eyes, hair, bearing, damage"
              multiline
              className="!py-0 text-[10.5px] leading-snug text-ink-muted"
            />
          </div>
        ) : (
          !disabled && (
            <button
              type="button"
              onClick={() => onChange({ turnsAt: Math.min(2, shotCount), turnsInto: "" })}
              className="mt-0.5 inline-flex items-center gap-1 px-1.5 text-[10px] text-ink-faint transition hover:text-ink"
            >
              <Icon.Plus width={9} height={9} /> they change during the film
            </button>
          )
        )}
      </div>
    </div>
  );
}

/** What is wrong with the plan, while it is still free to fix. */
function Notes({ notes, onJump }: { notes: BoardNote[]; onJump: (shot: number) => void }) {
  if (!notes.length) return null;
  return (
    <ul className="space-y-1">
      {notes.map((note, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span
            aria-hidden
            className={`mt-[5px] h-1 w-1 shrink-0 rounded-full ${
              note.severity === "warn" ? "bg-amber-400" : "bg-ink-faint"
            }`}
          />
          <p className="text-[10.5px] leading-snug text-ink-muted">
            {note.shot >= 0 && (
              <button
                type="button"
                onClick={() => onJump(note.shot)}
                className="mr-1 rounded text-ink-faint underline decoration-line underline-offset-2 transition hover:text-ink"
              >
                Cut {note.shot + 1}
              </button>
            )}
            {note.text}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function StoryboardCard({
  board,
  onChange,
  onRender,
  onReplan,
  busy,
  done,
  soundtrack,
  faces = [],
}: {
  board: Storyboard;
  onChange: (b: Storyboard) => void;
  onRender: (b: Storyboard) => void;
  /** Hand the sheet back to Jarvis to re-plan at a new running time. */
  onReplan?: (b: Storyboard, targetSec: number) => void;
  /** A film from this sheet is already rendering. */
  busy: boolean;
  /** The sheet has been superseded — an older turn, or already shot. */
  done: boolean;
  /** The name of the track that will be laid under it, if one is attached. */
  soundtrack?: string;
  /** The reference photos this conversation is holding, for the cast tiles. */
  faces?: PanelFace[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<string[]>([]);
  const [drawError, setDrawError] = useState("");
  const runtime = runtimeSec(board);
  const eta = useMemo(() => etaSeconds(board), [board]);
  const notes = useMemo(() => boardNotes(board), [board]);
  const rows = useRef(new Map<string, HTMLLIElement>());

  const set = (patch: Partial<Storyboard>) => onChange({ ...board, ...patch });
  const setShot = (i: number, patch: Partial<Shot>) =>
    onChange(normalise({ ...board, shots: board.shots.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const setCast = (i: number, patch: Partial<Storyboard["cast"][number]>) =>
    onChange({ ...board, cast: board.cast.map((c, k) => (k === i ? { ...c, ...patch } : c)) });

  // Panels land one at a time and out of order, and each one has to be written
  // onto the board as it is NOW — not onto the copy this closure captured,
  // which is a board from before the other four panels arrived.
  const latest = useRef(board);
  latest.current = board;

  const draw = useCallback(
    async (indices: number[]) => {
      const ids = indices.map((i) => latest.current.shots[i]?.id).filter(Boolean) as string[];
      if (!ids.length) return;
      setDrawError("");
      setDrawing((d) => [...new Set([...d, ...ids])]);
      const at = latest.current;
      await Promise.all(
        indices.map(async (i) => {
          const id = at.shots[i]?.id;
          if (!id) return;
          try {
            const panel = await drawPanel(at, i, faces);
            const board = latest.current;
            onChange({
              ...board,
              shots: board.shots.map((s) => (s.id === id ? { ...s, panel } : s)),
            });
          } catch (e) {
            setDrawError(e instanceof Error ? e.message : "A panel could not be drawn.");
          } finally {
            setDrawing((d) => d.filter((x) => x !== id));
          }
        }),
      );
    },
    [faces, onChange],
  );

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

  const jump = (i: number) => {
    const el = rows.current.get(board.shots[i]?.id ?? "");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus?.();
  };

  /** Every distinct place the film visits, in the order it visits them. */
  const places = useMemo(
    () => [...new Set(board.shots.map((s) => s.location).filter(Boolean))],
    [board.shots],
  );
  const undrawn = board.shots.filter((s) => !s.panel).length;

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
            full length rather than trimmed to fit a tidy grid. The genre goes
            first and alone, because it governs the four fields under it. */}
        <div className="mt-2">
          <Fact
            label="Genre"
            value={board.mood}
            onChange={(mood) => set({ mood })}
            placeholder="How this film is shot — dread, warmth, grit. It decides the light and the grade."
          />
        </div>
        <div className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-2">
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
          {places.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-ink-muted">
              <Icon.Target width={10} height={10} className="text-ink-faint" />
              {places.join(" · ")}
            </span>
          )}
          {soundtrack && (
            <span className="flex items-center gap-1 text-[10px] text-ink-muted">
              <Icon.Waveform width={10} height={10} /> {soundtrack} under the cut
            </span>
          )}
        </div>
      </header>

      {/* ---- 1 · cast ---- */}
      {board.cast.length > 0 && (
        <Section n={1} title="Cast">
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
            {board.cast.map((member, i) => (
              <CastTile
                key={member.id}
                member={member}
                shotCount={board.shots.length}
                disabled={done}
                onChange={(patch) => setCast(i, patch)}
                onRemoveTurn={() => setCast(i, { turnsAt: null, turnsInto: "" })}
                {...(() => {
                  const face =
                    faces.find((f) => f.label === member.name) ??
                    faces.find((f) => f.label === `Subject ${member.subject}`);
                  return face ? { face } : {};
                })()}
              />
            ))}
          </div>
        </Section>
      )}

      {/* ---- 2 · storyboard ---- */}
      <Section
        n={board.cast.length > 0 ? 2 : 1}
        title="Storyboard"
        aside={
          !done && (
            <button
              type="button"
              onClick={() => void draw(board.shots.map((_, i) => i).filter((i) => !board.shots[i].panel))}
              disabled={drawing.length > 0 || !undrawn}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-ink-muted transition hover:border-ink-faint hover:text-ink disabled:opacity-40"
            >
              <Icon.Brush width={10} height={10} />
              {drawing.length
                ? `drawing ${drawing.length}…`
                : undrawn
                  ? `Draw ${undrawn} ${undrawn === 1 ? "board" : "boards"}`
                  : "All drawn"}
            </button>
          )
        }
      >
        {drawError && <p className="mb-1.5 text-[10.5px] text-amber-400">{drawError}</p>}
        <ol className="-mx-3">
          {board.shots.map((shot, i) => {
            const chained = i > 0 && shot.link === "continuous";
            const prompt = shotPrompt(board, i);
            const isOpen = open === shot.id;
            const moved = Boolean(
              i > 0 && shot.location && board.shots[i - 1].location && shot.location !== board.shots[i - 1].location,
            );
            return (
              <li
                key={shot.id}
                tabIndex={-1}
                ref={(el) => {
                  if (el) rows.current.set(shot.id, el);
                  else rows.current.delete(shot.id);
                }}
                className="group relative border-t border-line-soft px-3 py-2 first:border-t-0 focus:outline-none"
              >
                {/* The join to the shot above, stated once and stated plainly,
                    and sat on the panel column's axis so the chain reads as a
                    line down the left edge of the sheet. */}
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

                {/* On a phone the panel and the row controls sit on one line
                    ABOVE the call sheet, so the sheet gets the whole width
                    instead of 198 pixels of it. At sm the wrapper dissolves
                    (`contents`) and the three go back to one row. */}
                <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2.5">
                  <div className="flex items-start gap-2 sm:contents">
                  <Panel
                    shot={shot}
                    index={i}
                    aspect={board.aspectRatio}
                    drawing={drawing.includes(shot.id)}
                    disabled={done}
                    onDraw={() => void draw([i])}
                  />

                  {!done && (
                    <div className="flex shrink-0 gap-0.5 sm:order-3 sm:flex-col sm:opacity-0 sm:transition sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
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

                  <div className="min-w-0 flex-1 sm:order-2">
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                      {/* The title takes a whole row before it will shrink: a
                          clipped shot name is the one thing on this sheet you
                          navigate by. The metrics wrap under it instead. */}
                      <Field
                        label={`Shot ${i + 1} title`}
                        value={shot.title}
                        disabled={done}
                        onChange={(title) => setShot(i, { title })}
                        multiline
                        className="!w-auto min-w-[18ch] flex-1 text-[12.5px] font-medium leading-snug"
                      />
                      <label className="flex items-center rounded-md border border-transparent pl-1 text-[11px] tabular-nums text-ink-muted transition hover:border-line focus-within:border-ink-faint">
                        <input
                          aria-label={`Shot ${i + 1} duration in seconds`}
                          type="number"
                          min={MIN_SHOT_SEC}
                          max={MAX_SHOT_SEC}
                          value={shot.durationSec}
                          disabled={done}
                          onChange={(e) =>
                            setShot(i, {
                              durationSec: Math.min(
                                MAX_SHOT_SEC,
                                Math.max(MIN_SHOT_SEC, Number(e.target.value) || MIN_SHOT_SEC),
                              ),
                            })
                          }
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
                          disabled={done}
                          onChange={(e) => setShot(i, { lensMm: Math.min(300, Math.max(8, Number(e.target.value) || 35)) })}
                          className="w-11 bg-transparent py-1 text-right focus:outline-none"
                        />
                        <span className="pr-1 text-ink-faint">mm</span>
                      </label>
                      {/* Both wrap rather than clip. A framing or a move
                          truncated to fit ("hitchcock do…") hides the one
                          thing the row is asking you to check. */}
                      <Field
                        label={`Shot ${i + 1} framing`}
                        value={shot.framing}
                        disabled={done}
                        onChange={(framing) => setShot(i, { framing })}
                        placeholder="framing"
                        multiline
                        className="!w-auto min-w-[8ch] flex-1 text-[11px] leading-snug text-ink-muted"
                      />
                      <Field
                        label={`Shot ${i + 1} camera move`}
                        value={shot.move}
                        disabled={done}
                        onChange={(m) => setShot(i, { move: m })}
                        placeholder="camera move"
                        multiline
                        className="!w-auto min-w-[10ch] flex-[2] text-[11px] leading-snug text-ink-muted"
                      />
                    </div>

                    {/* Where. A cut that changes it says so, because a location
                        that changes by accident is the single most visible way
                        a stitched film falls apart. */}
                    <div className="flex items-center gap-1">
                      <Icon.Target
                        width={10}
                        height={10}
                        className={`shrink-0 ${moved ? "text-amber-400" : "text-ink-faint"}`}
                      />
                      <Field
                        label={`Shot ${i + 1} location`}
                        value={shot.location}
                        disabled={done}
                        onChange={(location) => setShot(i, { location })}
                        placeholder="where this is"
                        multiline
                        className={`!w-auto min-w-[12ch] flex-1 !py-0.5 text-[11px] leading-snug ${
                          moved ? "text-amber-400" : "text-ink-muted"
                        }`}
                      />
                      {moved && (
                        <span className="shrink-0 text-[9.5px] uppercase tracking-[0.12em] text-amber-400">moves</span>
                      )}
                    </div>

                    <Field
                      label={`Shot ${i + 1} action`}
                      value={shot.action}
                      disabled={done}
                      onChange={(action) => setShot(i, { action })}
                      placeholder="What physically happens across these seconds."
                      multiline
                      className="text-[12px] leading-relaxed"
                    />

                    <Beats shot={shot} index={i} disabled={done} onChange={(beats) => setShot(i, { beats })} />

                    <div className="mt-0.5 grid gap-x-3 sm:grid-cols-2">
                      <div>
                        <p className={`px-1.5 ${KEY}`}>Camera</p>
                        <Field
                          label={`Shot ${i + 1} camera geometry`}
                          value={shot.cameraNote}
                          disabled={done}
                          onChange={(cameraNote) => setShot(i, { cameraNote })}
                          placeholder="What the move physically does — travel, focal length at each end, what stays locked"
                          multiline
                          className="!py-0 text-[11px] text-ink-muted"
                        />
                      </div>
                      <div>
                        <p className={`px-1.5 ${KEY}`}>Ends on</p>
                        <Field
                          label={`Shot ${i + 1} ends on`}
                          value={shot.endsOn}
                          disabled={done}
                          onChange={(endsOn) => setShot(i, { endsOn })}
                          placeholder="The frame the next shot opens on"
                          multiline
                          className="!py-0 text-[11px] text-ink-muted"
                        />
                      </div>
                      <div>
                        <p className={`px-1.5 ${KEY}`}>Carries over</p>
                        <Field
                          label={`Shot ${i + 1} carries over`}
                          value={shot.carry}
                          disabled={done}
                          onChange={(carry) => setShot(i, { carry })}
                          placeholder="Props, damage, weather that must survive the join"
                          multiline
                          className="!py-0 text-[11px] text-ink-muted"
                        />
                      </div>
                      <div>
                        <p className={`px-1.5 ${KEY}`}>Dialogue</p>
                        <Field
                          label={`Shot ${i + 1} dialogue`}
                          value={shot.dialogue}
                          disabled={done}
                          onChange={(dialogue) => setShot(i, { dialogue })}
                          placeholder="Spoken line, if any"
                          multiline
                          className="!py-0 text-[11px] text-ink-muted"
                        />
                      </div>
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
                        disabled={done}
                        onChange={(e) => setShot(i, { prompt: e.target.value })}
                        rows={8}
                        spellCheck={false}
                        className="mt-1 w-full resize-y rounded-lg border border-line bg-panel px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-ink-muted focus:border-ink-faint focus:outline-none"
                      />
                    )}
                  </div>

                </div>
              </li>
            );
          })}
        </ol>
      </Section>

      {/* ---- 3 · continuity ---- */}
      {notes.length > 0 && (
        <Section n={board.cast.length > 0 ? 3 : 2} title="Continuity">
          <Notes notes={notes} onJump={jump} />
        </Section>
      )}

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
        {!done && (
          <Runtime
            board={board}
            onChange={onChange}
            disabled={busy}
            {...(onReplan && !busy ? { onReplan: (sec: number) => onReplan(board, sec) } : {})}
          />
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
