"use client";

// ---------------------------------------------------------------------------
// 3D Animation Flow — Jarvis › Studio › the "3D Animation Flow" card.
//
// The 3D sibling of Kids Animation Flow: Character → Story → Storyboard →
// Render → Watch, but the film is a real Three.js scene made in code
// (src/lib/studio/film3d). It plays live while it is edited, renders to MP4
// right here in the browser, or goes to the PC for an HD render through the
// threejs-film-story skill. Design skill driving the look: interactive-web-
// studio — one toy, the live film stage, inside the shell's dense dark system.
// ---------------------------------------------------------------------------

import "./film3d.css";
import { useEffect, useRef, type CSSProperties } from "react";
import { Icon } from "../../icons";
import { STAGES, useFilm3D, type Film3DSeed, type Stage } from "@/lib/studio/film3d/useFilm3D";
import { CharacterStage } from "./CharacterStage";
import { StoryStage } from "./StoryStage";
import { BoardStage } from "./BoardStage";
import { RenderStage } from "./RenderStage";
import { WatchStage, FilmList } from "./WatchStage";

export function Film3DFlow({ seed, onClose }: { seed?: Film3DSeed | null; onClose?: () => void }) {
  const flow = useFilm3D();
  const { draft, stage, job, local } = flow;
  const started = useRef<number | null>(null);
  const { startFromPrompt } = flow;

  useEffect(() => {
    if (!seed || started.current === seed.nonce) return;
    started.current = seed.nonce;
    void startFromPrompt(seed);
  }, [seed, startFromPrompt]);

  const done: Record<Stage, boolean> = {
    character: flow.images.length > 0 || draft.hero.name.trim().length > 0,
    story: draft.story.trim().length > 8,
    board: draft.beats.length > 0 && flow.problems.length === 0,
    render: Boolean(job) || local?.phase === "done",
    watch: Boolean(local?.phase === "done" || (job?.kind === "done" && job.finished.video)),
  };

  return (
    <div className="f3 flex h-full min-h-0 min-w-0 flex-col" style={{ ["--f3-hero" as string]: draft.hero.accent } as CSSProperties}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-3 py-2">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink"
          >
            <Icon.ArrowLeft width={11} height={11} aria-hidden /> Workflows
          </button>
        )}
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-ink">3D Animation Flow</h2>
          <p className="text-[11px] text-ink-faint">Your character + a one-line story → a 3D animated short, made in code with Three.js</p>
        </div>
        <nav className="f3-rail ml-auto max-w-full" aria-label="Steps">
          {STAGES.map((s, i) => (
            <button key={s.id} type="button" onClick={() => flow.go(s.id)} aria-current={stage === s.id ? "step" : undefined} className={`f3-step ${done[s.id] ? "is-done" : ""}`}>
              <span className="f3-step__n">{done[s.id] ? <Icon.Check width={9} height={9} /> : i + 1}</span>
              {s.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-3 py-4 sm:px-5">
            {flow.planning === "plan" && (
              <p className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-[12px] text-ink" role="status">
                <span className="f3-busy" aria-hidden />
                Reading {flow.images.length ? `${draft.hero.name || "your character"}'s picture` : "your story"} and planning the shots…
              </p>
            )}
            {stage === "character" && <CharacterStage flow={flow} />}
            {stage === "story" && <StoryStage flow={flow} />}
            {stage === "board" && <BoardStage flow={flow} />}
            {stage === "render" && <RenderStage flow={flow} />}
            {stage === "watch" && <WatchStage flow={flow} />}
          </div>
        </main>
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-l border-line bg-panel/60 lg:block" aria-label="Your films">
          <FilmList flow={flow} />
        </aside>
      </div>
    </div>
  );
}
