"use client";

// Stage 2 — Story: one line of story, the length, the frame, the look and the
// mood. "Write the storyboard" turns it into beats the 3D director can shoot.

import { Icon } from "../../icons";
import type { Film3DFlow } from "@/lib/studio/film3d/useFilm3D";
import { LOOKS, type Aspect, type Length, type Mood } from "@/lib/studio/film3d/plan";

const MOODS: Mood[] = ["cozy", "funny", "adventurous", "gentle"];

export function StoryStage({ flow }: { flow: Film3DFlow }) {
  const { draft, patch, planning } = flow;
  return (
    <section aria-labelledby="f3-story" className="mx-auto max-w-3xl space-y-4">
      <div>
        <h3 id="f3-story" className="text-[15px] font-semibold text-ink">The story</h3>
        <p className="text-[11.5px] text-ink-muted">One line is enough. Name the places — each one becomes its own 3D world.</p>
      </div>

      <label className="block">
        <span className="f3-label">Title (optional)</span>
        <input className="f3-field" value={draft.title} onChange={(e) => patch({ title: e.target.value.slice(0, 100) })} placeholder={`${draft.hero.name || "Milo"} and the Runaway Kite`} />
      </label>
      <label className="block">
        <span className="f3-label">The story, in a line</span>
        <textarea
          className="f3-field min-h-[5.5rem] resize-y"
          value={draft.story}
          onChange={(e) => patch({ story: e.target.value.slice(0, 600) })}
          placeholder="Her balloon floats away and she follows it across the beach, through the city at night, and catches it on a rooftop"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <span className="f3-label">Length</span>
          <div className="f3-seg" role="group" aria-label="Length">
            {([30, 45, 60] as Length[]).map((l) => (
              <button key={l} type="button" aria-pressed={draft.length === l} onClick={() => patch({ length: l })}>{l} s</button>
            ))}
          </div>
        </div>
        <div>
          <span className="f3-label">Frame</span>
          <div className="f3-seg" role="group" aria-label="Frame">
            {(["16:9", "9:16", "1:1"] as Aspect[]).map((a) => (
              <button key={a} type="button" aria-pressed={draft.aspect === a} onClick={() => patch({ aspect: a })}>
                {a === "16:9" ? "Wide" : a === "9:16" ? "Tall" : "Square"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="f3-label">Words</span>
          <div className="f3-seg" role="group" aria-label="Words">
            <button type="button" aria-pressed={draft.words === "captions"} onClick={() => patch({ words: "captions" })}>Music + captions</button>
            <button type="button" aria-pressed={draft.words === "music"} onClick={() => patch({ words: "music" })}>Music only</button>
          </div>
        </div>
      </div>

      <div>
        <span className="f3-label">Look</span>
        <div className="grid gap-2 sm:grid-cols-4">
          {LOOKS.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={draft.look === l.id}
              onClick={() => patch({ look: l.id })}
              className="f3-chip !rounded-xl !px-3 !py-2 text-left"
            >
              <span className="block text-[12px] font-semibold text-ink">{l.label}</span>
              <span className="block text-[10.5px] leading-snug">{l.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="f3-label">Mood</span>
        <div className="f3-chips">
          {MOODS.map((m) => (
            <button
              key={m}
              type="button"
              className="f3-chip"
              aria-pressed={draft.moods.includes(m)}
              onClick={() => patch({ moods: draft.moods.includes(m) ? draft.moods.filter((x) => x !== m) : [...draft.moods, m] })}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="f3-label">Must / must-not (optional)</span>
        <input className="f3-field" value={draft.notes} onChange={(e) => patch({ notes: e.target.value.slice(0, 300) })} placeholder="end on her laughing; no night scenes" />
      </label>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" className="f3-go" disabled={planning !== null || draft.story.trim().length < 8} onClick={() => void flow.plan()}>
          {planning === "plan" ? <span className="f3-busy" aria-hidden /> : <Icon.Sparkles width={12} height={12} aria-hidden />}
          {planning === "plan" ? "Writing the storyboard…" : draft.beats.length ? "Rewrite the storyboard" : "Write the storyboard"}
        </button>
        {draft.beats.length > 0 && (
          <button type="button" className="f3-ghost" onClick={() => flow.go("board")}>
            Keep the current one <Icon.ArrowRight width={11} height={11} aria-hidden />
          </button>
        )}
      </div>
      {flow.planNote && <p className="text-[11.5px] text-ink-muted">{flow.planNote}</p>}
    </section>
  );
}
