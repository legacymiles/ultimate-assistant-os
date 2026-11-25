"use client";

// ---------------------------------------------------------------------------
// 24/7 Queue — the command center. Mockup 3, "Chat is the stage" (picked by
// the owner 2026-11-25; taste-skill Cold Luxury + webgl-trail-reveal).
//
//   header   name, what the queue is doing in one sentence, Board/Library/Apps,
//            the bell, New task
//   centre   THE STAGE: a trail-reveal panel (QueueStage) with Jarvis's
//            message box on it — words, reference pictures, the model router,
//            the mic — and the conversation under it, where every task Jarvis
//            files shows as a live card
//   left     the tasks as a timeline rail, by bucket, with search and filters
//   right    the four counts, the pulse of the last hour, the workers, the
//            discoveries and the live activity
//
// Phone: the stage and conversation first, then the tasks, then the counts.
// Everything is read from GET /api/queue247/tasks every 4 s. No number is
// invented: a bar is drawn only for reported progress, a meter only for a
// reported heartbeat, and an empty state says what to do next.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { BUCKET_LABEL, STATUS_LABEL, bucketOf, type Bucket } from "@/lib/queue247/engine";
import type { Task, TaskMessage } from "@/lib/queue247/types";
import { useQueue247, type UseQueue247 } from "@/lib/queue247/useQueue247";
import {
  activityTicks,
  appName,
  currentStepOf,
  ecosystem,
  EMPTY_FILTER,
  findingKindLabel,
  groupByBucket,
  historyOf,
  matchesFilter,
  nextRunText,
  progressOf,
  relTime,
  tickerItems,
  toneOf,
  type AppRef,
  type BoardFilter,
  type Ecosystem,
  type Tone,
  type WorkerView,
} from "@/lib/queue247/view";
import { FONT_VARS, Meter, Notice, ProgressBar, StatusMark, useEscape } from "./parts";
import { MessageList } from "./Conversation";
import { TaskDrawer } from "./TaskDrawer";
import { NewTaskSheet } from "./NewTaskSheet";
import { Library } from "./Library";
import { AppsPanel } from "./AppsPanel";
import { QueueStage, placeNodes } from "./QueueStage";
import { JarvisComposer, useQueueModel, type Outgoing } from "./JarvisComposer";
import "./queue247.css";

type View = "board" | "library" | "apps";

const BUCKET_TONE: Record<Bucket, Tone> = {
  attention: "needs",
  active: "running",
  waiting: "queued",
  autonomous: "always",
  scheduled: "scheduled",
  paused: "paused",
  failed: "failed",
  completed: "done",
};

const EXAMPLES = [
  "Find the newest MT4 trading bots on Telegram and start evaluating them",
  "Create a recurring task that researches new video generation techniques",
  "Recreate the attached clip as H3 prompts with my character as the lead",
  "Monitor my trading systems and report any problems",
];

