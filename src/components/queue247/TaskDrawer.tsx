"use client";

// One task, opened: every control, the gate when it waits on you, and six
// tabs — Overview, Log, Runs, Results, Sub-tasks, Talk. A side drawer on a
// laptop, a full-screen sheet on a phone. Polls its own detail every 4 s while
// open, so a running task's log and steps move by themselves.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import type { OwnerAction } from "@/lib/queue247/engine";
import { STATUS_LABEL } from "@/lib/queue247/engine";
import type { EventLevel, Finding, Task, TaskEvent, TaskMessage, TaskRun, TaskSchedule } from "@/lib/queue247/types";
import { getJson, POLL_MS, type UseQueue247 } from "@/lib/queue247/useQueue247";
import {
  appName,
  configToFields,
  currentStepOf,
  fieldsToConfig,
  formatDuration,
  historyOf,
  nextRunText,
  progressOf,
  relTime,
  scheduleText,
  stepCounts,
  toneOf,
  type AppRef,
  type ExecutorRef,
} from "@/lib/queue247/view";
import { HistoryBars, Layer, Notice, ProgressBar, StatusChip, StatusMark } from "./parts";
import { FindingResults } from "./Results";
import { MessageList } from "./Conversation";

interface Detail {
  task: Task;
  runs: TaskRun[];
  events: TaskEvent[];
  findings: Finding[];
  children: Task[];
  messages: TaskMessage[];
}

type DrawerTab = "overview" | "log" | "runs" | "results" | "children" | "talk";

