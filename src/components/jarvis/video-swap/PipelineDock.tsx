"use client";

// The dock at the bottom: the pipeline the PC will run (each stage lit when
// it's switched on, with its engine and its honest time), the total, and
// Make it. While sending, it shows the real upload progress.

import { Icon } from "../../icons";
import type { VideoSwap } from "@/lib/studio/video-swap/useVideoSwap";
import { humanMinutes } from "@/lib/studio/video-swap/plan";

const STEP_LABEL = { filing: "Filing the job…", uploading: "Uploading your clip…", linking: "Handing it to your PC…" } as const;

export function PipelineDock({ swap }: { swap: VideoSwap }) {
  const { stages, minutes, problems, phase, clip } = swap;
  const sending = Boolean(phase);

  return (
    <div className="vs-dock shrink-0 px-3 py-3 sm:px-5">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3 lg:flex-row lg:items-center">
        <ol className="vs-rail min-w-0 flex-1" aria-label="What your PC will do">
          {stages.map((s) => (
            <li key={s.id} className={`vs-node ${s.on ? "is-on" : ""}`} title={s.detail}>
              <b>{s.label}</b>
              <small className="mono">
                {s.engine}
                {s.on && s.minutes ? ` · ${humanMinutes(s.minutes)}` : s.on ? "" : " · off"}
              </small>
            </li>
          ))}
        </ol>

        <div className="flex items-center gap-3 lg:justify-end">
          <div className="min-w-0 flex-1 text-right lg:flex-none">
            {sending ? (
              <div className="w-48">
                <p className="text-[11.5px] text-[var(--vs-ink-2)]">
                  {STEP_LABEL[phase!.step]} {phase!.step === "uploading" ? <span className="mono">{Math.round(phase!.progress * 100)}%</span> : null}
                </p>
                <div className="vs-bar mt-1.5">
                  <i style={{ width: `${Math.max(4, phase!.progress * 100)}%` }} />
                </div>
              </div>
            ) : problems.length && clip ? (
              <p className="vs-warn max-w-[280px] text-left lg:text-right">{problems[0]}</p>
            ) : (
              <p className="text-left text-[11.5px] leading-tight text-[var(--vs-ink-3)] lg:text-right">
                <span className="mono text-[13px] text-[var(--vs-ink)]">{humanMinutes(minutes)}</span>
                <br />
                <span className="sm:hidden">{stages.filter((s) => s.on).length} steps · </span>on your PC · $0
              </p>
            )}
          </div>
          <button type="button" className="vs-go" disabled={sending || problems.length > 0} onClick={() => void swap.send()}>
            <Icon.Sparkles width={15} height={15} aria-hidden />
            {sending ? "Sending" : "Make it"}
          </button>
        </div>
      </div>
      {swap.error && !sending && <p className="vs-warn mx-auto mt-2 max-w-[1400px]">{swap.error}</p>}
    </div>
  );
}
