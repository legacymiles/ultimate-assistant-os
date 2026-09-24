"use client";

// ---------------------------------------------------------------------------
// The shot plan, as a printed sheet.
//
// Same document Smart Shot Videos produces, because the owner asked for that
// format and it is the right one: a call sheet reads top-down — who is in it,
// where it happens, the cuts in a row, then how the whole thing is lit and
// graded — and every panel is editable in place rather than behind a dialog.
// It shares `smart-shot.css` outright rather than copying the look, so the two
// sheets cannot drift into two different house styles.
//
// Two things are different here, and both come from the song:
//
//   SECTION 2 is the SONG MAP, not a floor plan. A music video's geography is
//   temporal — the sections, the bar lines, the drops — so the thing worth
//   drawing a map of is the track, and a cut's place on it is the equivalent of
//   a camera mark on a floor plan.
//
//   A CUT CARD CARRIES ITS SECOND. Every cut shows where it lands on the track,
//   goes amber when it sings, and prints the words underneath, because on this
//   sheet "when" is a production fact exactly like lens and stop.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import "../smart-shot/smart-shot.css";
import "./score-sheet.css";
import { SINGS, timecode } from "@/lib/seedance/constants";
import {
  coverage,
  placeShots,
  scoreNotes,
  sungShots,
  type PlacedShot,
  type Score,
  type ScoreShot,
} from "@/lib/seedance/score";
import type { Reel } from "@/lib/seedance/types";
import { drawPanel, type PanelFace } from "@/lib/studio/panels";
import { toStoryboard } from "@/lib/seedance/score";

