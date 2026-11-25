"use client";

// What an agent found, rendered by kind — never shown as raw JSON.
//   mt4-bot        ranked table: composite score, four score bars, strategy, flags, verdict, backtest
//   h3-storyboard  shot list (frames are storage keys — listed, not fetched)
//   h3-prompt      the compiled prompt + each variation, each with Copy
//   research-*     notes as a linked list
//   anything else  title, summary, link

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import type { Finding } from "@/lib/queue247/types";
import { findingKindLabel, h3Prompts, mt4Rows, notesOf, relTime, storyboardShots, type Mt4Row } from "@/lib/queue247/view";
import { CopyButton, ScoreBar } from "./parts";

const SEV_INK: Record<string, string> = {
  danger: "text-[var(--q-fail)] border-[color-mix(in_oklab,var(--q-fail-fill)_40%,var(--q-line))]",
  warn: "text-[var(--q-needs)] border-[color-mix(in_oklab,var(--q-needs)_35%,var(--q-line))]",
  info: "text-[var(--q-muted)] border-[var(--q-line)]",
};

export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex min-w-0 items-center gap-1 text-[var(--q-ink)] underline decoration-[var(--q-line)] underline-offset-2 hover:decoration-[var(--q-brand)]">
      <span className="truncate">{children}</span>
      <Icon.Launch width={10} height={10} className="flex-none text-[var(--q-faint)]" aria-hidden />
    </a>
  );
}

