"use client";

// Stage 4 — Render: send the brief and the picture to the PC, then watch the
// job move — queued, picked up, notes from the agent, the video coming back.
// Every step here is read live from In Queue; nothing is a timer pretending.

import { useState } from "react";
import { Icon } from "../../icons";
import type { KidsFlow } from "@/lib/studio/kids-flow/useKidsFlow";

const SAY = "work my Jarvis queue";

export function RenderStage({ flow }: { flow: KidsFlow }) {
  const { draft, images, job, problems } = flow;
  const [copied, setCopied] = useState(false);

  const open = job?.kind === "open" ? job.request : null;
  const finished = job?.kind === "done" ? job.finished : null;
  const queued = Boolean(job);
  const picked = Boolean(open?.status === "working" || finished);
  const video = Boolean(open?.video || finished?.video);
  const done = Boolean(finished);
  const notes = open?.notes ?? [];

  const steps: { label: string; detail: string; state: "done" | "now" | "next" }[] = [
    {
      label: "Sent to your queue",
      detail: queued ? `Filed as ${job!.id} in Animate my character.` : "The brief and the picture go to In Queue.",
      state: queued ? "done" : "now",
    },
    {
      label: "Your PC picks it up",
      detail: picked
        ? `${open?.startedBy ?? finished?.by ?? "Claude Code"} took it.`
        : `In Claude Code on your PC, say “${SAY}”.`,
      state: picked ? "done" : queued ? "now" : "next",
    },
    {
      label: "Drawn, scored and checked",
      detail: notes.length ? notes[notes.length - 1].text : "Built with the animate kit, then the review checks run.",
      state: video || done ? "done" : picked ? "now" : "next",
    },
    {
      label: "The video comes back here",
      detail: video ? "It's here — open Watch." : done ? finished?.result ?? "Finished." : "Plays on any device once it lands.",
      state: video || done ? "done" : "next",
    },
  ];

  return (
    <section aria-labelledby="kf-render" className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <h3 id="kf-render" className="text-[15px] font-semibold text-ink">Make it</h3>
        <div className="flex gap-3 rounded-xl border border-line bg-panel p-3">
          {images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local data URL
            <img src={images[0]} alt="" className="h-24 w-20 shrink-0 rounded-md border border-line bg-white object-contain" />
          ) : (
            <div className="grid h-24 w-20 shrink-0 place-items-center rounded-md border border-dashed border-line text-[10px] text-ink-faint">no picture</div>
          )}
          <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
            <dt className="text-ink-faint">Title</dt>
            <dd className="truncate text-ink">{draft.title || `${draft.sheet.name || "Our hero"}'s story`}</dd>
            <dt className="text-ink-faint">Hero</dt>
            <dd className="truncate text-ink">{draft.sheet.name || "—"} · {draft.mode === "rebuild" ? "rebuilt in paper" : "puppet of your art"}</dd>
            <dt className="text-ink-faint">Film</dt>
            <dd className="text-ink">{draft.length} s · {draft.aspect} · {draft.look.replace("-", " ")}</dd>
            <dt className="text-ink-faint">Beats</dt>
            <dd className="text-ink">{draft.beats.length}</dd>
          </dl>
        </div>

        {!images.length && draft.mode === "puppet" && (
          <p className="text-[11.5px] text-[#f8b471]">Puppet mode needs your picture — add it on the Character step.</p>
        )}
        {problems.length > 0 && (
          <p className="text-[11.5px] text-[#f8b471]">
            The storyboard still has {problems.length} thing{problems.length === 1 ? "" : "s"} to fix.{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => flow.go("board")}>Open the storyboard</button>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="kf-go"
            onClick={() => void flow.send()}
            disabled={flow.sending || !draft.beats.length || (draft.mode === "puppet" && !images.length)}
          >
            <Icon.Send width={13} height={13} aria-hidden />
            {flow.sending ? "Sending…" : queued ? "Send it again as a new version" : "Send to my PC"}
          </button>
          {!draft.beats.length && <span className="text-[11px] text-ink-faint">Write the storyboard first.</span>}
        </div>
        {flow.sendError && <p className="text-[11.5px] text-[#f8b471]">{flow.sendError}</p>}
        {flow.requests.localOnly && flow.requests.ready && (
          <p className="text-[11.5px] text-[#f8b471]">You&apos;re not signed in, so this stays on this device and your PC can&apos;t see it. Sign in first.</p>
        )}

        <div className="rounded-xl border border-line bg-panel/60 p-3">
          <p className="text-[11.5px] text-ink">How your PC makes it</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
            Open Claude Code on the PC and say the line below. It reads the queue, draws {draft.sheet.name || "him"} with the
            animate kit, scores it, checks it, sends the video back here and takes the job off the queue.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded-md border border-line bg-canvas px-2 py-1.5 font-mono text-[12px] text-ink">{SAY}</code>
            <button
              type="button"
              className="kf-ghost !py-1.5"
              onClick={() => {
                void navigator.clipboard?.writeText(SAY).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              <Icon.Copy width={11} height={11} aria-hidden /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      <div>
        <span className="kf-label">Progress — updates by itself</span>
        <ol className="kf-steps rounded-xl border border-line bg-panel p-3">
          {steps.map((s) => (
            <li key={s.label} className={s.state === "done" ? "is-done" : s.state === "now" ? "is-now" : ""}>
              <span className="kf-dot" aria-hidden>
                <Icon.Check width={9} height={9} />
              </span>
              <div>
                <p className={`text-[12px] ${s.state === "next" ? "text-ink-faint" : "text-ink"}`}>{s.label}</p>
                <p className="text-[11px] leading-snug text-ink-muted">{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        {notes.length > 1 && (
          <ul className="mt-2 space-y-0.5">
            {notes.slice(0, -1).map((n, i) => (
              <li key={i} className="text-[10.5px] text-ink-faint">
                {n.by}: {n.text}
              </li>
            ))}
          </ul>
        )}
        {(video || done) && (
          <button type="button" className="kf-go mt-3" onClick={() => flow.go("watch")}>
            <Icon.Play width={12} height={12} aria-hidden /> Watch it
          </button>
        )}
      </div>
    </section>
  );
}
