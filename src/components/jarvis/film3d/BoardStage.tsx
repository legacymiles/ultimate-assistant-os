"use client";

// Stage 3 — Storyboard: the film plays above its own beat strip. Click a beat
// to jump there and edit it — world, light, what he does, the shot, the
// caption, its length — and the stage re-shoots it on the spot.

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../../icons";
import { FilmStage, type FilmStageHandle } from "./FilmStage";
import type { Film3DFlow } from "@/lib/studio/film3d/useFilm3D";
import {
  EXPRESSIONS,
  MOVES,
  PROPS,
  ROLES,
  SHOTS,
  TIMES,
  WORLDS,
  relay,
  runtimeOf,
  type Beat3D,
} from "@/lib/studio/film3d/plan";

const WORLD_HUE: Record<string, string> = {
  home: "#f2a93b", town: "#e94f37", park: "#6cc04a", forest: "#2e7d4f", hill: "#86c76a", beach: "#3aa3d4",
  snow: "#cfe3f5", space: "#7a5cff", city: "#ff3cac", desert: "#e8c27e", bedroom: "#ff8fa3",
};

const nice = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Picker<T extends string>({ label, value, options, onPick, labels }: { label: string; value: T; options: readonly T[]; onPick: (v: T) => void; labels?: Record<string, string> }) {
  return (
    <label className="block min-w-0">
      <span className="f3-label">{label}</span>
      <select className="f3-field" value={value} onChange={(e) => onPick(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>{labels?.[o] ?? nice(o)}</option>
        ))}
      </select>
    </label>
  );
}

