"use client";

// The app's record — docs/apps/<slug>.md — at the top of its Features tab:
// how current it is, what it does, what must keep working, what was asked
// for, and what the code itself says (sign-in, routes, tables + RLS, keys,
// tests). The "Change it" prompt is built from exactly this.

import { useMemo, useState } from "react";
import { codeSummary, recordFor } from "@/lib/timeline/appRecords";
import { ACCESS_LABEL, freshness, freshnessLine, type AppRecord, type Freshness } from "@/lib/timeline/records";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

const FIRST = 8;

export function AppRecordSection({ project, onChangeIt }: { project: Project; onChangeIt?: () => void }) {
  const record = recordFor(project);
  const fresh = useMemo(() => (record ? freshness(record, project.edits ?? []) : null), [record, project.edits]);
  if (!record || !fresh) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel" aria-labelledby="app-record-title">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id="app-record-title" className="text-sm font-semibold text-ink">
            App record
          </h2>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            <code className="text-ink-muted">docs/apps/{record.slug}.md</code> · the truth every edit starts from
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FreshPill f={fresh} />
          {onChangeIt && (
            <button
              onClick={onChangeIt}
              className="flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand transition hover:bg-brand/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              <Icon.Edit width={13} height={13} />
              Change it
            </button>
          )}
        </div>
      </header>

      {fresh.state !== "current" && fresh.edits.length > 0 && <SinceReview f={fresh} />}

      <div className="divide-y divide-line/60">
        <ListBlock title="Features" items={record.features} empty="None written yet — the next edit writes them." />
        <ListBlock
          title="Must keep working"
          items={record.mustKeep}
          empty="Nothing written by hand yet. Sign-in, routes, data rules and keys below are kept by themselves."
        />
        <ListBlock title="Requested, not built yet" items={record.requested} empty="Nothing waiting." />
      </div>

      <CodeFacts record={record} />
    </section>
  );
}

function FreshPill({ f }: { f: Freshness }) {
  const tone =
    f.state === "current"
      ? "border-core/40 bg-core/10 text-core"
      : f.state === "never"
        ? "border-line bg-canvas text-ink-faint"
        : "border-amber-400/40 bg-amber-400/10 text-amber-300";
  const label =
    f.state === "current"
      ? "Up to date"
      : f.state === "behind"
        ? `${f.behind} edit${f.behind === 1 ? "" : "s"} behind`
        : f.state === "seeded"
          ? f.behind
            ? `Not reviewed · ${f.behind} behind`
            : "Not reviewed yet"
          : "Never reviewed";
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums", tone)} title={freshnessLine(f)}>
      {label}
    </span>
  );
}

function SinceReview({ f }: { f: Extract<Freshness, { edits: unknown }> }) {
  return (
    <div className="border-b border-line bg-amber-400/[0.05] px-4 py-2.5">
      <p className="text-xs text-amber-200/90">{freshnessLine(f)} The next edit should fold these into the record:</p>
      <ul className="mt-1.5 space-y-0.5">
        {f.edits.slice(0, 5).map((e) => (
          <li key={e.id} className="grid grid-cols-[52px_1fr] gap-2 text-xs">
            <span className="tabular-nums text-ink-faint">{e.date.slice(5)}</span>
            <span className="text-ink-muted">{e.title}</span>
          </li>
        ))}
        {f.edits.length > 5 && <li className="pl-[60px] text-[11px] text-ink-faint">+{f.edits.length - 5} more in App edits below</li>}
      </ul>
    </div>
  );
}

