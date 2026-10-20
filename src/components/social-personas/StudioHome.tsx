"use client";

// The Studio home: every persona at once. A totals strip, then one dense row
// per persona (the owner prefers a table over a card grid), then "Up next" —
// every scheduled post across all personas, soonest first.

import { useMemo } from "react";
import { Icon } from "../icons";
import { compact, personaTotals } from "@/lib/social-personas/studio";
import { PLATFORM_NAME, type Persona } from "@/lib/social-personas/types";
import { Avatar, PlatformDot } from "./bits";
import { Sparkline } from "./charts";
import type { TabId } from "./Workspace";

export function StudioHome({
  personas,
  loaded,
  onOpen,
  onNew,
  onSetup,
  ready,
}: {
  /** Open Connect setup (the platforms' one-time developer-app step). */
  onSetup: () => void;
  /** Which platforms can be connected right now. */
  ready: Partial<Record<"tiktok" | "instagram" | "facebook" | "youtube", boolean>>;
  personas: Persona[];
  loaded: boolean;
  onOpen: (id: string, tab?: TabId) => void;
  onNew: () => void;
}) {
  const rows = useMemo(() => personas.map((p) => ({ p, t: personaTotals(p) })), [personas]);
  const sum = useMemo(
    () => ({
      followers: rows.reduce((s, r) => s + r.t.followers, 0),
      views7d: rows.reduce((s, r) => s + r.t.views7d, 0),
      posts7d: rows.reduce((s, r) => s + r.t.posts7d, 0),
      scheduled: rows.reduce((s, r) => s + r.t.scheduled, 0),
    }),
    [rows],
  );
  const upNext = useMemo(() => {
    const now = Date.now();
    return personas
      .flatMap((p) => p.drafts.filter((d) => d.scheduledAt && d.stage !== "posted" && Date.parse(d.scheduledAt) >= now - 3_600_000).map((d) => ({ p, d })))
      .sort((a, b) => Date.parse(a.d.scheduledAt!) - Date.parse(b.d.scheduledAt!))
      .slice(0, 8);
  }, [personas]);

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-5 sm:py-6">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="ps-title text-2xl font-bold text-ink">Personas Studio</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Every creator persona you run, in one place: what to post today, a calendar that posts for you, and how each video is doing.
          </p>
        </div>
        <button
          onClick={onSetup}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          title="Set up TikTok, Instagram, Facebook and YouTube sign-in (once)"
        >
          <Icon.Link width={14} height={14} /> Connections
          <span className="flex gap-0.5" aria-hidden>
            {(["tiktok", "instagram", "facebook", "youtube"] as const).map((x) => (
              <span key={x} className={"h-1.5 w-1.5 rounded-full " + (ready[x] ? "bg-emerald-400" : "bg-ink-faint/40")} />
            ))}
          </span>
        </button>
        <button onClick={onNew} className="ps-cta inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-2">
          <Icon.Plus width={15} height={15} /> New persona
        </button>
      </div>

      {loaded && personas.length === 0 ? (
        <button
          onClick={onNew}
          className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-6 py-16 text-center transition hover:border-brand hover:bg-panel"
        >
          <Icon.Users width={28} height={28} className="text-ink-faint" />
          <span className="text-sm font-semibold text-ink">Make your first persona</span>
          <span className="max-w-md text-xs text-ink-muted">
            A rap channel, an explainer page, a baby-growth diary… Give it a name and niche, add its accounts, and the Studio starts bringing ideas.
          </span>
        </button>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-panel sm:grid-cols-4">
            <Kpi label="Personas" value={personas.length} />
            <Kpi label="Followers" value={sum.followers} />
            <Kpi label="Views · 7 days" value={sum.views7d} />
            <Kpi label="Scheduled" value={sum.scheduled} sub={`${sum.posts7d} posted this week`} />
          </div>

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-panel text-[11px] uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="px-3 py-2 font-medium">Persona</th>
                  <th className="px-2 py-2 font-medium">Accounts</th>
                  <th className="px-2 py-2 text-right font-medium">Followers</th>
                  <th className="px-2 py-2 text-right font-medium">Views 7d</th>
                  <th className="px-2 py-2 font-medium">14 days</th>
                  <th className="px-2 py-2 font-medium">Next post</th>
                  <th className="px-2 py-2 text-right font-medium">Ideas</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, t }) => (
                  <tr key={p.id} className="ps-row group cursor-pointer border-t border-line bg-canvas/30 hover:bg-panel" onClick={() => onOpen(p.id)} style={{ ["--ps-hue" as string]: p.hue }}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={p.name} hue={p.hue} size={30} />
                        <div className="min-w-0">
                          <button className="block max-w-[220px] truncate text-left text-sm font-semibold text-ink outline-none group-hover:text-brand focus-visible:underline" onClick={(e) => (e.stopPropagation(), onOpen(p.id))}>
                            {p.name}
                          </button>
                          <div className="max-w-[220px] truncate text-ink-faint">{p.niche || "No niche set"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex max-w-[220px] flex-wrap gap-1">
                        {p.accounts.length === 0 ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          p.accounts.map((a) => (
                            <span key={a.id} className="inline-flex items-center gap-1 rounded border border-line px-1 py-0.5 text-[11px] text-ink-muted" title={`${PLATFORM_NAME[a.platform]}${a.connectionId ? " · connected" : ""}`}>
                              <PlatformDot platform={a.platform} />
                              {a.handle || "…"}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{t.followers ? compact(t.followers) : "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">{t.views7d ? compact(t.views7d) : "—"}</td>
                    <td className="px-2 py-1.5">
                      <Sparkline values={t.daily} label={`${p.name} daily views`} />
                    </td>
                    <td className="px-2 py-2">
                      {t.nextUp ? (
                        <button className="max-w-[180px] truncate text-left text-ink-muted hover:text-ink" onClick={(e) => (e.stopPropagation(), onOpen(p.id, "plan"))}>
                          <span className="tabular-nums text-ink">{when(t.nextUp.scheduledAt!)}</span> · {t.nextUp.title || "Untitled"}
                        </button>
                      ) : (
                        <button className="text-ink-faint hover:text-brand" onClick={(e) => (e.stopPropagation(), onOpen(p.id, "plan"))}>
                          Plan one →
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {t.ideasWaiting > 0 ? (
                        <button className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand" onClick={(e) => (e.stopPropagation(), onOpen(p.id, "ideas"))}>
                          {t.ideasWaiting} today
                        </button>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="mt-5">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint">Up next, all personas</h2>
            {upNext.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-xs text-ink-muted">
                Nothing scheduled. Open a persona → Plan, and drag a draft onto a day.
              </p>
            ) : (
              <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
                {upNext.map(({ p, d }) => (
                  <li key={d.id}>
                    <button onClick={() => onOpen(p.id, "plan")} className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-panel-2">
                      <span className="w-36 shrink-0 whitespace-nowrap tabular-nums text-ink">{when(d.scheduledAt!)}</span>
                      <Avatar name={p.name} hue={p.hue} size={20} />
                      <span className="min-w-0 flex-1 truncate text-ink">{d.title || "Untitled"}</span>
                      <span className="flex shrink-0 gap-1">
                        {d.accountIds.map((id) => {
                          const a = p.accounts.find((x) => x.id === id);
                          return a ? <PlatformDot key={id} platform={a.platform} /> : null;
                        })}
                      </span>
                      <ResultBadge d={d} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="border-b border-r border-line px-3 py-2.5 last:border-r-0 sm:border-b-0">
      <div className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="ps-num text-xl font-bold tabular-nums text-ink">{compact(value)}</div>
      {sub && <div className="text-[11px] text-ink-faint">{sub}</div>}
    </div>
  );
}

export function ResultBadge({ d }: { d: { results: { status: string }[]; media: unknown } }) {
  const failed = d.results.some((r) => r.status === "failed");
  const queued = d.results.some((r) => r.status === "queued" || r.status === "publishing");
  if (failed) return <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">⚠ needs you</span>;
  if (queued) return <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">auto</span>;
  return <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint">reminder</span>;
}

/** "Today 6:00 PM", "Tue 9:00 AM", "Oct 30 6:00 PM". */
export function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}
