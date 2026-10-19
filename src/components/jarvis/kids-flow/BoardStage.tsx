"use client";

// Stage 3 — Storyboard: the beats as torn-paper tiles on a time ruler.
//
// The toy: drag a tile's right edge and the beat holds longer, every beat
// after it slides along, and the animatic above replays the new timing — so
// the owner feels the pacing before an hour of PC time is spent on it.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../../icons";
import type { KidsFlow } from "@/lib/studio/kids-flow/useKidsFlow";
import { EXPRESSIONS, relay, runtimeOf, type Beat, type BeatRole } from "@/lib/studio/kids-flow/plan";

const ROLE_LABEL: Record<BeatRole, string> = {
  hook: "Hook",
  problem: "Problem",
  journey: "Journey",
  rush: "Rush",
  silence: "Silence",
  payoff: "Payoff",
  return: "Return",
};

/** A wall colour per place, from the cut-paper palette, stable for the same words. */
const WALLS = ["#cfe2ee", "#a9d9c6", "#f3a3bf", "#f6cf55", "#c08048", "#8c7ad8", "#5aa05a", "#26315f"];
function wallFor(place: string): string {
  let h = 0;
  for (const ch of place) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return WALLS[h % WALLS.length];
}

function hexIn(s: string): string | undefined {
  return s.match(/#[0-9a-f]{6}/i)?.[0];
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The animatic's stand-in colours, picked from the measured palette by what
 * they look like: skin is the warm mid-tone, hair the darkest, legs the first
 * blue-ish one. A typed hex in the sheet always wins.
 */
function standInColours(palette: string[], hero: string) {
  const rest = palette.filter((c) => c.toLowerCase() !== hero.toLowerCase());
  const lum = (c: string) => {
    const [r, g, b] = rgb(c);
    return 0.3 * r + 0.59 * g + 0.11 * b;
  };
  const skin = rest.find((c) => {
    const [r, g, b] = rgb(c);
    const l = lum(c);
    return r > g && g > b && r - b > 40 && l > 60 && l < 210;
  });
  const hair = [...rest].sort((a, b) => lum(a) - lum(b))[0];
  const legs = rest.find((c) => {
    const [r, , b] = rgb(c);
    return b > r + 30 && c !== hair;
  });
  return { skin, hair: hair && lum(hair) < 90 ? hair : undefined, legs };
}

function wordsOf(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export function BoardStage({ flow }: { flow: KidsFlow }) {
  const { draft, setBeats, problems } = flow;
  const beats = draft.beats;
  const total = Math.max(runtimeOf(beats), 1);
  const [sel, setSel] = useState<string | null>(beats[0]?.id ?? null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; dur: number; pps: number } | null>(null);

  // A new storyboard (written after the prompt) opens on its first beat.
  useEffect(() => {
    if (!beats.some((b) => b.id === sel)) setSel(beats[0]?.id ?? null);
  }, [beats, sel]);

  // --- the animatic clock ---------------------------------------------------
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      setT((cur) => {
        const next = cur + (now - last) / 1000;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const nowBeat = beats.find((b) => t >= b.start && t < b.end) ?? beats[beats.length - 1];
  const shown = playing ? nowBeat : beats.find((b) => b.id === sel) ?? nowBeat;
  const index = shown ? beats.indexOf(shown) : 0;

  const edit = useCallback(
    (id: string, p: Partial<Beat>) => setBeats(beats.map((b) => (b.id === id ? { ...b, ...p } : b))),
    [beats, setBeats],
  );

  const setLength = useCallback(
    (id: string, seconds: number) => {
      const d = Math.max(0.5, Math.round(seconds * 4) / 4);
      setBeats(relay(beats.map((b) => (b.id === id ? { ...b, end: b.start + d } : b))));
    },
    [beats, setBeats],
  );

  const onGripDown = (e: React.PointerEvent, b: Beat) => {
    e.stopPropagation();
    const width = track.current?.getBoundingClientRect().width ?? 1;
    drag.current = { id: b.id, x: e.clientX, dur: b.end - b.start, pps: width / total };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onGripMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setLength(d.id, d.dur + (e.clientX - d.x) / d.pps);
  };
  const onGripUp = () => {
    drag.current = null;
  };

  const ticks = useMemo(() => {
    const step = total > 40 ? 10 : 5;
    const out: number[] = [];
    for (let s = 0; s <= total; s += step) out.push(s);
    return out;
  }, [total]);

  const selected = beats.find((b) => b.id === sel) ?? null;
  const sheet = draft.sheet;
  const guess = standInColours(sheet.palette, hexIn(sheet.heroColor) ?? sheet.palette[0] ?? "");
  const frameStyle = {
    ["--kf-wall" as string]: shown ? (shown.role === "silence" ? "#3a3f55" : wallFor(shown.place || shown.role)) : "#cfe2ee",
    ["--kf-skin" as string]: hexIn(sheet.skin) ?? guess.skin ?? "#c98d63",
    ["--kf-hair" as string]: hexIn(sheet.hair) ?? guess.hair ?? "#2a1d18",
    ["--kf-legs" as string]: guess.legs ?? "#4c6fb5",
  } as CSSProperties;

  if (!beats.length) {
    // While it is being written, the banner above says so; an empty box would just repeat it.
    if (flow.planning) return null;
    return (
      <div className="rounded-xl border border-line bg-panel p-6 text-center">
        <p className="text-[13px] text-ink">No storyboard yet.</p>
        <p className="mt-1 text-[11.5px] text-ink-muted">Write it from your story line — it takes a few seconds.</p>
        <button type="button" className="kf-go mt-3" onClick={() => void flow.plan()} disabled={flow.planning}>
          <Icon.Sparkles width={13} height={13} aria-hidden /> {flow.planning ? "Writing…" : "Write the storyboard"}
        </button>
      </div>
    );
  }

  return (
    <section aria-labelledby="kf-board" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="kf-board" className="text-[15px] font-semibold text-ink">{draft.title || `${sheet.name ? `${sheet.name}'s` : "His"} story`}</h3>
          <p className="text-[11px] text-ink-faint">
            {beats.length} beats · {total.toFixed(1)} s of {draft.length} s · drag a tile&apos;s right edge to change how long it holds
          </p>
        </div>
        {flow.planNote && <p className="max-w-sm text-right text-[11px] text-ink-faint">{flow.planNote}</p>}
      </div>

      {/* --- the animatic --------------------------------------------------- */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div
            className={`kf-frame ${draft.aspect === "9:16" ? "is-portrait" : ""}`}
            style={frameStyle}
            data-mood={shown?.expression}
            data-role={shown?.role}
            key={playing ? shown?.id : "still"}
          >
            <div className="kf-ground" />
            {shown?.place && <span className="kf-place">{shown.place}</span>}
            <div className="kf-hero" style={{ left: `${shown?.role === "return" || shown?.role === "hook" ? 22 : 18 + ((index * 23) % 52)}%` }} aria-hidden>
              <div className="kf-hero__legs" />
              <div className="kf-hero__body" />
              <div className="kf-hero__head">
                <div className="kf-face">
                  <div className="kf-eyes"><i /><i /></div>
                  <div className="kf-mouth" />
                </div>
              </div>
              <div className="kf-hero__hair" />
            </div>
            {shown?.caption && draft.words !== "music" && <p className="kf-caption">{shown.caption}</p>}
            <div className="kf-flash" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="kf-ghost"
              onClick={() => {
                if (playing) setPlaying(false);
                else {
                  if (t >= total - 0.05) setT(0);
                  if (reduced) {
                    // No motion: step to the next beat instead of playing.
                    const next = beats[(index + 1) % beats.length];
                    setSel(next.id);
                    setT(next.start);
                  } else setPlaying(true);
                }
              }}
            >
              {playing ? <Icon.Pause width={12} height={12} aria-hidden /> : <Icon.Play width={12} height={12} aria-hidden />}
              {playing ? "Pause" : reduced ? "Next beat" : "Play the timing"}
            </button>
            <span className="font-mono text-[11px] text-ink-faint" data-num>
              {t.toFixed(1)} / {total.toFixed(1)} s
            </span>
            <span className="ml-auto hidden min-w-0 truncate text-[11px] text-ink-muted sm:block">{shown?.action}</span>
          </div>
        </div>

        {/* --- one beat, editable ---------------------------------------- */}
        <div className="min-w-0 rounded-xl border border-line bg-panel p-3">
          {selected ? (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-ink-faint">Beat {beats.indexOf(selected) + 1}</span>
                <select
                  className="kf-field !w-auto !py-1"
                  value={selected.role}
                  onChange={(e) => edit(selected.id, { role: e.target.value as BeatRole })}
                  aria-label="What this beat does"
                >
                  {Object.entries(ROLE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <label className="ml-auto flex items-center gap-1 text-[11px] text-ink-muted">
                  <input
                    type="number"
                    min={0.5}
                    max={10}
                    step={0.25}
                    className="kf-field !w-16 !py-1 text-right"
                    value={(selected.end - selected.start).toFixed(2).replace(/\.?0+$/, "")}
                    onChange={(e) => setLength(selected.id, Number(e.target.value) || 0.5)}
                    aria-label="Seconds"
                  />
                  s
                </label>
              </div>
              <div>
                <label className="kf-label" htmlFor="kf-place">Where</label>
                <input id="kf-place" className="kf-field" value={selected.place} onChange={(e) => edit(selected.id, { place: e.target.value })} />
              </div>
              <div>
                <label className="kf-label" htmlFor="kf-action">What we see him do</label>
                <textarea id="kf-action" className="kf-field min-h-[3.5rem] resize-y" value={selected.action} onChange={(e) => edit(selected.id, { action: e.target.value })} />
              </div>
              <div className="flex flex-wrap gap-1" role="group" aria-label="His face">
                {EXPRESSIONS.map((x) => (
                  <button
                    key={x}
                    type="button"
                    aria-pressed={selected.expression === x}
                    onClick={() => edit(selected.id, { expression: x })}
                    className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${selected.expression === x ? "border-[var(--kf-hero)] text-ink" : "border-line text-ink-muted hover:text-ink"}`}
                  >
                    {x}
                  </button>
                ))}
              </div>
              <div>
                <label className="kf-label" htmlFor="kf-cap">
                  Caption <span className={wordsOf(selected.caption) > 6 ? "text-[#f8b471]" : "text-ink-faint"}>({wordsOf(selected.caption)}/6 words)</span>
                </label>
                <input id="kf-cap" className="kf-field" value={selected.caption} onChange={(e) => edit(selected.id, { caption: e.target.value })} placeholder="(none)" />
              </div>
            </div>
          ) : (
            <p className="text-[11.5px] text-ink-muted">Tap a tile below to edit that beat.</p>
          )}
        </div>
      </div>

      {/* --- the strip --------------------------------------------------- */}
      <div className="kf-strip overflow-x-auto pb-1">
        <div className="min-w-[640px]">
          <div className="kf-ruler" aria-hidden>
            {ticks.map((s) => (
              <span key={s} style={{ left: `${(s / total) * 100}%` }}>{s}s</span>
            ))}
          </div>
          <div className="kf-track" ref={track} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp}>
            {beats.map((b, i) => (
              // A div with a button role, not a <button>: the length grip inside
              // it is its own control, and a control may not nest in a button.
              <div
                key={b.id}
                role="button"
                tabIndex={0}
                className="kf-tile"
                data-role={b.role}
                aria-pressed={sel === b.id}
                style={{ flex: `${b.end - b.start} 0 0` }}
                onClick={() => {
                  setSel(b.id);
                  setPlaying(false);
                  setT(b.start);
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSel(b.id);
                    setT(b.start);
                  }
                }}
                title={`${i + 1}. ${ROLE_LABEL[b.role]} — ${b.action}`}
              >
                <span className="kf-tile__in">
                  <span className="kf-tile__n">{i + 1} · {(b.end - b.start).toFixed(1)}s</span>
                  <span className="kf-tile__t block">{b.role === "silence" ? "…silence" : b.place || ROLE_LABEL[b.role]}</span>
                  {b.caption && <span className="kf-tile__c block">“{b.caption}”</span>}
                </span>
                <span
                  className="kf-grip"
                  onPointerDown={(e) => onGripDown(e, b)}
                  onClick={(e) => e.stopPropagation()}
                  role="slider"
                  aria-label={`Length of beat ${i + 1}`}
                  aria-valuemin={0.5}
                  aria-valuemax={10}
                  aria-valuenow={b.end - b.start}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      e.preventDefault();
                      setLength(b.id, b.end - b.start + (e.key === "ArrowRight" ? 0.25 : -0.25));
                    }
                  }}
                />
              </div>
            ))}
            <div className="kf-playhead" style={{ left: `${(Math.min(t, total) / total) * 100}%` }} aria-hidden />
          </div>
        </div>
      </div>

      {problems.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-[#f8b471]/40 bg-[#f8b471]/5 p-2.5">
          {problems.map((p, i) => (
            <li key={i} className="text-[11.5px] text-[#f8b471]">
              {p.at !== "plan" ? (
                <button type="button" className="underline-offset-2 hover:underline" onClick={() => setSel(p.at)}>{p.message}</button>
              ) : (
                p.message
              )}
            </li>
          ))}
        </ul>
      )}

      <details className="rounded-lg border border-line bg-panel/60 p-2.5">
        <summary className="cursor-pointer text-[11.5px] text-ink-muted">The brief your PC will read</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-ink">{flow.brief}</pre>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="kf-ghost" onClick={() => flow.go("story")}>
          <Icon.ArrowLeft width={12} height={12} aria-hidden /> Story
        </button>
        <button type="button" className="kf-go" onClick={() => flow.go("render")}>
          Looks good — render it <Icon.ArrowRight width={13} height={13} aria-hidden />
        </button>
      </div>
    </section>
  );
}