export function CommandCenter({ embedded = false }: { embedded?: boolean }) {
  const q = useQueue247();
  const [view, setView] = useState<View>("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [openTab, setOpenTab] = useState<"overview" | "results">("overview");
  const [sheet, setSheet] = useState<"task" | "h3" | null>(null);
  const cmdRef = useRef<HTMLTextAreaElement>(null);

  // "/" focuses Jarvis's box from anywhere that is not already a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (openId || sheet) return;
      e.preventDefault();
      setView("board");
      requestAnimationFrame(() => cmdRef.current?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, sheet]);

  const open = useCallback((id: string, tab: "overview" | "results" = "overview") => {
    setOpenTab(tab);
    setOpenId(id);
  }, []);

  const snap = q.data;
  const eco = useMemo(() => (snap ? ecosystem(snap, q.now) : null), [snap, q.now]);
  const apps = snap?.apps ?? [];
  const ready = q.state.kind === "ready" && snap;
  const unavailable = q.state.kind === "offline" || q.state.kind === "signed-out" || (q.state.kind === "error" && !snap);

  return (
    <div className={`q247 q247-root ${FONT_VARS} flex min-h-0 flex-col overflow-hidden ${embedded ? "h-full" : "h-[100dvh]"}`}>
      <Header q={q} eco={eco} view={view} setView={setView} onNew={() => setSheet("task")} onOpen={open} embedded={embedded} />

      <main className="q-scroll min-h-0 flex-1 overflow-y-auto" aria-busy={q.state.kind === "loading"}>
        <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-4 px-3 py-4 sm:px-5">
          {unavailable ? (
            <Unavailable state={q.state} onRetry={q.refresh} />
          ) : view === "library" && ready ? (
            <Library apps={apps} now={q.now} onOpenTask={(id) => open(id, "results")} taskTitle={(id) => snap.tasks.find((t) => t.id === id)?.title ?? null} />
          ) : view === "apps" && ready ? (
            <AppsPanel now={q.now} />
          ) : (
            <div className="q-layout">
              <div className="q-area-center flex min-w-0 flex-col gap-4">
                <JarvisChat q={q} eco={eco} inputRef={cmdRef} onOpen={open} disabled={!ready} />
              </div>
              <aside className="q-area-side flex min-w-0 flex-col gap-4" aria-label="What the queue is doing">
                {ready && eco ? (
                  <>
                    <Notice text={q.notice} onDismiss={q.dismiss} />
                    <Counts eco={eco} q={q} onOpen={open} />
                    <Workers eco={eco} />
                    <Discoveries eco={eco} q={q} onOpen={open} />
                    <Activity q={q} onOpen={open} />
                  </>
                ) : (
                  <SideSkeleton />
                )}
              </aside>
              <div className="q-area-rail min-w-0">
                {ready ? <TaskRail q={q} apps={apps} onOpen={open} onNew={() => setSheet("task")} onH3={() => setSheet("h3")} /> : <RailSkeleton />}
              </div>
            </div>
          )}
        </div>
      </main>

      {openId && snap && (
        <TaskDrawer
          key={openId}
          id={openId}
          q={q}
          apps={apps}
          executors={snap.executors}
          initialTab={openTab}
          onClose={() => setOpenId(null)}
          onOpen={(id) => open(id)}
        />
      )}
      {sheet && snap && (
        <NewTaskSheet
          q={q}
          apps={apps}
          executors={snap.executors}
          initialMode={sheet}
          onClose={() => setSheet(null)}
          onCreated={(t) => {
            setSheet(null);
            open(t.id);
          }}
        />
      )}
    </div>
  );
}

// --- the stage + the conversation ------------------------------------------

