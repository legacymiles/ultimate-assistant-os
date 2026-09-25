"use client";

// ---------------------------------------------------------------------------
// The shot plan, as a full page of paper.
//
// This is the Smart Shot Videos sheet, brought to Jarvis Studio: the same
// document, the same job, the same reason it is big. A shot plan is read the
// way a crew reads a call sheet — the whole film on one surface, the frames
// large enough to judge, every word markable — and it was living in a 672-pixel
// chat bubble, which is a poster folded into a wallet.
//
// So the sheet takes the page. It is printed on paper because a production
// document is paper; the dark studio around it is the app. The AI director is
// docked down the right edge, the way a director sits beside the board rather
// than underneath it, so a note and the thing it changes are on screen at once.
//
// The bands answer four different questions, and they are not the same:
//
//   SHARED CHOICES  what is true of every frame — genre, world, wardrobe,
//                   light, grade, glass. Every field here is repeated VERBATIM
//                   into every shot, which is the only reason a dozen separate
//                   generations read as one film.
//   CAST            who must not change, faces beside descriptions, and — when
//                   the story turns on it — what they change INTO and at which
//                   cut.
//   STORYBOARD      one card per cut: the drawn frame at the film's real
//                   aspect, the call sheet under it, the join to the cut before
//                   stated on the card's own head.
//   CONTINUITY      what is wrong with the plan, before it costs an hour of
//                   this PC's GPU.
//
// Everything is editable in place: no modal, no edit mode, no save button. The
// sheet is the film, so typing in it changes the film. The woven H3 prompt sits
// one disclosure below each card, and editing THAT pins it — from then on the
// owner's words are rendered instead of the weave, and the card says so.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { drawCastSheet, drawPanel, drawPlate, type PanelFace } from "@/lib/studio/panels";
import { blockers } from "@/lib/studio/preflight";
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
import "./storyboard-sheet.css";

/**
 * A field that looks like the sheet until you put a caret in it.
 *
 * Multiline fields grow to their content rather than scrolling inside a fixed
 * box. On this sheet that is not a nicety: the world, the wardrobe and the
 * grade are the exact strings repeated into every shot's prompt, so a value
 * the owner cannot read in full is a continuity break they cannot see.
 */
function Ed({
  value,
  onChange,
  label,
  placeholder,
  className = "",
  single,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  /** One line, no growth — a name, a heading. */
  single?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // Border-box: the border has to be added back, or a two-line value reads
    // as a clipped sentence.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, []);
  useLayoutEffect(fit, [fit, value, single]);
  // And whenever the column changes width — a height measured in a two-column
  // grid clips the same text in one column.
  const lastWidth = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width === lastWidth.current) return;
      lastWidth.current = width;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  if (single) {
    return (
      <input
        aria-label={label}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`jb-ed ${className}`}
      />
    );
  }
  return (
    <textarea
      ref={ref}
      aria-label={label}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      rows={1}
      onChange={(e) => {
        onChange(e.target.value);
        fit();
      }}
      className={`jb-ed ${className}`}
    />
  );
}

/** A named band of the sheet — ruled off, headed, not boxed in a card. */
function Band({
  title,
  aside,
  count,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  count?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="jb-band">
      <h3>
        {title}
        {count && <em>{count}</em>}
        {aside && <span className="jb-band-tools">{aside}</span>}
      </h3>
      <div className="jb-band-body">{children}</div>
    </section>
  );
}

