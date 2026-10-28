"use client";

// After "Make it": the job, read live from In Queue — filed, picked up by the
// PC, the agent's latest note, the video landing — and, once it lands, a
// before | after you drag across to compare.

import { useRef, useState } from "react";
import { Icon } from "../../icons";
import type { VideoSwap } from "@/lib/studio/video-swap/useVideoSwap";
import { humanMinutes, jobMinutes, parseJob } from "@/lib/studio/video-swap/plan";

const SAY = "work my Jarvis queue";

export function SwapJob({ swap }: { swap: VideoSwap }) {
  const job = swap.job;
  const [copied, setCopied] = useState(false);
  if (!job) {
    return (
      <div className="grid place-items-center py-20 text-center">
        <p className="text-[13px] text-[var(--vs-ink-2)]">That swap isn&apos;t in your queue any more.</p>
        <button type="button" className="vs-ghost mt-3" onClick={swap.backToCompose}>
          <Icon.ArrowLeft width={12} height={12} aria-hidden /> Back to the swap
        </button>
      </div>
    );
  }
  const open = job.kind === "open" ? job.request : null;
  const finished = job.kind === "done" ? job.finished : null;
  const text = open?.text ?? finished?.text ?? "";
  const plan = parseJob(text);
  const video = Boolean(open?.video || finished?.video);
  const hasInput = Boolean(open?.input || finished?.input);
  const picked = Boolean(open?.status === "working" || finished);
  const notes = open?.notes ?? [];

  const steps: { label: string; detail: string; state: "done" | "now" | "next" }[] = [
    { label: "Filed with your clip", detail: hasInput ? `${job.id} · the driving clip is attached` : `${job.id} · waiting for the clip`, state: hasInput ? "done" : "now" },
    {
      label: "Your PC picks it up",
      detail: picked ? `${open?.startedBy ?? finished?.by ?? "Claude Code"} took it` : `In Claude Code on your PC, say “${SAY}”`,
      state: picked ? "done" : hasInput ? "now" : "next",
    },
    {
      label: plan?.stages.includes("swap") ? "Swap · world · composite" : "World · composite",
      detail: notes.length ? notes[notes.length - 1].text : "Viggle swaps, H3 builds the world, the people are matted on",
      state: video || finished ? "done" : picked ? "now" : "next",
    },
    { label: "Back here, before and after", detail: video ? "It's in — drag across it" : finished?.result ?? "Plays on every device", state: video || finished ? "done" : "next" },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section className="vs-panel vs-rise p-4">
        {video ? (
          <Compare before={hasInput ? `/api/new-jarvis/requests/watch?id=${job.id}&input=1` : null} after={`/api/new-jarvis/requests/watch?id=${job.id}`} />
        ) : hasInput ? (
          <div className="vs-screen aspect-video w-full">
            <video src={`/api/new-jarvis/requests/watch?id=${job.id}&input=1`} muted loop playsInline autoPlay className="opacity-60" />
            <span className="vs-hint">The original — the swap lands here when your PC is done</span>
          </div>
        ) : (
          <div className="vs-skel aspect-video w-full" />
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {video && (
            <a className="vs-ghost" href={`/api/new-jarvis/requests/watch?id=${job.id}&download=1`}>
              <Icon.Download width={12} height={12} aria-hidden /> Download
            </a>
          )}
          <button type="button" className="vs-ghost" onClick={swap.backToCompose}>
            <Icon.Edit width={12} height={12} aria-hidden /> Change and make again
          </button>
          <button type="button" className="vs-ghost" onClick={swap.newSwap}>
            <Icon.Plus width={12} height={12} aria-hidden /> New swap
          </button>
        </div>
      </section>

      <section className="vs-panel vs-rise-2 p-4">
        <h3 className="text-[14px] font-semibold tracking-tight">{job.title}</h3>
        {plan && (
          <p className="mono mt-1 text-[11px] text-[var(--vs-ink-3)]">
            {plan.clip.trim[1] - plan.clip.trim[0]} s · {plan.people.length} swap{plan.people.length === 1 ? "" : "s"} · {plan.scene.mode === "replace" ? "new world" : "original background"} · {plan.output.quality.toUpperCase()}
          </p>
        )}
        {open && open.images.length > 0 && (
          <ul className="mt-3 flex gap-2" aria-label="Pictures sent">
            {open.images.map((src, i) => (
              <li key={i} className="h-16 w-14 overflow-hidden rounded-[10px] border border-[var(--vs-line-2)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- stored data URL */}
                <img src={src} alt="" className="h-full w-full object-cover" />
              </li>
            ))}
          </ul>
        )}
        <ol className="vs-track mt-5">
          {steps.map((s) => (
            <li key={s.label} className={s.state === "done" ? "is-done" : s.state === "now" ? "is-now" : ""}>
              <span className="vs-dot" aria-hidden>
                <Icon.Check width={9} height={9} />
              </span>
              <div>
                <p className={`text-[12.5px] ${s.state === "next" ? "text-[var(--vs-ink-3)]" : "text-[var(--vs-ink)]"}`}>{s.label}</p>
                <p className="text-[11.5px] leading-snug text-[var(--vs-ink-3)]">{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        {!picked && (
          <div className="mt-5 rounded-[14px] border border-[var(--vs-line)] bg-[var(--vs-panel-2)] p-3">
            <p className="text-[12px] text-[var(--vs-ink-2)]">Your PC makes it for free. In Claude Code, say:</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="mono flex-1 rounded-full border border-[var(--vs-line-2)] px-3 py-1.5 text-[12px]">{SAY}</code>
              <button
                type="button"
                className="vs-ghost !h-8"
                onClick={() => void navigator.clipboard?.writeText(SAY).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })}
              >
                <Icon.Copy width={11} height={11} aria-hidden /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
            {plan && (
              <p className="mt-2 text-[11px] text-[var(--vs-ink-3)]">
                Expect about <span className="mono">{humanMinutes(jobMinutes(plan))}</span> once it starts.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** Before | after: two players in lockstep, a chrome divider you drag. */
function Compare({ before, after }: { before: string | null; after: string }) {
  const [at, setAt] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setAt(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };
  if (!before) {
    return (
      <div className="vs-compare aspect-video w-full">
        <video src={after} controls playsInline autoPlay muted loop />
      </div>
    );
  }
  return (
    <div
      ref={box}
      className="vs-compare aspect-video w-full"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => e.buttons && move(e.clientX)}
      role="slider"
      aria-label="Before and after"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(at)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setAt((v) => Math.max(0, v - 5));
        if (e.key === "ArrowRight") setAt((v) => Math.min(100, v + 5));
      }}
    >
      <video
        ref={a}
        src={before}
        muted
        loop
        playsInline
        autoPlay
        onTimeUpdate={() => {
          if (a.current && b.current && Math.abs(a.current.currentTime - b.current.currentTime) > 0.15) b.current.currentTime = a.current.currentTime;
        }}
      />
      <div className="vs-compare__after" style={{ clipPath: `inset(0 0 0 ${at}%)` }}>
        <video ref={b} src={after} muted loop playsInline autoPlay />
      </div>
      <span className="vs-compare__label" style={{ left: 10 }}>Before</span>
      <span className="vs-compare__label" style={{ right: 10 }}>After</span>
      <span className="vs-compare__line" style={{ left: `${at}%` }} />
      <span className="vs-compare__knob" style={{ left: `${at}%` }}>
        <Icon.Move width={14} height={14} aria-hidden />
      </span>
    </div>
  );
}
