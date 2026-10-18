"use client";

// ---------------------------------------------------------------------------
// One block, and everything inside it.
//
// The block is the surface's whole argument: a request, the numbered steps it
// took, and what each step actually returned, kept on screen instead of being
// flattened into a sentence. So the result of a step is RENDERED — a shell
// command shows its output as output, a folder listing shows as a table, a
// screenshot shows as a picture — rather than printed as JSON. A run you have
// to decode is a run you stop reading, and then the ledger has bought nothing.
// ---------------------------------------------------------------------------

import { modelLabel } from "@/lib/new-jarvis/chatModels";
import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { Markdown } from "../jarvis/Markdown";
import type { Block, Gate, Step } from "@/lib/new-jarvis/types";
import { elapsed } from "@/lib/new-jarvis/types";

const ms = (n: number | undefined) => (n === undefined ? "" : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);

function StatusDot({ status }: { status: Step["status"] | Block["status"] }) {
  const colour =
    status === "ok" || status === "done"
      ? "bg-core"
      : status === "failed"
        ? "bg-[#ef4444]"
        : status === "refused" || status === "stopped"
          ? "bg-ink-faint"
          : status === "waiting"
            ? "bg-[#f59e0b]"
            : "bg-brand";
  const live = status === "running";
  return <span className={`nj-dot ${colour}`} data-live={live} aria-hidden />;
}

// --- results --------------------------------------------------------------

function Mono({ text, tone = "ink" }: { text: string; tone?: "ink" | "muted" | "bad" }) {
  const colour = tone === "bad" ? "text-[#f87171]" : tone === "muted" ? "text-ink-muted" : "text-ink";
  return (
    <pre
      className={`nj-mono max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line-soft bg-canvas px-3 py-2 font-mono text-[11.5px] leading-relaxed ${colour}`}
    >
      {text}
    </pre>
  );
}

/** Does this output want reading as a diff rather than as a wall of grey? */
export function looksLikeDiff(text: string): boolean {
  const lines = text.split("\n").slice(0, 60);
  if (lines.some((l) => l.startsWith("@@ ") || l.startsWith("diff --git "))) return true;
  const marked = lines.filter((l) => /^[+-]/.test(l)).length;
  return marked >= 3 && marked / Math.max(1, lines.length) > 0.25;
}

/**
 * A diff, coloured per line.
 *
 * `git diff` is a command this surface allows without a gate, so diffs arrive
 * often. Printed as one undifferentiated grey block, the one thing the owner
 * opened it to see — what changed — is the thing they then have to find.
 */
