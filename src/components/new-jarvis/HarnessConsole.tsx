"use client";

// ---------------------------------------------------------------------------
// The Harness tab: a coding agent you talk to from here.
//
// Every other harness puts its permission prompt in the terminal it is running
// in, which is answerable only because you are already there. The invention in
// this surface is that the prompt travels: a gate arrives carrying the PATCH it
// wants to apply, built from the tool's own arguments, and you approve the
// change rather than the tool's name. That is the one thing to look at here.
//
// The second idea is the Workbench. A thread is not a chat, it is a branch
// with a pile of changes growing in it, so the right-hand column counts that
// pile while the agent works and holds the one action that moves it anywhere.
// Nothing lands by itself, and landing refuses out loud when your own checkout
// has work in it.
//
// Chrome is greyscale, as everywhere on this surface. The only colour is
// state: amber is a gate waiting on you, green is a change that happened, red
// is a refusal or a failure. Motion is the same step-settle the block console
// uses, so a harness turn and a Jarvis block read as the same kind of record.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "../icons";
import { useHarness } from "@/lib/new-jarvis/harness/useHarness";
import { countActions } from "@/lib/new-jarvis/harness/model";
import type {
  GateCard, HarnessChoice, HarnessId, ThreadSummary, ToolRow, Turn, WorkSummary,
} from "@/lib/new-jarvis/harness/types";

const money = (usd: number) => (usd >= 0.01 ? `$${usd.toFixed(2)}` : usd > 0 ? `$${usd.toFixed(4)}` : "");

