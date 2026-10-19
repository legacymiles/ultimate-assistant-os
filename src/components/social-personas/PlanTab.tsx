"use client";

// ---------------------------------------------------------------------------
// Plan & post — the Studio's toy.
//
// A week of days you drag posts onto. A draft dropped on a day lands at the
// persona's best hour (from its own history) and springs into place; accounts
// with auto-post get a server job right then, the rest get a reminder. Days
// glow by how well posts published on them have done, so the calendar itself
// tells you where to aim. On a phone, tap a post to pick its time instead.
//
// Under it: the tray of unscheduled drafts, and (switchable) the pipeline —
// Idea → Script → Film → Edit → Ready → Scheduled → Posted.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { localDay } from "@/lib/social-personas/logic";
import { addDays, bestHour, bestTimes, draftsOn, newDraft, nextBestSlot, scheduleOnDay, sortDrafts, weekDays } from "@/lib/social-personas/studio";
import { STAGES, type Draft, type Stage } from "@/lib/social-personas/types";
import type { PublicJob, Status } from "./api";
import { Btn, PlatformDot } from "./bits";
import { DraftEditor } from "./DraftEditor";
import { autoAccounts, blocker, pushSchedule } from "./schedule";
import { ResultBadge } from "./StudioHome";
import type { TabProps } from "./Workspace";

type View = "calendar" | "pipeline";