export function BoardStage({ flow }: { flow: Film3DFlow }) {
  const { draft, film, setBeats, problems } = flow;
  const stage = useRef<FilmStageHandle>(null);
  const [sel, setSel] = useState(0);
  const [playingIdx, setPlayingIdx] = useState(-1);
  const beats = draft.beats;
  const beat = beats[Math.min(sel, beats.length - 1)];
  const total = runtimeOf(beats);
  const shotLabels = useMemo(() => Object.fromEntries(SHOTS.map((s) => [s.id, s.label])), []);
  const worldLabels = useMemo(() => Object.fromEntries(WORLDS.map((w) => [w.id, w.label])), []);

  if (!beats.length) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-dashed border-line p-6 text-center">
        <p className="text-[13px] text-ink">No storyboard yet.</p>
        <p className="mt-1 text-[11.5px] text-ink-muted">Write the story in a line and Jarvis plans the shots.</p>
        <button type="button" className="f3-go mt-3" onClick={() => flow.go("story")}>Go to the story</button>
      </div>
    );
  }

  const edit = (p: Partial<Beat3D>) => setBeats(beats.map((b, i) => (i === sel ? { ...b, ...p } : b)));
  const lengthen = (d: number) => setBeats(relay(beats.map((b, i) => (i === sel ? { ...b, end: Math.max(b.start + 0.5, b.end + d) } : b))));
  const pick = (i: number) => {
    setSel(i);
    stage.current?.seek(beats[i].start + Math.min(0.6, (beats[i].end - beats[i].start) / 3));
  };
  const remove = () => {
    if (beats.length < 2) return;
    setBeats(relay(beats.filter((_, i) => i !== sel)));
    setSel(Math.max(0, sel - 1));
  };
  const duplicate = () => {
    const copy = { ...beat, id: `b${Date.now().toString(36)}` };
    setBeats(relay([...beats.slice(0, sel + 1), copy, ...beats.slice(sel + 1)]).map((b, i) => ({ ...b, id: `b${i + 1}` })));
    setSel(sel + 1);
  };
  const move = (d: -1 | 1) => {
    const j = sel + d;
    if (j < 0 || j >= beats.length) return;
    const next = [...beats];
    [next[sel], next[j]] = [next[j], next[sel]];
    setBeats(relay(next));
    setSel(j);
  };

  const tall = draft.aspect === "9:16";

  return (
    <section aria-labelledby="f3-board" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="f3-board" className="text-[15px] font-semibold text-ink">{film.title}</h3>
          <p className="text-[11px] text-ink-faint">{beats.length} beats · {total.toFixed(0)} s · {draft.aspect} · {draft.look} — press play; click a beat to jump to it and change it.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="f3-ghost" onClick={() => flow.go("story")}>
            <Icon.Edit width={11} height={11} aria-hidden /> Story
          </button>
          <button type="button" className="f3-go" disabled={problems.length > 0} onClick={() => flow.go("render")}>
            Make the film <Icon.ArrowRight width={12} height={12} aria-hidden />
          </button>
        </div>
      </div>
      {flow.planNote && <p className="text-[11.5px] text-ink-muted">{flow.planNote}</p>}

      <div className={tall ? "grid gap-4 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]" : ""}>
        <FilmStage
          ref={stage}
          film={film}
          onTime={(t) => {
            let i = 0;
            for (let k = 0; k < beats.length; k++) if (t >= beats[k].start) i = k;
            if (i !== playingIdx) setPlayingIdx(i);
          }}
          className={tall ? "mx-auto w-full max-w-[20rem]" : "mx-auto w-full"}
          style={tall ? undefined : { maxWidth: "min(100%, calc(56vh * 16 / 9))" }}
        />

        <div className={tall ? "min-w-0 space-y-4" : "mt-4 space-y-4"}>
          <div className="f3-strip" role="listbox" aria-label="Beats">
            {beats.map((b, i) => (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={i === sel}
                aria-pressed={i === sel}
                data-role={b.role}
                onClick={() => pick(i)}
                className={`f3-tile ${i === playingIdx ? "is-playing" : ""}`}
                style={{ width: `${Math.max(4.4, ((b.end - b.start) / Math.max(1, total)) * 60)}rem`, ["--f3-world" as string]: WORLD_HUE[b.world] } as CSSProperties}
                title={b.action}
              >
                <span className="f3-tile__n">{i + 1} · {(b.end - b.start).toFixed(1)}s · {b.role}</span>
                <span className="f3-tile__t block">{worldLabels[b.world]} · {nice(b.move)}</span>
                <span className="f3-tile__c">{b.caption ? `“${b.caption}”` : shotLabels[b.shot]}</span>
              </button>
            ))}
          </div>

          {beat && (
            <div className="rounded-xl border border-line bg-panel p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-ink">
                  Beat {sel + 1} <span className="font-normal text-ink-faint">· {beat.start.toFixed(1)}–{beat.end.toFixed(1)} s</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="f3-ghost !px-2 !py-1" onClick={() => lengthen(-0.5)} aria-label="Shorter">−½ s</button>
                  <button type="button" className="f3-ghost !px-2 !py-1" onClick={() => lengthen(0.5)} aria-label="Longer">+½ s</button>
                  <button type="button" className="f3-ghost !px-2 !py-1" onClick={() => move(-1)} disabled={sel === 0} aria-label="Move earlier">←</button>
                  <button type="button" className="f3-ghost !px-2 !py-1" onClick={() => move(1)} disabled={sel === beats.length - 1} aria-label="Move later">→</button>
                  <button type="button" className="f3-ghost !px-2 !py-1" onClick={duplicate}>
                    <Icon.Copy width={11} height={11} aria-hidden /> Copy
                  </button>
                  <button type="button" className="f3-ghost !px-2 !py-1" onClick={remove} disabled={beats.length < 2}>
                    <Icon.Trash width={11} height={11} aria-hidden /> Remove
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Picker label="World" value={beat.world} options={WORLDS.map((w) => w.id)} labels={worldLabels} onPick={(world) => edit({ world })} />
                <Picker label="Light" value={beat.time} options={TIMES} onPick={(time) => edit({ time })} />
                <Picker label="They…" value={beat.move} options={MOVES} onPick={(m) => edit({ move: m })} />
                <Picker label="Face" value={beat.expression} options={EXPRESSIONS} onPick={(expression) => edit({ expression })} />
                <Picker label="Shot" value={beat.shot} options={SHOTS.map((s) => s.id)} labels={shotLabels} onPick={(shot) => edit({ shot })} />
                <Picker label="Thing" value={beat.prop} options={PROPS} onPick={(prop) => edit({ prop })} />
                <Picker label="Story job" value={beat.role} options={ROLES} onPick={(role) => edit({ role })} />
                <label className="block min-w-0">
                  <span className="f3-label">Caption (≤ 6 words)</span>
                  <input className="f3-field" value={beat.caption} onChange={(e) => edit({ caption: e.target.value.slice(0, 60) })} placeholder="(none)" />
                </label>
              </div>
              <label className="mt-2.5 block">
                <span className="f3-label">What happens</span>
                <input className="f3-field" value={beat.action} onChange={(e) => edit({ action: e.target.value.slice(0, 240) })} />
              </label>
            </div>
          )}

          {problems.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-[#f8b471]/40 bg-[#f8b471]/5 p-3">
              {problems.map((p, i) => (
                <li key={i} className="text-[11.5px] text-[#f8b471]">
                  {p.at !== "plan" ? (
                    <button type="button" className="underline-offset-2 hover:underline" onClick={() => pick(Math.max(0, beats.findIndex((b) => b.id === p.at)))}>{p.message}</button>
                  ) : p.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