/** mm:ss for a thread, because a harness turn is minutes, not milliseconds. */
function since(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Picking a harness
// ---------------------------------------------------------------------------

function StartPanel({
  choices,
  working,
  onStart,
  initial,
}: {
  choices: HarnessChoice[];
  working: string;
  onStart: (opts: { harness: HarnessId; title: string; strict: boolean }) => void;
  /** The one picked in Chat's switch, used when it is available. */
  initial?: HarnessId;
}) {
  const usable = choices.filter((c) => c.available);
  const [harness, setHarness] = useState<HarnessId>(
    usable.some((c) => c.id === initial) ? initial! : usable[0]?.id ?? initial ?? "claude",
  );
  const [title, setTitle] = useState("");
  const [strict, setStrict] = useState(false);

  useEffect(() => {
    if (usable.length && !usable.some((c) => c.id === harness)) setHarness(usable[0].id);
  }, [usable, harness]);

  const picked = choices.find((c) => c.id === harness);

  return (
    <div className="mx-auto max-w-2xl p-3">
      <h2 className="text-sm font-medium text-ink">Start a harness thread</h2>
      <p className="mt-1 text-xs text-ink-muted">
        A coding agent, working in its own git worktree cut from this repo. Every edit and every
        command asks you first. Your own checkout is never touched.
      </p>

      <div className="mt-3 space-y-1.5">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={!c.available}
            onClick={() => setHarness(c.id)}
            aria-pressed={harness === c.id}
            className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition disabled:cursor-not-allowed ${
              harness === c.id && c.available
                ? "border-brand/50 bg-brand/[0.07]"
                : "border-line bg-panel hover:bg-elevated disabled:hover:bg-panel"
            } ${c.available ? "" : "opacity-55"}`}
          >
            <Icon.Bot
              width={15}
              height={15}
              className={`mt-0.5 shrink-0 ${harness === c.id && c.available ? "text-brand" : "text-ink-muted"}`}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">{c.label}</span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
                {c.available ? c.blurb : c.why}
              </span>
            </span>
          </button>
        ))}
        {choices.length === 0 && (
          <p className="rounded-lg border border-line bg-panel px-3 py-2.5 text-xs text-ink-muted">
            The local agent is not reporting any harness. Start it on this PC, then refresh.
          </p>
        )}
      </div>

      <label className="mt-3 block">
        <span className="text-[11px] uppercase tracking-wide text-ink-muted">What is it for</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. fix the calendar timezone"
          className="mt-1 w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 font-mono text-[12.5px] text-ink outline-none placeholder:text-ink-muted"
        />
        <span className="mt-1 block text-[10.5px] text-ink-muted">
          Names the branch and the worktree folder. Nothing else reads it.
        </span>
      </label>

      {harness === "claude" && (
        <label className="mt-2.5 flex items-start gap-2">
          <input
            type="checkbox"
            checked={strict}
            onChange={(e) => setStrict(e.target.checked)}
            className="mt-0.5 accent-[var(--color-brand)]"
          />
          <span className="text-[11.5px] leading-relaxed text-ink-muted">
            <span className="text-ink">Ask about reads too.</span> Off, it opens and searches files
            freely and asks before it changes anything. On, every file it looks at is a tap — honest,
            and tiring enough that you stop reading the gates that matter.
          </span>
        </label>
      )}

      <button
        type="button"
        disabled={!picked?.available || Boolean(working)}
        onClick={() => onStart({ harness, title: title.trim(), strict })}
        className="mt-3 w-full rounded-md bg-brand-2 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-[var(--nj-brand-press)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {working || `Start a ${picked?.label ?? "harness"} thread`}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The gate — the thing this whole tab exists for
// ---------------------------------------------------------------------------

function Patch({ text }: { text: string }) {
  return (
    <div className="nj-mono max-h-56 overflow-auto rounded-md border border-line-soft bg-canvas py-1 font-mono text-[11px] leading-relaxed">
      {text.split("\n").map((line, i) => {
        const tone = line.startsWith("+++") || line.startsWith("---")
          ? "text-ink-muted"
          : line.startsWith("@@")
            ? "text-brand"
            : line.startsWith("+")
              ? "text-core bg-core/8"
              : line.startsWith("-")
                ? "text-[#f87171] bg-[#ef4444]/8"
                : "text-ink-muted";
        return (
          <div key={i} className={`whitespace-pre-wrap break-words px-2.5 ${tone}`}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

function GatePanel({ gate, onAnswer }: { gate: GateCard; onAnswer: (allow: boolean) => void }) {
  // Focus the refusal. The default action on something that cannot be undone
  // should be the one that changes nothing — and on a page, Enter is a reflex.
  const [no, setNo] = useState<HTMLButtonElement | null>(null);
  useEffect(() => no?.focus(), [no]);

  const grave = gate.risk === "grave";

  return (
    <div
      className={`nj-step rounded-lg border px-3 py-3 ${
        grave ? "border-[#ef4444]/55 bg-[#ef4444]/[0.07]" : "border-[#f59e0b]/50 bg-[#f59e0b]/[0.07]"
      }`}
      role="group"
      aria-label="Waiting for your approval"
    >
      <p className="flex items-start gap-2">
        <Icon.Shield
          width={15}
          height={15}
          className={`mt-0.5 shrink-0 ${grave ? "text-[#f87171]" : "text-[#f59e0b]"}`}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="block break-words font-mono text-[12.5px] text-ink">{gate.title}</span>
          {gate.why && <span className="mt-0.5 block text-[11.5px] text-ink-muted">{gate.why}</span>}
        </span>
      </p>

      {gate.patch ? (
        <div className="mt-2.5">
          <p className="mb-1 text-[10.5px] uppercase tracking-wide text-ink-muted">
            The change it wants to make
          </p>
          <Patch text={gate.patch} />
        </div>
      ) : gate.command ? (
        <pre className="nj-mono mt-2.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line-soft bg-canvas px-2.5 py-2 font-mono text-[11.5px] text-ink">
          {gate.command}
        </pre>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAnswer(true)}
          className="rounded-md bg-brand-2 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--nj-brand-press)]"
        >
          {gate.patch ? "Apply it" : "Run it"}
        </button>
        <button
          ref={setNo}
          type="button"
          onClick={() => onAnswer(false)}
          className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-elevated hover:text-ink"
        >
          No
        </button>
        <span className="self-center text-[10.5px] text-ink-muted">
          It is stopped here until you answer.
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A turn
// ---------------------------------------------------------------------------

const DOT: Record<ToolRow["status"], string> = {
  running: "",
  ok: "bg-core",
  failed: "bg-[#ef4444]",
  refused: "bg-[#f59e0b]",
  escalating: "bg-[#f59e0b]",
};

function ToolLine({ row }: { row: ToolRow }) {
  const [open, setOpen] = useState(false);
  const hasOutput = Boolean(row.output);

  return (
    <li className="nj-step">
      <div className="flex items-start gap-2 py-0.5">
        <span className="flex h-[18px] w-[14px] items-center justify-center" aria-hidden>
          {row.status === "running" ? (
            <span className="nj-pending" />
          ) : (
            <span className={`nj-dot ${DOT[row.status]}`} />
          )}
        </span>
        <button
          type="button"
          onClick={() => hasOutput && setOpen((v) => !v)}
          aria-expanded={hasOutput ? open : undefined}
          className={`min-w-0 flex-1 text-left font-mono text-[11.5px] leading-[18px] ${
            row.status === "refused"
              ? "text-[#f59e0b]"
              : row.status === "failed"
                ? "text-[#f87171]"
                : "text-ink-muted"
          } ${hasOutput ? "hover:text-ink" : "cursor-default"}`}
        >
          <span className="break-words">{row.title}</span>
          {row.status === "refused" && <span className="ml-1.5 text-[10.5px]">— you said no</span>}
          {row.status === "escalating" && (
            <span className="ml-1.5 text-[10.5px]">— asking to leave the sandbox</span>
          )}
        </button>
      </div>
      {open && hasOutput && (
        <pre className="nj-mono ml-[22px] mb-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line-soft bg-canvas px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-ink-muted">
          {row.output.slice(0, 8_000)}
        </pre>
      )}
    </li>
  );
}

function TurnView({ turn, now }: { turn: Turn; now: number }) {
  const [showThinking, setShowThinking] = useState(false);
  const live = turn.status === "running" || turn.status === "waiting";

  return (
    <article className="nj-block px-3 py-2.5" data-status={turn.status === "waiting" ? "waiting" : turn.status === "failed" ? "failed" : live ? "running" : "done"}>
      {turn.prompt && (
        <p className="mb-2 flex items-start gap-2">
          <Icon.ArrowRight width={13} height={13} className="mt-[3px] shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-ink">
            {turn.prompt}
          </span>
        </p>
      )}

      {turn.notes.map((note, i) => (
        <p key={i} className="mb-1.5 text-[11px] leading-relaxed text-ink-muted">{note}</p>
      ))}

      {turn.plan.length > 0 && (
        <ol className="mb-2 space-y-0.5 rounded-md border border-line-soft bg-canvas px-2.5 py-1.5">
          {turn.plan.map((p, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11.5px] text-ink-muted">
              <span className="mt-[2px] shrink-0 text-[10px]" aria-hidden>
                {p.status === "completed" ? "✓" : p.status === "in_progress" ? "▸" : "·"}
              </span>
              <span className={p.status === "completed" ? "line-through opacity-60" : ""}>{p.text}</span>
            </li>
          ))}
        </ol>
      )}

      {turn.thinking && (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setShowThinking((v) => !v)}
            aria-expanded={showThinking}
            className="text-[10.5px] uppercase tracking-wide text-ink-muted transition hover:text-ink"
          >
            {showThinking ? "Hide" : "Show"} its reasoning
          </button>
          {showThinking && (
            <p className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line-soft bg-canvas px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-ink-muted">
              {turn.thinking}
            </p>
          )}
        </div>
      )}

      {turn.tools.length > 0 && (
        <ul className="nj-ledger mb-2 space-y-0">
          {turn.tools.map((row) => (
            <ToolLine key={row.callId || row.title} row={row} />
          ))}
        </ul>
      )}

      {/* Gates that have been answered stay as a record. The live one is drawn
          above the composer instead, so it is always within reach of a thumb
          on a long transcript. */}
      {turn.gates
        .filter((g) => g.answered)
        .map((g) => (
          <p key={g.gateId} className="mb-1.5 flex items-start gap-2 text-[11px]">
            <Icon.Shield
              width={12}
              height={12}
              className={`mt-[2px] shrink-0 ${g.allowed ? "text-core" : "text-[#f59e0b]"}`}
              aria-hidden
            />
            <span className="min-w-0 break-words text-ink-muted">
              {g.allowed ? "You approved" : g.how === "timeout" ? "Timed out waiting on" : "You refused"}{" "}
              <span className="font-mono text-ink">{g.title}</span>
            </span>
          </p>
        ))}

      {turn.text && (
        <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink">
          {turn.text}
          {live && <span className="nj-caret" aria-hidden />}
        </div>
      )}

      {turn.error && (
        <p className="mt-1.5 break-words rounded-md border border-[#ef4444]/40 bg-[#ef4444]/[0.07] px-2.5 py-1.5 font-mono text-[11.5px] text-[#f87171]">
          {turn.error}
        </p>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-ink-muted" data-num>
        <span>{live ? since(turn.at, now) : turn.ms ? `${(turn.ms / 1000).toFixed(1)}s` : ""}</span>
        {turn.usd > 0 && <span>{money(turn.usd)}</span>}
        {turn.tools.length > 0 && (
          <span>
            {turn.tools.length} step{turn.tools.length === 1 ? "" : "s"}
          </span>
        )}
      </p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// The Workbench — the pile of changes, and the one way out of it
// ---------------------------------------------------------------------------

function Workbench({
  thread,
  work,
  diff,
  diffTruncated,
  working,
  onLoadDiff,
  onLand,
  onDiscard,
}: {
  thread: ThreadSummary;
  work: WorkSummary | null;
  diff: string;
  diffTruncated: boolean;
  working: string;
  onLoadDiff: () => void;
  onLand: (opts: { message: string; merge: boolean }) => void;
  onDiscard: () => void;
}) {
  const [message, setMessage] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const files = work?.files ?? [];

  return (
    <aside className="space-y-2.5 text-[11.5px]">
      <div className="rounded-lg border border-line bg-panel">
        <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
          <Icon.Layers width={12} height={12} className="shrink-0 text-ink-muted" aria-hidden />
          <span className="truncate font-mono text-[11px] text-ink">{thread.worktree.branch}</span>
        </div>
        <div className="px-2.5 py-2">
          <p className="text-[10.5px] leading-relaxed text-ink-muted">
            Cut from <span className="font-mono text-ink">{thread.worktree.base}</span>. Your own
            checkout is untouched until you land this.
          </p>
          <p className="mt-1.5 flex items-center gap-3 text-[11px]" data-num>
            <span className="text-core">+{work?.added ?? 0}</span>
            <span className="text-[#f87171]">−{work?.removed ?? 0}</span>
            <span className="text-ink-muted">
              {files.length} file{files.length === 1 ? "" : "s"}
            </span>
          </p>
        </div>

        {files.length > 0 && (
          <ul className="max-h-40 overflow-auto border-t border-line-soft px-2.5 py-1.5">
            {files.map((f) => (
              <li key={f.file} className="flex items-baseline gap-2 py-[1px]">
                <span
                  className={`w-4 shrink-0 font-mono text-[10px] ${
                    f.state === "??" ? "text-core" : f.state.includes("D") ? "text-[#f87171]" : "text-brand"
                  }`}
                >
                  {f.state === "??" ? "new" : f.state}
                </span>
                <span className="min-w-0 break-all font-mono text-[10.5px] text-ink-muted">{f.file}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={onLoadDiff}
        disabled={Boolean(working)}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[11.5px] text-ink-muted transition hover:bg-elevated hover:text-ink disabled:opacity-40"
      >
        <Icon.Eye width={12} height={12} aria-hidden />
        {diff ? "Re-read the patch" : "Read the whole patch"}
      </button>

      {diff && (
        <div>
          <Patch text={diff} />
          {diffTruncated && (
            <p className="mt-1 text-[10.5px] text-ink-muted">
              Cut off — the patch is bigger than this panel will honestly show. Open the worktree to
              read the rest.
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-line bg-panel px-2.5 py-2">
        <p className="text-[10.5px] uppercase tracking-wide text-ink-muted">Land it</p>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={thread.title}
          aria-label="Commit message"
          className="mt-1 w-full rounded-md border border-line bg-canvas px-2 py-1 font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-muted"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={Boolean(working) || !work?.dirty}
            onClick={() => onLand({ message: message.trim() || thread.title, merge: false })}
            className="rounded-md border border-line px-2.5 py-1 text-[11.5px] text-ink-muted transition hover:bg-elevated hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Commit only
          </button>
          <button
            type="button"
            disabled={Boolean(working) || !work?.dirty}
            onClick={() => onLand({ message: message.trim() || thread.title, merge: true })}
            className="rounded-md bg-brand-2 px-2.5 py-1 text-[11.5px] font-medium text-white transition hover:bg-[var(--nj-brand-press)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Commit and merge
          </button>
        </div>
        {!work?.dirty && (
          <p className="mt-1.5 text-[10.5px] text-ink-muted">Nothing has changed in here yet.</p>
        )}
        {thread.landed && (
          <p className="mt-2 border-t border-line-soft pt-1.5 text-[10.5px] leading-relaxed text-ink-muted">
            <span className="font-mono text-ink">{thread.landed.sha}</span> — {thread.landed.why}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-line bg-panel px-2.5 py-2">
        {confirmDiscard ? (
          <>
            <p className="text-[11px] leading-relaxed text-ink">
              Delete this worktree and its branch? Anything not committed goes with it.
            </p>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={onDiscard}
                disabled={Boolean(working)}
                className="rounded-md bg-[#ef4444] px-2.5 py-1 text-[11.5px] font-medium text-white transition hover:bg-[#dc2626] disabled:opacity-40"
              >
                {working || "Delete it"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="rounded-md border border-line px-2.5 py-1 text-[11.5px] text-ink-muted transition hover:bg-elevated hover:text-ink"
              >
                Keep it
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDiscard(true)}
            className="text-[11.5px] text-ink-muted transition hover:text-ink"
          >
            Throw this thread away
          </button>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export function HarnessConsole({ paired, initialHarness }: { paired: boolean; initialHarness?: HarnessId }) {
  const h = useHarness({ paired });
  const [input, setInput] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const bottom = useRef<HTMLDivElement | null>(null);

  // One ticking clock for the whole tab. A timer per live turn is how a long
  // transcript becomes a page that re-renders forty times a second.
  useEffect(() => {
    if (!h.thread || h.thread.status === "ended" || h.thread.status === "idle") return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [h.thread]);

  const lastTurn = h.view.turns.length;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [lastTurn]);

  const counts = useMemo(() => countActions(h.view), [h.view]);

  if (!paired) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <Icon.Server width={20} height={20} className="mx-auto text-ink-muted" aria-hidden />
        <p className="mt-2 text-sm text-ink">A harness runs on your PC, not in the cloud.</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          Pair Jarvis with the local agent in Settings, and this tab can start one, hold its
          gates and land its work.
        </p>
      </div>
    );
  }

  if (!h.thread) {
    return (
      <div>
        <StartPanel key={initialHarness} choices={h.choices} working={h.working} onStart={(o) => void h.start(o)} initial={initialHarness} />
        {h.threads.length > 0 && (
          <div className="mx-auto max-w-2xl px-3 pb-4">
            <p className="mb-1.5 text-[10.5px] uppercase tracking-wide text-ink-muted">
              Still running on this PC
            </p>
            <ul className="space-y-1">
              {h.threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => h.open(t.id)}
                    className="flex w-full items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-left transition hover:bg-elevated"
                  >
                    <span className={`nj-dot ${t.status === "ended" ? "bg-line" : "bg-brand"}`} data-live={t.status === "thinking"} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{t.title}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-ink-muted">{t.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {h.error && <p className="mx-auto max-w-2xl px-3 pb-4 text-xs text-[#f87171]">{h.error}</p>}
      </div>
    );
  }

  const t = h.thread;
  const thinking = t.status === "thinking" || t.status === "starting";

  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_288px]">
      <div className="min-w-0">
        {/* --- the head ---------------------------------------------------- */}
        <div className="sticky top-0 z-10 -mx-3 mb-2 border-b border-line bg-canvas/95 px-3 pb-2 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5">
              <span
                className={`nj-dot ${
                  t.status === "waiting" ? "bg-[#f59e0b]" : t.status === "ended" ? "bg-line" : "bg-brand"
                }`}
                data-live={thinking}
                aria-hidden
              />
              <span className="text-[12.5px] font-medium text-ink">{t.title}</span>
            </span>
            <span className="font-mono text-[10.5px] text-ink-muted">
              {t.label}
              {t.model ? ` · ${t.model}` : ""}
            </span>
            {t.strict && (
              <span className="flex items-center gap-1 text-[10.5px] text-ink-muted">
                <Icon.Lock width={10} height={10} aria-hidden />
                reads ask too
              </span>
            )}
            <span className="ml-auto flex items-center gap-2">
              {h.view.usd > 0 && (
                <span className="font-mono text-[10.5px] text-ink-muted" data-num>
                  {money(h.view.usd)}
                </span>
              )}
              {h.view.size > 0 && (
                <span className="font-mono text-[10.5px] text-ink-muted" data-num>
                  {Math.round((h.view.used / h.view.size) * 100)}% ctx
                </span>
              )}
              {thinking && (
                <button
                  type="button"
                  onClick={() => void h.interrupt()}
                  className="rounded-md border border-line px-2 py-0.5 text-[10.5px] text-ink-muted transition hover:bg-elevated hover:text-ink"
                >
                  Interrupt
                </button>
              )}
              {t.status !== "ended" && (
                <button
                  type="button"
                  onClick={() => void h.stop()}
                  className="rounded-md border border-line px-2 py-0.5 text-[10.5px] text-ink-muted transition hover:bg-elevated hover:text-ink"
                >
                  End
                </button>
              )}
              <button
                type="button"
                onClick={h.close}
                title="Back to the thread list — this keeps running"
                className="rounded-md p-1 text-ink-muted transition hover:bg-elevated hover:text-ink"
              >
                <Icon.Close width={12} height={12} aria-hidden />
                <span className="sr-only">Close this thread view</span>
              </button>
            </span>
          </div>
          <p className="mt-0.5 text-[10.5px] text-ink-muted" data-num>
            {counts.reads} read{counts.reads === 1 ? "" : "s"} · {counts.changes} change
            {counts.changes === 1 ? "" : "s"}
            {counts.refused > 0 ? ` · ${counts.refused} refused` : ""}
            {h.view.detail ? ` · ${h.view.detail}` : ""}
          </p>
        </div>

        {/* --- the thread -------------------------------------------------- */}
        {h.view.notes.map((note, i) => (
          <p key={i} className="mb-2 rounded-md border border-line-soft bg-panel px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-muted">
            {note}
          </p>
        ))}

        <div className="space-y-2">
          {h.view.turns.map((turn) => (
            <TurnView key={turn.id} turn={turn} now={now} />
          ))}
        </div>

        {h.view.turns.length === 0 && (
          <p className="rounded-lg border border-line bg-panel px-3 py-2.5 text-xs text-ink-muted">
            Ready. Tell it what to do — it can read this repo, change files in its worktree and run
            commands, and it will ask you before each one.
          </p>
        )}

        {h.error && (
          <p className="mt-2 break-words rounded-md border border-[#ef4444]/40 bg-[#ef4444]/[0.07] px-2.5 py-1.5 text-[11.5px] text-[#f87171]">
            {h.error}
          </p>
        )}

        <div ref={bottom} />

        {/* --- the gate, then the composer, both pinned -------------------- */}
        <div className="sticky bottom-0 -mx-3 mt-2 space-y-2 border-t border-line bg-canvas/95 px-3 pb-1 pt-2 backdrop-blur">
          {h.gate && <GatePanel gate={h.gate} onAnswer={(allow) => void h.decide(h.gate!.gateId, allow)} />}

          <div className="flex items-end gap-2 rounded-lg border border-line bg-panel px-2.5 py-2">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const text = input.trim();
                  if (!text || t.status === "ended") return;
                  setInput("");
                  void h.say(text);
                }
              }}
              placeholder={
                t.status === "ended"
                  ? "This thread has ended."
                  : h.gate
                    ? "Answer the gate above, or add to what it should do…"
                    : "What should it do next?"
              }
              disabled={t.status === "ended"}
              aria-label="Tell the harness what to do"
              className="min-h-[22px] max-h-40 min-w-0 flex-1 resize-y bg-transparent font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-muted disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => {
                const text = input.trim();
                if (!text) return;
                setInput("");
                void h.say(text);
              }}
              disabled={!input.trim() || t.status === "ended"}
              className="shrink-0 rounded-md p-1.5 text-ink-muted transition hover:bg-elevated hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
            >
              {thinking ? (
                <Icon.Refresh width={14} height={14} className="animate-spin [animation-duration:1.4s]" />
              ) : (
                <Icon.Send width={14} height={14} />
              )}
              <span className="sr-only">Send</span>
            </button>
          </div>
        </div>
      </div>

      <Workbench
        thread={t}
        work={h.work}
        diff={h.diff}
        diffTruncated={h.diffTruncated}
        working={h.working}
        onLoadDiff={() => void h.loadDiff()}
        onLand={(o) => void h.land(o)}
        onDiscard={() => void h.discard()}
      />
    </div>
  );
}