/** One constant of the film: the label above, the sentence below. */
function Fact({
  label,
  value,
  onChange,
  placeholder,
  wide,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  wide?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`jb-fact ${wide ? "is-wide" : ""}`}>
      <span className="jb-k">{label}</span>
      {children}
      <Ed
        label={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        className="jb-small"
      />
    </div>
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
 * these cards cannot hold.
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
  // The seconds move from anywhere on this sheet — a duration typed, a cut
  // added, a card deleted — and the field must not keep showing the old total.
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
    <>
      <label className="jb-runtime">
        <span className="jb-k" style={{ marginBottom: 0 }}>
          Runtime
        </span>
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
        />
      </label>
      {pending && reachable && (
        <button type="button" className="jb-paper-btn" onClick={spread}>
          Spread over {board.shots.length} {board.shots.length === 1 ? "cut" : "cuts"}
        </button>
      )}
      {pending && onReplan && (
        <button type="button" className="jb-paper-btn is-mark" onClick={() => onReplan(target!)}>
          <Icon.Refresh width={11} height={11} /> Re-plan at {timecode(target!)}
        </button>
      )}
      {pending && !reachable && (
        <p className="jb-hint">
          {board.shots.length} {board.shots.length === 1 ? "cut" : "cuts"} hold{" "}
          <b>
            {timecode(min)}–{timecode(max)}
          </b>
          . Re-planning changes how many there are.
        </p>
      )}
      {!pending && text !== timecode(runtime) && target === null && (
        <p className="jb-hint">Seconds, or m:ss.</p>
      )}
    </>
  );
}

/** The drawn frame for one cut, at the film's real aspect, big enough to judge. */
function Frame({
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
    <div className={`jb-frame ${shot.panel ? "" : "is-empty"}`} style={{ aspectRatio: ratio }}>
      {shot.panel ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL from this browser
        <img src={shot.panel} alt={`Frame for cut ${index + 1}: ${shot.title}`} />
      ) : (
        !drawing && <div className="jb-frame-empty">no frame yet</div>
      )}
      {drawing && (
        <div className="jb-busy">
          <span className="jb-spin" />
          drawing
        </div>
      )}
      {!disabled && !drawing && (
        <button
          type="button"
          className="jb-draw"
          onClick={onDraw}
          title="Draw this frame from the words on this card"
        >
          <span>
            <Icon.Brush width={11} height={11} />
            {shot.panel ? "Recreate image" : "Draw the frame"}
          </span>
        </button>
      )}
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
  onDraw,
  drawing,
  disabled,
}: {
  member: Storyboard["cast"][number];
  face?: PanelFace;
  shotCount: number;
  onChange: (patch: Partial<Storyboard["cast"][number]>) => void;
  onRemoveTurn: () => void;
  /** Draw this invented character's reference sheet. Absent once anchored. */
  onDraw?: () => void;
  drawing?: boolean;
  disabled: boolean;
}) {
  // What the film will actually hold this face with: their upload if there is
  // one, otherwise the sheet drawn for them.
  const anchor = face?.dataUrl ?? member.sheet;
  return (
    <div className="jb-castmember">
      <div className="jb-face">
        {anchor ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL from this browser
          <img src={anchor} alt={member.name} />
        ) : (
          <span>{member.subject ? `S${member.subject}` : "—"}</span>
        )}
        {onDraw && !disabled && (
          <button
            type="button"
            className="jb-face-draw"
            onClick={onDraw}
            disabled={drawing || !member.look.trim()}
            title={
              member.look.trim()
                ? "Draw a reference sheet so every shot keeps this face"
                : "Describe them first — the sheet is drawn from their look"
            }
          >
            {drawing ? "Drawing…" : member.sheet ? "Redraw" : "Draw"}
          </button>
        )}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Ed
          label={`${member.name} name`}
          value={member.name}
          disabled={disabled}
          onChange={(name) => onChange({ name: name.toUpperCase() })}
          className="jb-name"
          single
        />
        <Ed
          label={`${member.name} look`}
          value={member.look}
          disabled={disabled}
          onChange={(look) => onChange({ look })}
          placeholder="Face, build, hair, skin, marks"
          className="jb-small"
        />
        {member.turnsAt !== null ? (
          <div className="jb-turn">
            <div className="jb-turn-head">
              <Icon.Refresh width={9} height={9} />
              turns at cut
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
              />
              {!disabled && (
                <button
                  type="button"
                  className="jb-tool"
                  style={{ marginLeft: "auto" }}
                  onClick={onRemoveTurn}
                  aria-label={`${member.name} does not change`}
                >
                  <Icon.Close width={9} height={9} />
                </button>
              )}
            </div>
            <Ed
              label={`${member.name} turns into`}
              value={member.turnsInto}
              disabled={disabled}
              onChange={(turnsInto) => onChange({ turnsInto })}
              placeholder="What they become — skin, eyes, hair, bearing, damage"
              className="jb-small"
            />
          </div>
        ) : (
          !disabled && (
            <button
              type="button"
              className="jb-mini"
              onClick={() => onChange({ turnsAt: Math.min(2, shotCount), turnsInto: "" })}
            >
              <Icon.Plus width={9} height={9} /> they change during the film
            </button>
          )
        )}
      </div>
    </div>
  );
}

