"use client";

// ---------------------------------------------------------------------------
// Workflow Maker — Jarvis › Studio › the "Workflow Maker" card (and its App
// plugins page). The owner's "rea to workflow":
//
//   video or pictures of a process + what they want
//     → Jarvis watches it (video-analyzer + rea pass on the frames), raises it
//       (felix + scholar), and writes the blueprint: inputs as slots, every
//       stage with its engine and where it runs, the one result, the judge,
//       and the Studio card exactly as it will look
//     → the owner edits it here
//     → "Build it" files it to In Queue; Claude Code on the PC builds the real
//       working tool with the rea-to-workflow skill and pushes it live.
//
// Design: taste-skill, the same Cold Luxury system as Custom Video Swap.
// ---------------------------------------------------------------------------

import "../video-swap/video-swap.css";
import "./workflow-maker.css";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "../../icons";
import { vsFonts } from "../video-swap/fonts";
import { useWorkflowMaker, type MakerSeed, type WorkflowMakerState } from "@/lib/studio/workflow-maker/useWorkflowMaker";
import {
  KIND_LABEL,
  MAKE_KINDS,
  safeUrl,
  type AgentKit,
  type BpSlot,
  type Home,
  type Mode,
  type RunsOn,
  type SlotKind,
  type ToolKind,
} from "@/lib/studio/workflow-maker/blueprint";
import { ACCEPT } from "@/lib/app-builder/media";

const KIND_ICON: Record<SlotKind, ReactNode> = {
  video: <Icon.Film width={13} height={13} aria-hidden />,
  image: <Icon.Image width={13} height={13} aria-hidden />,
  text: <Icon.Note width={13} height={13} aria-hidden />,
  audio: <Icon.Waveform width={13} height={13} aria-hidden />,
  link: <Icon.Link width={13} height={13} aria-hidden />,
};
const KINDS: SlotKind[] = ["video", "image", "text", "audio", "link"];
const RUNS: { id: RunsOn; label: string }[] = [
  { id: "pc", label: "Your PC" },
  { id: "cloud", label: "Cloud" },
  { id: "browser", label: "Browser" },
];
const HOMES: { id: Home; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "studio", label: "Studio card" },
  { id: "plugin", label: "App plugin" },
  { id: "widget", label: "Widget" },
];
const SAY = "work my Jarvis queue";