export function PlanTab(props: TabProps & { status: Status | null; applyJobs: (jobs: PublicJob[]) => void; focusId: string | null; clearFocus: () => void }) {
  const { persona, mutate, flash, applyJobs, focusId, clearFocus } = props;
  const [view, setView] = useState<View>("calendar");
  // A rolling week from today: on a Sunday a Monday-first week is six days of
  // past, which is no use for planning.
  const [start, setStart] = useState(() => startOfToday());
  const [editing, setEditing] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const latest = useRef(persona);
  latest.current = persona;

  useEffect(() => {
    if (focusId) {
      setEditing(focusId);
      clearFocus();
    }
  }, [focusId, clearFocus]);

  // Self-heal: a draft scheduled for later whose auto-post accounts have no
  // job yet (the editor was closed by a crash, or auto-post was turned on
  // after scheduling) gets its jobs now — once per visit.
  const healed = useRef(false);
  useEffect(() => {
    if (healed.current) return;
    healed.current = true;
    const later = persona.drafts.filter(
      (d) => d.scheduledAt && Date.parse(d.scheduledAt) > Date.now() && d.stage !== "posted" && autoAccounts(persona, d).some((a) => !blocker(persona, d, a.id) && !d.results.some((r) => r.accountId === a.id)),
    );
    void (async () => {
      for (const d of later) await commitDraft(d);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = weekDays(start);
  const today = localDay();
  const hour = useMemo(() => bestHour(persona.posts), [persona.posts]);
  const dayScore = useMemo(() => {
    const { grid } = bestTimes(persona.posts);
    return grid.map((row) => {
      const vals = row.filter((v): v is number => v != null);
      return vals.length ? Math.max(...vals) : null;
    });
  }, [persona.posts]);
  const unscheduled = sortDrafts(persona.drafts.filter((d) => !d.scheduledAt && d.stage !== "posted"));
  const now = Date.now();
  const due = persona.drafts.filter(
    (d) => d.scheduledAt && Date.parse(d.scheduledAt) <= now && d.stage !== "posted" && d.accountIds.some((id) => !d.results.some((r) => r.accountId === id && r.status !== "failed")),
  );
  const failed = persona.drafts.filter((d) => d.results.some((r) => r.status === "failed"));

  const save = (d: Draft) => mutate(persona.id, (p) => ({ ...p, drafts: p.drafts.map((x) => (x.id === d.id ? { ...d, updatedAt: new Date().toISOString() } : x)) }));

  /** Save, then bring the server queue in line with the draft. */
  const commitDraft = async (d: Draft, now = false) => {
    save(d);
    const r = await pushSchedule(latest.current, d, { now, applyJobs });
    save(r.draft);
    if (r.error) flash(r.error, true);
    return r.draft;
  };

  const drop = (day: string) => {
    const d = persona.drafts.find((x) => x.id === dragId);
    setDragId(null);
    setOver(null);
    if (!d) return;
    const at = scheduleOnDay(d, day, hour);
    setLanded(d.id);
    window.setTimeout(() => setLanded(null), 700);
    void commitDraft({ ...d, scheduledAt: at, stage: d.stage === "posted" ? d.stage : "scheduled" });
  };

  const create = (patch: Partial<Draft> = {}) => {
    const d = newDraft({ accountIds: persona.accounts.map((a) => a.id), ...patch });
    mutate(persona.id, (p) => ({ ...p, drafts: [d, ...p.drafts] }));
    setEditing(d.id);
  };

  const editingDraft = persona.drafts.find((d) => d.id === editing) ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5" role="tablist" aria-label="View">
          {(["calendar", "pipeline"] as View[]).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={"rounded-md px-2.5 py-1 text-xs font-medium capitalize transition " + (view === v ? "bg-elevated text-ink" : "text-ink-muted hover:text-ink")}
            >
              {v}
            </button>
          ))}
        </div>
        {view === "calendar" && (
          <div className="flex items-center gap-1 text-xs">
            <button className="rounded p-1 text-ink-muted hover:bg-panel-2 hover:text-ink" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">
              <Icon.Chevron width={14} height={14} className="rotate-180" />
            </button>
            <button className="rounded px-1.5 py-0.5 text-ink-muted hover:bg-panel-2 hover:text-ink" onClick={() => setStart(startOfToday())} title="Back to today">
              {new Date(start).toLocaleDateString([], { month: "short", day: "numeric" })} – {addDays(start, 6).toLocaleDateString([], { month: "short", day: "numeric" })}
            </button>
            <button className="rounded p-1 text-ink-muted hover:bg-panel-2 hover:text-ink" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">
              <Icon.Chevron width={14} height={14} />
            </button>
          </div>
        )}
        <span className="hidden text-[11px] text-ink-faint md:inline">
          {hour != null ? `Best hour from your posts: ${hourText(hour)}` : "Drop a post on a day — it lands at 6 PM until your stats say better."}
        </span>
        <Btn primary className="ml-auto" onClick={() => create()}>
          <Icon.Plus width={13} height={13} /> New post
        </Btn>
      </div>

      {(due.length > 0 || failed.length > 0) && (
        <div className="space-y-1.5">
          {[...new Set([...failed, ...due])].map((d) => (
            <button
              key={d.id}
              onClick={() => setEditing(d.id)}
              className="flex w-full items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-left text-xs hover:bg-amber-500/10"
            >
              <Icon.Bell width={14} height={14} className="shrink-0 text-amber-300" />
              <span className="min-w-0 flex-1 truncate text-ink">
                <b>{d.title || "Untitled"}</b> {d.results.some((r) => r.status === "failed") ? "— a post didn't go through" : "— it's time to post this"}
              </span>
              <span className="shrink-0 text-amber-300">Open →</span>
            </button>
          ))}
        </div>
      )}

      {view === "calendar" ? (
        <>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-7">
            {days.map((day) => {
              const items = draftsOn(persona.drafts, day);
              const score = dayScore[(new Date(day + "T12:00").getDay() + 6) % 7];
              const isPast = day < today;
              return (
                <div
                  key={day}
                  onDragOver={(e) => {
                    if (!dragId || isPast) return;
                    e.preventDefault();
                    setOver(day);
                  }}
                  onDragLeave={() => setOver((o) => (o === day ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!isPast) drop(day);
                  }}
                  className={
                    "ps-day group relative flex min-h-[64px] flex-col sm:min-h-[132px] rounded-xl border p-1.5 transition " +
                    (over === day ? "is-over border-brand " : day === today ? "border-[hsl(var(--ps-hue)_70%_55%/0.6)] " : "border-line ") +
                    (isPast ? "opacity-60" : "")
                  }
                  style={score != null ? { ["--ps-heat" as string]: Math.min(1, score / 2) } : undefined}
                >
                  <div className="mb-1 flex items-center gap-1 px-0.5">
                    <span className={"text-[11px] font-semibold " + (day === today ? "text-ink" : "text-ink-muted")}>
                      {new Date(day + "T12:00").toLocaleDateString([], { weekday: "short" })}{" "}
                      <span className="tabular-nums text-ink-faint">{Number(day.slice(8))}</span>
                    </span>
                    {score != null && score >= 1.3 && (
                      <span className="rounded bg-brand/15 px-1 text-[9px] font-semibold text-brand" title="Posts published on this weekday beat your usual">
                        hot
                      </span>
                    )}
                    {!isPast && (
                      <button
                        className="ml-auto rounded p-0.5 text-ink-faint opacity-0 transition hover:bg-panel-2 hover:text-ink focus:opacity-100 group-hover:opacity-100"
                        aria-label={`New post on ${day}`}
                        onClick={() => create({ scheduledAt: scheduleOnDay(newDraft(), day, hour), stage: "idea" })}
                      >
                        <Icon.Plus width={12} height={12} />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {items.map((d) => (
                      <Chip key={d.id} d={d} persona={persona} landed={landed === d.id} onOpen={() => setEditing(d.id)} onDrag={setDragId} showTime />
                    ))}
                    {items.length === 0 && over !== day && <span className="px-0.5 text-[10px] text-ink-faint/70">{isPast ? "" : "drop here"}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <section>
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">Not scheduled yet · drag onto a day</h3>
            {unscheduled.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-ink-muted">
                Nothing waiting. Press <b>Plan it</b> on an idea, or <b>New post</b>.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {unscheduled.map((d) => (
                  <div key={d.id} className="w-full sm:w-56">
                    <Chip d={d} persona={persona} landed={false} onOpen={() => setEditing(d.id)} onDrag={setDragId} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <Pipeline
          drafts={persona.drafts}
          onOpen={setEditing}
          onMove={(id, stage) => {
            const d = persona.drafts.find((x) => x.id === id);
            if (d && d.stage !== stage) save({ ...d, stage });
          }}
          persona={persona}
        />
      )}

      {editingDraft && (
        <DraftEditor
          key={editingDraft.id}
          {...props}
          draft={editingDraft}
          onClose={() => setEditing(null)}
          onCommit={commitDraft}
          onDelete={async () => {
            await commitDraft({ ...editingDraft, scheduledAt: null, accountIds: [] });
            mutate(persona.id, (p) => ({ ...p, drafts: p.drafts.filter((x) => x.id !== editingDraft.id) }));
            setEditing(null);
          }}
          suggestSlot={() => nextBestSlot(persona)}
        />
      )}
    </div>
  );
}

function Chip({
  d,
  persona,
  landed,
  onOpen,
  onDrag,
  showTime,
}: {
  d: Draft;
  persona: TabProps["persona"];
  landed: boolean;
  onOpen: () => void;
  onDrag: (id: string | null) => void;
  showTime?: boolean;
}) {
  const posted = d.stage === "posted";
  return (
    <button
      draggable={!posted}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", d.id);
        e.dataTransfer.effectAllowed = "move";
        onDrag(d.id);
      }}
      onDragEnd={() => onDrag(null)}
      onClick={onOpen}
      className={
        "ps-chip w-full rounded-lg border bg-panel px-2 py-1.5 text-left text-[11px] transition hover:border-brand/60 " +
        (landed ? "is-landed " : "") +
        (posted ? "border-emerald-500/30 opacity-80" : "border-line")
      }
      style={{ borderLeft: `3px solid hsl(${persona.hue} 70% 55%)` }}
    >
      <div className="flex items-center gap-1">
        {showTime && d.scheduledAt && <span className="tabular-nums text-ink-faint">{new Date(d.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
        <span className="ml-auto flex gap-0.5">
          {d.accountIds.map((id) => {
            const a = persona.accounts.find((x) => x.id === id);
            return a ? <PlatformDot key={id} platform={a.platform} /> : null;
          })}
        </span>
      </div>
      <div className="line-clamp-2 font-medium text-ink">{d.title || "Untitled post"}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 whitespace-nowrap">
        <span className="text-[10px] text-ink-faint">{STAGES.find((s) => s.id === d.stage)?.label}</span>
        {!d.media && !posted && <span className="text-[10px] text-ink-faint">· no video</span>}
        <span className="ml-auto">{posted ? <span className="text-[10px] font-semibold text-emerald-400">posted</span> : d.scheduledAt ? <ResultBadge d={d} /> : null}</span>
      </div>
    </button>
  );
}

function Pipeline({ drafts, persona, onOpen, onMove }: { drafts: Draft[]; persona: TabProps["persona"]; onOpen: (id: string) => void; onMove: (id: string, s: Stage) => void }) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 lg:grid lg:grid-cols-7 lg:overflow-visible">
      {STAGES.map((s) => {
        const items = sortDrafts(drafts.filter((d) => d.stage === s.id));
        return (
          <div
            key={s.id}
            onDragOver={(e) => {
              if (!drag || s.id === "scheduled" || s.id === "posted") return;
              e.preventDefault();
              setOver(s.id);
            }}
            onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (drag && s.id !== "scheduled" && s.id !== "posted") onMove(drag, s.id);
              setDrag(null);
              setOver(null);
            }}
            className={"flex min-h-[200px] w-52 shrink-0 flex-col rounded-xl border p-1.5 lg:w-auto " + (over === s.id ? "border-brand bg-brand/5" : "border-line bg-panel/40")}
          >
            <div className="mb-1 flex items-center px-1 text-[11px] font-semibold text-ink-muted">
              {s.label}
              <span className="ml-auto tabular-nums text-ink-faint">{items.length}</span>
            </div>
            <div className="flex flex-col gap-1">
              {items.map((d) => (
                <Chip key={d.id} d={d} persona={persona} landed={false} onOpen={() => onOpen(d.id)} onDrag={setDrag} showTime={Boolean(d.scheduledAt)} />
              ))}
              {!items.length && <span className="px-1 py-2 text-[10px] text-ink-faint/70">—</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function hourText(h: number) {
  return new Date(2026, 0, 1, h).toLocaleTimeString([], { hour: "numeric" });
}