/** The clock inside one shot. */
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

  if (disabled && !shot.beats.length) return null;

  return (
    <div className="jb-beats">
      {shot.beats.map((beat, i) => {
        const end = shot.beats[i + 1]?.at ?? shot.durationSec;
        return (
          <div key={i} className="jb-beat">
            <label className="jb-beat-t">
              <input
                aria-label={`Cut ${index + 1} beat ${i + 1} at second`}
                type="number"
                min={0}
                max={MAX_SHOT_SEC}
                step={0.5}
                value={beat.at}
                disabled={disabled}
                onChange={(e) =>
                  set(i, { at: Math.max(0, Math.min(MAX_SHOT_SEC, Number(e.target.value) || 0)) })
                }
              />
              <span>–{end.toFixed(1)}s</span>
            </label>
            <Ed
              label={`Cut ${index + 1} beat ${i + 1}`}
              value={beat.text}
              disabled={disabled}
              onChange={(text) => set(i, { text })}
              placeholder="what happens at this second"
            />
            {!disabled && (
              <button
                type="button"
                className="jb-tool"
                onClick={() => onChange(shot.beats.filter((_, k) => k !== i))}
                aria-label={`Delete beat ${i + 1} of cut ${index + 1}`}
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
          className="jb-mini"
          onClick={() =>
            onChange([
              ...shot.beats,
              {
                // A new beat lands halfway between the last one and the end,
                // which is where the gap actually is.
                at: shot.beats.length
                  ? Math.min(
                      MAX_SHOT_SEC,
                      Math.round(((shot.beats[shot.beats.length - 1].at + shot.durationSec) / 2) * 2) / 2,
                    )
                  : 0,
                text: "",
              },
            ])
          }
        >
          <Icon.Plus width={9} height={9} /> beat
        </button>
      )}
    </div>
  );
}

/** What is wrong with the plan, while it is still free to fix. */
function Notes({ notes, onJump }: { notes: BoardNote[]; onJump: (shot: number) => void }) {
  return (
    <div className="jb-notes">
      {notes.map((note, i) => (
        <p
          key={i}
          className={`jb-note ${note.severity === "block" ? "is-block" : note.severity === "warn" ? "is-warn" : ""}`}
        >
          <span style={{ minWidth: 0 }}>
            {note.shot >= 0 && (
              <button type="button" className="jb-note-jump" onClick={() => onJump(note.shot)}>
                Cut {note.shot + 1}
              </button>
            )}
            {note.text}
          </span>
        </p>
      ))}
    </div>
  );
}

export function StoryboardSheet({
  board,
  onChange,
  onRender,
  onReplan,
  busy,
  done,
  soundtrack,
  faces = [],
  onBack,
  director,
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
  /** Back to the conversation this sheet came out of. */
  onBack?: () => void;
  /** The AI director, docked down the right edge. */
  director?: React.ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<string[]>([]);
  const [castDrawing, setCastDrawing] = useState<string[]>([]);
  const [plateDrawing, setPlateDrawing] = useState(false);
  const [drawError, setDrawError] = useState("");
  const runtime = runtimeSec(board);
  const eta = useMemo(() => etaSeconds(board), [board]);
  // The pre-flight gate first, then the advisory notes. A film costs the better
  // part of an hour on this PC's GPU and cannot be skimmed until it is
  // finished, so a plan that cannot become the film it describes is stopped
  // here, where fixing it is free.
  const stops = useMemo(() => blockers(board), [board]);
  const notes = useMemo(() => [...stops, ...boardNotes(board)], [stops, board]);
  const cards = useRef(new Map<string, HTMLElement>());
  const notesBand = useRef<HTMLDivElement>(null);

  const set = (patch: Partial<Storyboard>) => onChange({ ...board, ...patch });
  const setShot = (i: number, patch: Partial<Shot>) =>
    onChange(normalise({ ...board, shots: board.shots.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const setCast = (i: number, patch: Partial<Storyboard["cast"][number]>) =>
    onChange({ ...board, cast: board.cast.map((c, k) => (k === i ? { ...c, ...patch } : c)) });

  // Frames land one at a time and out of order, and each one has to be written
  // onto the board as it is NOW — not onto the copy this closure captured,
  // which is a board from before the other four frames arrived.
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
            setDrawError(e instanceof Error ? e.message : "A frame could not be drawn.");
          } finally {
            setDrawing((d) => d.filter((x) => x !== id));
          }
        }),
      );
    },
    [faces, onChange],
  );

  /**
   * Draw one invented character's reference sheet.
   *
   * Written against `latest.current` for the same reason the panels are: the
   * request takes seconds, the owner keeps typing, and writing back onto the
   * board this closure captured would throw their edits away.
   */
  const drawCast = useCallback(
    async (index: number) => {
      const member = latest.current.cast[index];
      if (!member) return;
      setDrawError("");
      setCastDrawing((d) => [...new Set([...d, member.id])]);
      try {
        const sheet = await drawCastSheet(latest.current, member);
        const board = latest.current;
        onChange({
          ...board,
          cast: board.cast.map((c) => (c.id === member.id ? { ...c, sheet } : c)),
        });
      } catch (e) {
        setDrawError(e instanceof Error ? e.message : "That reference sheet could not be drawn.");
      } finally {
        setCastDrawing((d) => d.filter((x) => x !== member.id));
      }
    },
    [onChange],
  );

  /** Draw the set plate — the room, empty, so every cold shot is dressed from it. */
  const drawSet = useCallback(async () => {
    setDrawError("");
    setPlateDrawing(true);
    try {
      const plate = await drawPlate(latest.current);
      onChange({ ...latest.current, plate });
    } catch (e) {
      setDrawError(e instanceof Error ? e.message : "The set could not be drawn.");
    } finally {
      setPlateDrawing(false);
    }
  }, [onChange]);

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
    const el = cards.current.get(board.shots[i]?.id ?? "");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus?.();
  };

  /**
   * What the render button does while the plan is blocked: take the owner to
   * the list of what is stopping it. A button that is simply dead tells them
   * nothing, and the notes already carry each finding and its own jump link.
   */
  const showStops = () =>
    notesBand.current?.scrollIntoView({ behavior: "smooth", block: "center" });

  /** Every distinct place the film visits, in the order it visits them. */
  const places = useMemo(
    () => [...new Set(board.shots.map((s) => s.location).filter(Boolean))],
    [board.shots],
  );
  const undrawn = board.shots.filter((s) => !s.panel).length;

  return (
    <div className="jb-sheet">
      <div className="jb-scroll">
        {/* The bar belongs to the app, not to the paper: it is where you leave
            from, and where the two things you do to the whole sheet live. */}
        <div className="jb-bar">
          {onBack && (
            <button type="button" className="jb-dark-btn" onClick={onBack}>
              <Icon.ArrowLeft width={11} height={11} /> Conversation
            </button>
          )}
          <div className="jb-bar-title">
            <b>{board.title || "Shot plan"}</b>
            <span>
              {board.shots.length} {board.shots.length === 1 ? "cut" : "cuts"} · {timecode(runtime)} ·{" "}
              {board.aspectRatio}
            </span>
          </div>
          {!done && (
            <button
              type="button"
              className="jb-dark-btn"
              onClick={() => void draw(board.shots.map((_, i) => i).filter((i) => !board.shots[i].panel))}
              disabled={drawing.length > 0 || !undrawn}
            >
              <Icon.Brush width={11} height={11} />
              {drawing.length
                ? `Drawing ${drawing.length}…`
                : undrawn
                  ? `Draw ${undrawn} ${undrawn === 1 ? "frame" : "frames"}`
                  : "All frames drawn"}
            </button>
          )}
          <button
            type="button"
            className="jb-go"
            onClick={() => (stops.length ? showStops() : onRender(board))}
            disabled={busy || done || !board.shots.some((s) => s.action.trim())}
            title={stops.length ? "The plan has to be fixed before it can be shot" : undefined}
          >
            <Icon.Film width={13} height={13} />
            {busy
              ? "Rendering…"
              : done
                ? "Shot"
                : stops.length
                  ? `${stops.length} to fix first`
                  : "Make the film"}
          </button>
        </div>

        <div className="jb-paper">
          {/* ---- masthead ---- */}
          <header className="jb-mast">
            <div className="jb-mast-l">
              <Ed
                label="Film title"
                value={board.title}
                disabled={done}
                onChange={(title) => set({ title })}
                className="jb-title"
                placeholder="Untitled"
              />
              <Ed
                label="Logline"
                value={board.logline}
                disabled={done}
                onChange={(logline) => set({ logline })}
                placeholder="One sentence: what happens."
                className="jb-logline"
              />
            </div>
            <div className="jb-mast-r">
              <div className="jb-stat">
                <b>{board.shots.length}</b>
                <span>{board.shots.length === 1 ? "cut" : "cuts"}</span>
              </div>
              <div className="jb-stat">
                <b>{timecode(runtime)}</b>
                <span>runtime</span>
              </div>
              <div className="jb-stat">
                <b>{board.aspectRatio}</b>
                <span>aspect</span>
              </div>
              {board.palette.length > 0 && (
                <div className="jb-stat">
                  <span className="jb-swatches" aria-label="Palette">
                    {board.palette.map((c) => (
                      <span key={c} title={c} style={{ background: c }} />
                    ))}
                  </span>
                  <span>palette</span>
                </div>
              )}
            </div>
          </header>

          {/* ---- shared choices ---- */}
          <Band
            title="Shared choices"
            count="repeated word for word into every cut"
            aside={
              <>
                {places.length > 0 && (
                  <span className="jb-hint" style={{ fontSize: 9.5, letterSpacing: "0.08em" }}>
                    {places.join(" · ")}
                  </span>
                )}
                {soundtrack && (
                  <span className="jb-hint" style={{ fontSize: 9.5, letterSpacing: "0.08em" }}>
                    {soundtrack}
                  </span>
                )}
              </>
            }
          >
            <div className="jb-facts">
              <Fact
                label="Genre"
                value={board.mood}
                disabled={done}
                onChange={(mood) => set({ mood })}
                placeholder="How this film is shot — dread, warmth, grit. It decides the light and the grade."
                wide
              />
              <Fact label="World" value={board.world} disabled={done} onChange={(world) => set({ world })} placeholder="Where, and what it feels like" />
              <Fact label="Wardrobe" value={board.wardrobe} disabled={done} onChange={(wardrobe) => set({ wardrobe })} placeholder="Exactly what everyone wears" />
              <Fact label="Light" value={board.lighting} disabled={done} onChange={(lighting) => set({ lighting })} placeholder="The light, unchanged all film" />
              <Fact label="Grade" value={board.grade} disabled={done} onChange={(grade) => set({ grade })} placeholder="The colour, unchanged all film" />
              <Fact label="Camera" value={board.lens} disabled={done} onChange={(lens) => set({ lens })} placeholder="The body and the lens set" />
              <Fact label="Look" value={board.look} disabled={done} onChange={(look) => set({ look })} placeholder="Live action, anime, 3D…" />
              <Fact label="Sound" value={board.soundscape} disabled={done} onChange={(soundscape) => set({ soundscape })} placeholder="What the scene sounds like" />
              <Fact label="Score" value={board.music} disabled={done} onChange={(music) => set({ music })} placeholder="The music under it, or none" />
            </div>
          </Band>

          {/* ---- cast ---- */}
          {board.cast.length > 0 && (
            <Band title="Cast" count={`${board.cast.length} who must not change`}>
              <div className="jb-cast">
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
                      // Only an invented character needs one drawn: an upload
                      // already is the anchor, and a second picture of the same
                      // person is two answers to one question.
                      return {
                        ...(face ? { face } : {}),
                        ...(face || member.subject !== null
                          ? {}
                          : { onDraw: () => void drawCast(i), drawing: castDrawing.includes(member.id) }),
                      };
                    })()}
                  />
                ))}
              </div>
            </Band>
          )}

          {/* ---- the set ---- */}
          <Band title="The set" count={board.plate ? "drawn" : "nothing is holding the room"}>
            <div className="jb-castmember">
              <div className="jb-face jb-plate">
                {board.plate ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a data URL from this browser
                  <img src={board.plate} alt="The set, empty" />
                ) : (
                  <span>—</span>
                )}
                {!done && (
                  <button
                    type="button"
                    className="jb-face-draw"
                    onClick={() => void drawSet()}
                    disabled={plateDrawing || !board.world.trim()}
                    title={
                      board.world.trim()
                        ? "Draw the location empty and wide, so every cut is dressed from the same room"
                        : "Describe the world first — the plate is drawn from it"
                    }
                  >
                    {plateDrawing ? "Drawing…" : board.plate ? "Redraw" : "Draw"}
                  </button>
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className="jb-name">THE LOCATION, EMPTY</p>
                <p className="jb-small" style={{ margin: 0 }}>
                  {board.plate
                    ? "Attached to every shot that opens cold, the same way a cast sheet is — so each one is dressed from this room rather than from the words for it. A continued shot does not get it: it already has the room, in frames."
                    : "Faces are held by a picture and the room is not, so every shot that starts cold re-invents it — furniture moves, a hallway becomes a living room, and someone at the far end of it turns up beside you in the next shot."}
                </p>
              </div>
            </div>
          </Band>

          {/* ---- the storyboard ---- */}
          <Band
            title="Storyboard"
            count={`${board.shots.length} sequential ${board.shots.length === 1 ? "cut" : "cuts"} · ${timecode(runtime)}`}
            aside={
              drawError ? <span className="jb-hint" style={{ color: "var(--pa-mark)" }}>{drawError}</span> : undefined
            }
          >
            <div className="jb-cuts">
              {board.shots.map((shot, i) => {
                const chained = i > 0 && shot.link === "continuous";
                const isOpen = open === shot.id;
                const moved = Boolean(
                  i > 0 &&
                    shot.location &&
                    board.shots[i - 1].location &&
                    shot.location !== board.shots[i - 1].location,
                );
                return (
                  <article
                    key={shot.id}
                    className="jb-cut"
                    tabIndex={-1}
                    ref={(el) => {
                      if (el) cards.current.set(shot.id, el);
                      else cards.current.delete(shot.id);
                    }}
                  >
                    <div className="jb-cut-head">
                      <span className="jb-cutno">CUT {i + 1}</span>
                      {i > 0 ? (
                        <button
                          type="button"
                          className={`jb-join ${chained ? "is-same" : ""}`}
                          disabled={done}
                          onClick={() => setShot(i, { link: chained ? "cut" : "continuous" })}
                          title={
                            chained
                              ? "Rendered from the last frame of the cut before — one unbroken take. Click for a hard cut."
                              : "A new angle, matched to the cut before. Click to make it one unbroken take."
                          }
                        >
                          {chained ? <Icon.Link width={9} height={9} /> : <Icon.Scissors width={9} height={9} />}
                          {chained ? "same take" : "cut"}
                        </button>
                      ) : (
                        <span className="jb-join" style={{ cursor: "default", pointerEvents: "none" }}>
                          opens
                        </span>
                      )}
                      {!done && (
                        <span className="jb-cut-tools">
                          <button
                            type="button"
                            className="jb-tool"
                            onClick={() => move(i, -1)}
                            disabled={i === 0}
                            aria-label={`Move cut ${i + 1} earlier`}
                          >
                            <Icon.Chevron width={12} height={12} style={{ transform: "rotate(180deg)" }} />
                          </button>
                          <button
                            type="button"
                            className="jb-tool"
                            onClick={() => move(i, 1)}
                            disabled={i === board.shots.length - 1}
                            aria-label={`Move cut ${i + 1} later`}
                          >
                            <Icon.Chevron width={12} height={12} />
                          </button>
                          <button
                            type="button"
                            className="jb-tool"
                            onClick={() => removeShot(i)}
                            disabled={board.shots.length < 2}
                            aria-label={`Delete cut ${i + 1}`}
                          >
                            <Icon.Trash width={11} height={11} />
                          </button>
                        </span>
                      )}
                    </div>

                    <Frame
                      shot={shot}
                      index={i}
                      aspect={board.aspectRatio}
                      drawing={drawing.includes(shot.id)}
                      disabled={done}
                      onDraw={() => void draw([i])}
                    />

                    <div className="jb-cut-body">
                      <Ed
                        label={`Cut ${i + 1} title`}
                        value={shot.title}
                        disabled={done}
                        onChange={(title) => setShot(i, { title })}
                        className="jb-body"
                        placeholder="What this cut is called"
                      />

                      <div className="jb-spec">
                        <label className="jb-num">
                          <input
                            aria-label={`Cut ${i + 1} duration in seconds`}
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
                          />
                          <i>s</i>
                        </label>
                        <span className="jb-dot">·</span>
                        <label className="jb-num">
                          <input
                            aria-label={`Cut ${i + 1} focal length in millimetres`}
                            type="number"
                            min={8}
                            max={300}
                            value={shot.lensMm}
                            disabled={done}
                            onChange={(e) =>
                              setShot(i, { lensMm: Math.min(300, Math.max(8, Number(e.target.value) || 35)) })
                            }
                          />
                          <i>mm</i>
                        </label>
                        <span className="jb-dot">·</span>
                        <Ed
                          label={`Cut ${i + 1} framing`}
                          value={shot.framing}
                          disabled={done}
                          onChange={(framing) => setShot(i, { framing })}
                          placeholder="framing"
                          className="jb-caps"
                        />
                        <span className="jb-dot">·</span>
                        <Ed
                          label={`Cut ${i + 1} camera move`}
                          value={shot.move}
                          disabled={done}
                          onChange={(m) => setShot(i, { move: m })}
                          placeholder="camera move"
                          className="jb-caps"
                        />
                      </div>

                      {/* Where. A cut that changes it says so, because a
                          location that changes by accident is the single most
                          visible way a stitched film falls apart. */}
                      <div className={`jb-where ${moved ? "is-moved" : ""}`}>
                        <Icon.Target width={10} height={10} style={{ flex: "none" }} />
                        <Ed
                          label={`Cut ${i + 1} location`}
                          value={shot.location}
                          disabled={done}
                          onChange={(location) => setShot(i, { location })}
                          placeholder="where this is"
                        />
                        {moved && <span style={{ flex: "none" }}>moves</span>}
                      </div>

                      <Ed
                        label={`Cut ${i + 1} action`}
                        value={shot.action}
                        disabled={done}
                        onChange={(action) => setShot(i, { action })}
                        placeholder="What physically happens across these seconds."
                        className="jb-body"
                      />

                      <Beats shot={shot} index={i} disabled={done} onChange={(beats) => setShot(i, { beats })} />

                      <div className="jb-pairs">
                        <div>
                          <span className="jb-k">Camera</span>
                          <Ed
                            label={`Cut ${i + 1} camera geometry`}
                            value={shot.cameraNote}
                            disabled={done}
                            onChange={(cameraNote) => setShot(i, { cameraNote })}
                            placeholder="What the move physically does — travel, focal length at each end, what stays locked"
                            className="jb-small"
                          />
                        </div>
                        <div>
                          <span className="jb-k">Ends on</span>
                          <Ed
                            label={`Cut ${i + 1} ends on`}
                            value={shot.endsOn}
                            disabled={done}
                            onChange={(endsOn) => setShot(i, { endsOn })}
                            placeholder="The frame the next cut opens on"
                            className="jb-small"
                          />
                        </div>
                        <div>
                          <span className="jb-k">Carries over</span>
                          <Ed
                            label={`Cut ${i + 1} carries over`}
                            value={shot.carry}
                            disabled={done}
                            onChange={(carry) => setShot(i, { carry })}
                            placeholder="Props, damage, weather that must survive the join"
                            className="jb-small"
                          />
                        </div>
                        <div>
                          <span className="jb-k">Dialogue</span>
                          <Ed
                            label={`Cut ${i + 1} dialogue`}
                            value={shot.dialogue}
                            disabled={done}
                            onChange={(dialogue) => setShot(i, { dialogue })}
                            placeholder="Spoken line, if any"
                            className="jb-small"
                          />
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          marginTop: "auto",
                          paddingTop: 4,
                        }}
                      >
                        <button
                          type="button"
                          className="jb-mini"
                          onClick={() => setOpen(isOpen ? null : shot.id)}
                          aria-expanded={isOpen}
                        >
                          <Icon.Chevron
                            width={10}
                            height={10}
                            style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .2s" }}
                          />
                          {shot.prompt ? "Your prompt" : "H3 prompt"}
                        </button>
                        <span className="jb-chip" style={{ cursor: "default", pointerEvents: "none" }}>
                          {h3Form(board, i)}
                        </span>
                        {shot.references.length > 0 && (
                          <span className="jb-hint" style={{ fontSize: 10 }}>
                            refs {shot.references.map((n) => `S${n}`).join(" ")}
                          </span>
                        )}
                        {shot.prompt && !done && (
                          <button type="button" className="jb-mini" onClick={() => setShot(i, { prompt: undefined })}>
                            Re-weave from the sheet
                          </button>
                        )}
                      </div>

                      {isOpen && (
                        <textarea
                          aria-label={`Cut ${i + 1} prompt`}
                          value={shotPrompt(board, i)}
                          disabled={done}
                          onChange={(e) => setShot(i, { prompt: e.target.value })}
                          spellCheck={false}
                          className="jb-prompt"
                        />
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </Band>

          {/* ---- continuity ---- */}
          {notes.length > 0 && (
            <div ref={notesBand}>
              <Band
                title="Continuity"
                count={stops.length ? `${stops.length} to fix` : `${notes.length} to look at`}
              >
                <Notes notes={notes} onJump={jump} />
              </Band>
            </div>
          )}

          {/* ---- the foot: what it costs, and the one button ---- */}
          <footer className="jb-foot">
            {!done && board.shots.length < MAX_SHOTS && (
              <button type="button" className="jb-paper-btn" onClick={() => addShot(board.shots.length)}>
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
            <p className="jb-hint">
              {board.shots.length} {board.shots.length === 1 ? "clip" : "clips"} rendered in order on this PC and
              cut together — <b>about {formatEta(eta).replace(" left", "")}</b>.
            </p>
            {stops.length > 0 && !busy && !done && (
              <p className="jb-stop" id="jb-stop-why">
                <span className="jb-stop-n">{stops.length}</span>
                {stops.length === 1 ? "thing in this plan " : "things in this plan "}
                cannot become the film it describes. Fixing them now is free; finding out after the
                render costs {formatEta(eta).replace(" left", "")}.{" "}
                <button type="button" onClick={showStops}>
                  Show me
                </button>
              </p>
            )}
            <button
              type="button"
              className="jb-shoot"
              onClick={() => (stops.length ? showStops() : onRender(board))}
              disabled={busy || done || !board.shots.some((s) => s.action.trim())}
              aria-describedby={stops.length ? "jb-stop-why" : undefined}
            >
              <Icon.Film width={14} height={14} />
              {busy
                ? "Rendering…"
                : done
                  ? "Shot"
                  : stops.length
                    ? `${stops.length} to fix first`
                    : "Make the film"}
            </button>
          </footer>
        </div>
      </div>

      {director && <aside className="jb-director">{director}</aside>}
    </div>
  );
}
