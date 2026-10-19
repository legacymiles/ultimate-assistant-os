"use client";

// Stage 2 — Story: the line, the shape it moves in, and the film's settings.

import { Icon } from "../../icons";
import type { KidsFlow } from "@/lib/studio/kids-flow/useKidsFlow";
import { LOOKS, SHAPES, type Aspect, type Length, type Mood, type Words } from "@/lib/studio/kids-flow/plan";

const MOODS: Mood[] = ["cozy", "funny", "adventurous", "gentle"];

function Seg<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="kf-seg">
      {options.map((o) => (
        <button key={String(o.id)} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StoryStage({ flow }: { flow: KidsFlow }) {
  const { draft, patch } = flow;
  return (
    <section aria-labelledby="kf-story" className="space-y-5">
      <div>
        <h3 id="kf-story" className="mb-2 text-[15px] font-semibold text-ink">What happens to {draft.sheet.name || "him"}?</h3>
        <textarea
          className="kf-field min-h-[4.5rem] resize-y text-[13px] leading-snug"
          value={draft.story}
          onChange={(e) => patch({ story: e.target.value })}
          placeholder="His kite blows away and he chases it through town, a forest and up a hill, and catches it at sunset"
          aria-label="The story, in a line"
        />
        <p className="mt-1 text-[10.5px] text-ink-faint">One line is enough: what he wants, what gets in the way, the places it happens.</p>
      </div>

      <div>
        <span className="kf-label">How the story moves</span>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SHAPES.map((s) => (
            <button key={s.id} type="button" className="kf-opt" aria-pressed={draft.shape === s.id} onClick={() => patch({ shape: s.id })}>
              <p className="text-[12.5px] font-semibold text-ink">{s.label}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{s.blurb}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="kf-label">Length</span>
          <Seg<Length> label="Length" value={draft.length} onChange={(v) => patch({ length: v })} options={[{ id: 30, label: "30 s" }, { id: 45, label: "45 s" }, { id: 60, label: "60 s" }]} />
        </div>
        <div>
          <span className="kf-label">Shape</span>
          <Seg<Aspect> label="Shape" value={draft.aspect} onChange={(v) => patch({ aspect: v })} options={[{ id: "16:9", label: "16:9 wide" }, { id: "9:16", label: "9:16 tall" }, { id: "both", label: "Both" }]} />
        </div>
        <div>
          <span className="kf-label">Words</span>
          <Seg<Words> label="Words" value={draft.words} onChange={(v) => patch({ words: v })} options={[{ id: "captions", label: "Music + captions" }, { id: "music", label: "Music only" }, { id: "voice", label: "Voice-over" }]} />
          {draft.words === "voice" && <p className="mt-1 text-[10.5px] text-ink-faint">A voice needs your ElevenLabs connector or your own recording on the PC.</p>}
        </div>
        <div>
          <span className="kf-label">Look</span>
          <Seg label="Look" value={draft.look} onChange={(v) => patch({ look: v })} options={LOOKS} />
        </div>
      </div>

      <div>
        <span className="kf-label">Mood (optional)</span>
        <div className="flex flex-wrap gap-1.5">
          {MOODS.map((m) => {
            const on = draft.moods.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => patch({ moods: on ? draft.moods.filter((x) => x !== m) : [...draft.moods, m] })}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] capitalize transition ${on ? "border-[var(--kf-hero)] text-ink" : "border-line text-ink-muted hover:text-ink"}`}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="kf-label" htmlFor="kf-title">Title (optional)</label>
          <input id="kf-title" className="kf-field" value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder={`${draft.sheet.name || "Milo"} and the Lost Kite`} />
        </div>
        <div>
          <label className="kf-label" htmlFor="kf-notes">Must have / must not (optional)</label>
          <input id="kf-notes" className="kf-field" value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="a dog that follows him; no rain" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="kf-ghost" onClick={() => flow.go("character")}>
          <Icon.ArrowLeft width={12} height={12} aria-hidden /> Character
        </button>
        <div className="flex items-center gap-2">
          {draft.beats.length > 0 && (
            <button type="button" className="kf-ghost" onClick={() => flow.go("board")}>
              Keep my storyboard
            </button>
          )}
          <button type="button" className="kf-go" onClick={() => void flow.plan()} disabled={flow.planning || draft.story.trim().length < 8}>
            <Icon.Sparkles width={13} height={13} aria-hidden />
            {flow.planning ? "Writing the storyboard…" : draft.beats.length ? "Rewrite the storyboard" : "Write the storyboard"}
          </button>
        </div>
      </div>
      {flow.planNote && <p className="text-right text-[11px] text-ink-faint">{flow.planNote}</p>}
    </section>
  );
}
