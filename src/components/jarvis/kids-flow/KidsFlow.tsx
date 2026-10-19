"use client";

// ---------------------------------------------------------------------------
// Kids Animation Flow — Jarvis › Studio › Kids flow.
//
// The whole pipeline for "Animate my character" as one screen instead of a
// chat: Character → Story → Storyboard → Render → Watch. The picture and the
// story line become a character sheet and a beat strip the owner can drag and
// edit, an animatic plays the timing before anything is spent, and "Send to
// my PC" hands the brief and the picture to In Queue, where Claude Code on the
// PC renders it with the animate-character-story skill and sends the MP4 back
// to the Watch stage. Design skill driving the look: interactive-web-studio
// (one toy — the draggable paper strip with its live animatic — in the
// shell's own dense, dark system).
// ---------------------------------------------------------------------------

import "./kids-flow.css";
import type { CSSProperties } from "react";
import { Icon } from "../../icons";
import { STAGES, useKidsFlow, type Stage } from "@/lib/studio/kids-flow/useKidsFlow";
import { CharacterStage } from "./CharacterStage";
import { StoryStage } from "./StoryStage";
import { BoardStage } from "./BoardStage";
import { RenderStage } from "./RenderStage";
import { WatchStage, FilmList } from "./WatchStage";

export function KidsFlow() {
  const flow = useKidsFlow();
  const { draft, images, stage, job } = flow;

  const done: Record<Stage, boolean> = {
    character: images.length > 0 || Boolean(draft.sheet.hair || draft.sheet.outfit),
    story: draft.story.trim().length > 8,
    board: draft.beats.length > 0 && flow.problems.length === 0,
    render: Boolean(job),
    watch: job?.kind === "done" && Boolean(job.finished.video),
  };

  const hero = draft.sheet.heroColor.match(/#[0-9a-f]{6}/i)?.[0] ?? draft.sheet.palette[0] ?? "#f6cf55";

  return (
    <div className="kf flex h-full min-h-0 min-w-0 flex-col" style={{ ["--kf-hero" as string]: hero } as CSSProperties}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-ink">Kids Animation Flow</h2>
          <p className="text-[11px] text-ink-faint">Your character + a one-line story → a cut-paper animated short, made on your PC</p>
        </div>
        <nav className="kf-rail ml-auto max-w-full" aria-label="Steps">
          {STAGES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => flow.go(s.id)}
              aria-current={stage === s.id ? "step" : undefined}
              className={`kf-step ${done[s.id] ? "is-done" : ""}`}
            >
              <span className="kf-step__n">{done[s.id] ? <Icon.Check width={9} height={9} /> : i + 1}</span>
              {s.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-3 py-4 sm:px-5">
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
