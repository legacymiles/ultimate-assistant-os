"use client";

// Stage 4 — Render. Two ways to make the same film:
//   • Make it here: this browser draws every frame and writes the MP4 now —
//     no PC, no wait for a queue — then saves it to the films on every device.
//   • Send to my PC (HD): Claude Code on the PC renders it at 1080p with the
//     threejs-film-story skill; its progress is read live from In Queue.

import { useState } from "react";
import { Icon } from "../../icons";
import type { Film3DFlow } from "@/lib/studio/film3d/useFilm3D";

const SAY = "work my Jarvis queue";

export function RenderStage({ flow }: { flow: Film3DFlow }) {
  const { draft, problems, local, job } = flow;
  const [short, setShort] = useState<720 | 1080>(720);
  const [copied, setCopied] = useState(false);
  const busy = local?.phase === "rendering" || local?.phase === "uploading";

  const open = job?.kind === "open" ? job.request : null;
  const finished = job?.kind === "done" ? job.finished : null;
  const pcJob = job && !(finished?.by === "this browser") ? job : null;
  const picked = Boolean(open?.status === "working" || (finished && finished.by !== "this browser"));
  const video = Boolean(open?.video || finished?.video);
  const steps: { label: string; detail: string; state: "done" | "now" | "next" }[] = [
    { label: "Sent to your queue", detail: pcJob ? `Filed as ${pcJob.id}.` : "The exact film you previewed goes to In Queue.", state: pcJob ? "done" : "now" },
    { label: "Your PC picks it up", detail: picked ? `${open?.startedBy ?? finished?.by ?? "Claude Code"} took it.` : `In Claude Code on your PC, say “${SAY}”.`, state: picked ? "done" : pcJob ? "now" : "next" },
    { label: "Rendered in HD and checked", detail: open?.notes?.length ? open.notes[open.notes.length - 1].text : "1080p, same frames, then the stills are checked.", state: video || finished ? "done" : picked ? "now" : "next" },
    { label: "Back here to watch", detail: video ? "It's here — open Watch." : "Plays on any device once it lands.", state: video ? "done" : "next" },
  ];

  return (
    <section aria-labelledby="f3-render" className="space-y-4">
      <div>
        <h3 id="f3-render" className="text-[15px] font-semibold text-ink">Make the film</h3>
        <p className="text-[11.5px] text-ink-muted">
          {draft.title || `${draft.hero.name}'s story`} · {draft.beats.length} beats · {draft.length} s · {draft.aspect}
        </p>
      </div>
      {problems.length > 0 && (
        <p className="text-[11.5px] text-[#f8b471]">
          The storyboard has {problems.length} thing{problems.length === 1 ? "" : "s"} to fix first.{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => flow.go("board")}>Open the storyboard</button>
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-ink">Make it here</p>
            <span className="rounded-full bg-[var(--f3-hero)]/15 px-2 py-0.5 text-[10.5px] font-semibold text-ink">No PC needed</span>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            This browser draws every frame and writes the MP4 with the music, then saves it to your films so it plays on your phone too. Keep this tab open while it works — about the film&apos;s length on a laptop, longer on a phone.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="f3-seg" role="group" aria-label="Quality">
              <button type="button" aria-pressed={short === 720} onClick={() => setShort(720)} disabled={busy}>720p</button>
              <button type="button" aria-pressed={short === 1080} onClick={() => setShort(1080)} disabled={busy}>1080p</button>
            </div>
            {busy ? (
              <button type="button" className="f3-ghost" onClick={flow.cancelRender}>Stop</button>
            ) : (
              <button type="button" className="f3-go" disabled={problems.length > 0} onClick={() => void flow.renderHere(short)}>
                <Icon.Film width={13} height={13} aria-hidden /> {local?.phase === "done" ? "Make it again" : "Make it now"}
              </button>
            )}
          </div>
          {local && (
            <div className="space-y-1.5" role="status" aria-live="polite">
              {local.phase !== "error" && (
                <div className="f3-meter" aria-hidden>
                  <i style={{ width: `${Math.round(local.progress * 100)}%` }} />
                </div>
              )}
              <p className={`text-[11.5px] ${local.phase === "error" ? "text-[#f8b471]" : "text-ink-muted"}`}>
                {local.phase === "error" ? `It stopped: ${local.error} Try 720p, or send it to your PC.` : local.label}
                {local.size ? ` · ${local.size}` : ""}
              </p>
              {local.phase === "done" && local.url && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="f3-go" onClick={() => flow.go("watch")}>
                    <Icon.Play width={12} height={12} aria-hidden /> Watch it
                  </button>
                  <a className="f3-ghost" href={local.url} download={`${(draft.title || "film").replace(/[^\w-]+/g, "-")}.mp4`}>
                    <Icon.Download width={11} height={11} aria-hidden /> Download
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-ink">Send to my PC</p>
            <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-muted">HD · 1080p</span>
          </div>
          <p className="text-[11.5px] leading-relaxed text-ink-muted">
            Claude Code on your PC renders the exact same film bigger and sharper with the 3D film skill, checks the stills, and sends it back here. It can also swap in a Mixamo character if you ask.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="f3-ghost" disabled={flow.sending || problems.length > 0} onClick={() => void flow.send()}>
              <Icon.Send width={11} height={11} aria-hidden /> {flow.sending ? "Sending…" : pcJob ? "Send again as a new version" : "Send to my PC"}
            </button>
            <button
              type="button"
              className="f3-ghost"
              onClick={() =>
                void navigator.clipboard?.writeText(SAY).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              <Icon.Copy width={11} height={11} aria-hidden /> {copied ? "Copied" : `Copy “${SAY}”`}
            </button>
          </div>
          {flow.sendError && <p className="text-[11.5px] text-[#f8b471]">{flow.sendError}</p>}
          {flow.requests.localOnly && flow.requests.ready && (
            <p className="text-[11.5px] text-[#f8b471]">You&apos;re not signed in, so your PC can&apos;t see the queue. Sign in first — or use Make it here.</p>
          )}
          <ol className="f3-steps pt-1">
            {steps.map((s) => (
              <li key={s.label} className={s.state === "done" ? "is-done" : s.state === "now" ? "is-now" : ""}>
                <span className="f3-dotstep" aria-hidden>
                  <Icon.Check width={9} height={9} />
                </span>
                <div>
                  <p className={`text-[12px] ${s.state === "next" ? "text-ink-faint" : "text-ink"}`}>{s.label}</p>
                  <p className="text-[11px] leading-snug text-ink-muted">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          {video && (
            <button type="button" className="f3-go" onClick={() => flow.go("watch")}>
              <Icon.Play width={12} height={12} aria-hidden /> Watch it
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