export function WorkflowMaker({ seed, onClose }: { seed?: MakerSeed | null; onClose?: () => void }) {
  const wm = useWorkflowMaker();
  const started = useRef<number | null>(null);
  const { startFromSeed } = wm;

  useEffect(() => {
    if (!seed || started.current === seed.nonce) return;
    started.current = seed.nonce;
    void startFromSeed(seed);
  }, [seed, startFromSeed]);

  return (
    <div className={`vs ${vsFonts} flex h-full min-h-0 min-w-0 flex-col`}>
      <header className="vs-top flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-5">
        {onClose && (
          <button type="button" className="vs-back" onClick={onClose}>
            <Icon.ArrowLeft width={12} height={12} aria-hidden /> Workflows
          </button>
        )}
        <div className="min-w-0">
          <h2 className="vs-title">Workflow Maker</h2>
          <p className="vs-sub">Show it any process — it builds the tool, or the agent that goes and does it</p>
        </div>
        <nav className="vs-steps ml-auto" aria-label="Progress">
          {[
            { label: "Watch", done: Boolean(wm.blueprint) },
            { label: "Design", done: Boolean(wm.blueprint) && wm.problems.length === 0 },
            { label: "Build", done: Boolean(wm.job) },
          ].map((s) => (
            <span key={s.label} className={`vs-step ${s.done ? "is-done" : ""}`}>
              <i aria-hidden />
              {s.label}
            </span>
          ))}
        </nav>
        {wm.builds.length > 0 && <BuildsMenu wm={wm} />}
      </header>

      {wm.view === "job" ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1100px] px-3 py-5 sm:px-5">
            <BuildJob wm={wm} />
          </div>
        </main>
      ) : (
        <>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto grid max-w-[1400px] gap-4 px-3 py-5 sm:px-5 lg:grid-cols-12">
              <Source wm={wm} />
              <section className="vs-panel vs-rise-2 lg:col-span-8" aria-labelledby="wm-h-bp">
                <div className="vs-h">
                  <span className="vs-n mono">02</span>
                  <h3 id="wm-h-bp">The blueprint</h3>
                  <p className="hidden sm:block">{wm.engine === "ai" ? "Watched by AI — edit anything" : wm.blueprint ? "Built-in draft — edit anything" : ""}</p>
                </div>
                <div className="p-4 pt-3">
                  {wm.blueprint ? <BlueprintView wm={wm} /> : <Empty watching={wm.watching} />}
                </div>
              </section>
            </div>
          </main>
          <div className="vs-dock shrink-0 px-3 py-3 sm:px-5">
            <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3">
              <p className="line-clamp-2 min-w-0 flex-1 text-[11.5px] text-[var(--vs-ink-3)]">
                {wm.notice ? <span className="text-[var(--vs-ink-2)]">{wm.notice} </span> : null}
                {wm.blueprint && wm.problems.length ? (
                  <span className="vs-warn">{wm.problems[0]}</span>
                ) : (
                  <>Claude Code on your PC builds it with felix, the scholar and the prompt enhancer, tests it and puts it live.</>
                )}
              </p>
              {wm.error && <p className="vs-warn w-full">{wm.error}</p>}
              <button type="button" className="vs-go" disabled={!wm.blueprint || wm.problems.length > 0 || wm.sending} onClick={() => void wm.send()}>
                <Icon.Sparkles width={15} height={15} aria-hidden /> {wm.sending ? "Sending" : "Build it"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Source({ wm }: { wm: WorkflowMakerState }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <section className="vs-panel vs-rise lg:col-span-4" aria-labelledby="wm-h-src">
      <div className="vs-h">
        <span className="vs-n mono">01</span>
        <h3 id="wm-h-src">What it learns from</h3>
      </div>
      <div className="grid gap-4 p-4 pt-3">
        <div
          className={`vs-slot min-h-[120px] w-full ${over ? "is-over" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void wm.addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              void wm.addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <span className="vs-slot__empty">
            <Icon.Upload width={20} height={20} aria-hidden />
            <span className="text-[12px] font-medium text-[var(--vs-ink-2)]">{wm.adding ? "Reading…" : "Drop the video or pictures"}</span>
            <span>A money-making method, a tutorial, a website or game you like, a creator&apos;s routine</span>
          </span>
        </div>
        {wm.media.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {wm.media.map((m) => (
              <li key={m.id} className="wm-media">
                {/* eslint-disable-next-line @next/next/no-img-element -- local thumb */}
                <img src={m.thumb} alt={m.name} />
                <span className="wm-media__kind">{m.kind === "video" ? `${m.duration ?? ""}${m.duration ? " s" : "video"}` : "picture"}</span>
                <button type="button" className="vs-slot__x !opacity-100" onClick={() => wm.removeMedia(m.id)} aria-label={`Remove ${m.name}`}>
                  <Icon.Close width={10} height={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div>
          <label className="vs-label" htmlFor="wm-req">What should it do for you?</label>
          <textarea
            id="wm-req"
            className="vs-area"
            value={wm.request}
            onChange={(e) => wm.setRequest(e.target.value)}
            placeholder="Make me an agent that does what this video shows — finds local businesses with bad websites, rebuilds them and lines up the pitch"
          />
        </div>
        <button
          type="button"
          className="vs-ghost justify-self-start"
          disabled={wm.watching || (!wm.request.trim() && !wm.media.length)}
          onClick={() => void wm.rewatch()}
        >
          <Icon.Eye width={12} height={12} aria-hidden /> {wm.watching ? "Watching…" : wm.blueprint ? "Watch again" : "Watch it"}
        </button>
        {wm.watching && wm.media.length > 0 && (
          <div className="wm-scan" aria-label="Watching the frames">
            <div className="wm-scan__row">
              {[...wm.media, ...wm.media].flatMap((m, j) =>
                // eslint-disable-next-line @next/next/no-img-element -- local frames
                m.frames.map((f, i) => <img key={`${j}-${m.id}-${i}`} src={f} alt="" />),
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Empty({ watching }: { watching: boolean }) {
  return watching ? (
    <div className="grid gap-3" aria-label="Writing the blueprint">
      <div className="flex gap-4">
        <div className="vs-skel h-[224px] w-[168px]" />
        <div className="grid flex-1 content-start gap-2">
          <div className="vs-skel h-6 w-2/3" />
          <div className="vs-skel h-4 w-full" />
          <div className="vs-skel h-4 w-5/6" />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="vs-skel h-28" />
        <div className="vs-skel h-28" />
        <div className="vs-skel h-28" />
      </div>
    </div>
  ) : (
    <div className="grid place-items-center py-16 text-center">
      <p className="max-w-sm text-[13px] leading-relaxed text-[var(--vs-ink-2)]">
        Drop a video of the process and say what you want. Jarvis watches it, maps every step, and lays out the tool here — the
        inputs, each stage and its engine, and the card it gets on your Studio wall.
      </p>
    </div>
  );
}

function BlueprintView({ wm }: { wm: WorkflowMakerState }) {
  const bp = wm.blueprint!;
  const root = useRef<HTMLDivElement>(null);
  // Growing fields: CSS field-sizing where the browser has it, and this for the rest (iPhone Safari).
  useEffect(() => {
    if (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content")) return;
    const fit = () =>
      root.current?.querySelectorAll<HTMLTextAreaElement>("textarea.wm-grow").forEach((t) => {
        t.style.height = "auto";
        t.style.height = `${t.scrollHeight}px`;
      });
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [bp]);
  return (
    <div ref={root} className="grid gap-6">
      {/* The card + the goal */}
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="wm-card" style={{ ["--h" as string]: bp.card.hue } as CSSProperties} aria-label="The card on your Studio wall">
          <span className="wm-card__grid" />
          <span className="wm-card__shine" />
          <span className="wm-card__new">New</span>
          <span className="wm-card__copy">
            <span className="block text-[13px] font-semibold leading-tight text-white">{bp.card.name || bp.name}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-white/70">{bp.card.blurb}</span>
          </span>
        </div>
        <div className="grid min-w-0 flex-1 content-start gap-3">
          <input
            className="wm-field text-[22px] font-semibold tracking-tight"
            value={bp.name}
            onChange={(e) => wm.patch({ name: e.target.value, card: { ...bp.card, name: e.target.value } })}
            aria-label="Name"
          />
          <input
            className="wm-field text-[13px] text-[var(--vs-ink-2)]"
            value={bp.card.blurb}
            onChange={(e) => wm.patch({ card: { ...bp.card, blurb: e.target.value } })}
            aria-label="Card line"
            placeholder="One line that shows the result"
          />
          <div className="vs-seg wm-kinds" role="group" aria-label="What it makes">
            {MAKE_KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={bp.kind === k} onClick={() => wm.setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="vs-seg" role="group" aria-label="Where it lives">
              {HOMES.filter((h) => (bp.kind === "agent" ? true : h.id !== "agent")).map((h) => (
                <button key={h.id} type="button" aria-pressed={bp.home === h.id} onClick={() => wm.patch({ home: h.id })}>
                  {h.label}
                </button>
              ))}
            </div>
            <div className="vs-seg" role="group" aria-label="Recreate or change">
              {(["recreate", "change"] as Mode[]).map((m) => (
                <button key={m} type="button" aria-pressed={bp.mode === m} onClick={() => wm.patch({ mode: m })}>
                  {m === "recreate" ? "Recreate it" : "Change it"}
                </button>
              ))}
            </div>
          </div>
          <dl className="grid gap-2 text-[12.5px]">
            <div>
              <dt className="vs-label !mb-0.5">End goal</dt>
              <dd>
                <textarea rows={2} className="wm-field resize-none leading-snug" value={bp.endGoal} onChange={(e) => wm.patch({ endGoal: e.target.value })} aria-label="End goal" />
              </dd>
            </div>
            <div>
              <dt className="vs-label !mb-0.5">Goal beyond it</dt>
              <dd>
                <textarea rows={2} className="wm-field resize-none leading-snug text-[var(--vs-ink-2)]" value={bp.beyond} onChange={(e) => wm.patch({ beyond: e.target.value })} aria-label="Goal beyond" />
              </dd>
            </div>
          </dl>
          {bp.watched && (
            <p className="rounded-[14px] border border-[var(--vs-line)] bg-[var(--vs-panel-2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--vs-ink-2)]">
              <Icon.Eye width={11} height={11} className="mr-1.5 inline -translate-y-px text-[var(--vs-ink-3)]" aria-hidden />
              {bp.watched}
            </p>
          )}
        </div>
      </div>

      {/* The agent's kit: what it needs to go and do it on its own */}
      {bp.kind === "agent" && bp.agent && <AgentPanel kit={bp.agent} wm={wm} />}

      {/* The pipeline */}
      <div className="wm-flow">
        <div>
          <div className="wm-col-h">
            <span>Goes in</span>
            <button type="button" className="wm-icon-btn" onClick={wm.addInput} aria-label="Add an input">
              <Icon.Plus width={12} height={12} />
            </button>
          </div>
          {bp.inputs.map((s) => (
            <InputRow key={s.id} slot={s} wm={wm} />
          ))}
        </div>
        <div>
          <div className="wm-col-h">
            <span>What it does</span>
            <button type="button" className="wm-icon-btn" onClick={wm.addStage} aria-label="Add a step">
              <Icon.Plus width={12} height={12} />
            </button>
          </div>
          <ol>
            {bp.stages.map((s, i) => (
              <li key={s.id} className={`wm-st ${s.on ? "" : "is-off"}`}>
                <div className="flex items-start gap-2.5">
                  <span className="wm-num mono">{i + 1}</span>
                  <div className="grid min-w-0 flex-1 gap-1">
                    <input className="wm-field text-[13px] font-semibold" value={s.label} onChange={(e) => wm.patchStage(s.id, { label: e.target.value })} aria-label={`Step ${i + 1}`} />
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className="wm-field mono !w-auto min-w-0 flex-1 text-[11px] text-[var(--vs-ink-2)]"
                        value={s.engine}
                        onChange={(e) => wm.patchStage(s.id, { engine: e.target.value })}
                        aria-label={`Engine for step ${i + 1}`}
                      />
                      <select className="wm-runs" value={s.runsOn} onChange={(e) => wm.patchStage(s.id, { runsOn: e.target.value as RunsOn })} aria-label="Runs on">
                        {RUNS.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {s.detail && <p className="text-[11px] leading-snug text-[var(--vs-ink-3)]">{s.detail}</p>}
                  </div>
                  <div className="flex flex-col items-center">
                    <button type="button" className="wm-icon-btn" onClick={() => wm.moveStage(s.id, -1)} aria-label="Move up" disabled={i === 0}>
                      <Icon.Chevron width={11} height={11} className="rotate-180" />
                    </button>
                    <label className="vs-switch !gap-0" title={s.on ? "On" : "Off"}>
                      <input type="checkbox" checked={s.on} onChange={(e) => wm.patchStage(s.id, { on: e.target.checked })} aria-label={`Step ${i + 1} on`} />
                      <span className="vs-knob scale-75" aria-hidden />
                    </label>
                    <button type="button" className="wm-icon-btn" onClick={() => wm.moveStage(s.id, 1)} aria-label="Move down" disabled={i === bp.stages.length - 1}>
                      <Icon.Chevron width={11} height={11} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <div className="wm-col-h">
            <span>Comes out</span>
          </div>
          <div className="wm-out">
            <textarea className="wm-field min-h-[72px] resize-none text-[13px] leading-snug" value={bp.output} onChange={(e) => wm.patch({ output: e.target.value })} aria-label="What comes out" />
          </div>
          {bp.money && (
            <div className="mt-3 rounded-[14px] border border-[var(--vs-line)] p-3">
              <p className="vs-label !mb-1">
                <Icon.Cash width={11} height={11} className="mr-1 inline -translate-y-px" aria-hidden /> Where the money is
              </p>
              <textarea className="wm-field min-h-[56px] resize-none text-[12px] leading-snug text-[var(--vs-ink-2)]" value={bp.money} onChange={(e) => wm.patch({ money: e.target.value })} aria-label="Money" />
            </div>
          )}
        </div>
      </div>

      {/* The craft + the judge */}
      <div className="grid gap-4 border-t border-[var(--vs-line)] pt-5 md:grid-cols-2">
        <EditableList title="The master's craft" hint="What a 40-year pro does that the video doesn't show" items={bp.mastery} onChange={(mastery) => wm.patch({ mastery })} />
        <EditableList title="How we'll know it works" hint="Checked by something other than me or you" items={bp.judge} onChange={(judge) => wm.patch({ judge })} />
      </div>
    </div>
  );
}


const TOOL_KINDS: ToolKind[] = ["skill", "app", "api", "model", "site"];

/** The agent's kit, every part editable in place. */
function AgentPanel({ kit, wm }: { kit: AgentKit; wm: WorkflowMakerState }) {
  const notReady = kit.tools.filter((t) => !t.ready).length;
  return (
    <section className="wm-agent" aria-labelledby="wm-agent-h">
      <div className="wm-agent__head">
        <span className="wm-agent__badge" aria-hidden>
          <Icon.Bot width={16} height={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h4 id="wm-agent-h" className="text-[14px] font-semibold tracking-tight">The agent&apos;s kit</h4>
          <textarea
            rows={2}
            className="wm-field wm-grow text-[12.5px] leading-snug text-[var(--vs-ink-2)]"
            value={kit.role}
            onChange={(e) => wm.patchAgent({ role: e.target.value })}
            placeholder="Who it is, in one line"
            aria-label="The agent's role"
          />
        </div>
        <div className="wm-agent__goal">
          <span className="vs-label !mb-0.5">
            <Icon.Target width={11} height={11} className="mr-1 inline -translate-y-px" aria-hidden />
            Goal
          </span>
          <textarea
            rows={2}
            className="wm-field wm-grow text-[13px] font-medium leading-snug"
            value={kit.goal}
            onChange={(e) => wm.patchAgent({ goal: e.target.value })}
            placeholder="A target it can be measured against"
            aria-label="The agent's goal"
          />
        </div>
      </div>

      <div className="wm-agent__grid">
        <div>
          <div className="wm-col-h">
            <span>
              Tools it uses {notReady > 0 && <span className="text-[var(--vs-warn)]">· {notReady} to set up</span>}
            </span>
            <button
              type="button"
              className="wm-icon-btn"
              onClick={() => wm.patchAgent({ tools: [...kit.tools, { name: "New tool", does: "", kind: "skill", ready: false }] })}
              aria-label="Add a tool"
            >
              <Icon.Plus width={12} height={12} />
            </button>
          </div>
          <ul className="grid gap-1.5">
            {kit.tools.map((t, i) => (
              <li key={i} className="wm-tool">
                <button
                  type="button"
                  className={`wm-ready ${t.ready ? "is-ready" : ""}`}
                  title={t.ready ? "Already in Jarvis — tap if it still needs setting up" : "Needs setting up — tap when it's ready"}
                  onClick={() => wm.patchAgent({ tools: kit.tools.map((x, j) => (j === i ? { ...x, ready: !x.ready } : x)) })}
                  aria-label={t.ready ? `${t.name} is ready` : `${t.name} needs setting up`}
                >
                  {t.ready ? <Icon.Check width={10} height={10} /> : <Icon.Key width={10} height={10} />}
                </button>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <div className="flex items-center gap-2">
                    <input
                      className="wm-field min-w-0 flex-1 text-[12.5px] font-medium"
                      value={t.name}
                      onChange={(e) => wm.patchAgent({ tools: kit.tools.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                      aria-label="Tool"
                    />
                    <select
                      className="wm-runs"
                      value={t.kind}
                      onChange={(e) => wm.patchAgent({ tools: kit.tools.map((x, j) => (j === i ? { ...x, kind: e.target.value as ToolKind } : x)) })}
                      aria-label="Kind of tool"
                    >
                      {TOOL_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea rows={1}
                    className="wm-field wm-grow text-[11px] text-[var(--vs-ink-3)]"
                    value={t.does}
                    placeholder="What it uses it for"
                    onChange={(e) => wm.patchAgent({ tools: kit.tools.map((x, j) => (j === i ? { ...x, does: e.target.value } : x)) })}
                    aria-label="What it does"
                  />
                </div>
                <button type="button" className="wm-icon-btn" onClick={() => wm.patchAgent({ tools: kit.tools.filter((_, j) => j !== i) })} aria-label={`Remove ${t.name}`}>
                  <Icon.Close width={10} height={10} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="wm-col-h">
            <span>Websites & resources</span>
            <button
              type="button"
              className="wm-icon-btn"
              onClick={() => wm.patchAgent({ resources: [...kit.resources, { label: "New site", url: "", why: "" }] })}
              aria-label="Add a website"
            >
              <Icon.Plus width={12} height={12} />
            </button>
          </div>
          <ul className="grid gap-1.5">
            {kit.resources.map((r, i) => {
              const href = safeUrl(r.url);
              return (
                <li key={i} className="wm-tool">
                  <span className="wm-ready is-site" aria-hidden>
                    <Icon.Globe width={10} height={10} />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <div className="flex items-center gap-2">
                      <input
                        className="wm-field min-w-0 flex-1 text-[12.5px] font-medium"
                        value={r.label}
                        onChange={(e) => wm.patchAgent({ resources: kit.resources.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                        aria-label="Website"
                      />
                      {href && (
                        <a className="wm-icon-btn" href={href} target="_blank" rel="noreferrer" aria-label={`Open ${r.label}`}>
                          <Icon.Launch width={11} height={11} />
                        </a>
                      )}
                    </div>
                    <input
                      className="wm-field mono text-[10.5px] text-[var(--vs-ink-3)]"
                      value={r.url}
                      placeholder="https://…"
                      onChange={(e) => wm.patchAgent({ resources: kit.resources.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
                      aria-label="Address"
                    />
                    <textarea rows={1}
                      className="wm-field wm-grow text-[11px] text-[var(--vs-ink-3)]"
                      value={r.why}
                      placeholder="Why it uses it"
                      onChange={(e) => wm.patchAgent({ resources: kit.resources.map((x, j) => (j === i ? { ...x, why: e.target.value } : x)) })}
                      aria-label="Why"
                    />
                  </div>
                  <button type="button" className="wm-icon-btn" onClick={() => wm.patchAgent({ resources: kit.resources.filter((_, j) => j !== i) })} aria-label={`Remove ${r.label}`}>
                    <Icon.Close width={10} height={10} />
                  </button>
                </li>
              );
            })}
            {!kit.resources.length && <li className="text-[11.5px] text-[var(--vs-ink-3)]">Your PC researches the right sites before it starts.</li>}
          </ul>
        </div>
      </div>

      <div className="wm-agent__run">
        <div>
          <span className="vs-label !mb-0.5">
            <Icon.Clock width={11} height={11} className="mr-1 inline -translate-y-px" aria-hidden />
            When it works
          </span>
          <textarea rows={1} className="wm-field wm-grow text-[12.5px]" value={kit.cadence} onChange={(e) => wm.patchAgent({ cadence: e.target.value })} aria-label="When it works" />
        </div>
        <ChipList label="Accounts you connect once" icon={<Icon.Link width={11} height={11} aria-hidden />} items={kit.accounts} onChange={(accounts) => wm.patchAgent({ accounts })} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <EditableList title="Asks you first" hint="It never does these without your yes" items={kit.approvals} onChange={(approvals) => wm.patchAgent({ approvals })} />
        <EditableList title="Keeps score on" hint="Earnings go to Financial Bible" items={kit.kpis} onChange={(kpis) => wm.patchAgent({ kpis })} />
        <EditableList title="First moves" hint="What it does today" items={kit.firstMoves} onChange={(firstMoves) => wm.patchAgent({ firstMoves })} />
      </div>
    </section>
  );
}

function ChipList({ label, icon, items, onChange }: { label: string; icon: ReactNode; items: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !items.includes(v)) onChange([...items, v]);
    setDraft("");
  };
  return (
    <div>
      <span className="vs-label !mb-1">
        <span className="mr-1 inline-block -translate-y-px">{icon}</span>
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((a) => (
          <span key={a} className="wm-chip">
            {a}
            <button type="button" onClick={() => onChange(items.filter((x) => x !== a))} aria-label={`Remove ${a}`}>
              <Icon.Close width={9} height={9} />
            </button>
          </span>
        ))}
        <input
          className="wm-chip wm-chip--add"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="+ add"
          aria-label={`Add to ${label}`}
        />
      </div>
    </div>
  );
}

function InputRow({ slot, wm }: { slot: BpSlot; wm: WorkflowMakerState }) {
  return (
    <div className="wm-in">
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          className="wm-kind"
          title={`Kind: ${slot.kind} (tap to change)`}
          onClick={() => wm.patchInput(slot.id, { kind: KINDS[(KINDS.indexOf(slot.kind) + 1) % KINDS.length] })}
        >
          {KIND_ICON[slot.kind]}
        </button>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <input className="wm-field text-[12.5px] font-medium" value={slot.label} onChange={(e) => wm.patchInput(slot.id, { label: e.target.value })} aria-label="Input name" />
          <textarea
            rows={2}
            className="wm-field resize-none text-[11px] leading-snug text-[var(--vs-ink-3)]"
            value={slot.role}
            placeholder="What it's for"
            onChange={(e) => wm.patchInput(slot.id, { role: e.target.value })}
            aria-label="What it's for"
          />
        </div>
        <button type="button" className="wm-icon-btn" onClick={() => wm.removeInput(slot.id)} aria-label={`Remove ${slot.label}`}>
          <Icon.Close width={10} height={10} />
        </button>
      </div>
      <span className="wm-arrow" aria-hidden />
    </div>
  );
}

function EditableList({ title, hint, items, onChange }: { title: string; hint: string; items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <p className="text-[13px] font-semibold tracking-tight">{title}</p>
      <p className="mb-2 text-[11px] text-[var(--vs-ink-3)]">{hint}</p>
      <ul className="grid gap-1.5">
        {items.map((m, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mono mt-1 text-[10.5px] text-[var(--vs-ink-3)]">{String(i + 1).padStart(2, "0")}</span>
            <textarea rows={1}
              className="wm-field wm-grow flex-1 text-[12.5px] leading-snug"
              value={m}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
              aria-label={`${title} ${i + 1}`}
            />
            <button type="button" className="wm-icon-btn" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove">
              <Icon.Close width={10} height={10} />
            </button>
          </li>
        ))}
      </ul>
      {items.length < 8 && (
        <button type="button" className="vs-ghost mt-2 !h-7" onClick={() => onChange([...items, ""])}>
          <Icon.Plus width={11} height={11} aria-hidden /> Add
        </button>
      )}
    </div>
  );
}

function BuildJob({ wm }: { wm: WorkflowMakerState }) {
  const [copied, setCopied] = useState(false);
  const job = wm.job;
  if (!job) {
    return (
      <div className="grid place-items-center py-20 text-center">
        <p className="text-[13px] text-[var(--vs-ink-2)]">That build isn&apos;t in your queue any more.</p>
        <button type="button" className="vs-ghost mt-3" onClick={wm.backToDesign}>
          <Icon.ArrowLeft width={12} height={12} aria-hidden /> Back to the blueprint
        </button>
      </div>
    );
  }
  const open = job.kind === "open" ? job.request : null;
  const finished = job.kind === "done" ? job.finished : null;
  const picked = Boolean(open?.status === "working" || finished);
  const notes = open?.notes ?? [];
  const steps = [
    { label: "Filed to your queue", detail: `${job.id} · Workflow Maker`, state: "done" as const },
    { label: "Your PC picks it up", detail: picked ? `${open?.startedBy ?? finished?.by ?? "Claude Code"} took it` : `In Claude Code on your PC, say “${SAY}”`, state: picked ? ("done" as const) : ("now" as const) },
    { label: "Built and tested", detail: notes.length ? notes[notes.length - 1].text : "felix → scholar → prompt enhancer → build → checklist → push", state: finished ? ("done" as const) : picked ? ("now" as const) : ("next" as const) },
    { label: "Live on your Studio wall", detail: finished?.result ?? "The card shows up in Studio once it ships", state: finished ? ("done" as const) : ("next" as const) },
  ];
  return (
    <section className="vs-panel vs-rise p-5">
      <h3 className="text-[16px] font-semibold tracking-tight">{job.title}</h3>
      <ol className="vs-track mt-5">
        {steps.map((s) => (
          <li key={s.label} className={s.state === "done" ? "is-done" : s.state === "now" ? "is-now" : ""}>
            <span className="vs-dot" aria-hidden>
              <Icon.Check width={9} height={9} />
            </span>
            <div>
              <p className={`text-[12.5px] ${s.state === "next" ? "text-[var(--vs-ink-3)]" : ""}`}>{s.label}</p>
              <p className="text-[11.5px] text-[var(--vs-ink-3)]">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      {!picked && (
        <div className="mt-5 flex items-center gap-2">
          <code className="mono flex-1 rounded-full border border-[var(--vs-line-2)] px-3 py-1.5 text-[12px]">{SAY}</code>
          <button
            type="button"
            className="vs-ghost !h-8"
            onClick={() =>
              void navigator.clipboard?.writeText(SAY).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            <Icon.Copy width={11} height={11} aria-hidden /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className="vs-ghost" onClick={wm.backToDesign}>
          <Icon.Edit width={12} height={12} aria-hidden /> Back to the blueprint
        </button>
        <button type="button" className="vs-ghost" onClick={wm.reset}>
          <Icon.Plus width={12} height={12} aria-hidden /> Make another
        </button>
      </div>
    </section>
  );
}

function BuildsMenu({ wm }: { wm: WorkflowMakerState }) {
  return (
    <details className="relative">
      <summary className="vs-back cursor-pointer list-none">
        <Icon.Layers width={12} height={12} aria-hidden /> Your builds <span className="mono text-[var(--vs-ink-3)]">{wm.builds.length}</span>
      </summary>
      <div className="vs-panel vs-list absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-24px)] p-2">
        {wm.builds.slice(0, 12).map((b) => (
          <button key={b.id} type="button" aria-current={wm.job?.id === b.id} onClick={() => wm.openBuild(b.id)}>
            <span className="grid h-11 w-11 place-items-center rounded-[10px] border border-[var(--vs-line-2)] bg-[var(--vs-panel-2)]">
              {b.kind === "done" ? <Icon.Check width={13} height={13} aria-hidden /> : <Icon.Clock width={13} height={13} aria-hidden />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] text-[var(--vs-ink)]">{b.title}</span>
              <span className="mono block text-[10.5px] text-[var(--vs-ink-3)]">
                {b.kind === "done" ? "Built" : b.request.status === "working" ? "Building" : "Queued"} · {b.at.slice(5, 16).replace("T", " ")}
              </span>
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}