function Diff({ text }: { text: string }) {
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-line-soft bg-canvas py-1 font-mono text-[11.5px] leading-relaxed">
      {text.split("\n").map((line, i) => {
        const tone = line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")
          ? "text-ink-muted"
          : line.startsWith("@@")
            ? "text-brand"
            : line.startsWith("+")
              ? "text-core bg-core/8"
              : line.startsWith("-")
                ? "text-[#f87171] bg-[#ef4444]/8"
                : "text-ink-muted";
        return (
          <div key={i} className={`whitespace-pre-wrap break-words px-3 ${tone}`}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

/** The page, framed as a page: its address above what it said. */
function PageFrame({ url, title, text, controls }: { url: string; title: string; text: string; controls: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-line-soft">
      <div className="flex items-center gap-2 border-b border-line-soft bg-panel-2 px-2.5 py-1.5">
        <Icon.Globe width={11} height={11} className="shrink-0 text-ink-muted" aria-hidden />
        <span className="truncate font-mono text-[11px] text-ink-muted">{url}</span>
        {title && <span className="ml-auto shrink-0 truncate text-[10.5px] text-ink-muted">{title}</span>}
      </div>
      <pre className="nj-mono max-h-64 overflow-auto whitespace-pre-wrap break-words bg-canvas px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink-muted">
        {text || "The page had no readable text."}
      </pre>
      <p className="border-t border-line-soft bg-panel-2 px-2.5 py-1 text-[10.5px] text-ink-muted" data-num>
        {controls} control{controls === 1 ? "" : "s"} it can reach
      </p>
    </div>
  );
}

function KeyRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 border-b border-line-soft py-1 last:border-0">
      <span className="w-24 shrink-0 font-mono text-[11px] text-ink-muted">{k}</span>
      <span className="min-w-0 break-words font-mono text-[11.5px] text-ink-muted" data-num>
        {v}
      </span>
    </div>
  );
}

function ResultView({ step }: { step: Step }) {
  const r = (step.result ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");

  if (step.status === "refused") {
    return <p className="px-3 py-2 text-xs text-ink-muted">You said no, so nothing ran.</p>;
  }
  if (step.status === "failed") {
    return <Mono text={step.error ?? "It failed."} tone="bad" />;
  }
  if (step.status !== "ok") return null;

  if (r.pngDropped === true) {
    return (
      <p className="px-3 py-2 text-xs text-ink-muted">
        The picture was taken, and was not kept when this block was saved.
      </p>
    );
  }

  // A picture, of the screen or of a page.
  if (typeof r.png === "string") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`data:image/png;base64,${r.png}`}
        alt={step.tool === "system_screenshot" ? "The screen" : `The page at ${s("url")}`}
        className="w-full rounded-md border border-line-soft"
      />
    );
  }

  if (step.tool === "shell_run") {
    const out = s("stdout").trim();
    const err = s("stderr").trim();
    const code = r.exitCode;
    return (
      <div className="space-y-2">
        {out && (looksLikeDiff(out) ? <Diff text={out} /> : <Mono text={out} />)}
        {err && <Mono text={err} tone="bad" />}
        {!out && !err && <p className="px-3 py-2 text-xs text-ink-muted">It printed nothing.</p>}
        <p className="px-1 text-[11px] text-ink-muted" data-num>
          {r.timedOut ? "Timed out and was stopped." : `Exit ${code === null ? "?" : String(code)}`}
          {typeof r.ms === "number" ? ` · ${ms(r.ms)}` : ""}
          {r.truncated ? " · output truncated" : ""}
        </p>
      </div>
    );
  }

  if (step.tool === "browser_read") {
    const els = Array.isArray(r.elements) ? (r.elements as Record<string, unknown>[]) : [];
    return <PageFrame url={s("url")} title={s("title")} text={s("text")} controls={els.length} />;
  }

  if (step.tool === "page_fields") {
    const fields = Array.isArray(r.fields) ? (r.fields as Record<string, unknown>[]) : [];
    return (
      <div className="space-y-2">
        <div className="max-h-72 overflow-auto rounded-md border border-line-soft">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-panel-2">
              <tr className="text-[10px] uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-1.5 font-medium">Field</th>
                <th className="px-3 py-1.5 font-medium">On the page</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[11.5px]">
              {fields.map((f, i) => (
                <tr key={i} className="border-t border-line-soft">
                  <td className="px-3 py-1 text-ink">
                    {String(f.label || f.key)}
                    {f.secret ? <span className="ml-1.5 text-[10px] text-ink-muted">secret</span> : null}
                  </td>
                  <td className="px-3 py-1 text-ink-muted" data-num>
                    {f.filled ? String(f.preview) : <span className="text-ink-faint">empty</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {fields.length === 0 && <p className="px-3 py-2 text-xs text-ink-muted">No form fields on that page.</p>}
        </div>
        {/* The whole reason this renderer exists: the owner has to be able to
            see that the values stayed here. */}
        <p className="px-1 text-[11px] leading-relaxed text-ink-muted">
          Values are held in this browser only — shown masked here, and never sent to the model. It can name a field
          to save; it cannot read one.
        </p>
      </div>
    );
  }

  if (step.tool === "record_capture") {
    const saved = Array.isArray(r.saved) ? (r.saved as string[]) : [];
    const skipped = Array.isArray(r.skipped) ? (r.skipped as string[]) : [];
    return (
      <div className="rounded-md border border-line-soft px-3 py-2">
        <p className="text-xs text-ink">
          Saved to your Life Record: <span className="font-mono text-core">{saved.join(", ") || "nothing"}</span>
        </p>
        {skipped.length > 0 && (
          <p className="mt-1 text-[11px] text-ink-muted">Left alone: {skipped.join(", ")}</p>
        )}
        <p className="mt-1 text-[11px] text-ink-muted">Written here on your PC. The values were not sent anywhere.</p>
      </div>
    );
  }

  if (step.tool === "files_list") {
    const entries = Array.isArray(r.entries) ? (r.entries as Record<string, unknown>[]) : [];
    return (
      <div className="max-h-72 overflow-auto rounded-md border border-line-soft">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-panel-2">
            <tr className="text-[10px] uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-1.5 font-medium">Name</th>
              <th className="whitespace-nowrap px-3 py-1.5 font-medium">Size</th>
              <th className="hidden whitespace-nowrap px-3 py-1.5 font-medium sm:table-cell">Changed</th>
            </tr>
          </thead>
          <tbody className="font-mono text-[11.5px]">
            {entries.map((e, i) => (
              <tr key={i} className="border-t border-line-soft">
                <td className="px-3 py-1 text-ink">
                  {e.dir ? <span className="text-ink-faint">/</span> : null}
                  {String(e.name)}
                </td>
                <td className="whitespace-nowrap px-3 py-1 text-ink-muted" data-num>
                  {typeof e.size === "number" ? e.size.toLocaleString() : "—"}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-1 text-ink-muted sm:table-cell" data-num>
                  {typeof e.modified === "string" ? e.modified.slice(0, 10) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && <p className="px-3 py-2 text-xs text-ink-muted">That folder is empty.</p>}
      </div>
    );
  }

  if (step.tool === "files_read") {
    return (
      <div className="space-y-2">
        <p className="truncate px-1 font-mono text-[11px] text-ink-muted">{s("path")}</p>
        <Mono text={s("text")} />
      </div>
    );
  }

  if (step.tool === "system_windows") {
    const ws = Array.isArray(r.windows) ? (r.windows as Record<string, unknown>[]) : [];
    return (
      <div className="max-h-72 overflow-auto rounded-md border border-line-soft">
        <table className="w-full border-collapse text-left font-mono text-[11.5px]">
          <tbody>
            {ws.map((w, i) => (
              <tr key={i} className="border-b border-line-soft last:border-0">
                <td className="px-3 py-1 text-ink-muted" data-num>{String(w.pid)}</td>
                <td className="px-3 py-1 text-ink-muted">{String(w.process)}</td>
                <td className="px-3 py-1 text-ink">{String(w.title)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Everything else: the fields that matter, as a table rather than JSON.
  const rows = Object.entries(r).filter(
    ([k, v]) => k !== "ok" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"),
  );
  if (!rows.length) return <p className="px-3 py-2 text-xs text-ink-muted">Done.</p>;
  return (
    <div className="rounded-md border border-line-soft px-3 py-1">
      {rows.map(([k, v]) => (
        <KeyRow key={k} k={k} v={String(v)} />
      ))}
    </div>
  );
}

// --- steps ----------------------------------------------------------------

function StepRow({ step, autoOpen }: { step: Step; autoOpen: boolean }) {
  // Opening the last result automatically is the difference between the
  // composition's promise — the result inline, at full size — and a row you
  // have to go and click. Once the owner touches a row, their choice wins and
  // the surface stops deciding for them.
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const hasResult = step.status === "ok" || step.status === "failed";
  const shown = hasResult && (touched ? open : autoOpen);

  return (
    <li className="nj-step relative pl-6">
      <span className="absolute left-[6px] top-[7px] rounded-full bg-panel p-[1px]">
        <StatusDot status={step.status} />
      </span>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px] text-ink-muted" data-num>
          {step.n}
        </span>
        <button
          type="button"
          onClick={() => {
            if (!hasResult) return;
            setTouched(true);
            setOpen(!shown);
          }}
          disabled={!hasResult}
          className={`min-w-0 flex-1 text-left text-xs ${
            step.status === "refused" ? "text-ink-muted line-through" : "text-ink-muted"
          } ${hasResult ? "hover:text-ink" : "cursor-default"}`}
        >
          {step.summary}
        </button>
        {step.by === "jev" && (
          <span className="shrink-0 rounded px-1 font-mono text-[10px] text-[#c3f584]" title="Jev picked this click in under a second — no chat model needed">
            ⚡ Jev
          </span>
        )}
        {step.rerouted && (
          <span className="shrink-0 rounded px-1 font-mono text-[10px] text-fuchsia-300" title={`Claude declined explicit content, so ${step.rerouted} did this step`}>
            {step.rerouted.split("/").pop()?.split("-").slice(0, 2).join(" ")}
          </span>
        )}
        {step.ms !== undefined && (
          <span className="shrink-0 font-mono text-[10.5px] text-ink-muted" data-num>
            {ms(step.ms)}
          </span>
        )}
        {hasResult && (
          <Icon.Chevron
            width={11}
            height={11}
            className={`shrink-0 text-ink-muted transition-transform ${shown ? "rotate-90" : ""}`}
            aria-hidden
          />
        )}
      </div>
      {shown && (
        <div className="mt-1.5 mb-1">
          <ResultView step={step} />
        </div>
      )}
      {step.status === "failed" && !shown && (
        <p className="mt-0.5 text-[11px] text-[#f87171]">{step.error}</p>
      )}
    </li>
  );
}

// --- the gate -------------------------------------------------------------

function GateCard({ gate, onAnswer }: { gate: Gate; onAnswer: (yes: boolean) => void }) {
  // Focus the refusal, not the approval: the default action on a gate for
  // something that cannot be undone should be the one that changes nothing.
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  useEffect(() => el?.focus(), [el]);

  return (
    <div className="border-t border-[#f59e0b]/45 bg-[#f59e0b]/[0.06] px-3 py-3">
      <p className="flex items-start gap-2 text-sm text-ink">
        <Icon.Shield width={15} height={15} className="mt-0.5 shrink-0 text-[#f59e0b]" aria-hidden />
        <span>{gate.summary}</span>
      </p>
      {gate.why && <p className="mt-1 pl-[23px] text-xs text-ink-muted">{gate.why}</p>}
      <div className="mt-3 flex gap-2 pl-[23px]">
        <button
          type="button"
          onClick={() => onAnswer(true)}
          className="rounded-md bg-brand-2 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--nj-brand-press)]"
        >
          Do it
        </button>
        <button
          ref={setEl}
          type="button"
          onClick={() => onAnswer(false)}
          className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-elevated hover:text-ink"
        >
          No
        </button>
      </div>
    </div>
  );
}

// --- the block ------------------------------------------------------------

export function BlockView({
  block,
  onAnswerGate,
  onRerun,
  onStop,
  onToggle,
}: {
  block: Block;
  onAnswerGate: (yes: boolean) => void;
  onRerun: () => void;
  onStop: () => void;
  onToggle: () => void;
}) {
  // Elapsed time ticks while it runs, and stops the moment it does.
  const [, tick] = useState(0);
  useEffect(() => {
    if (block.status !== "running" && block.status !== "waiting") return;
    const t = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [block.status]);

  const live = block.status === "running" || block.status === "waiting";
  // Only once the block has settled: opening each result as it lands would
  // make the ledger jump under the owner while they are reading it.
  const autoOpenId = live
    ? ""
    : [...block.steps].reverse().find((s) => s.status === "ok" || s.status === "failed")?.id ?? "";
  const thinking = block.status === "running" && block.steps.every((s) => s.status !== "running" && s.status !== "waiting");

  return (
    <article className="nj-block" data-status={block.status}>
      <header className="flex items-start gap-2 px-3 py-2">
        <StatusDot status={block.status} />
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
          aria-expanded={!block.collapsed}
        >
          <span className="block break-words font-mono text-[12.5px] leading-snug text-ink">{block.command}</span>
          {block.media?.length ? (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {block.media.map((m, i) => (
                <span key={i} className="relative block h-12 w-12 overflow-hidden rounded border border-line-soft" title={m.name}>
                  <img src={m.thumb} alt={m.name} className="h-full w-full object-cover" />
                  {m.kind !== "image" && (
                    <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-center font-mono text-[8px] uppercase text-ink">{m.kind}</span>
                  )}
                </span>
              ))}
            </span>
          ) : null}
        </button>
        {block.model && (
          <span className="shrink-0 truncate font-mono text-[10px] text-ink-faint" title={block.model}>
            {modelLabel(block.model)}
          </span>
        )}
        <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-ink-muted">{block.mode}</span>
        {block.source === "voice" && <Icon.Mic width={12} height={12} className="shrink-0 text-ink-faint" aria-hidden />}
        <span className="shrink-0 font-mono text-[10.5px] text-ink-muted" data-num>
          {ms(elapsed(block))}
        </span>
        {live ? (
          <button
            type="button"
            onClick={onStop}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] text-ink-muted transition hover:bg-elevated hover:text-ink"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onRerun}
            title="Run it again"
            className="shrink-0 rounded px-1 py-0.5 text-ink-muted transition hover:bg-elevated hover:text-ink"
          >
            <Icon.Refresh width={12} height={12} />
            <span className="sr-only">Run it again</span>
          </button>
        )}
      </header>

      {!block.collapsed && (
        <>
          {block.steps.length > 0 && (
            <ol className="nj-ledger space-y-1.5 border-t border-line-soft px-3 py-2">
              {block.steps.map((s) => (
                <StepRow key={s.id} step={s} autoOpen={s.id === autoOpenId} />
              ))}
              {/* The gap between a finished step and the next one is where a
                  run looks stalled: five done rows, a ticking number, and
                  nothing saying the model is still deciding. */}
              {thinking && (
                <li className="nj-step relative pl-6">
                  <span className="absolute left-[6px] top-[7px] rounded-full bg-panel p-[1px]">
                    <span className="nj-pending" aria-hidden />
                  </span>
                  <span className="text-xs text-ink-muted">Working out the next step…</span>
                </li>
              )}
            </ol>
          )}

          {block.gate && <GateCard gate={block.gate} onAnswer={onAnswerGate} />}

          {block.answer && (
            <div className="border-t border-line-soft px-3 py-2.5 text-[13px] leading-relaxed text-ink">
              {/* The model writes markdown whether or not you ask it to, so
                  rendering it as plain text ships literal ** around the one
                  number the owner actually wanted. */}
              <Markdown text={block.answer} />
            </div>
          )}

          {block.error && (
            <div className="border-t border-line-soft px-3 py-2.5">
              <p className="text-[13px] leading-relaxed text-[#f87171]">{block.error}</p>
            </div>
          )}

          {block.status === "running" && !block.steps.length && !block.answer && (
            <div className="border-t border-line-soft px-3 py-2.5">
              <p className="text-xs text-ink-muted">Working out what to do…</p>
            </div>
          )}
        </>
      )}
    </article>
  );
}