export function TaskDrawer({
  id,
  q,
  apps,
  executors,
  onClose,
  onOpen,
  initialTab = "overview",
}: {
  id: string;
  q: UseQueue247;
  apps: AppRef[];
  executors: ExecutorRef[];
  onClose: () => void;
  onOpen: (id: string) => void;
  initialTab?: DrawerTab;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  const [editing, setEditing] = useState(false);
  const now = q.now;

  // The board's copy is fresher for status (optimistic presses land there first).
  const boardTask = q.data?.tasks.find((t) => t.id === id) ?? null;
  const task = boardTask ?? detail?.task ?? null;

  const load = useCallback(async () => {
    try {
      const d = await getJson<Detail>(`/api/queue247/tasks/${encodeURIComponent(id)}`);
      setDetail(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setEditing(false);
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const act = async (a: OwnerAction) => {
    const t = await q.act(id, a);
    if (t) void load();
    return t;
  };

  const counts = {
    log: detail?.events.length ?? 0,
    runs: detail?.runs.length ?? 0,
    results: detail?.findings.length ?? 0,
    children: detail?.children.length ?? 0,
    talk: detail?.messages.length ?? 0,
  };

  return (
    <Layer onClose={onClose} label={task ? `Task: ${task.title}` : "Task"}>
      {!task ? (
        <div className="flex h-full flex-col">
          <DrawerTop onClose={onClose} />
          <div className="p-4">
            {error ? <Notice text={error} /> : <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className="q-skel h-5" style={{ width: `${90 - i * 15}%` }} />)}</div>}
          </div>
        </div>
      ) : (
        <>
          <Header task={task} now={now} apps={apps} busy={q.busy.has(id)} onClose={onClose} act={act} onEdit={() => setEditing((v) => !v)} editing={editing} onDelete={async () => (await q.remove(id)) && onClose()} />
          <div className="px-4">
            <Notice text={q.notice} onDismiss={q.dismiss} />
          </div>
          {(task.status === "waiting_approval" || task.status === "needs_input") && <Gate task={task} act={act} />}
          {editing && <EditForm task={task} executors={executors} onDone={() => setEditing(false)} act={act} />}

          <div role="tablist" aria-label="Task detail" className="q-tabs mt-1 flex-none border-b border-[var(--q-line)] px-2">
            {(
              [
                ["overview", "Overview", 0],
                ["log", "Log", counts.log],
                ["runs", "Runs", counts.runs],
                ["results", "Results", counts.results],
                ["children", "Sub-tasks", counts.children],
                ["talk", "Talk", counts.talk],
              ] as const
            ).map(([k, label, n]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className="q-tab" onClick={() => setTab(k)}>
                {label}
                {n > 0 && (
                  <span className="ml-1 text-[10px] text-[var(--q-faint)]" data-num>
                    {n}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="q-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3" role="tabpanel">
            {error && <Notice text={error} />}
            {tab === "overview" && <Overview task={task} now={now} apps={apps} />}
            {tab === "log" && (detail ? <Log events={detail.events} now={now} /> : <Skeleton />)}
            {tab === "runs" && (detail ? <Runs runs={detail.runs} now={now} /> : <Skeleton />)}
            {tab === "results" &&
              (detail ? (
                detail.findings.length ? (
                  <FindingResults findings={detail.findings} now={now} />
                ) : (
                  <p className="text-[12.5px] text-[var(--q-muted)]">Nothing found yet. Results appear here as the agent finishes each step.</p>
                )
              ) : (
                <Skeleton />
              ))}
            {tab === "children" && (detail ? <Children tasks={detail.children} now={now} onOpen={onOpen} /> : <Skeleton />)}
            {tab === "talk" && <Talk task={task} q={q} initial={detail?.messages ?? null} onSent={load} onOpen={onOpen} />}
          </div>
        </>
      )}
    </Layer>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2" aria-label="Loading">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="q-skel h-4" style={{ width: `${95 - i * 12}%` }} />
      ))}
    </div>
  );
}

function DrawerTop({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-end border-b border-[var(--q-line)] px-3 py-2">
      <button type="button" className="q-icon-btn" onClick={onClose} aria-label="Close">
        <Icon.Close width={14} height={14} />
      </button>
    </div>
  );
}

function Header({
  task,
  now,
  apps,
  busy,
  onClose,
  act,
  onEdit,
  editing,
  onDelete,
}: {
  task: Task;
  now: Date;
  apps: AppRef[];
  busy: boolean;
  onClose: () => void;
  act: (a: OwnerAction) => Promise<Task | null>;
  onEdit: () => void;
  editing: boolean;
  onDelete: () => void;
}) {
  const tone = toneOf(task, now);
  const [confirm, setConfirm] = useState<"cancel" | "delete" | null>(null);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(null), 4000);
    return () => clearTimeout(t);
  }, [confirm]);
  const finished = task.status === "completed" || task.status === "cancelled";
  const canResume = task.status === "paused" || task.status === "failed";
  const p = progressOf(task);

  return (
    <div className="flex-none border-b border-[var(--q-line)] px-4 pb-3 pt-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusChip tone={tone} label={STATUS_LABEL[task.status]} />
            <span className="text-[11px] text-[var(--q-muted)]">{appName(task.app, apps)}</span>
            <span className="text-[11px] text-[var(--q-faint)]">{task.agent}</span>
          </div>
          <h2 className="mt-1.5 text-[14px] font-semibold leading-snug text-[var(--q-ink)]">{task.title}</h2>
          {task.description && <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--q-muted)]">{task.description}</p>}
        </div>
        <button type="button" className="q-icon-btn -mr-1 flex-none" onClick={onClose} aria-label="Close (Esc)">
          <Icon.Close width={15} height={15} />
        </button>
      </div>
      {p != null && (
        <div className="mt-3 flex items-center gap-3">
          <ProgressBar value={p} tone={tone} live={tone === "running"} className="flex-1" />
          <span className="text-[11px] text-[var(--q-ink)]" data-num>
            {p}%
          </span>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {canResume ? (
          <button type="button" className="q-btn q-btn-primary" disabled={busy} onClick={() => act({ action: "resume" })}>
            <Icon.Play width={12} height={12} aria-hidden /> Resume
          </button>
        ) : (
          <button type="button" className="q-btn" disabled={busy || finished} onClick={() => act({ action: "pause" })}>
            <Icon.Pause width={12} height={12} aria-hidden /> Pause
          </button>
        )}
        <button type="button" className="q-btn" disabled={busy || finished || task.status === "running"} onClick={() => act({ action: "run_now" })}>
          <Icon.Launch width={12} height={12} aria-hidden /> Run now
        </button>
        <button type="button" className="q-btn" disabled={busy} onClick={() => act({ action: "restart" })}>
          <Icon.Refresh width={12} height={12} aria-hidden /> Restart
        </button>
        <PriorityPicker value={task.priority} disabled={busy} onPick={(n) => act({ action: "priority", priority: n })} />
        <button type="button" className="q-btn" aria-pressed={editing} onClick={onEdit}>
          <Icon.Edit width={12} height={12} aria-hidden /> Edit
        </button>
        <span className="flex-1" />
        {task.status !== "cancelled" && (
          <button
            type="button"
            className={`q-btn ${confirm === "cancel" ? "q-btn-confirm" : "q-btn-danger"}`}
            disabled={busy}
            onClick={() => (confirm === "cancel" ? (setConfirm(null), act({ action: "cancel" })) : setConfirm("cancel"))}
          >
            <Icon.Square width={11} height={11} aria-hidden /> {confirm === "cancel" ? "Terminate — sure?" : "Terminate"}
          </button>
        )}
        <button
          type="button"
          className={`q-btn ${confirm === "delete" ? "q-btn-confirm" : "q-btn-danger"}`}
          disabled={busy}
          onClick={() => (confirm === "delete" ? (setConfirm(null), onDelete()) : setConfirm("delete"))}
          aria-label="Delete task"
        >
          <Icon.Trash width={12} height={12} aria-hidden /> {confirm === "delete" ? "Delete for good?" : ""}
        </button>
      </div>
    </div>
  );
}

export function PriorityPicker({ value, onPick, disabled, compact = false }: { value: number; onPick: (n: number) => void; disabled?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
        className={compact ? "q-icon-btn w-auto px-1.5 text-[10.5px]" : "q-btn"}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Priority (5 = urgent)"
        aria-label={`Priority ${value} of 5`}
      >
        {!compact && <Icon.Flag width={12} height={12} aria-hidden />}
        <span data-num>P{value}</span>
      </button>
      {open && (
        <div role="listbox" aria-label="Priority" className="q-glass absolute right-0 top-[calc(100%+4px)] z-20 flex gap-0.5 p-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={n === value}
              className="q-chip min-w-[28px] justify-center"
              onClick={() => {
                setOpen(false);
                if (n !== value) onPick(n);
              }}
            >
              <span data-num>{n}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Gate({ task, act }: { task: Task; act: (a: OwnerAction) => Promise<Task | null> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const approval = task.status === "waiting_approval";
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  const send = async (a: OwnerAction) => {
    setSending(true);
    try {
      if (await act(a)) setText("");
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="q-gate mx-4 mt-3 flex-none px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Icon.Shield width={15} height={15} className="mt-0.5 flex-none text-[var(--q-needs)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--q-needs)]">{approval ? "Waiting for your OK" : "Needs your answer"}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--q-ink)]">{task.question || (approval ? "The agent stopped before a step only you can approve." : "The agent needs something it cannot find on its own.")}</p>
        </div>
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder={approval ? "Optional note for the agent…" : "Type your answer…"}
        className="q-field mt-2 resize-y"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !approval && text.trim()) void send({ action: "answer", text });
        }}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {approval ? (
          <>
            <button type="button" className="q-btn q-btn-primary" disabled={sending} onClick={() => send({ action: "approve", note: text.trim() || undefined })}>
              <Icon.Check width={12} height={12} aria-hidden /> Approve
            </button>
            <button type="button" className="q-btn" disabled={sending} onClick={() => send({ action: "reject", note: text.trim() || undefined })}>
              Say no
            </button>
          </>
        ) : (
          <button type="button" className="q-btn q-btn-primary" disabled={sending || !text.trim()} onClick={() => send({ action: "answer", text })}>
            <Icon.Send width={12} height={12} aria-hidden /> Send answer
          </button>
        )}
      </div>
    </div>
  );
}

function EditForm({ task, executors, act, onDone }: { task: Task; executors: ExecutorRef[]; act: (a: OwnerAction) => Promise<Task | null>; onDone: () => void }) {
  const help = executors.find((e) => e.id === task.executor)?.configHelp ?? {};
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [every, setEvery] = useState(task.schedule.everyMinutes ? String(task.schedule.everyMinutes) : "");
  const [daily, setDaily] = useState(task.schedule.dailyAt ?? "");
  const [at, setAt] = useState(task.schedule.at ? toLocalInput(task.schedule.at) : "");
  const [fields, setFields] = useState(() => configToFields(task.config, help));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const schedule: TaskSchedule = { ...(task.schedule.tz ? { tz: task.schedule.tz } : {}) };
    if (every.trim()) schedule.everyMinutes = Number(every);
    if (daily.trim()) schedule.dailyAt = daily.trim();
    if (at.trim()) schedule.at = new Date(at).toISOString();
    const t = await act({ action: "edit", title, description, schedule, config: fieldsToConfig(fields) });
    setSaving(false);
    if (t) onDone();
  };

  return (
    <form
      className="mx-4 mt-3 flex flex-none flex-col gap-2.5 rounded-lg border border-[var(--q-line)] bg-[var(--q-panel-2)] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Name">
        <input className="q-field" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={140} />
      </Field>
      <Field label="What it should do">
        <textarea className="q-field resize-y" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {task.kind !== "once" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {task.kind === "scheduled" ? (
            <Field label="Runs at">
              <input className="q-field" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
          ) : (
            <>
              <Field label="Every (minutes)">
                <input className="q-field font-mono" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value.replace(/[^\d]/g, ""))} placeholder="30" />
              </Field>
              {task.kind === "recurring" && (
                <Field label="Or daily at">
                  <input className="q-field font-mono" type="time" value={daily} onChange={(e) => setDaily(e.target.value)} />
                </Field>
              )}
            </>
          )}
        </div>
      )}
      {fields.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="q-label mb-1">Settings</legend>
          {fields.map((f, i) => (
            <Field key={f.key} label={f.key} hint={f.help}>
              <input
                className="q-field font-mono text-[11.5px]"
                value={f.value}
                onChange={(e) => setFields((all) => all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              />
            </Field>
          ))}
        </fieldset>
      )}
      <div className="flex gap-1.5">
        <button type="submit" className="q-btn q-btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="q-btn q-btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium text-[var(--q-muted)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-[var(--q-faint)]">{hint}</span>}
    </label>
  );
}

function Overview({ task, now, apps }: { task: Task; now: Date; apps: AppRef[] }) {
  const h = historyOf(task);
  const sc = stepCounts(task);
  const step = currentStepOf(task);
  const rows: [string, React.ReactNode][] = [
    ["App", appName(task.app, apps)],
    ["Agent", task.agent],
    ["Schedule", scheduleText(task.kind, task.schedule)],
    ["Next run", nextRunText(task, now)],
    ["Last run", task.last_run_at ? relTime(task.last_run_at, now) : "Not yet"],
    ["Last activity", relTime(task.last_activity_at ?? task.updated_at, now)],
    ["Priority", <span key="p" data-num>P{task.priority} of 5</span>],
    ["Attempts", <span key="a" data-num>{task.attempts} of {task.max_attempts}</span>],
    ["Filed by", task.created_by === "you" ? "You" : task.created_by],
    ["Created", new Date(task.created_at).toLocaleString()],
  ];
  return (
    <div className="flex flex-col gap-4">
      {task.last_error && task.status !== "completed" && (
        <div className="rounded-md border border-[color-mix(in_oklab,var(--q-fail-fill)_35%,var(--q-line))] px-3 py-2">
          <p className="q-label text-[var(--q-fail)]">Last error</p>
          <p className="mt-1 whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-[var(--q-ink)]">{task.last_error}</p>
        </div>
      )}
      {task.result_summary && (
        <div>
          <p className="q-label">Result</p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--q-ink)]">{task.result_summary}</p>
        </div>
      )}

      <section>
        <div className="mb-1.5 flex items-baseline gap-2">
          <h4 className="q-label">Steps</h4>
          {sc.total > 0 && (
            <span className="text-[10.5px] text-[var(--q-faint)]" data-num>
              {sc.done}/{sc.total}
            </span>
          )}
          {step && <span className="min-w-0 truncate text-[11.5px] text-[var(--q-muted)]">· now: {step}</span>}
        </div>
        {task.steps.length ? (
          <ol className="q-ledger flex flex-col">
            {task.steps.map((s) => {
              const tone = s.state === "active" ? "running" : s.state === "done" ? "done" : s.state === "failed" ? "failed" : s.state === "skipped" ? "cancelled" : "queued";
              return (
                <li key={s.id} className="relative grid grid-cols-[9px_1fr] gap-x-3 py-1.5">
                  <span className="mt-[5px]">
                    <StatusMark tone={tone} title={s.state} />
                  </span>
                  <div className="min-w-0">
                    <p className={`text-[12.5px] ${s.state === "active" ? "text-[var(--q-ink)]" : s.state === "pending" ? "text-[var(--q-faint)]" : "text-[var(--q-muted)]"}`}>{s.label}</p>
                    {s.note && <p className="text-[11.5px] leading-snug text-[var(--q-faint)]">{s.note}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-[12px] text-[var(--q-faint)]">The agent plans its steps when it first runs.</p>
        )}
      </section>

      <section>
        <h4 className="q-label mb-1.5">Record</h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[12px]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-[var(--q-faint)]">{k}</dt>
                <dd className="min-w-0 truncate text-[var(--q-ink)]">{v}</dd>
              </div>
            ))}
          </dl>
          <div>
            <p className="mb-1 text-[11px] text-[var(--q-faint)]">Rounds</p>
            <HistoryBars h={h} />
            {h.rate != null && (
              <p className="mt-1 text-[11px] text-[var(--q-muted)]" data-num>
                {Math.round(h.rate * 100)}% succeeded
              </p>
            )}
          </div>
        </div>
      </section>

      {task.instruction && (
        <section>
          <h4 className="q-label mb-1.5">Your original words</h4>
          <blockquote className="whitespace-pre-wrap border-l-2 border-[var(--q-line)] pl-3 text-[13px] leading-relaxed text-[var(--q-muted)]">{task.instruction}</blockquote>
        </section>
      )}

      {Object.keys(task.config ?? {}).length > 0 && (
        <section>
          <h4 className="q-label mb-1.5">Settings</h4>
          <dl className="q-inset grid grid-cols-[minmax(90px,max-content)_1fr] gap-x-3 gap-y-1 px-3 py-2 text-[11.5px]">
            {Object.entries(task.config).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-[var(--q-faint)]">{k}</dt>
                <dd className="min-w-0 break-words font-mono text-[var(--q-ink)]">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

const LEVELS: (EventLevel | "all")[] = ["all", "step", "result", "info", "warn", "error"];
const LEVEL_INK: Record<EventLevel, string> = {
  info: "text-[var(--q-muted)]",
  step: "text-[var(--q-run)]",
  result: "text-[var(--q-done)]",
  warn: "text-[var(--q-needs)]",
  error: "text-[var(--q-fail)]",
};

function Log({ events, now }: { events: TaskEvent[]; now: Date }) {
  const [level, setLevel] = useState<EventLevel | "all">("all");
  const list = useMemo(() => [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id - a.id).filter((e) => level === "all" || e.level === level), [events, level]);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Filter by level">
        {LEVELS.map((l) => (
          <button key={l} type="button" className="q-chip" aria-pressed={level === l} onClick={() => setLevel(l)}>
            {l}
          </button>
        ))}
      </div>
      {list.length ? (
        <ol className="q-inset font-mono text-[11.5px] leading-relaxed">
          {list.map((e) => (
            <li key={e.id} className="grid grid-cols-[70px_52px_1fr] gap-x-2 border-t border-[var(--q-line-soft)] px-2.5 py-1 first:border-t-0 max-sm:grid-cols-[60px_1fr]">
              <time className="text-[var(--q-faint)]" dateTime={e.at} title={new Date(e.at).toLocaleString()}>
                {relTime(e.at, now).replace(" ago", "")}
              </time>
              <span className={`uppercase max-sm:hidden ${LEVEL_INK[e.level]}`}>{e.level}</span>
              <span className={`min-w-0 whitespace-pre-wrap break-words ${e.level === "error" ? "text-[var(--q-fail)]" : "text-[var(--q-ink)]"}`}>{e.message}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[12.5px] text-[var(--q-muted)]">{events.length ? "Nothing at this level." : "No log lines yet — they appear when a worker picks this task up."}</p>
      )}
    </div>
  );
}

const OUTCOME_TONE: Record<string, "done" | "running" | "needs" | "failed" | "queued" | "scheduled"> = {
  done: "done",
  continue: "scheduled",
  wait: "scheduled",
  needs_approval: "needs",
  needs_input: "needs",
  failed: "failed",
  lost: "failed",
};

function Runs({ runs, now }: { runs: TaskRun[]; now: Date }) {
  if (!runs.length) return <p className="text-[12.5px] text-[var(--q-muted)]">No runs yet. A run is one turn a worker took at this task.</p>;
  return (
    <div className="q-inset overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-left">
        <thead>
          <tr className="bg-[var(--q-panel-2)] text-[10px] uppercase tracking-[0.06em] text-[var(--q-muted)]">
            <th className="px-2.5 py-1.5 font-medium">Started</th>
            <th className="px-2.5 py-1.5 font-medium">Outcome</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Took</th>
            <th className="px-2.5 py-1.5 text-right font-medium">AI calls</th>
            <th className="px-2.5 py-1.5 font-medium">What came of it</th>
          </tr>
        </thead>
        <tbody className="font-mono text-[11.5px]">
          {runs.map((r) => {
            const ms = r.metrics?.ms ?? (r.finished_at ? Date.parse(r.finished_at) - Date.parse(r.started_at) : null);
            const tone = r.outcome ? OUTCOME_TONE[r.outcome] ?? "queued" : "running";
            return (
              <tr key={r.id} className="border-t border-[var(--q-line-soft)] align-top">
                <td className="whitespace-nowrap px-2.5 py-1.5 text-[var(--q-muted)]" title={new Date(r.started_at).toLocaleString()}>
                  {relTime(r.started_at, now)}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5">
                  <span className="inline-flex items-center gap-1.5" data-tone-ink={tone}>
                    <StatusMark tone={tone} />
                    {r.outcome ? r.outcome.replace("_", " ") : "running"}
                  </span>
                </td>
                <td className="px-2.5 py-1.5 text-right text-[var(--q-ink)]" data-num>
                  {r.finished_at || r.metrics?.ms ? formatDuration(ms) : "—"}
                </td>
                <td className="px-2.5 py-1.5 text-right text-[var(--q-ink)]" data-num>
                  {r.metrics?.aiCalls ?? "—"}
                </td>
                <td className={`px-2.5 py-1.5 font-sans text-[12px] ${r.error ? "text-[var(--q-fail)]" : "text-[var(--q-muted)]"}`}>{r.error || r.summary || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Children({ tasks, now, onOpen }: { tasks: Task[]; now: Date; onOpen: (id: string) => void }) {
  if (!tasks.length) return <p className="text-[12.5px] text-[var(--q-muted)]">No sub-tasks. When Jarvis splits a request into parts, each part shows here.</p>;
  return (
    <ul className="q-inset">
      {tasks.map((t) => {
        const tone = toneOf(t, now);
        const p = progressOf(t);
        return (
          <li key={t.id} className="border-t border-[var(--q-line-soft)] first:border-t-0">
            <button type="button" onClick={() => onOpen(t.id)} className="grid w-full grid-cols-[12px_1fr_auto] items-center gap-x-2.5 px-3 py-2 text-left hover:bg-[var(--q-elev)]">
              <StatusMark tone={tone} />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] text-[var(--q-ink)]">{t.title}</span>
                <span className="block truncate text-[11px] text-[var(--q-muted)]">
                  {t.agent} · {currentStepOf(t) || STATUS_LABEL[t.status]}
                </span>
                {p != null && <ProgressBar value={p} tone={tone} className="mt-1 w-40" />}
              </span>
              <span className="text-[10.5px] text-[var(--q-faint)]" data-num>
                {relTime(t.last_activity_at ?? t.updated_at, now)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Talk({ task, q, initial, onSent, onOpen }: { task: Task; q: UseQueue247; initial: TaskMessage[] | null; onSent: () => void; onOpen: (id: string) => void }) {
  const [local, setLocal] = useState<TaskMessage[]>([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const messages = useMemo(() => {
    const server = initial ?? [];
    const seen = new Set(server.map((m) => `${m.role}:${m.text}`));
    return [...server, ...local.filter((m) => !seen.has(`${m.role}:${m.text}`))].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [initial, local]);

  const send = async () => {
    const t = text.trim();
    if (!t || thinking) return;
    setText("");
    setErr(null);
    const at = new Date().toISOString();
    setLocal((l) => [...l, { id: `local-${at}`, task_id: task.id, user_id: "", role: "you", text: t, task_ids: [], at }]);
    setThinking(true);
    try {
      const r = await q.command(t, task.id);
      const ids = [...r.created, ...r.acted].map((x) => x.id);
      setLocal((l) => [...l, { id: `local-r-${Date.now()}`, task_id: task.id, user_id: "", role: "jarvis", text: r.clarify || r.reply || r.error || "Done.", task_ids: ids, at: new Date().toISOString() }]);
      onSent();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-relaxed text-[var(--q-muted)]">Talk to Jarvis about this task — change its direction, ask what it found, or give it guidance for its next step. Nothing is recreated.</p>
      {initial === null ? <Skeleton /> : <MessageList messages={messages} tasks={q.data?.tasks ?? []} onOpen={onOpen} thinking={thinking} />}
      <Notice text={err} onDismiss={() => setErr(null)} />
      <div className="q-cmd" data-armed={text.trim() ? "true" : undefined}>
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Tell Jarvis about “${task.title.slice(0, 40)}”…`}
          aria-label="Message about this task"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="q-btn q-btn-primary h-8" disabled={!text.trim() || thinking} onClick={send}>
          <Icon.Send width={12} height={12} aria-hidden /> Send
        </button>
      </div>
    </div>
  );
}