export function Mt4Table({ findings }: { findings: Finding[] }) {
  const rows = useMemo(() => mt4Rows(findings), [findings]);
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return null;
  return (
    <div className="q-inset overflow-x-auto">
      <table className="w-full min-w-[580px] border-collapse text-left">
        <thead>
          <tr className="bg-[var(--q-panel-2)] text-[10px] uppercase tracking-[0.06em] text-[var(--q-muted)]">
            <th className="w-8 px-2 py-1.5 font-medium">#</th>
            <th className="px-2 py-1.5 font-medium">Bot</th>
            <th className="w-[76px] px-2 py-1.5 font-medium">Score</th>
            <th className="w-[76px] px-2 py-1.5 font-medium">Quality</th>
            <th className="w-[76px] px-2 py-1.5 font-medium">Reliability</th>
            <th className="w-[76px] px-2 py-1.5 font-medium" title="Higher is safer">Risk</th>
            <th className="w-[76px] px-2 py-1.5 font-medium">Strategy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <Mt4Line key={r.id} r={r} rank={i + 1} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Mt4Line({ r, rank, open, onToggle }: { r: Mt4Row; rank: number; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-t border-[var(--q-line-soft)] align-top">
        <td className="px-2 py-2 text-[11px] text-[var(--q-faint)]" data-num>
          {rank}
        </td>
        <td className="px-2 py-2">
          <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-1.5 text-left">
            <Icon.Chevron width={11} height={11} className={`mt-0.5 flex-none text-[var(--q-faint)] transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium text-[var(--q-ink)]">{r.title}</span>
              <span className="mt-0.5 flex flex-wrap gap-1">
                {r.strategy.slice(0, 3).map((s) => (
                  <span key={s} className="rounded border border-[var(--q-line)] px-1 text-[10px] text-[var(--q-muted)]">
                    {s}
                  </span>
                ))}
                {r.flags.slice(0, 3).map((f) => (
                  <span key={f.label} className={`whitespace-nowrap rounded border px-1 text-[10px] ${SEV_INK[f.severity] ?? SEV_INK.warn}`}>
                    {f.label}
                  </span>
                ))}
                {r.flags.length > 3 && <span className="text-[10px] text-[var(--q-faint)]">+{r.flags.length - 3} flags</span>}
              </span>
            </span>
          </button>
        </td>
        <td className="px-2 py-2">
          <ScoreBar value={r.score} />
        </td>
        <td className="px-2 py-2">
          <ScoreBar value={r.quality} />
        </td>
        <td className="px-2 py-2">
          <ScoreBar value={r.reliability} />
        </td>
        <td className="px-2 py-2">
          <ScoreBar value={r.risk} />
        </td>
        <td className="px-2 py-2">
          <ScoreBar value={r.strategyScore} />
        </td>
      </tr>
      {open && (
        <tr className="bg-[color-mix(in_oklab,var(--q-panel-2)_60%,transparent)]">
          <td />
          <td colSpan={6} className="px-2 pb-3 pt-1 text-[12px] leading-relaxed text-[var(--q-muted)]">
            {r.verdict && <p className="text-[var(--q-ink)]">{r.verdict}</p>}
            <dl className="mt-2 grid grid-cols-[90px_1fr] gap-x-3 gap-y-1 text-[11.5px]">
              <dt className="text-[var(--q-faint)]">Backtest</dt>
              <dd>{r.backtest ? `${r.backtest.status}${r.backtest.why ? ` — ${r.backtest.why}` : ""}` : "Not run"}</dd>
              {r.flags.length > 0 && (
                <>
                  <dt className="text-[var(--q-faint)]">Flags</dt>
                  <dd>{r.flags.map((f) => f.label).join(" · ")}</dd>
                </>
              )}
              {(r.url || r.sources.length > 0) && (
                <>
                  <dt className="text-[var(--q-faint)]">Sources</dt>
                  <dd className="flex min-w-0 flex-col gap-0.5">
                    {[...(r.url ? [r.url] : []), ...r.sources.filter((s) => s !== r.url)].slice(0, 6).map((s) =>
                      /^https?:/.test(s) ? (
                        <ExternalLink key={s} href={s}>
                          {s.replace(/^https?:\/\//, "")}
                        </ExternalLink>
                      ) : (
                        <span key={s} className="truncate">
                          {s}
                        </span>
                      ),
                    )}
                  </dd>
                </>
              )}
              <dt className="text-[var(--q-faint)]">Found</dt>
              <dd data-num>{new Date(r.at).toLocaleString()}</dd>
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

export function Storyboard({ finding }: { finding: Finding }) {
  const sb = storyboardShots(finding);
  return (
    <div className="q-inset">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--q-line-soft)] px-3 py-2">
        <span className="text-[12.5px] font-medium text-[var(--q-ink)]">{finding.title}</span>
        <span className="text-[11px] text-[var(--q-muted)]" data-num>
          {sb.shots.length} shots{sb.total != null ? ` · ${sb.total.toFixed(1)} s` : ""}
          {sb.pacing ? ` · ${sb.pacing}` : ""}
          {sb.style ? ` · ${sb.style}` : ""}
        </span>
      </div>
      <ol>
        {sb.shots.map((s) => (
          <li key={s.n} className="grid grid-cols-[34px_1fr] gap-2 border-t border-[var(--q-line-soft)] px-3 py-2 first:border-t-0">
            <span className="text-[11px] text-[var(--q-faint)]" data-num>
              {String(s.n).padStart(2, "0")}
            </span>
            <div className="min-w-0 text-[12px] leading-relaxed">
              <div className="flex flex-wrap gap-x-2 text-[11px] text-[var(--q-muted)]" data-num>
                <span>
                  {s.start.toFixed(1)}–{s.end.toFixed(1)} s
                </span>
                {s.camera && <span>· {s.camera}</span>}
                {s.movement && <span>· {s.movement}</span>}
              </div>
              {s.action && <p className="text-[var(--q-ink)]">{s.action}</p>}
              {(s.environment || s.lighting) && <p className="text-[var(--q-muted)]">{[s.environment, s.lighting].filter(Boolean).join(" · ")}</p>}
              {s.frames.length > 0 && (
                <p className="mt-1 truncate font-mono text-[10.5px] text-[var(--q-faint)]" title={s.frames.join("\n")}>
                  {s.frames.length} keyframe{s.frames.length === 1 ? "" : "s"} · {s.frames[0].split("/").pop()}
                </p>
              )}
            </div>
          </li>
        ))}
        {!sb.shots.length && <li className="px-3 py-3 text-[12px] text-[var(--q-muted)]">{finding.summary || "No shots in this storyboard yet."}</li>}
      </ol>
    </div>
  );
}

export function H3Prompts({ findings }: { findings: Finding[] }) {
  const prompts = useMemo(() => h3Prompts(findings), [findings]);
  if (!prompts.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {prompts.map((p) => (
        <details key={p.id} className="q-inset group" open={prompts.length <= 2}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
            <Icon.Chevron width={11} height={11} className="flex-none text-[var(--q-faint)] transition-transform group-open:rotate-90" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-[var(--q-ink)]">{p.title}</span>
              {p.summary && <span className="block truncate text-[11px] text-[var(--q-muted)]">{p.summary}</span>}
            </span>
            <span className="text-[10.5px] text-[var(--q-faint)]" data-num>
              {p.variations.length} var.
            </span>
          </summary>
          <div className="flex flex-col gap-2 border-t border-[var(--q-line-soft)] px-3 py-2">
            <PromptBlock label="Prompt" text={p.prompt} />
            {p.variations.map((v) => (
              <PromptBlock key={v.n} label={v.label} text={v.prompt} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function PromptBlock({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="q-label">{label}</span>
        <CopyButton text={text} />
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--q-line-soft)] bg-[var(--q-canvas)] px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-[var(--q-ink)]">
        {text}
      </pre>
    </div>
  );
}

export function NoteList({ findings }: { findings: Finding[] }) {
  const notes = findings.flatMap((f) => notesOf(f).map((n, i) => ({ ...n, key: `${f.id}:${i}`, at: f.created_at })));
  if (!notes.length) return null;
  return (
    <ul className="q-inset">
      {notes.map((n) => (
        <li key={n.key} className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-[var(--q-line-soft)] px-3 py-2 first:border-t-0">
          <div className="min-w-0 text-[12.5px]">
            {n.url ? <ExternalLink href={n.url}>{n.title}</ExternalLink> : <span className="text-[var(--q-ink)]">{n.title}</span>}
            {n.summary && <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-[var(--q-muted)]">{n.summary}</p>}
          </div>
          {n.score != null && (
            <span className="text-[11px] text-[var(--q-muted)]" data-num title="Relevance score">
              {Math.round(n.score)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function GenericFindings({ findings, now }: { findings: Finding[]; now: Date }) {
  if (!findings.length) return null;
  return (
    <ul className="q-inset">
      {findings.map((f) => (
        <li key={f.id} className="border-t border-[var(--q-line-soft)] px-3 py-2 first:border-t-0">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--q-ink)]">{f.url ? <ExternalLink href={f.url}>{f.title}</ExternalLink> : f.title}</span>
            <span className="flex-none text-[10.5px] text-[var(--q-faint)]" data-num>
              {relTime(f.created_at, now)}
            </span>
          </div>
          {f.summary && <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--q-muted)]">{f.summary}</p>}
        </li>
      ))}
    </ul>
  );
}

const KIND_ORDER = ["alert", "mt4-bot", "h3-storyboard", "h3-prompt", "report", "research-digest", "research-note", "repo"];

/** Every finding, grouped by kind, each kind in its own form. */
export function FindingResults({ findings, now }: { findings: Finding[]; now: Date }) {
  const groups = useMemo(() => {
    const m = new Map<string, Finding[]>();
    for (const f of findings) m.set(f.kind, [...(m.get(f.kind) ?? []), f]);
    return [...m.entries()].sort((a, b) => (KIND_ORDER.indexOf(a[0]) + 99) % 99 - ((KIND_ORDER.indexOf(b[0]) + 99) % 99));
  }, [findings]);
  return (
    <div className="flex flex-col gap-4">
      {groups.map(([kind, list]) => (
        <section key={kind}>
          <h4 className="q-label mb-1.5 flex items-center gap-2">
            {findingKindLabel(kind)}
            <span className="text-[var(--q-faint)]" data-num>
              {list.length}
            </span>
          </h4>
          {kind === "mt4-bot" ? (
            <Mt4Table findings={list} />
          ) : kind === "h3-storyboard" ? (
            <div className="flex flex-col gap-2">
              {list.map((f) => (
                <Storyboard key={f.id} finding={f} />
              ))}
            </div>
          ) : kind === "h3-prompt" ? (
            <H3Prompts findings={list} />
          ) : kind === "research-note" || kind === "research-digest" || kind === "repo" ? (
            <NoteList findings={list} />
          ) : (
            <GenericFindings findings={list} now={now} />
          )}
        </section>
      ))}
    </div>
  );
}
