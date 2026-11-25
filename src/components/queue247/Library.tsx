"use client";

// The research library: everything every agent has ever found, searchable.
// GET /api/queue247/findings with kind / q / order / app / notable. MT4 bots
// sort by score and render as the ranked table; everything else by kind.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import type { Finding } from "@/lib/queue247/types";
import { getJson } from "@/lib/queue247/useQueue247";
import { FINDING_KIND_LABEL, findingKindLabel, type AppRef } from "@/lib/queue247/view";
import { Empty, Notice } from "./parts";
import { FindingResults } from "./Results";

const KINDS = ["", "mt4-bot", "h3-storyboard", "h3-prompt", "research-note", "research-digest", "repo", "alert", "report"];

export function Library({ apps, now, onOpenTask, taskTitle }: { apps: AppRef[]; now: Date; onOpenTask: (id: string) => void; taskTitle: (id: string) => string | null }) {
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [app, setApp] = useState("");
  const [order, setOrder] = useState<"recent" | "score">("recent");
  const [notable, setNotable] = useState(false);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Debounce typing so the library is not asked on every key.
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 280);
    return () => clearTimeout(t);
  }, [q]);

  // MT4 bots are read best ranked.
  useEffect(() => {
    if (kind === "mt4-bot") setOrder("score");
  }, [kind]);

  useEffect(() => {
    let live = true;
    const p = new URLSearchParams();
    if (kind) p.set("kind", kind);
    if (term) p.set("q", term);
    if (app) p.set("app", app);
    if (notable) p.set("notable", "1");
    p.set("order", order);
    p.set("limit", "150");
    setErr(null);
    getJson<{ findings: Finding[] }>(`/api/queue247/findings?${p}`)
      .then((r) => live && setFindings(r.findings ?? []))
      .catch((e: Error) => {
        if (!live) return;
        setErr(e.message);
        setFindings((f) => f ?? []);
      });
    return () => {
      live = false;
    };
  }, [kind, term, app, order, notable]);

  const byTask = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of findings ?? []) m.set(f.task_id, (m.get(f.task_id) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [findings]);

  return (
    <div className="flex flex-col gap-3">
      <div className="q-glass flex flex-col gap-2 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Icon.Search width={12} height={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--q-faint)]" aria-hidden />
            <input className="q-field pl-7" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything the agents found…" aria-label="Search the library" />
          </div>
          <select className="q-field w-auto min-w-[150px]" value={app} onChange={(e) => setApp(e.target.value)} aria-label="Filter by app">
            <option value="">Every app</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1" role="radiogroup" aria-label="Sort">
            <button type="button" className="q-chip" aria-pressed={order === "recent"} onClick={() => setOrder("recent")}>
              Newest
            </button>
            <button type="button" className="q-chip" aria-pressed={order === "score"} onClick={() => setOrder("score")}>
              Best score
            </button>
            <button type="button" className="q-chip" aria-pressed={notable} onClick={() => setNotable((v) => !v)}>
              Notable only
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Kind">
          {KINDS.map((k) => (
            <button key={k || "all"} type="button" className="q-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k ? FINDING_KIND_LABEL[k] ?? findingKindLabel(k) : "Everything"}
            </button>
          ))}
        </div>
      </div>

      <Notice text={err} />

      {findings === null ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="q-skel h-10" />
          ))}
        </div>
      ) : findings.length === 0 ? (
        <div className="q-glass">
          <Empty title={term || kind || app || notable ? "Nothing matches." : "The library is empty."}>
            {term || kind || app || notable
              ? "Try fewer words, or another kind."
              : "Every MT4 bot scored, storyboard written, prompt compiled and research note kept lands here. Ask Jarvis to research something and it fills by itself."}
          </Empty>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--q-muted)]">
            <span data-num>{findings.length} found</span>
            {byTask.length > 1 && (
              <>
                <span className="text-[var(--q-faint)]">from</span>
                {byTask.map(([id, n]) => (
                  <button key={id} type="button" className="underline decoration-[var(--q-line)] underline-offset-2 hover:text-[var(--q-ink)]" onClick={() => onOpenTask(id)}>
                    {taskTitle(id) ?? "an older task"} <span data-num>({n})</span>
                  </button>
                ))}
              </>
            )}
          </div>
          <FindingResults findings={findings} now={now} />
        </>
      )}
    </div>
  );
}
