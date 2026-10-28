"use client";

// ---------------------------------------------------------------------------
// Custom Video Swap — Jarvis › Studio › the "Custom Video Swap" card.
//
// The owner picks the card, types what they want and drops the clip and the
// pictures into the Studio composer, and presses Start: this screen pops up
// with every upload already in its slot — the driving video, each person in
// the clip → who they become (with an arrow between), and the new world.
// "Make it" files the job WITH the clip to In Queue; Claude Code on the PC
// runs it with the custom-video-swap skill (Viggle swap → H3 living plate →
// matte & composite) and the result lands back here as a before | after.
//
// Design: taste-skill, Cold Luxury (see video-swap.css for the design read).
// ---------------------------------------------------------------------------

import "./video-swap.css";
import { useEffect, useRef } from "react";
import { Icon } from "../../icons";
import { useVideoSwap, type SwapSeed } from "@/lib/studio/video-swap/useVideoSwap";
import { doesScene, doesSwap, isMarked } from "@/lib/studio/video-swap/plan";
import { vsFonts } from "./fonts";
import { ClipStage } from "./ClipStage";
import { CastPanel } from "./CastPanel";
import { WorldPanel } from "./WorldPanel";
import { PipelineDock } from "./PipelineDock";
import { SwapJob } from "./SwapJob";

export function VideoSwap({ seed, onClose }: { seed?: SwapSeed | null; onClose?: () => void }) {
  const swap = useVideoSwap();
  const started = useRef<number | null>(null);
  const { startFromSeed } = swap;

  useEffect(() => {
    if (!seed || started.current === seed.nonce) return;
    started.current = seed.nonce;
    void startFromSeed(seed);
  }, [seed, startFromSeed]);

  const { draft, meta } = swap;
  const steps = [
    { label: "Video", done: Boolean(swap.clip) },
    { label: "Cast", done: doesSwap(draft) && (draft.people.length === 1 || draft.people.every((p) => !p.image || isMarked(p))) },
    { label: "World", done: doesScene(draft) || draft.scene.mode === "keep" },
    { label: "Make", done: Boolean(swap.job) },
  ];

  return (
    <div className={`vs ${vsFonts} flex h-full min-h-0 min-w-0 flex-col`}>
      <header className="vs-top flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-5">
        {onClose && (
          <button type="button" className="vs-back" onClick={onClose}>
            <Icon.ArrowLeft width={12} height={12} aria-hidden /> Workflows
          </button>
        )}
        <div className="min-w-0">
          <h2 className="vs-title">Custom Video Swap</h2>
          <p className="vs-sub">Recast any clip — new characters, a new world, the original motion</p>
        </div>
        <nav className="vs-steps ml-auto" aria-label="Progress">
          {steps.map((s) => (
            <span key={s.label} className={`vs-step ${s.done ? "is-done" : ""}`}>
              <i aria-hidden />
              {s.label}
            </span>
          ))}
        </nav>
        {swap.swaps.length > 0 && (
          <SwapsMenu swap={swap} />
        )}
      </header>

      {swap.view === "job" ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-3 py-5 sm:px-5">
            <SwapJob swap={swap} />
          </div>
        </main>
      ) : (
        <>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto grid max-w-[1400px] gap-4 px-3 py-5 sm:px-5 lg:grid-cols-12">
              <section className="vs-panel vs-rise lg:col-span-5" aria-labelledby="vs-h-video">
                <div className="vs-h">
                  <span className="vs-n mono">01</span>
                  <h3 id="vs-h-video">Driving video</h3>
                  <p className="hidden sm:block">Motion, camera, timing</p>
                </div>
                <div className="p-4 pt-3">
                  <ClipStage swap={swap} />
                </div>
              </section>

              <section className="vs-panel vs-rise-2 lg:col-span-4" aria-labelledby="vs-h-cast">
                <div className="vs-h">
                  <span className="vs-n mono">02</span>
                  <h3 id="vs-h-cast">Cast</h3>
                  <p className="hidden sm:block">Who becomes who</p>
                </div>
                <div className="p-4 pt-3">
                  <CastPanel swap={swap} />
                </div>
              </section>

              <section className="vs-panel vs-rise-3 lg:col-span-3" aria-labelledby="vs-h-world">
                <div className="vs-h">
                  <span className="vs-n mono">03</span>
                  <h3 id="vs-h-world">New world</h3>
                </div>
                <div className="p-4 pt-3">
                  <WorldPanel swap={swap} />
                </div>
              </section>

              {draft.request && (
                <p className="text-[11.5px] text-[var(--vs-ink-3)] lg:col-span-12">
                  Your words: <span className="text-[var(--vs-ink-2)]">“{draft.request}”</span>
                  {meta ? "" : " — add the clip to start."}
                </p>
              )}
            </div>
          </main>
          <PipelineDock swap={swap} />
        </>
      )}
    </div>
  );
}

/** Earlier swaps — open one to watch it or see where it is. */
function SwapsMenu({ swap }: { swap: ReturnType<typeof useVideoSwap> }) {
  return (
    <details className="relative">
      <summary className="vs-back cursor-pointer list-none">
        <Icon.Layers width={12} height={12} aria-hidden /> Your swaps <span className="mono text-[var(--vs-ink-3)]">{swap.swaps.length}</span>
      </summary>
      <div className="vs-panel vs-list absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-24px)] p-2">
        {swap.swaps.slice(0, 12).map((s) => {
          const done = s.kind === "done" ? Boolean(s.finished.video) : Boolean(s.request.video);
          const state = s.kind === "done" ? (done ? "Ready" : "Finished") : s.request.status === "working" ? "On your PC" : "Queued";
          return (
            <button key={s.id} type="button" aria-current={swap.job?.id === s.id} onClick={() => swap.openSwap(s.id)}>
              <span className="grid h-11 w-11 place-items-center rounded-[10px] border border-[var(--vs-line-2)] bg-[var(--vs-panel-2)]">
                {done ? <Icon.Play width={13} height={13} aria-hidden /> : <Icon.Clock width={13} height={13} aria-hidden />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] text-[var(--vs-ink)]">{s.title}</span>
                <span className="mono block text-[10.5px] text-[var(--vs-ink-3)]">
                  {state} · {s.at.slice(5, 16).replace("T", " ")}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </details>
  );
}