function JarvisChat({
  q,
  eco,
  inputRef,
  onOpen,
  disabled,
}: {
  q: UseQueue247;
  eco: Ecosystem | null;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onOpen: (id: string) => void;
  disabled: boolean;
}) {
  const [messages, setMessages] = useState<TaskMessage[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [model, setModel] = useQueueModel();

  // The general conversation, loaded once the queue answers.
  useEffect(() => {
    if (disabled || messages !== null) return;
    q.messages()
      .then(setMessages)
      .catch(() => setMessages([]));
  }, [disabled, messages, q]);

  const send = async ({ text, media }: Outgoing): Promise<boolean> => {
    if (thinking) return false;
    setErr(null);
    const at = new Date().toISOString();
    const words = text || "Here is a reference picture — what can you do with it?";
    setMessages((m) => [
      ...(m ?? []),
      {
        id: `you-${at}`,
        task_id: null,
        user_id: "",
        role: "you",
        text: words,
        task_ids: [],
        at,
        // The thumbnails stand in until the stored copies' links come back.
        attachments: media.map((x) => ({ key: x.id, name: x.name, url: x.thumb })),
      },
    ]);
    setThinking(true);
    try {
      const images = media
        .map((x) => {
          const part = x.parts.find((p) => p.type === "image_url");
          return part && part.type === "image_url" ? { dataUrl: part.image_url.url, name: x.name } : null;
        })
        .filter((x): x is { dataUrl: string; name: string } => Boolean(x));
      const r = await q.command(words, undefined, { model, images });
      const ids = [...r.created, ...r.acted].map((x) => x.id);
      const reply = [r.reply, r.clarify].filter(Boolean).join("\n\n") || (ids.length ? "Done." : "I didn't find anything to do there. Say it another way?");
      setMessages((m) => [
        ...(m ?? []),
        { id: `j-${Date.now()}`, task_id: null, user_id: "", role: "jarvis", text: reply, task_ids: ids, at: new Date().toISOString(), model: r.model ?? (r.planner === "offline" ? "offline" : null) },
      ]);
      const notes = [r.notice, r.error].filter(Boolean);
      if (notes.length) setErr(notes.join(" "));
      return true;
    } catch (e) {
      setErr((e as Error).message);
      // The words go back in the box: nothing was filed.
      setMessages((m) => (m ?? []).filter((x) => x.id !== `you-${at}`));
      return false;
    } finally {
      setThinking(false);
    }
  };

  // The stage's labels are the real machine: the workers, then each kind of
  // standing or running work. A new event pulses out of its node.
  const tasks = q.data?.tasks;
  const nodes = useMemo(() => {
    const items: { id: string; label: string; live?: boolean }[] = [];
    for (const w of (eco?.workers ?? []).filter((x) => !x.stale).slice(0, 2)) {
      items.push({ id: `w:${w.id}`, label: `${w.host} · ${w.running}/${w.concurrency}`, live: w.running > 0 });
    }
    const seen = new Set<string>();
    for (const t of tasks ?? []) {
      const b = bucketOf(t, q.now);
      if ((b !== "autonomous" && b !== "active") || seen.has(t.executor)) continue;
      seen.add(t.executor);
      items.push({ id: `x:${t.executor}`, label: t.executor, live: t.status === "running" });
    }
    return placeNodes(items);
  }, [eco?.workers, tasks, q.now]);
  const newest = useMemo(() => {
    let best: { id: number; task_id: string } | null = null;
    for (const e of q.data?.events ?? []) if (!best || e.id > best.id) best = e;
    return best;
  }, [q.data?.events]);
  const pulseFrom = newest ? `x:${tasks?.find((t) => t.id === newest.task_id)?.executor ?? ""}` : null;

  return (
    <>
      <QueueStage nodes={nodes} pulseKey={String(newest?.id ?? 0)} pulseFrom={pulseFrom}>
        <h2 className="qs-title">
          What should run
          <br />
          while you are away?
        </h2>
        <JarvisComposer onSend={send} busy={thinking} disabled={disabled} model={model} onModel={setModel} inputRef={inputRef} />
      </QueueStage>

      {err && <Notice text={err} onDismiss={() => setErr(null)} />}

      <section aria-label="Conversation with Jarvis" className="q-conv">
        {messages === null && !disabled ? (
          <div className="flex flex-col gap-2">
            <div className="q-skel ml-auto h-9 w-1/2" />
            <div className="q-skel h-12 w-2/3" />
          </div>
        ) : (
          <MessageList
            messages={(messages ?? []).slice(-40)}
            tasks={q.data?.tasks ?? []}
            onOpen={onOpen}
            thinking={thinking}
            followOnLoad={false}
            empty={
              <div>
                <p className="max-w-[60ch] text-[13px] leading-relaxed text-[var(--q-muted)]">
                  Say what you want done: once, on a schedule, or around the clock. Attach a picture when it helps. Jarvis files the tasks, picks the agents and reports back here, even after you close the page.
                </p>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {EXAMPLES.map((ex) => (
                    <li key={ex}>
                      <button
                        type="button"
                        className="q-suggest"
                        disabled={disabled}
                        onClick={() => {
                          const el = inputRef.current;
                          if (!el) return;
                          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
                          setter?.call(el, ex);
                          el.dispatchEvent(new Event("input", { bubbles: true }));
                          el.focus();
                        }}
                      >
                        {ex}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            }
          />
        )}
      </section>
    </>
  );
}

// --- right column: the counts, the pulse and the workers --------------------

function Counts({ eco, q, onOpen }: { eco: Ecosystem; q: UseQueue247; onOpen: (id: string) => void }) {
  const ticks = useMemo(() => activityTicks(q.data?.events ?? [], q.now, 60), [q.data?.events, q.now]);
  const cell = (label: string, value: number, tone: Tone | undefined, sub: React.ReactNode) => (
    <div className="min-w-0">
      <span className="q-count" data-tone-ink={tone ?? "queued"} data-num>
        {value}
      </span>
      <span className="block text-[11.5px] text-[var(--q-muted)]">{label}</span>
      {sub && <span className="block truncate text-[11px] text-[var(--q-faint)]">{sub}</span>}
    </div>
  );
  return (
    <section aria-label="Right now" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        {cell(
          "Running",
          eco.running.length,
          eco.running.length ? "running" : undefined,
          eco.running[0] ? (
            <button type="button" className="hover:text-[var(--q-ink)]" onClick={() => onOpen(eco.running[0].id)}>
              {eco.running[0].title}
            </button>
          ) : eco.queued ? (
            `${eco.queued} waiting for a worker`
          ) : null,
        )}
        {cell(
          "Needs you",
          eco.needsYou.length,
          eco.needsYou.length ? "needs" : undefined,
          eco.needsYou[0] ? (
            <button type="button" className="hover:text-[var(--q-ink)]" onClick={() => onOpen(eco.needsYou[0].id)}>
              {eco.needsYou[0].title}
            </button>
          ) : null,
        )}
        {cell("24/7", eco.autonomousTotal, eco.autonomousTotal ? "running" : undefined, eco.autonomous.map((a) => a.name).slice(0, 2).join(", ") || null)}
        {cell(
          "Done today",
          eco.completedToday,
          undefined,
          eco.failed ? (
            <button type="button" className="text-[var(--q-fail)] hover:underline" onClick={() => document.getElementById("q-bucket-failed")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              {eco.failed} failed
            </button>
          ) : (
            "None failed"
          ),
        )}
      </div>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="q-label">Last hour</span>
          <span className="text-[10.5px] text-[var(--q-faint)]" data-num>
            {ticks.length} event{ticks.length === 1 ? "" : "s"}
          </span>
        </div>
        <PulseRail ticks={ticks} live={eco.running.length > 0} />
      </div>
    </section>
  );
}

function Workers({ eco }: { eco: Ecosystem }) {
  const live = eco.workers.filter((w) => !w.stale);
  return (
    <section aria-label="Workers">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="q-label">Workers</span>
        <span className="text-[10.5px] text-[var(--q-faint)]" data-num>
          {live.length} online
        </span>
      </div>
      <div className="q-card px-3 py-2.5">
        {eco.workers.length === 0 ? (
          <p className="flex items-start gap-2 text-[12px] leading-snug text-[var(--q-muted)]">
            <span className="qm mt-1" data-tone="paused" aria-hidden />
            No worker online. Tasks wait until the VPS worker is running.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {eco.workers.slice(0, 3).map((w) => (
              <WorkerLine key={w.id} w={w} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// --- left column: the tasks as a timeline rail ------------------------------

function TaskRail({ q, apps, onOpen, onNew, onH3 }: { q: UseQueue247; apps: AppRef[]; onOpen: (id: string) => void; onNew: () => void; onH3: () => void }) {
  const [filter, setFilter] = useState<BoardFilter>(EMPTY_FILTER);
  const [collapsed, setCollapsed] = useState<Set<Bucket>>(() => new Set<Bucket>(["completed"]));
  const tasks = q.data?.tasks ?? [];
  const all = useMemo(() => groupByBucket(tasks, q.now), [tasks, q.now]);
  const shown = useMemo(() => groupByBucket(tasks.filter((t) => matchesFilter(t, filter, q.now)), q.now), [tasks, filter, q.now]);
  const usedApps = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.app).filter(Boolean));
    return apps.filter((a) => ids.has(a.id));
  }, [tasks, apps]);
  const filtered = filter.app || filter.bucket || filter.q.trim();
  const visible = shown.filter((g) => g.tasks.length > 0);

  return (
    <section aria-label="Tasks" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <Icon.Search width={12} height={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--q-faint)]" aria-hidden />
          <input className="q-field py-1.5 pl-7 text-[12px]" value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} placeholder="Search tasks…" aria-label="Search tasks" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <select className="q-field py-1 text-[11.5px]" value={filter.app} onChange={(e) => setFilter((f) => ({ ...f, app: e.target.value }))} aria-label="Filter by app">
            <option value="">Every app</option>
            {usedApps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select className="q-field py-1 text-[11.5px]" value={filter.bucket} onChange={(e) => setFilter((f) => ({ ...f, bucket: e.target.value as Bucket | "" }))} aria-label="Filter by status">
            <option value="">Every status</option>
            {all.map((g) => (
              <option key={g.bucket} value={g.bucket}>
                {BUCKET_LABEL[g.bucket]} ({g.tasks.length})
              </option>
            ))}
          </select>
        </div>
        {filtered && (
          <button type="button" className="self-start text-[11px] text-[var(--q-muted)] hover:text-[var(--q-ink)]" onClick={() => setFilter(EMPTY_FILTER)}>
            Clear filters
          </button>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="q-card px-3 py-4">
          <p className="text-[13px] font-semibold text-[var(--q-ink)]">The queue is empty.</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--q-muted)]">Tell Jarvis what you want done, or set a task up yourself.</p>
          <button type="button" className="q-btn mt-3" onClick={onNew}>
            <Icon.Plus width={12} height={12} aria-hidden /> New task
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-[12px] text-[var(--q-muted)]">No task matches. Clear the filters to see everything.</p>
      ) : (
        visible.map((g) => {
          const isCollapsed = collapsed.has(g.bucket) && !filter.bucket;
          return (
            <div key={g.bucket} id={`q-bucket-${g.bucket}`}>
              <h3>
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsed((c) => {
                      const n = new Set(c);
                      if (n.has(g.bucket)) n.delete(g.bucket);
                      else n.add(g.bucket);
                      return n;
                    })
                  }
                  className="flex w-full items-center gap-2 py-1 text-left"
                >
                  <span className="q-label text-[var(--q-muted)]">{BUCKET_LABEL[g.bucket]}</span>
                  <span className="text-[10.5px] text-[var(--q-faint)]" data-num>
                    {g.tasks.length}
                  </span>
                  <span className="flex-1" />
                  <Icon.Chevron width={11} height={11} className={`text-[var(--q-faint)] transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`} aria-hidden />
                </button>
              </h3>
              {!isCollapsed && (
                <ol className="q-rail mt-1.5" data-tone={BUCKET_TONE[g.bucket]}>
                  {g.tasks.map((t) => (
                    <RailItem key={t.id} t={t} q={q} apps={apps} onOpen={onOpen} />
                  ))}
                </ol>
              )}
            </div>
          );
        })
      )}

      <button type="button" className="q-btn w-full" onClick={onH3} title="Recreate a video as H3 prompts">
        <Icon.Film width={12} height={12} aria-hidden /> Recreate a video
      </button>
    </section>
  );
}

function RailItem({ t, q, apps, onOpen }: { t: Task; q: UseQueue247; apps: AppRef[]; onOpen: (id: string) => void }) {
  const now = q.now;
  const tone = toneOf(t, now);
  const p = progressOf(t);
  const step = currentStepOf(t);
  const h = historyOf(t);
  const busy = q.busy.has(t.id);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(id);
  }, [armed]);
  const finished = t.status === "completed" || t.status === "cancelled";
  const canResume = t.status === "paused" || t.status === "failed";

  return (
    <li className="q-rail-item" data-tone={tone} data-dim={finished ? "true" : undefined}>
      <span className="q-rail-mark">
        <StatusMark tone={tone} title={STATUS_LABEL[t.status]} />
      </span>
      <button type="button" className="block w-full min-w-0 text-left" onClick={() => onOpen(t.id)} aria-label={`Open ${t.title}`}>
        <span className="block truncate text-[13px] font-medium text-[var(--q-ink)]">{t.title}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-[var(--q-muted)]">
          {tone === "running" && step ? step : nextRunText(t, now)}
          {t.app ? ` · ${appName(t.app, apps)}` : ""}
        </span>
        {t.status === "failed" && t.last_error && <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--q-fail)]">{t.last_error}</span>}
        {(t.status === "waiting_approval" || t.status === "needs_input") && t.question && <span className="mt-0.5 block truncate text-[11.5px] text-[var(--q-needs)]">{t.question}</span>}
      </button>
      {p != null && tone === "running" && <ProgressBar value={p} tone={tone} live className="mt-1.5" />}
      <div className="mt-1.5 flex items-center gap-1">
        <span className="q-tag" title={h.total ? `${h.ok} succeeded, ${h.fail} failed` : "Has not finished a round yet"} data-num>
          ✓{h.ok}
          {h.fail > 0 && <span className="text-[var(--q-fail)]"> ✗{h.fail}</span>}
        </span>
        <span className="flex-1" />
        {canResume ? (
          <button type="button" className="q-icon-btn h-6 w-6" disabled={busy} onClick={() => q.act(t.id, { action: "resume" })} aria-label={`Resume ${t.title}`} title="Resume">
            <Icon.Play width={12} height={12} />
          </button>
        ) : (
          <button type="button" className="q-icon-btn h-6 w-6" disabled={busy || finished} onClick={() => q.act(t.id, { action: "pause" })} aria-label={`Pause ${t.title}`} title="Pause">
            <Icon.Pause width={12} height={12} />
          </button>
        )}
        <button type="button" className="q-icon-btn h-6 w-6" disabled={busy || finished || t.status === "running"} onClick={() => q.act(t.id, { action: "run_now" })} aria-label={`Run ${t.title} now`} title="Run now">
          <Icon.Launch width={12} height={12} />
        </button>
        {t.status !== "cancelled" && (
          <button
            type="button"
            className="q-icon-btn h-6 w-6"
            data-armed={armed ? "true" : undefined}
            disabled={busy}
            onClick={() => {
              if (!armed) return setArmed(true);
              setArmed(false);
              void q.act(t.id, { action: "cancel" });
            }}
            aria-label={armed ? "Press again to terminate" : `Terminate ${t.title}`}
            title="Terminate"
          >
            {armed ? "Terminate?" : <Icon.Square width={11} height={11} />}
          </button>
        )}
      </div>
    </li>
  );
}

// --- loading ------------------------------------------------------------------

function SideSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading">
      <div className="grid grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="q-skel h-8 w-10" />
            <div className="q-skel h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="q-skel h-16" />
      <div className="q-skel h-40" />
    </div>
  );
}

function RailSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="Loading the tasks">
      <div className="q-skel h-8" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex gap-2.5">
          <div className="q-skel h-2.5 w-2.5 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="q-skel h-3" style={{ width: `${80 - i * 8}%` }} />
            <div className="q-skel h-2.5" style={{ width: `${55 - i * 5}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// --- header -------------------------------------------------------------

function Header({
  q,
  eco,
  view,
  setView,
  onNew,
  onOpen,
  embedded,
}: {
  q: UseQueue247;
  eco: Ecosystem | null;
  view: View;
  setView: (v: View) => void;
  onNew: () => void;
  onOpen: (id: string, tab?: "overview" | "results") => void;
  embedded: boolean;
}) {
  const live = (eco?.running.length ?? 0) > 0;
  return (
    <header className="flex-none border-b border-[var(--q-line)] bg-[color-mix(in_oklab,var(--q-panel)_70%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative grid h-7 w-7 flex-none place-items-center rounded-md border border-[var(--q-line)] bg-[var(--q-canvas)]">
            <Icon.Network width={14} height={14} className="text-[var(--q-run)]" aria-hidden />
            {live && <span className="qm absolute -right-0.5 -top-0.5 h-[7px] w-[7px]" data-tone="running" aria-hidden />}
          </span>
          <div className="min-w-0">
            {embedded ? (
              <h2 className="q-display text-[14px] font-semibold leading-none text-[var(--q-ink)]">24/7 Queue</h2>
            ) : (
              <h1 className="q-display text-[14px] font-semibold leading-none text-[var(--q-ink)]">24/7 Queue</h1>
            )}
            <p className="mt-1 max-w-[62ch] truncate text-[11.5px] leading-none text-[var(--q-muted)]" aria-live="polite">
              {eco ? eco.headline : "Your AI operations, around the clock."}
            </p>
          </div>
        </div>
        <span className="flex-1" />
        <nav role="tablist" aria-label="Command center" className="flex gap-0.5 rounded-md border border-[var(--q-line)] bg-[var(--q-canvas)] p-0.5">
          {(
            [
              ["board", "Board", Icon.ListChecks],
              ["library", "Library", Icon.Database],
              ["apps", "Apps", Icon.Grid],
            ] as const
          ).map(([id, label, I]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} className="q-chip h-[26px] px-2" onClick={() => setView(id)}>
              <I width={11} height={11} aria-hidden />
              {label}
            </button>
          ))}
        </nav>
        <Bell q={q} onOpen={onOpen} />
        <button type="button" className="q-btn q-btn-primary" onClick={onNew} disabled={!q.data}>
          <Icon.Plus width={12} height={12} aria-hidden />
          <span className="max-[400px]:sr-only">New task</span>
        </button>
      </div>
    </header>
  );
}

function Bell({ q, onOpen }: { q: UseQueue247; onOpen: (id: string, tab?: "overview" | "results") => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = q.data?.notifications ?? [];
  const unread = list.filter((n) => !n.read).length;
  useEscape(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", off);
    return () => window.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="q-icon-btn relative h-[30px] w-[30px] text-[var(--q-muted)]"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unread) void q.readNotifications();
        }}
      >
        <Icon.Bell width={15} height={15} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[var(--q-brand-2)] px-1 font-mono text-[9px] font-semibold text-white" data-num>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="q-glass absolute right-0 top-[calc(100%+6px)] z-40 w-[min(360px,calc(100vw-24px))] overflow-hidden bg-[color-mix(in_oklab,var(--q-panel)_96%,transparent)]">
          <p className="q-label border-b border-[var(--q-line-soft)] px-3 py-2">Notifications</p>
          {list.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-[var(--q-muted)]">Nothing yet. You&apos;ll hear here when a task needs you, fails, or finds something worth seeing.</p>
          ) : (
            <ul className="q-scroll max-h-[60vh] overflow-y-auto">
              {list.map((n) => (
                <li key={n.id} className="border-t border-[var(--q-line-soft)] first:border-t-0">
                  <button
                    type="button"
                    disabled={!n.task_id}
                    onClick={() => {
                      setOpen(false);
                      if (n.task_id) onOpen(n.task_id);
                    }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[var(--q-elev)] disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${n.read ? "bg-transparent" : "bg-[var(--q-run)]"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] text-[var(--q-ink)]">{n.title}</span>
                      {n.body && <span className="mt-0.5 block line-clamp-2 text-[11.5px] text-[var(--q-muted)]">{n.body}</span>}
                    </span>
                    <span className="flex-none text-[10.5px] text-[var(--q-faint)]" data-num>
                      {relTime(n.at, q.now)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// --- the pulse of the last hour, one worker -----------------------------------

function PulseRail({ ticks, live }: { ticks: { x: number; level: string }[]; live: boolean }) {
  // Height carries the kind of event: steps and results stand taller than chatter.
  const H: Record<string, number> = { info: 7, step: 13, result: 18, warn: 15, error: 20 };
  return (
    <div className="flex flex-col gap-1">
      <div className="q-pulse" role="img" aria-label={ticks.length ? `${ticks.length} events in the last hour` : "No activity in the last hour"}>
        {ticks.map((t, i) => (
          <i key={i} data-level={t.level} data-fresh={t.x > 0.985 ? "true" : undefined} style={{ left: `${(t.x * 100).toFixed(2)}%`, height: `${H[t.level] ?? 8}px` }} />
        ))}
        <span className="q-pulse-now" data-live={live ? "true" : undefined} />
      </div>
      <div className="flex justify-between text-[9.5px] text-[var(--q-faint)]" data-num aria-hidden>
        <span>−60m</span>
        <span>−30m</span>
        <span>now</span>
      </div>
    </div>
  );
}

function WorkerLine({ w }: { w: WorkerView }) {
  return (
    <li className="min-w-0">
      <div className="flex items-center gap-2 text-[11.5px]">
        <StatusMark tone={w.stale ? "paused" : w.running ? "running" : "done"} title={w.stale ? "No heartbeat" : w.running ? "Working" : "Idle"} />
        <span className="min-w-0 flex-1 truncate font-mono text-[var(--q-ink)]">{w.host}</span>
        <span className="text-[var(--q-muted)]" data-num>
          {w.running}/{w.concurrency}
        </span>
        <span className="text-[10.5px] text-[var(--q-faint)]" data-num>
          {w.stale ? `seen ${w.seen}` : `up ${w.uptime}`}
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1 pl-[17px]">
        <Meter pct={w.loadPct} label="CPU" />
        <Meter pct={w.memPct} label="RAM" />
      </div>
    </li>
  );
}

// --- right column: discoveries + live activity -------------------------------

function Discoveries({ eco, q, onOpen }: { eco: Ecosystem; q: UseQueue247; onOpen: (id: string, tab?: "overview" | "results") => void }) {
  const list = eco.discoveries.slice(0, 10);
  const unseenIds = eco.discoveries.filter((f) => f.seen === false).map((f) => f.id);
  return (
    <section className="q-glass overflow-hidden" aria-label="Discoveries">
      <header className="flex items-center gap-2 border-b border-[var(--q-line-soft)] px-3 py-2">
        <Icon.Bulb width={12} height={12} className="text-[var(--q-muted)]" aria-hidden />
        <h3 className="q-label text-[var(--q-ink)]">Discoveries</h3>
        {eco.unseen > 0 && (
          <span className="rounded bg-[var(--q-brand-2)] px-1.5 font-mono text-[10px] text-white" data-num>
            {eco.unseen} new
          </span>
        )}
        <span className="flex-1" />
        {unseenIds.length > 0 && (
          <button type="button" className="text-[11px] text-[var(--q-muted)] hover:text-[var(--q-ink)]" onClick={() => q.seenFindings(unseenIds)}>
            Mark seen
          </button>
        )}
      </header>
      {list.length === 0 ? (
        <p className="px-3 py-3 text-[12px] leading-relaxed text-[var(--q-muted)]">What your agents find — ranked bots, storyboards, research — shows up here the moment it lands.</p>
      ) : (
        <ul>
          {list.map((f) => (
            <li key={f.id} className="border-t border-[var(--q-line-soft)] first:border-t-0">
              <button
                type="button"
                className="grid w-full grid-cols-[8px_1fr_auto] items-start gap-x-2 px-3 py-2 text-left hover:bg-[var(--q-elev)]"
                onClick={() => {
                  if (f.seen === false) void q.seenFindings([f.id]);
                  onOpen(f.task_id, "results");
                }}
              >
                <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${f.seen === false ? "bg-[var(--q-run)]" : "bg-transparent"}`} aria-label={f.seen === false ? "New" : undefined} />
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] text-[var(--q-ink)]">{f.title}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[var(--q-faint)]">
                    <span className="uppercase tracking-[0.05em]">{findingKindLabel(f.kind)}</span>
                    {f.notable && <span className="text-[var(--q-run)]">· notable</span>}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  {f.score != null && (
                    <span className="text-[11px] text-[var(--q-ink)]" data-num>
                      {Math.round(f.score)}
                    </span>
                  )}
                  <span className="text-[10px] text-[var(--q-faint)]" data-num>
                    {relTime(f.created_at, q.now)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const LEVEL_TONE: Record<string, Tone> = { info: "queued", step: "running", result: "done", warn: "needs", error: "failed" };

function Activity({ q, onOpen }: { q: UseQueue247; onOpen: (id: string) => void }) {
  const items = useMemo(() => tickerItems(q.data?.events ?? [], q.data?.tasks ?? [], 30), [q.data?.events, q.data?.tasks]);
  return (
    <section className="q-glass overflow-hidden" aria-label="Live activity">
      <header className="flex items-center gap-2 border-b border-[var(--q-line-soft)] px-3 py-2">
        <Icon.Waveform width={12} height={12} className="text-[var(--q-muted)]" aria-hidden />
        <h3 className="q-label text-[var(--q-ink)]">Live activity</h3>
        <span className="flex-1" />
        <span className="text-[10.5px] text-[var(--q-faint)]">every 4 s</span>
      </header>
      {items.length === 0 ? (
        <p className="px-3 py-3 text-[12px] leading-relaxed text-[var(--q-muted)]">Every step an agent takes is logged here as it happens.</p>
      ) : (
        <ol className="q-scroll max-h-[440px] overflow-y-auto lg:max-h-[52vh]" aria-live="polite" aria-relevant="additions">
          {items.map((e) => (
            <li key={e.id} className="border-t border-[var(--q-line-soft)] first:border-t-0">
              <button type="button" onClick={() => onOpen(e.task_id)} className="grid w-full grid-cols-[9px_1fr_auto] gap-x-2 px-3 py-1.5 text-left hover:bg-[var(--q-elev)]">
                <span className="mt-[5px]">
                  <StatusMark tone={LEVEL_TONE[e.level] ?? "queued"} title={e.level} />
                </span>
                <span className="min-w-0">
                  <span className={`block text-[12px] leading-snug ${e.level === "error" ? "text-[var(--q-fail)]" : "text-[var(--q-ink)]"}`}>{e.message}</span>
                  <span className="block truncate text-[10.5px] text-[var(--q-faint)]">{e.taskTitle}</span>
                </span>
                <span className="text-[10px] text-[var(--q-faint)]" data-num>
                  {relTime(e.at, q.now).replace(" ago", "")}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// --- states -----------------------------------------------------------------

function Unavailable({ state, onRetry }: { state: UseQueue247["state"]; onRetry: () => void }) {
  const message = "message" in state ? state.message : "";
  const offline = state.kind === "offline";
  const signedOut = state.kind === "signed-out";
  return (
    <section className="q-glass mt-1 w-full max-w-[640px] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--q-line-soft)] px-4 py-2.5">
        <StatusMark tone={offline ? "paused" : signedOut ? "needs" : "failed"} />
        <span className="q-label text-[var(--q-ink)]">{offline ? "Not connected yet" : signedOut ? "Signed out" : "Can't reach the queue"}</span>
      </div>
      <div className="px-4 py-4">
        <p className="text-[14px] font-semibold text-[var(--q-ink)]">
          {offline ? "The 24/7 Queue needs its database before it can run anything." : signedOut ? "Sign in to see your 24/7 Queue." : "The command center couldn't load."}
        </p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--q-muted)]">{message}</p>
        {offline && (
          <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--q-muted)]">
            Once Supabase is configured for this deployment, tasks, workers and discoveries appear here by themselves — nothing on this page needs to change.
          </p>
        )}
        <div className="mt-4 flex gap-1.5">
          {signedOut ? (
            <a className="q-btn q-btn-primary" href="/login">
              Go to sign in
            </a>
          ) : (
            <button type="button" className="q-btn" onClick={onRetry}>
              <Icon.Refresh width={12} height={12} aria-hidden /> Try again
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
