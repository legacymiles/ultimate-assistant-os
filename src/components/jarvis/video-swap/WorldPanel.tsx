"use client";

// The new world: a background picture and/or the world in words. H3 brings it
// to life as a moving plate; the swapped people are cut out and laid on it.

import { Icon } from "../../icons";
import type { VideoSwap } from "@/lib/studio/video-swap/useVideoSwap";
import type { PlateMotion, SwapAspect, SwapQuality } from "@/lib/studio/video-swap/plan";
import { Slot } from "./Slot";

const MOTIONS: { id: PlateMotion; label: string }[] = [
  { id: "match", label: "Match my clip" },
  { id: "still", label: "Locked off" },
  { id: "drift", label: "Slow drift" },
  { id: "push", label: "Push in" },
];
const ASPECTS: { id: SwapAspect; label: string }[] = [
  { id: "source", label: "As shot" },
  { id: "9:16", label: "9:16" },
  { id: "16:9", label: "16:9" },
  { id: "1:1", label: "1:1" },
];
const QUALITY: { id: SwapQuality; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "hd", label: "HD" },
];
const IDEAS = ["Luxury penthouse at golden hour", "Neon Tokyo street in the rain", "Minimal white photo studio", "Sunlit marble kitchen", "Beach at sunset"];

export function WorldPanel({ swap }: { swap: VideoSwap }) {
  const { draft } = swap;
  const scene = draft.scene;
  const keep = scene.mode === "keep";

  return (
    <div className="grid gap-4">
      <div className="vs-seg w-full" role="group" aria-label="Background">
        <button type="button" className="flex-1 justify-center" aria-pressed={!keep} onClick={() => swap.patchScene({ mode: "replace" })}>
          <Icon.Globe width={12} height={12} aria-hidden /> New world
        </button>
        <button type="button" className="flex-1 justify-center" aria-pressed={keep} onClick={() => swap.patchScene({ mode: "keep" })}>
          <Icon.Lock width={11} height={11} aria-hidden /> Keep original
        </button>
      </div>

      {!keep ? (
        <>
          <Slot
            src={scene.image}
            label="Background picture"
            hint="Where they should be — H3 brings it to life"
            tag="New world"
            icon={<Icon.Image width={20} height={20} aria-hidden />}
            className="aspect-video w-full"
            onFile={(f) => void swap.setSceneImage(f)}
            onClear={() => void swap.setSceneImage(null)}
          />
          <div>
            <label className="vs-label" htmlFor="vs-world">
              Describe the world {scene.image ? "(optional)" : ""}
            </label>
            <textarea
              id="vs-world"
              className="vs-area"
              value={scene.prompt}
              onChange={(e) => swap.patchScene({ prompt: e.target.value })}
              placeholder="A sunlit marble kitchen, steam rising from a pan, soft window light from the left"
            />
            {!scene.prompt && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {IDEAS.map((idea) => (
                  <button key={idea} type="button" className="vs-chip" onClick={() => swap.patchScene({ prompt: idea })}>
                    {idea}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <span className="vs-label">Camera on the new world</span>
            <div className="vs-chips">
              {MOTIONS.map((m) => (
                <button key={m.id} type="button" className="vs-chip" aria-pressed={scene.motion === m.id} onClick={() => swap.patchScene({ motion: m.id })}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <label className="vs-switch">
            <span>Grade the people to the new light</span>
            <input type="checkbox" checked={scene.relight} onChange={(e) => swap.patchScene({ relight: e.target.checked })} />
            <span className="vs-knob" aria-hidden />
          </label>
        </>
      ) : (
        <p className="text-[12px] leading-relaxed text-[var(--vs-ink-2)]">
          The background stays exactly as shot. Only the people change.
        </p>
      )}

      <div className="grid gap-3 border-t border-[var(--vs-line)] pt-4">
        <div>
          <span className="vs-label">Shape</span>
          <div className="vs-chips">
            {ASPECTS.map((a) => (
              <button key={a.id} type="button" className="vs-chip" aria-pressed={draft.aspect === a.id} onClick={() => swap.patch({ aspect: a.id })}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <span className="vs-label">Quality</span>
            <div className="vs-chips">
              {QUALITY.map((q) => (
                <button key={q.id} type="button" className="vs-chip" aria-pressed={draft.quality === q.id} onClick={() => swap.patch({ quality: q.id })}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>
          <label className="vs-switch min-w-[160px] flex-1 self-end">
            <span>Keep the original sound</span>
            <input type="checkbox" checked={draft.keepAudio} onChange={(e) => swap.patch({ keepAudio: e.target.checked })} />
            <span className="vs-knob" aria-hidden />
          </label>
        </div>
      </div>
    </div>
  );
}