export function ScoreSheet({
  score,
  reel,
  onChange,
  onSelectShot,
  onRenderShot,
  faces = [],
}: {
  score: Score;
  reel: Reel;
  onChange: (next: Score) => void;
  onSelectShot?: (id: string) => void;
  onRenderShot?: (index: number) => void;
  /** Reference faces this conversation holds, so a drawn cut keeps them. */
  faces?: PanelFace[];
}) {
  const placed = useMemo(() => placeShots(score), [score]);
  const sung = useMemo(() => sungShots(placed), [placed]);
  const notes = useMemo(() => scoreNotes(score), [score]);
  const t = score.timeline;
  const total = Math.round(placed.reduce((n, p) => n + p.durationSec, 0));

  const set = (fields: Partial<Score>) => onChange({ ...score, ...fields });
  const setShot = (id: string, fields: Partial<ScoreShot>) =>
    onChange({ ...score, shots: score.shots.map((s) => (s.id === id ? { ...s, ...fields } : s)) });

  const errors = notes.filter((n) => n.kind === "error");

  /**
   * Draw a cut's frame.
   *
   * The sheet is a document made of pictures — a storyboard with empty boxes is
   * a table with a picture column, which is the one thing this format is not.
   * The frame is drawn from the WHOLE plan (toStoryboard carries the bibles and
   * the woven prompt), and the conversation's reference faces go with it, so the
   * same person comes back in every cut they are in rather than a new stranger
   * each time.
   */
  const scoreRef = useRef(score);
  scoreRef.current = score;
  const [drawing, setDrawing] = useState<Record<string, boolean>>({});

  const draw = useCallback(
    async (p: PlacedShot) => {
      setDrawing((d) => ({ ...d, [p.shot.id]: true }));
      try {
        const panel = await drawPanel(toStoryboard(scoreRef.current), p.index, faces);
        const live = scoreRef.current;
        onChange({
          ...live,
          shots: live.shots.map((x) => (x.id === p.shot.id ? { ...x, panel } : x)),
        });
      } catch {
        // A frame that would not draw is not a reason to lose the sheet; the
        // card simply keeps its empty box and its Draw button.
      } finally {
        setDrawing((d) => ({ ...d, [p.shot.id]: false }));
      }
    },
    [faces, onChange],
  );

  /** Fill every empty frame, a few at a time so a burst cannot trip the balance. */
  const drawAll = useCallback(async () => {
    const todo = placeShots(scoreRef.current).filter((p) => !p.shot.panel);
    for (let i = 0; i < todo.length; i += 3) {
      await Promise.all(todo.slice(i, i + 3).map((p) => draw(p)));
    }
  }, [draw]);

  const missing = placed.filter((p) => !p.shot.panel).length;

  return (
    <div className="ss-sheetwrap">
      <div className="ss-toolbar">
        <div>
          <div className="ss-label">
            Shot plan · {placed.length} cuts · {total}s · {sung.length} sing
          </div>
          <Editable value={score.name} className="ss-title" onChange={(name) => set({ name })} />
        </div>
        <div className="ss-toolbar-actions">
          <span className="ss-status">
            <span className="ss-dot" /> {Math.round(coverage(score) * 100)}% of the track covered
          </span>
          {missing > 0 && (
            <button type="button" className="ss-btn" onClick={() => void drawAll()}>
              <Icon.Refresh width={13} height={13} /> Draw {missing} frame{missing === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>

      <div className="ss-sheet">
        {/* ----- shared choices ----- */}
        <div className="ss-strip">
          <span className="ss-strip-k">SHARED CHOICES</span>
          <span>
            <b>Cut Count:</b> {placed.length}
          </span>
          <span>
            <b>Aspect:</b> {score.aspectRatio}
          </span>
          <span className="ss-strip-short">
            <b>Lighting:</b>
            <Editable value={score.lighting} onChange={(lighting) => set({ lighting })} />
          </span>
          <span className="ss-strip-short">
            <b>Lens:</b>
            <Editable value={score.lens} onChange={(lens) => set({ lens })} />
          </span>
          <span className="ss-strip-pal">
            <b>Palette:</b>
            <Swatches colors={score.palette} />
            <Editable value={score.grade} onChange={(grade) => set({ grade })} />
          </span>
          <span className="ss-strip-fp">
            <b>World:</b>
            <Editable value={score.world} onChange={(world) => set({ world })} />
          </span>
        </div>

        {errors.length > 0 && (
          <div className="ss-strip" style={{ borderColor: "#ffb4a0" }}>
            <span className="ss-strip-k" style={{ color: "#ffb4a0" }}>
              FIX {errors.length}
            </span>
            <span className="ss-strip-fp">{errors.map((e) => e.text).join(" · ")}</span>
          </div>
        )}

        <div className="ss-row2">
          {/* ----- section 1: cast ----- */}
          <section className="ss-section">
            <h3>SECTION 1: CAST REFERENCE</h3>
            <div className="ss-chars">
              {score.cast.length === 0 && (
                <p className="ss-hint">
                  Nobody named yet. A performance shot with no cast has no face to put the words in.
                </p>
              )}
              {score.cast.map((c) => (
                <div key={c.id} className="ss-char">
                  <Editable
                    value={c.name}
                    className="ss-h"
                    onChange={(name) =>
                      set({
                        cast: score.cast.map((x) =>
                          x.id === c.id ? { ...x, name: name.toUpperCase() } : x,
                        ),
                      })
                    }
                  />
                  <Editable
                    value={c.look}
                    className="ss-small"
                    multiline
                    placeholder="Face, build, hair, skin, marks — what a frame must keep"
                    onChange={(look) =>
                      set({ cast: score.cast.map((x) => (x.id === c.id ? { ...x, look } : x)) })
                    }
                  />
                </div>
              ))}
            </div>
            <div className="ss-h" style={{ marginTop: 10 }}>
              WARDROBE — UNCHANGED ALL FILM
            </div>
            <Editable
              value={score.wardrobe}
              className="ss-small"
              multiline
              placeholder="Exactly what everyone wears; the most common continuity break"
              onChange={(wardrobe) => set({ wardrobe })}
            />
          </section>

          {/* ----- section 2: the song map ----- */}
          <section className="ss-section">
            <h3>SECTION 2: SONG MAP &amp; LOCATIONS</h3>
            {t ? (
              <>
                <div className="ss-cut-spec" style={{ marginBottom: 6 }}>
                  {timecode(t.durationSec)} | {t.bpm ? `${t.bpm} BPM` : "FREE TIME"} |{" "}
                  {t.key || "KEY UNKNOWN"} | {t.sections.length} SECTIONS |{" "}
                  {t.hits.filter((h) => h.drop).length} DROPS |{" "}
                  {t.lines?.length ? `${t.lines.length} LINES · ${t.lyricSource.toUpperCase()}` : "INSTRUMENTAL"}
                </div>
                <SongMap score={score} placed={placed} />
                <div className="ss-h" style={{ marginTop: 10 }}>
                  SECTIONS
                </div>
                <div className="ss-small">
                  {t.sections.map((s, i) => (
                    <div key={s.id}>
                      {i + 1}. {timecode(s.startSec)}–{timecode(s.endSec)} · {s.provisional} ·{" "}
                      {s.bars} bars · energy {s.level}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="ss-hint">No track measured yet.</p>
            )}

            <div className="ss-h" style={{ marginTop: 10 }}>
              LOCATIONS
            </div>
            <div className="ss-small">
              {score.places.length === 0 && <p className="ss-hint">No locations written.</p>}
              {score.places.map((pl) => (
                <div key={pl.id} style={{ marginBottom: 6 }}>
                  <Editable
                    value={pl.name}
                    className="ss-h"
                    onChange={(name) =>
                      set({ places: score.places.map((x) => (x.id === pl.id ? { ...x, name } : x)) })
                    }
                  />
                  <Editable
                    value={pl.look}
                    className="ss-small"
                    multiline
                    onChange={(look) =>
                      set({ places: score.places.map((x) => (x.id === pl.id ? { ...x, look } : x)) })
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ----- section 3: storyboard ----- */}
        <section className="ss-section">
          <h3>
            SECTION 3: STORYBOARD ({placed.length} SEQUENTIAL CUTS · {total}s)
            <span className="ss-hint" style={{ marginLeft: 8, textTransform: "none" }}>
              amber = sings, and on those the words outrank the prompt
            </span>
          </h3>
          <div className="ss-cuts">
            {placed.map((p) => (
              <CutCard
                key={p.shot.id}
                p={p}
                reel={reel}
                onShot={setShot}
                onSelect={onSelectShot}
                onRender={onRenderShot}
                onDraw={() => void draw(p)}
                drawing={Boolean(drawing[p.shot.id])}
              />
            ))}
          </div>
        </section>

        {/* ----- section 3b: the cuts that sing, on their own ----- */}
        <section className="ss-section">
          <h3 style={{ color: SINGS.text }}>
            SECTION 3B: LIP SYNC ({sung.length} OF {placed.length} CUTS)
            <span className="ss-hint" style={{ marginLeft: 8, textTransform: "none" }}>
              drag a range on the lip-sync lane above to change what sings
            </span>
          </h3>
          {sung.length === 0 ? (
            <p className="ss-hint">
              Nothing sings. Drop a range on the timeline&apos;s lip-sync lane and whichever cuts it
              lands on become performance shots.
            </p>
          ) : (
            <div className="ss-cuts">
              {sung.map((p) => (
                <CutCard
                  key={`sing-${p.shot.id}`}
                  p={p}
                  reel={reel}
                  onShot={setShot}
                  onSelect={onSelectShot}
                  onRender={onRenderShot}
                  onDraw={() => void draw(p)}
                  drawing={Boolean(drawing[p.shot.id])}
                />
              ))}
            </div>
          )}
        </section>

        {/* ----- section 4: lighting / mood / style ----- */}
        <section className="ss-section">
          <h3>SECTION 4: LIGHTING / MOOD / STYLE NOTES</h3>
          <div className="ss-notes">
            <div className="ss-mood">
              <div className="ss-h">GENRE &amp; TREATMENT</div>
              <Editable
                value={score.mood}
                className="ss-essence"
                multiline
                placeholder="How this film is shot, framed and paced"
                onChange={(mood) => set({ mood })}
              />
              <div className="ss-h" style={{ marginTop: 8 }}>
                STYLE ESSENCE
              </div>
              <Editable
                value={score.look}
                className="ss-essence"
                multiline
                onChange={(look) => set({ look })}
              />
            </div>
            <div className="ss-cine">
              <div className="ss-h">THE STORY</div>
              <Editable
                value={score.story}
                className="ss-small"
                multiline
                placeholder="Where it starts, what changes, where it ends"
                onChange={(story) => set({ story })}
              />
              <div className="ss-h" style={{ marginTop: 8 }}>
                LOGLINE
              </div>
              <Editable
                value={score.logline}
                className="ss-small"
                multiline
                onChange={(logline) => set({ logline })}
              />
            </div>
            <div className="ss-cine">
              <div className="ss-h">LIGHTING</div>
              <Editable
                value={score.lighting}
                className="ss-small"
                multiline
                onChange={(lighting) => set({ lighting })}
              />
              <div className="ss-h" style={{ marginTop: 8 }}>
                SOUND
              </div>
              <Editable
                value={score.soundscape}
                className="ss-small"
                multiline
                placeholder="The diegetic sound world"
                onChange={(soundscape) => set({ soundscape })}
              />
              <p className="ss-hint" style={{ marginTop: 6 }}>
                The track itself is laid over the finished cut at full level, as the master.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ----- the song map -----------------------------------------------------------

/**
 * The track, with the cuts marked on it.
 *
 * This is the sheet's floor plan: on a live-action shoot you draw the room and
 * mark where the camera stands, and here the "room" is four minutes long, so
 * what gets drawn is the song and where each cut falls on it.
 */
function SongMap({ score, placed }: { score: Score; placed: PlacedShot[] }) {
  const t = score.timeline;
  if (!t || t.durationSec <= 0) return null;
  const pc = (sec: number) => `${Math.max(0, Math.min(100, (sec / t.durationSec) * 100))}%`;
  return (
    <div className="ss-songmap">
      <div className="ss-songmap-sections">
        {t.sections.map((s) => (
          <span
            key={s.id}
            style={{ left: pc(s.startSec), width: pc(s.endSec - s.startSec) }}
            title={`${s.provisional} · ${timecode(s.startSec)}`}
          >
            {s.provisional}
          </span>
        ))}
      </div>
      <div className="ss-songmap-track">
        {t.hits.map((h, i) => (
          <i
            key={`${h.atSec}-${i}`}
            className={h.drop ? "is-drop" : ""}
            style={{ left: pc(h.atSec) }}
            title={`${h.drop ? "Drop" : "Accent"} at ${h.atSec.toFixed(2)}s`}
          />
        ))}
        {placed.map((p) => (
          <b
            key={p.shot.id}
            className={p.sings ? "is-sings" : ""}
            style={{ left: pc(p.startSec), width: pc(p.durationSec) }}
            title={`${p.shot.title} · ${timecode(p.startSec)}`}
          >
            {p.index + 1}
          </b>
        ))}
      </div>
    </div>
  );
}

// ----- one cut ----------------------------------------------------------------

function CutCard({
  p,
  reel,
  onShot,
  onSelect,
  onRender,
  onDraw,
  drawing,
}: {
  p: PlacedShot;
  reel: Reel;
  onShot: (id: string, fields: Partial<ScoreShot>) => void;
  onSelect?: (id: string) => void;
  onRender?: (index: number) => void;
  onDraw: () => void;
  drawing: boolean;
}) {
  const { shot } = p;
  // The block this cut became on the timeline, so a rendered clip shows here.
  const block = reel.prompts.find((b) => b.id === shot.id);
  return (
    <div
      className="ss-cut"
      style={p.sings ? { borderColor: SINGS.edge, boxShadow: `inset 0 2px 0 ${SINGS.edge}` } : undefined}
    >
      <div className="ss-cut-head">
        <span className="ss-cutno">
          Cut {p.index + 1} · {timecode(p.startSec, true)}
        </span>
        <span className="ss-cut-tools">
          {p.sings && (
            <span style={{ color: SINGS.text, fontWeight: 700, fontSize: 10 }} title="This cut sings">
              <Icon.Mic width={10} height={10} /> SINGS
            </span>
          )}
          {onRender && (
            <button type="button" onClick={() => onRender(p.index)} aria-label="Render this cut">
              <Icon.Play width={11} height={11} />
            </button>
          )}
          {onSelect && (
            <button type="button" onClick={() => onSelect(shot.id)} aria-label="Open this shot">
              <Icon.Edit width={11} height={11} />
            </button>
          )}
        </span>
      </div>

      <div className="ss-img sd-frame">
        {block?.videoUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={block.videoUrl} muted playsInline loop />
        ) : shot.panel ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.panel} alt="" />
        ) : (
          <div className="ss-img-empty">
            {drawing ? (
              <>
                <span className="ss-spinner" /> drawing…
              </>
            ) : (
              "not drawn yet"
            )}
          </div>
        )}
        {!drawing && (
          <button type="button" className="ss-redraw" onClick={onDraw} title="Draw this frame from the plan">
            <Icon.Refresh width={11} height={11} />
          </button>
        )}
      </div>

      <div className="ss-cut-spec">
        {shot.lensMm}mm | {shot.aperture} | {p.durationSec.toFixed(1)}s |{" "}
        {(shot.move || "static").toUpperCase()} | {(shot.framing || "medium").toUpperCase()}
      </div>

      <Editable
        value={shot.title}
        className="ss-h"
        onChange={(title) => onShot(shot.id, { title })}
      />
      <Editable
        value={shot.action}
        className="ss-small"
        multiline
        onChange={(action) => onShot(shot.id, { action })}
      />

      {p.words && (
        <p
          className="ss-small"
          style={{ color: p.sings ? SINGS.text : undefined, fontStyle: "italic", marginTop: 4 }}
        >
          “{p.words}”
        </p>
      )}

      <Editable
        value={shot.because}
        className="ss-small"
        multiline
        placeholder="what in the audio put this cut here"
        onChange={(because) => onShot(shot.id, { because })}
      />
    </div>
  );
}

// ----- editing in place --------------------------------------------------------

/**
 * A field you type straight into, with no edit mode.
 *
 * The sheet is a document, so an input that looks like an input would break the
 * illusion it depends on: a call sheet is read, and the fact that it is also
 * editable should only be discovered by clicking a line of it.
 */
function Editable({
  value,
  onChange,
  className,
  multiline,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const shared = {
    value,
    placeholder,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    className: `ss-editable ${className ?? ""}`,
  };
  return multiline ? (
    <textarea {...shared} rows={Math.min(6, Math.max(2, Math.ceil(value.length / 48)))} />
  ) : (
    <input {...shared} />
  );
}

function Swatches({ colors }: { colors: string[] }) {
  if (!colors.length) return null;
  return (
    <span className="ss-swatches">
      {colors.map((c) => (
        <i key={c} style={{ background: c }} title={c} />
      ))}
    </span>
  );
}