function ListBlock({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <div className="px-4 py-3">
      <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-ink">
        {title}
        <span className="rounded-full bg-canvas px-1.5 text-[10px] font-semibold tabular-nums text-ink-faint">{items.length}</span>
      </h3>
      {items.length ? (
        <ul className="space-y-1">
          {shown.map((item, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-ink-muted">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" aria-hidden />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-faint">{empty}</p>
      )}
      {items.length > FIRST && (
        <button onClick={() => setAll(!all)} className="mt-1.5 text-[11px] font-medium text-brand hover:underline">
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

function CodeFacts({ record }: { record: AppRecord }) {
  const [open, setOpen] = useState(false);
  const c = record.code;
  const summary = codeSummary(record);
  return (
    <div className="border-t border-line">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-panel-2 focus-visible:bg-panel-2 focus-visible:outline-none"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon.Database width={14} height={14} className="shrink-0 text-ink-muted" />
          <span className="text-xs font-semibold text-ink">From the code</span>
          <span className="truncate text-[11px] text-ink-faint">{summary || "nothing of its own"}</span>
        </span>
        <Icon.Chevron width={14} height={14} className={cn("shrink-0 text-ink-faint transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line/60 bg-canvas/40 px-4 py-3 text-xs">
          <Facts title="Where it lives" rows={[...c.pages.map((p) => `${p.path} — ${ACCESS_LABEL[p.access]}`), ...c.folders]} mono />
          <Facts title="Sign-in & access" rows={c.signIn.map((s) => s.what)} />
          {c.api.length > 0 && (
            <div>
              <FactTitle>Server routes</FactTitle>
              <table className="w-full table-fixed border-collapse">
                <tbody>
                  {c.api.map((r) => (
                    <tr key={r.path} className="border-b border-line/40 last:border-0">
                      <td className="w-[88px] py-1 pr-2 align-top font-mono text-[10px] text-ink-faint">{r.methods.join(" ") || "—"}</td>
                      <td className="break-all py-1 pr-2 align-top font-mono text-[11px] text-ink-muted">{r.path}</td>
                      <td
                        className={cn(
                          "w-[34%] py-1 align-top text-[11px]",
                          r.access === "owner" ? "text-ink-faint" : "font-medium text-amber-300",
                        )}
                      >
                        {ACCESS_LABEL[r.access]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {c.tables.length > 0 && (
            <div>
              <FactTitle>Tables & row-level security</FactTitle>
              <ul className="space-y-1">
                {c.tables.map((t) => (
                  <TableRow key={t.name} t={t} />
                ))}
              </ul>
            </div>
          )}
          <Facts
            title="Other saved data"
            rows={[
              ...c.buckets.map((b) => `Storage bucket ${b.what}`),
              ...c.rpcs.map((r) => `Database function ${r.what}`),
              ...c.savedKeys.map((k) => `Saved key ${k.what}`),
              ...(c.serverDocs.length ? [`Server docs in ${c.serverDocs.length} file${c.serverDocs.length === 1 ? "" : "s"}`] : []),
            ]}
          />
          <Facts title="Keys" rows={[...c.env.map((e) => e.what), ...(c.ai.length ? ["AI calls through src/lib/ai/provider.ts"] : [])]} mono />
          <Facts title="Called on a schedule" rows={c.callers.map((x) => x.what)} mono />
          <Facts title="Tests" rows={c.tests} mono />
        </div>
      )}
    </div>
  );
}

function TableRow({ t }: { t: AppRecord["code"]["tables"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        disabled={!t.policies.length}
        className="flex w-full items-center gap-2 text-left disabled:cursor-default"
      >
        <span className="font-mono text-[11px] text-ink-muted">{t.name}</span>
        <span className={cn("text-[10px] font-semibold", t.rls ? "text-core" : t.defined.length ? "text-amber-300" : "text-ink-faint")}>
          {t.rls ? "RLS on" : t.defined.length ? "RLS off" : "not in migrations"}
        </span>
        {t.policies.length > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-ink-faint">
            {t.policies.length} polic{t.policies.length === 1 ? "y" : "ies"}
            <Icon.Chevron width={11} height={11} className={cn("transition", open && "rotate-180")} />
          </span>
        )}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-3">
          {t.policies.map((p) => (
            <li key={p} className="break-words font-mono text-[10px] leading-relaxed text-ink-faint">
              {p}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function FactTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-1 text-[11px] font-semibold text-ink">{children}</h4>;
}

function Facts({ title, rows, mono }: { title: string; rows: string[]; mono?: boolean }) {
  if (!rows.length) return null;
  return (
    <div>
      <FactTitle>{title}</FactTitle>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r} className={cn("break-words text-ink-muted", mono ? "font-mono text-[11px]" : "text-xs")}>
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}
