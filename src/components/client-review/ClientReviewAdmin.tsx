"use client";

// ---------------------------------------------------------------------------
// Client Review — the owner's console (Jarvis › Toolbox › Clients, and
// /apps/client-review). Dense and table-like on purpose: this is a work queue.
//
//   left   every client project, with what is waiting on you
//   right  the selected project: Waiting on you (batches to approve, reword,
//          improve with AI, reject), the version timeline (post a URL → the
//          client is notified), and every request ever made
//
// Approving a batch also writes the new version and the brief into the linked
// Projects Timeline project, so the timeline stays the one source of truth.
//
// With the client's GitHub repo set, "Approve & build" hands the batch to App
// Builder (edit mode) and queues it for Claude Code, which builds it on a
// branch, opens a pull request, and posts the Vercel preview back here as the
// next version through the connector — the client is told with no URL pasted.
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { PHASE_LABEL, latestWord } from "@/lib/app-builder/build";
import { buildLinks, CannotBuildHere, startClientEditBuild } from "@/lib/client-review/autoBuild";
import { call as bridgeCall, probe as bridgeProbe } from "@/lib/new-jarvis/bridge";
import { pushThreadToMain } from "@/lib/client-review/pushMain";
import { useBuild } from "@/lib/app-builder/useBuild";
import { admin, type AdminState, type BriefOut } from "@/lib/client-review/client";
import { buildText, currentVersion, plainBrief, sortVersions, isSentToClient } from "@/lib/client-review/logic";
import { DEFAULT_SORT, isSortMode, listProjects, projectState, SORTS, STATE_LABEL, type SortMode } from "@/lib/client-review/list";
import { buildModelNote, isLaneValue, isSubscriptionValue, laneOfValue, pickValue } from "@/lib/client-review/models";
import { writeBriefOnPlan } from "@/lib/client-review/subscriptionBrief";
import type { ClientProject, ContentLane, EditRequest, RequestBatch, ReviewVersion } from "@/lib/client-review/types";
import { getRepo } from "@/lib/repo";
import { useStore } from "@/lib/store";
import { ModelMenu } from "./ModelMenu";

const LANES: { id: ContentLane; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Claude first; if it refuses, the uncensored model takes it" },
  { id: "standard", label: "Standard", hint: "Claude only" },
  { id: "uncensored", label: "Uncensored", hint: "Always the uncensored model (for explicit sites)" },
];

const REQ_TONE: Record<EditRequest["status"], string> = {
  draft: "text-ink-faint",
  sent: "text-amber-300",
  approved: "text-emerald-300",
  rejected: "text-rose-300",
  done: "text-sky-300",
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function linkFor(p: ClientProject): string {
  const path = `/apps/client-review?site=${p.token}`;
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
}

/**
 * Where to send the owner once a build starts: the Building screen, in the
 * Client tab, on that project.
 *
 * A context rather than a prop threaded through four components, because the
 * three places that start a build are three levels apart and none of the
 * components in between has any business knowing about navigation.
 */
const GoBuilding = createContext<((token: string) => void) | null>(null);

export function ClientReviewAdmin({
  chromeless = false,
  fill = false,
  onBuildStarted,
}: {
  chromeless?: boolean;
  fill?: boolean;
  /** Pressing a build button lands on the Building screen for that project. */
  onBuildStarted?: (token: string) => void;
} = {}) {
  const [state, setState] = useState<AdminState | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [flash, setFlash] = useState("");
  const [timeline, setTimeline] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(() => {
    admin
      .load()
      .then((s) => {
        setState(s);
        setError("");
        setSelected((cur) => cur ?? s.projects.find((p) => !p.archived)?.id ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), 45_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    getRepo()
      .getProjects()
      .then((ps) => setTimeline(ps.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setTimeline([]));
  }, []);

  const replace = (p: ClientProject) =>
    setState((s) => (s ? { ...s, projects: [p, ...s.projects.filter((x) => x.id !== p.id)] } : s));

  const run = useCallback(
    async <T extends { project?: ClientProject }>(label: string, action: Record<string, unknown>): Promise<T | null> => {
      setBusy(label);
      setError("");
      try {
        const out = await admin.act<T>(action);
        if (out.project) replace(out.project);
        return out;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setBusy("");
      }
    },
    [],
  );

  const say = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((f) => (f === msg ? "" : f)), 3500);
  };

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>(DEFAULT_SORT);

  const projects = state?.projects ?? [];
  const project = projects.find((p) => p.id === selected) ?? null;
  // App Builder opens a review project for every build, so this list is no
  // longer a handful of client sites — it is every app. Newest first, and
  // searchable, or it stops being usable at about twenty.
  const live = projects.filter((p) => !p.archived);
  const visible = listProjects(live, { query, sort });
  const archived = listProjects(projects.filter((p) => p.archived), { query, sort });
  const hiddenBySearch = live.length - visible.length;

  return (
    <GoBuilding.Provider value={onBuildStarted ?? null}>
    <div
      className={`flex overflow-hidden bg-canvas text-ink ${fill ? "h-full" : chromeless ? "h-[calc(100dvh-90px)] md:h-[calc(100dvh-49px)]" : "h-dvh"}`}
    >
      {/* ---------- project list ---------- */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel max-md:hidden">
        <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
          {fill ? (
            <h1 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">Clients</h1>
          ) : (
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Jarvis</p>
              <h1 className="text-sm font-semibold">Client Review</h1>
            </div>
          )}
          <button
            className="rounded-md border border-brand/50 bg-brand/20 px-2.5 py-1 text-xs font-medium hover:bg-brand/30"
            onClick={() => setCreating(true)}
          >
            + New
          </button>
        </div>
        <div className="border-b border-line px-2.5 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps and clients"
            aria-label="Search apps and clients"
            className="w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[12px] text-ink placeholder:text-ink-faint focus:border-brand/60 focus:outline-none"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(isSortMode(e.target.value) ? e.target.value : DEFAULT_SORT)}
              aria-label="Order"
              className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-1.5 py-1 text-[11.5px] text-ink-muted focus:border-brand/60 focus:outline-none"
            >
              {SORTS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="shrink-0 text-[11px] text-ink-faint">{visible.length}</span>
          </div>
        </div>
        <ProjectList projects={visible} selected={selected} onSelect={setSelected} />
        {query && !visible.length && (
          <p className="px-3 py-3 text-xs text-ink-faint">Nothing matches &ldquo;{query}&rdquo;.</p>
        )}
        {query && visible.length > 0 && hiddenBySearch > 0 && (
          <p className="px-3 pb-2 text-[11px] text-ink-faint">{hiddenBySearch} hidden by the search.</p>
        )}
        {archived.length > 0 && (
          <details className="border-t border-line px-3 py-2 text-xs text-ink-faint">
            <summary className="cursor-pointer">Archived ({archived.length})</summary>
            <ProjectList projects={archived} selected={selected} onSelect={setSelected} />
          </details>
        )}
        {state && (
          <div className="space-y-1 border-t border-line px-3 py-2 text-[11px] leading-snug text-ink-faint">
            <p>{state.storage.persistent ? "● Saved" : "▲ Not saved"} — {state.storage.reason}</p>
            <p>
              {state.push ? "● Push notifications on" : "○ Push off — set CLIENT_REVIEW_VAPID_PUBLIC_KEY / _PRIVATE_KEY"}
            </p>
            <p>{state.ai ? "● AI briefs on" : "○ No AI key — briefs are a plain list"}</p>
          </div>
        )}
      </aside>

      {/* ---------- detail ---------- */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* mobile project picker */}
        <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2 md:hidden">
          <select
            className="min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm"
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {visible.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {pendingCount(p) ? ` · ${pendingCount(p)} waiting` : ""}
              </option>
            ))}
          </select>
          <button className="rounded-md border border-line px-2.5 py-1.5 text-xs" onClick={() => setCreating(true)}>
            + New
          </button>
        </div>

        {state && state.events.length > 0 && (
          <EventStrip
            events={state.events}
            onOpen={(id) => setSelected(id)}
            onClear={async () => {
              const out = await admin.act<{ events: AdminState["events"] }>({ action: "dismissEvents" }).catch(() => null);
              if (out) setState((s) => (s ? { ...s, events: out.events } : s));
            }}
          />
        )}

        {(error || flash) && (
          <div className={`mx-3 mt-2 rounded-md px-3 py-2 text-xs ${error ? "bg-rose-500/10 text-rose-200" : "bg-emerald-500/10 text-emerald-200"}`}>
            {error || flash}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!state ? (
            <p className="p-6 text-sm text-ink-muted">{error ? "" : "Loading…"}</p>
          ) : !project ? (
            <EmptyState onCreate={() => setCreating(true)} />
          ) : (
            <ProjectDetail
              key={project.id}
              project={project}
              timeline={timeline}
              busy={busy}
              run={run}
              say={say}
              lanes={state.lanes}
              onDeleted={() => {
                setState((s) => (s ? { ...s, projects: s.projects.filter((x) => x.id !== project.id) } : s));
                setSelected(null);
              }}
            />
          )}
        </div>
      </main>

      {creating && (
        <CreateDialog
          timeline={timeline}
          busy={busy === "create"}
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            const out = await run<{ project: ClientProject }>("create", { action: "create", ...input });
            if (out?.project) {
              setSelected(out.project.id);
              setCreating(false);
              say("Project created — copy the client link to send it.");
            }
          }}
        />
      )}
    </div>
    </GoBuilding.Provider>
  );
}

function pendingCount(p: ClientProject): number {
  return p.batches.filter((b) => b.status === "pending").length;
}

function ProjectList({
  projects,
  selected,
  onSelect,
}: {
  projects: ClientProject[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto py-1">
      {projects.map((p) => {
        const waiting = pendingCount(p);
        const cur = currentVersion(p);
        const st = projectState(p);
        return (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p.id)}
              className={`grid w-full grid-cols-[1fr_auto] gap-x-2 px-3 py-2 text-left hover:bg-panel-2 ${
                p.id === selected ? "bg-panel-2 shadow-[inset_2px_0_0_var(--color-brand)]" : ""
              } ${st === "being-created" ? "shadow-[inset_2px_0_0_var(--color-support)]" : ""}`}
            >
              <span className="truncate text-[13px] font-medium">{p.name}</span>
              {/* Created, not changed: "newest first" has to agree with what the row shows. */}
              <span className="text-[11px] text-ink-faint" title={`Created ${new Date(p.createdAt).toLocaleString()}`}>
                {ago(p.createdAt)}
              </span>
              <span className="truncate text-[11.5px] text-ink-muted">
                {p.clientName || "No client name"} · {cur?.number ?? "v—"}
              </span>
              <span className="text-[11px]">
                {waiting > 0 ? (
                  <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-amber-300">{waiting} waiting</span>
                ) : st === "being-created" ? (
                  <span className="rounded bg-sky-400/15 px-1.5 py-0.5 text-sky-300">Being created</span>
                ) : st === "building" ? (
                  <span className="rounded bg-sky-400/15 px-1.5 py-0.5 text-sky-300">{STATE_LABEL.building}</span>
                ) : st === "unsent" ? (
                  <span className="rounded bg-line px-1.5 py-0.5 text-ink-faint">{STATE_LABEL.unsent}</span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
      {!projects.length && <li className="px-3 py-3 text-xs text-ink-faint">No projects yet.</li>}
    </ul>
  );
}

function EventStrip({
  events,
  onOpen,
  onClear,
}: {
  events: AdminState["events"];
  onOpen: (projectId: string) => void;
  onClear: () => void;
}) {
  const recent = [...events].reverse().slice(0, 5);
  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-line bg-panel-2/60 px-3 py-1.5 text-[11.5px]">
      <span className="shrink-0 text-ink-faint">Latest:</span>
      {recent.map((e) => (
        <button
          key={e.id}
          onClick={() => onOpen(e.projectId)}
          className="shrink-0 rounded border border-line bg-panel px-2 py-0.5 hover:border-brand/60"
        >
          <b className="font-medium">{e.clientName || e.projectName}</b>{" "}
          <span className="text-ink-muted">
            {e.kind === "batch_sent" ? `sent ${e.detail}` : e.detail}
          </span>{" "}
          <span className="text-ink-faint">{ago(e.at)}</span>
        </button>
      ))}
      <button onClick={onClear} className="ml-auto shrink-0 text-ink-faint hover:text-ink">
        Clear
      </button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h2 className="text-lg font-semibold">Send a client their website</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Create a project with the site&apos;s URL, copy the private link, and send it. They&apos;ll see their site with
        a Chat Intake on top; everything they send to Jarvis lands here for you to approve.
      </p>
      <button className="mt-4 rounded-md border border-brand/50 bg-brand/20 px-3 py-2 text-sm" onClick={onCreate}>
        + New client project
      </button>
    </div>
  );
}

// ----- detail -------------------------------------------------------------------

type Run = <T extends { project?: ClientProject }>(label: string, action: Record<string, unknown>) => Promise<T | null>;

/**
 * One line under the model menu: what the current pick actually does.
 *
 * A lane is described by the models it will try; an explicit pick by where it
 * runs and who pays for it — the two things the owner is choosing between.
 */
function briefModelNote(p: ClientProject, lanes: AdminState["lanes"]): string {
  const picked = (p.briefModel ?? "").trim();
  if (isSubscriptionValue(picked)) return "Your own Claude plan, through the PC helper — no extra cost.";
  if (picked) return `${picked} · OpenRouter, billed per brief.`;
  return p.lane === "standard"
    ? `Claude (${lanes.standard.join(", ")})`
    : p.lane === "uncensored"
      ? `Uncensored: ${lanes.uncensored.join(" → ")}`
      : `Claude, then ${lanes.uncensored.join(" → ")} if it refuses`;
}

function ProjectDetail({
  project: p,
  timeline,
  busy,
  run,
  say,
  lanes,
  onDeleted,
}: {
  project: ClientProject;
  timeline: { id: string; name: string }[];
  busy: string;
  run: Run;
  say: (m: string) => void;
  lanes: AdminState["lanes"];
  onDeleted: () => void;
}) {
  const pending = p.batches.filter((b) => b.status === "pending").sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const versions = sortVersions(p.versions).reverse();
  const link = linkFor(p);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      say("Client link copied.");
    } catch {
      say(link);
    }
  };

  return (
    <div className="space-y-5 p-3 sm:p-4">
      {/* header */}
      <section className="rounded-lg border border-line bg-panel p-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <InlineText
              value={p.name}
              className="text-base font-semibold"
              onSave={(name) => run("meta", { action: "meta", id: p.id, name })}
            />
            <InlineText
              value={p.clientName}
              placeholder="Client name"
              className="text-xs text-ink-muted"
              onSave={(clientName) => run("meta", { action: "meta", id: p.id, clientName })}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button className="rounded-md border border-brand/50 bg-brand/20 px-2.5 py-1.5 text-xs font-medium" onClick={copy}>
              Copy client link
            </button>
            <a className="rounded-md border border-line px-2.5 py-1.5 text-xs" href={link} target="_blank" rel="noreferrer">
              Open as client ↗
            </a>
            <button
              className="rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-muted"
              disabled={busy === "rotate"}
              onClick={async () => {
                if (!confirm("Make a new link? The old one stops working immediately.")) return;
                if (await run("rotate", { action: "rotate", id: p.id })) say("New link made — copy it and send it again.");
              }}
            >
              New link
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-panel-2 px-2.5 py-1.5 text-[11.5px]">
          {p.clientUserEmail ? (
            <>
              <span className="text-emerald-300">● Signed in as {p.clientUserEmail}</span>
              <span className="text-ink-faint">— only this Jarvis account can open the link</span>
              <button
                className="ml-auto text-ink-muted underline"
                onClick={async () => {
                  if (!confirm("Let a different account claim this link? The current client loses access until they open it again first.")) return;
                  if (await run("release", { action: "release", id: p.id })) say("Released — the next account to open the link gets it.");
                }}
              >
                Release
              </button>
            </>
          ) : (
            <>
              <span className="text-ink-muted">○ Not opened yet — the first Jarvis account to sign in on the link claims it.</span>
              <span className="ml-auto text-ink-faint">Only allow:</span>
              <InlineText
                value={p.inviteEmail ?? ""}
                placeholder="any account (add an email to lock it)"
                className="max-w-[240px] text-[11.5px]"
                onSave={(inviteEmail) => run("meta", { action: "meta", id: p.id, inviteEmail })}
              />
            </>
          )}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="block text-[11px] text-ink-faint">
            <span>Model for edit briefs</span>
            <div className="mt-1">
              <ModelMenu
                value={pickValue(p)}
                onChange={(next) => {
                  // A lane pick clears the explicit model; a model pick leaves
                  // the lane alone, so switching back to Auto restores it.
                  void (isLaneValue(next)
                    ? run("meta", { action: "meta", id: p.id, lane: laneOfValue(next), briefModel: "" })
                    : run("meta", { action: "meta", id: p.id, briefModel: next }));
                }}
              />
            </div>
            <span className="mt-1 block leading-snug">{briefModelNote(p, lanes)}</span>
          </div>
          <label className="block text-[11px] text-ink-faint">
            Projects Timeline project
            <select
              className="mt-1 w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink"
              value={p.timelineProjectId ?? ""}
              onChange={(e) => run("meta", { action: "meta", id: p.id, timelineProjectId: e.target.value })}
            >
              <option value="">Not linked</option>
              {timeline.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block">Approved versions and briefs are added there.</span>
          </label>
        </div>

        <SiteHome project={p} run={run} say={say} />
      </section>

      {/* waiting on you */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
          Waiting on you
          {pending.length > 0 && <span className="rounded bg-amber-400/15 px-1.5 text-amber-300">{pending.length}</span>}
        </h2>
        {!pending.length ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-xs text-ink-faint">
            Nothing sent to Jarvis right now. When {p.clientName || "the client"} presses Send, it shows up here.
          </p>
        ) : (
          <div className="space-y-3">
            {pending.map((b) => (
              <BatchCard key={b.id} project={p} batch={b} busy={busy} run={run} say={say} />
            ))}
          </div>
        )}
      </section>

      {/* versions */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">Versions</h2>
          <AddVersion project={p} busy={busy} run={run} say={say} />
        </div>
        <div className="overflow-hidden rounded-lg border border-line">
          {versions.map((v) => (
            <VersionRow key={v.id} project={p} version={v} busy={busy} run={run} say={say} />
          ))}
        </div>
      </section>

      {/* every request */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">All requests</h2>
        <RequestTable project={p} />
      </section>

      {/* Whether the client can see this at all. Until it is sent it is yours
          alone — App Builder opens one of these for every build. */}
      <section className="border-t border-line pt-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">The client&rsquo;s side</h2>
        {isSentToClient(p) ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-core/15 px-1.5 py-0.5 text-[11px] text-core">
              {p.claimedAt ? `Open on ${p.clientUserEmail || "their account"}` : "Sent — the link opens"}
            </span>
            {!p.claimedAt && (
              <button
                className="rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-muted"
                disabled={busy === "send"}
                onClick={() => run("send", { action: "unsend", id: p.id })}
              >
                {busy === "send" ? "Taking it back…" : "Take it back"}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-md border border-brand/50 bg-brand/20 px-2.5 py-1.5 text-xs font-medium hover:bg-brand/30"
              disabled={busy === "send"}
              onClick={() => run("send", { action: "send", id: p.id })}
            >
              {busy === "send" ? "Sending…" : "Send to the client"}
            </button>
            <span className="text-[11.5px] text-ink-faint">
              Not sent yet, so the link does not open and it is not in their list — even for someone holding it.
            </span>
          </div>
        )}
      </section>

      <section className="flex flex-wrap gap-2 border-t border-line pt-3">
        <button
          className="rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-muted"
          onClick={() => run("meta", { action: "meta", id: p.id, archived: !p.archived })}
        >
          {p.archived ? "Unarchive (re-opens the link)" : "Archive (closes the client link)"}
        </button>
        <button
          className="rounded-md border border-rose-500/40 px-2.5 py-1.5 text-xs text-rose-300"
          onClick={async () => {
            if (!confirm(`Delete ${p.name} and every request in it? This can't be undone.`)) return;
            const out = await run<{ ok?: boolean; project?: ClientProject }>("delete", { action: "delete", id: p.id });
            if (out) onDeleted();
          }}
        >
          Delete project
        </button>
      </section>
    </div>
  );
}

function InlineText({
  value,
  placeholder,
  className,
  onSave,
}: {
  value: string;
  placeholder?: string;
  className?: string;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className={`block w-full rounded bg-transparent px-1 py-0.5 outline-none hover:bg-panel-2 focus:bg-panel-2 ${className ?? ""}`}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** Mirror an approved version into the Projects Timeline. Best-effort. */
async function syncTimeline(p: ClientProject, version: ReviewVersion, brief: string, approved: EditRequest[]): Promise<string> {
  if (!p.timelineProjectId) return "";
  try {
    const repo = getRepo();
    await repo.addVersion(p.timelineProjectId, {
      number: version.number,
      summary: `Client edits approved (${approved.length}).\n\n${brief}`.slice(0, 8000),
    });
    await repo.addKnowledge(p.timelineProjectId, {
      kind: "feature_request",
      title: `${p.clientName || "Client"} edit requests → ${version.number}`,
      content: approved.map((r, i) => `${i + 1}. ${buildText(r)}${r.adminText ? `\n   (client wrote: ${r.text})` : ""}`).join("\n"),
    });
    void useStore.getState().init();
    return " Added to Projects Timeline.";
  } catch {
    return " (Couldn't add it to Projects Timeline.)";
  }
}

function BatchCard({
  project: p,
  batch: b,
  busy,
  run,
  say,
}: {
  project: ClientProject;
  batch: RequestBatch;
  busy: string;
  run: Run;
  say: (m: string) => void;
}) {
  const reqs = b.requestIds.map((id) => p.requests.find((r) => r.id === id)).filter((r): r is EditRequest => !!r);
  const from = p.versions.find((v) => v.id === b.versionId);
  const [brief, setBrief] = useState(b.brief ?? "");
  const [briefInfo, setBriefInfo] = useState<BriefOut | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  /** Writing through the PC bridge, which `busy` (the server actions) doesn't cover. */
  const [writing, setWriting] = useState(false);
  /** Approving and starting the build, likewise outside `busy`. */
  const [starting, setStarting] = useState(false);
  const goBuilding = useContext(GoBuilding);
  useEffect(() => setBrief(b.brief ?? ""), [b.brief]);
  const live = reqs.filter((r) => r.status !== "rejected").length;

  return (
    <article className="rounded-lg border border-amber-400/30 bg-panel">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs">
        <b className="font-semibold">{reqs.length} request{reqs.length === 1 ? "" : "s"}</b>
        <span className="text-ink-muted">on {from?.number ?? "?"}</span>
        <span className="text-ink-faint">sent {ago(b.sentAt)}</span>
        {from?.siteUrl && (
          <a className="ml-auto text-accent underline" href={from.siteUrl} target="_blank" rel="noreferrer">
            view {from.number} ↗
          </a>
        )}
      </header>

      <table className="w-full text-[12.5px]">
        <tbody>
          {reqs.map((r, i) => (
            <RequestReviewRow key={r.id} n={i + 1} project={p} request={r} run={run} />
          ))}
        </tbody>
      </table>

      <div className="border-t border-line p-3">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">Build brief</span>
          <ModelMenu
            compact
            value={pickValue(p)}
            onChange={(next) => {
              void (isLaneValue(next)
                ? run("meta", { action: "meta", id: p.id, lane: laneOfValue(next), briefModel: "" })
                : run("meta", { action: "meta", id: p.id, briefModel: next }));
            }}
          />
          {(briefInfo || b.briefModel) && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10.5px] ${
                (briefInfo?.lane ?? b.briefLane) === "uncensored" ? "bg-pink-500/20 text-pink-200" : "bg-brand/20 text-indigo-200"
              }`}
            >
              {briefInfo?.model ?? b.briefModel}
              {briefInfo?.rerouted ? " · re-routed after Claude refused" : ""}
            </span>
          )}
          <button
            className="ml-auto rounded-md border border-brand/50 bg-brand/20 px-2 py-1 text-[11.5px]"
            disabled={busy === `brief-${b.id}` || writing}
            onClick={async () => {
              const pick = pickValue(p);
              // The owner's own Claude plan lives on their PC, not on this
              // server: this tab asks the bridge and saves the same brief.
              if (isSubscriptionValue(pick)) {
                setWriting(true);
                try {
                  const out = await writeBriefOnPlan(p, b, pick);
                  setBrief(out.brief);
                  setBriefInfo({ brief: out.brief, model: out.model, lane: "standard", rerouted: false, note: out.note });
                  await run("saveBrief", {
                    action: "saveBrief",
                    id: p.id,
                    batchId: b.id,
                    brief: out.brief,
                    model: out.model,
                  });
                  if (out.note) say(out.note);
                } catch (e) {
                  say(e instanceof Error ? e.message : "Claude couldn't write that brief.");
                } finally {
                  setWriting(false);
                }
                return;
              }
              const out = await run<{ project: ClientProject; brief: BriefOut }>(`brief-${b.id}`, {
                action: "brief",
                id: p.id,
                batchId: b.id,
              });
              if (out) {
                setBriefInfo(out.brief);
                setBrief(out.brief.brief);
                if (out.brief.note) say(out.brief.note);
              }
            }}
          >
            {writing
              ? "Claude is writing…"
              : busy === `brief-${b.id}`
                ? "Writing…"
                : brief
                  ? "✦ Improve again"
                  : "✦ Improve with AI"}
          </button>
        </div>
        <textarea
          className="h-36 w-full resize-y rounded-md border border-line bg-panel-2 p-2 font-mono text-[12px] leading-relaxed outline-none focus:border-brand/60"
          value={brief}
          placeholder={plainBrief(p, b)}
          onChange={(e) => setBrief(e.target.value)}
          onBlur={() => brief !== (b.brief ?? "") && run("saveBrief", { action: "saveBrief", id: p.id, batchId: b.id, brief })}
        />
        {briefInfo?.note && <p className="mt-1 text-[11.5px] text-amber-200">{briefInfo.note}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(["build", "approve"] as const)
            .filter((mode) => mode === "approve" || p.repo)
            .map((mode) => (
              <button
                key={mode}
                className={
                  mode === "build" || !p.repo
                    ? "rounded-md bg-emerald-500/80 px-3 py-1.5 text-xs font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
                    : "rounded-md border border-emerald-500/40 px-2.5 py-1.5 text-xs text-emerald-200 disabled:opacity-40"
                }
                disabled={!live || starting || busy === "approve" || busy === "buildQueued"}
                title={
                  mode === "build"
                    ? `Approve, then build it here on your PC (${p.repo}), from shipped main. ${buildModelNote(pickValue(p))}`
                    : "Approve only — you build it and post the URL yourself"
                }
                onClick={async () => {
                  setStarting(true);
                  try {
                    const out = await run<{ project: ClientProject; version: ReviewVersion; approved: EditRequest[] }>("approve", {
                      action: "approve",
                      id: p.id,
                      batchId: b.id,
                      brief,
                    });
                    if (!out) return;
                    const done = out.project.batches.find((x) => x.id === b.id);
                    const extra = await syncTimeline(out.project, out.version, done?.brief ?? brief, out.approved);
                    if (mode === "approve") {
                      say(`Approved — ${out.version.number} is waiting to be built; post its address below when it is.${extra}`);
                      return;
                    }
                    const started = await startBuild(out.project, b.id, run, out.version.id);
                    say(`Approved — ${out.version.number}: ${started.message}${extra}`);
                    if (started.mode === "thread") goBuilding?.(p.token);
                  } finally {
                    setStarting(false);
                  }
                }}
              >
                {starting || busy === "approve" || busy === "buildQueued"
                  ? "Starting…"
                  : mode === "build"
                    ? `Approve & build ${live} →`
                    : p.repo
                      ? "Approve only"
                      : `Approve ${live} → next version`}
              </button>
            ))}
          <input
            className="min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs outline-none"
            placeholder="Note to the client if you reject all of these (optional)"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
          />
          <button
            className="rounded-md border border-rose-500/40 px-2.5 py-1.5 text-xs text-rose-300"
            disabled={busy === "reject"}
            onClick={async () => {
              if (await run("reject", { action: "reject", id: p.id, batchId: b.id, note: rejectNote })) say("Batch rejected — the client sees your note.");
            }}
          >
            Reject all
          </button>
        </div>
        {/*
          Said out loud, not buried in a tooltip: the menu above chooses the
          brief's model, and this is the one the build itself will run on. They
          are the same whenever the pick names a Claude model, and when it does
          not this is where the owner finds out, before pressing build.
        */}
        {p.repo && <p className="mt-1.5 text-[11px] text-ink-faint">{buildModelNote(pickValue(p))}</p>}
      </div>
    </article>
  );
}

function RequestReviewRow({ n, project: p, request: r, run }: { n: number; project: ClientProject; request: EditRequest; run: Run }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(r.adminText ?? r.text);
  const [note, setNote] = useState(r.adminNote ?? "");
  const rejected = r.status === "rejected";
  return (
    <>
      <tr className="border-b border-line-soft align-top">
        <td className="w-7 py-2 pl-3 text-ink-faint">{n}</td>
        <td className="py-2 pr-2">
          <p className={rejected ? "text-ink-faint line-through" : ""}>{r.text}</p>
          {r.adminText && <p className="mt-1 text-accent">→ {r.adminText}</p>}
          {r.adminNote && <p className="mt-1 text-ink-muted">Note: {r.adminNote}</p>}
          {r.pin && (
            <p className="mt-1 text-[11px] text-ink-faint">
              📍 {Math.round(r.pin.x * 100)}% across, {Math.round(r.pin.y * 100)}% down{r.pin.viewport ? ` · ${r.pin.viewport}px screen` : ""}
            </p>
          )}
        </td>
        <td className="whitespace-nowrap py-2 pr-3 text-right">
          <button className="mr-2 text-[11.5px] text-ink-muted hover:text-ink" onClick={() => setOpen((o) => !o)}>
            {open ? "Close" : "Reword"}
          </button>
          <button
            className={`text-[11.5px] ${rejected ? "text-emerald-300" : "text-rose-300"}`}
            onClick={() => run("review", { action: "review", id: p.id, requestId: r.id, status: rejected ? "sent" : "rejected" })}
          >
            {rejected ? "Keep" : "Drop"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-line-soft bg-panel-2/50">
          <td />
          <td colSpan={2} className="space-y-1.5 py-2 pr-3">
            <textarea
              className="h-16 w-full rounded border border-line bg-panel p-1.5 text-xs outline-none"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="What will actually be built"
            />
            <input
              className="w-full rounded border border-line bg-panel px-1.5 py-1 text-xs outline-none"
              placeholder="Note the client will see (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="rounded border border-brand/50 bg-brand/20 px-2 py-1 text-[11.5px]"
              onClick={async () => {
                if (await run("review", { action: "review", id: p.id, requestId: r.id, adminText: text, adminNote: note })) setOpen(false);
              }}
            >
              Save
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

function VersionRow({
  project: p,
  version: v,
  busy,
  run,
  say,
}: {
  project: ClientProject;
  version: ReviewVersion;
  busy: string;
  run: Run;
  say: (m: string) => void;
}) {
  const [url, setUrl] = useState(v.siteUrl);
  useEffect(() => setUrl(v.siteUrl), [v.siteUrl]);
  const current = currentVersion(p)?.id === v.id;
  const tone =
    v.status === "building" ? "bg-sky-400/15 text-sky-300" : current ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-ink-faint";
  return (
    <div className={`grid gap-2 border-b border-line-soft px-3 py-2.5 last:border-b-0 sm:grid-cols-[64px_1fr] ${v.status === "building" ? "bg-sky-500/5" : ""}`}>
      <div className="flex items-center gap-2 sm:block">
        <b className="text-sm">{v.number}</b>
        <span className={`rounded px-1.5 py-0.5 text-[10.5px] sm:mt-1 sm:inline-block ${tone}`}>
          {v.status === "building" ? "building" : current ? "live" : "old"}
        </span>
      </div>
      <div className="min-w-0 space-y-1.5">
        {v.summary && <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-muted">{v.summary}</p>}
        {v.status === "building" && <BuildStatus project={p} version={v} busy={busy} run={run} say={say} onUseUrl={setUrl} />}
        {v.status === "building" ? (
          <div className="flex flex-wrap gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs outline-none focus:border-brand/60"
              placeholder={p.repo ? "…or paste the address yourself" : "https://… where this version is deployed"}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              className="rounded-md bg-sky-400/80 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
              disabled={!url.trim() || busy === "ready"}
              onClick={async () => {
                const out = await run("ready", { action: "ready", id: p.id, versionId: v.id, siteUrl: url });
                if (out) say(`${v.number} is live — ${p.clientName || "the client"} was notified.`);
              }}
            >
              {busy === "ready" ? "Publishing…" : "Mark ready & notify client"}
            </button>
          </div>
        ) : v.siteUrl ? (
          <a className="block truncate text-[12px] text-accent underline" href={v.siteUrl} target="_blank" rel="noreferrer">
            {v.siteUrl}
          </a>
        ) : null}
        {v.prUrl && (
          <p className="flex flex-wrap items-center gap-2 text-[11.5px]">
            <span className="rounded bg-violet-400/15 px-1.5 py-0.5 text-violet-200">built by Claude Code</span>
            {v.branch && <code className="text-ink-faint">{v.branch}</code>}
            <a className="text-accent underline" href={v.prUrl} target="_blank" rel="noreferrer">
              {current ? "Merge the pull request to put it live ↗" : "Pull request ↗"}
            </a>
          </p>
        )}
        <p className="text-[11px] text-ink-faint">
          created {ago(v.createdAt)}
          {v.readyAt ? ` · shown to client ${ago(v.readyAt)}` : ""}
          {" · "}
          {p.requests.filter((r) => r.versionId === v.id).length} requests on it
        </p>
      </div>
    </div>
  );
}

/** What pressing build did: started on the PC, or didn't — there is no third answer. */
interface BuildStart {
  mode: "thread" | "failed";
  message: string;
}

/**
 * Build an approved batch, on this PC, now.
 *
 * Nothing is filed. The queue used to be the fallback here and it was the
 * reason the button lied: a request parked in a list nobody works left the
 * version saying "building" with nothing behind it. So a failure is a sentence
 * saying which of the three things is missing, the batch stays approved, and
 * pressing build again is the retry.
 */
async function startBuild(
  project: ClientProject,
  batchId: string,
  run: Run,
  /**
   * The version this same press just opened by approving. Given only by
   * Approve & build: if the build then fails to start, approving was half an
   * action, and half an action is what leaves a version saying "building"
   * with nothing behind it. So it is undone.
   */
  rollbackVersionId?: string,
): Promise<BuildStart> {
  try {
    const started = await startClientEditBuild(project, batchId);
    const noted = await run("buildQueued", {
      action: "buildQueued",
      id: project.id,
      batchId,
      builderId: started.builderId,
      threadId: started.threadId,
    });
    const on = `${started.model}${started.base ? `, from main at ${started.base}` : ""}`;
    return {
      mode: "thread",
      message: noted
        ? `Claude Code is building it on your PC with ${on}. Watch it right here — the preview link lands on this version when it's done.`
        : `Claude Code is building it with ${on}, but Client Review couldn't record it — the build still runs.`,
    };
  } catch (e) {
    const why = e instanceof Error ? e.message : "The build didn't start.";
    // Written to the batch before anything else: this is the only record that
    // survives the toast, and it is what the next person debugging this reads.
    await run("buildFailed", { action: "buildFailed", id: project.id, batchId, message: why }).catch(() => null);
    if (rollbackVersionId) {
      const undone = await run("cancelBuild", {
        action: "cancelBuild",
        id: project.id,
        versionId: rollbackVersionId,
      }).catch(() => null);
      return {
        mode: "failed",
        message: undone
          ? `${why} Nothing was approved — your edits are still waiting, so fix that and press Approve & build again.`
          : `${why} The approval could not be undone either — use Stop & remove on the version below.`,
      };
    }
    return { mode: "failed", message: `${why} Nothing was filed — press build again once that's sorted.` };
  }
}

/** Where the client's site lives — the two fields that let approved edits build themselves. */
function SiteHome({ project: p, run, say }: { project: ClientProject; run: Run; say: (m: string) => void }) {
  const ready = Boolean(p.repo);
  return (
    <div className="mt-3 rounded-md border border-line-soft bg-panel-2/60 p-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="uppercase tracking-[0.12em] text-ink-faint">Where the site lives</span>
        <span className={ready ? "text-emerald-300" : "text-ink-faint"}>
          {ready ? "● Approved edits build themselves" : "○ Add the repo to build approved edits automatically"}
        </span>
        <PcHelper />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-[11px] text-ink-faint">
          GitHub repo
          <InlineText
            value={p.repo ?? ""}
            placeholder="owner/name or the GitHub link"
            className="mt-0.5 rounded-md border border-line font-mono text-[12px] text-ink"
            onSave={async (repo) => {
              if (await run("meta", { action: "meta", id: p.id, repo })) say(repo ? "Repo saved — approved edits now build themselves." : "Repo removed.");
            }}
          />
        </label>
        <label className="block text-[11px] text-ink-faint">
          Vercel project
          <InlineText
            value={p.vercelProject ?? ""}
            placeholder="project name (optional)"
            className="mt-0.5 rounded-md border border-line font-mono text-[12px] text-ink"
            onSave={(vercelProject) => run("meta", { action: "meta", id: p.id, vercelProject })}
          />
        </label>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">
        Approve &amp; build starts Claude Code on your PC, in a worktree of the repo reset to shipped <code>main</code>: the
        edits go on a branch and a pull request opens for you. You watch it, answer it and push it from this screen — nothing
        goes to a queue, and nothing reaches {p.clientName || "the client"} without you posting it. If the PC helper is off,
        the build simply does not start and says so. Previews must open without a login: in Vercel › Settings › Deployment
        Protection, turn Vercel Authentication off.
      </p>
    </div>
  );
}

/** On a version being built: where the build is, and the button that starts it. */
function BuildStatus({
  project: p,
  version: v,
  busy,
  run,
  say,
  onUseUrl,
}: {
  project: ClientProject;
  version: ReviewVersion;
  busy: string;
  run: Run;
  say: (m: string) => void;
  /** Puts a finished preview in the address box, so the owner still presses ship. */
  onUseUrl: (url: string) => void;
}) {
  /** Starting on the PC, which happens outside `busy`. */
  const [starting, setStarting] = useState(false);
  const goBuilding = useContext(GoBuilding);
  const batch = p.batches.find((b) => b.nextVersionId === v.id && b.build) ?? p.batches.find((b) => b.nextVersionId === v.id);
  if (!batch) return null;
  const build = batch.build;
  const appLink = build ? `/apps/app-builder?p=${encodeURIComponent(build.builderId)}` : "";

  /**
   * Stop this build and hand the edits back, so it can be built again.
   *
   * The thread dies first, the record second: the other order leaves Claude
   * Code writing into a worktree nothing is waiting on, which is how a
   * "stopped" build opens a pull request an hour later. A thread that is
   * already gone makes `harness/stop` fail, and that must not stop the half
   * that actually unsticks the screen.
   */
  const stopBuild = async () => {
    setStarting(true);
    try {
      if (build?.threadId) await bridgeCall("harness/stop", { id: build.threadId }).catch(() => {});
      const out = await run("cancelBuild", { action: "cancelBuild", id: p.id, versionId: v.id });
      if (out) say(`${v.number} stopped and removed — the edits are back as a batch waiting for Approve & build.`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-sky-500/10 px-2 py-1.5 text-[11.5px]">
      {build?.threadId ? (
        <>
          <BuildThread threadId={build.threadId} liveUrl={p.appPath} onUseUrl={onUseUrl} />
          <StopBuild busy={starting || busy === "cancelBuild"} onStop={stopBuild} />
          <a className="ml-auto text-accent underline" href={appLink}>
            Open in App Builder ↗
          </a>
        </>
      ) : build ? (
        <>
          {/*
            Only old records reach here: nothing files a build in In Queue any
            more. Kept so a batch recorded before that change still offers the
            one button that does something, rather than disappearing.
          */}
          <span className="text-amber-200">
            ● Filed in In Queue {ago(build.at)}
            {build.queueId ? <span className="text-ink-faint"> · {build.queueId}</span> : null}
          </span>
          <span className="text-ink-faint">— from before builds ran here. Nothing is running behind it.</span>
          {p.repo && (
            <button
              className="rounded-md border border-sky-400/50 bg-sky-400/20 px-2.5 py-1 text-[11.5px] text-sky-100 disabled:opacity-40"
              disabled={busy === "buildQueued" || starting}
              onClick={async () => {
                setStarting(true);
                try {
                  const started = await startBuild(p, batch.id, run);
                  say(started.message);
                  if (started.mode === "thread") goBuilding?.(p.token);
                } finally {
                  setStarting(false);
                }
              }}
            >
              {starting || busy === "buildQueued" ? "Starting…" : "Build it on my PC →"}
            </button>
          )}
          <StopBuild busy={starting || busy === "cancelBuild"} onStop={stopBuild} />
          <a className="ml-auto text-accent underline" href={appLink}>
            Open in App Builder ↗
          </a>
        </>
      ) : p.repo ? (
        <>
          <span className="text-ink-muted">Not started yet.</span>
          {/*
            A version that says "building" with nothing started is the stuck
            state. Both halves of getting out of it belong here: why it did
            not start, and the button that undoes the approval.
          */}
          {batch.buildError && (
            <span className="text-amber-200" title={`Last tried ${ago(batch.buildError.at)}`}>
              Last try: {batch.buildError.message}
            </span>
          )}
          {v.status === "building" && <StopBuild busy={starting || busy === "cancelBuild"} onStop={stopBuild} />}
          <button
            className="ml-auto rounded-md border border-sky-400/50 bg-sky-400/20 px-2.5 py-1 text-[11.5px] text-sky-100 disabled:opacity-40"
            disabled={busy === "buildQueued" || starting}
            onClick={async () => {
              setStarting(true);
              try {
                const started = await startBuild(p, batch.id, run);
                say(started.message);
                if (started.mode === "thread") goBuilding?.(p.token);
              } finally {
                setStarting(false);
              }
            }}
          >
            {starting || busy === "buildQueued" ? "Starting…" : "Build it on my PC →"}
          </button>
        </>
      ) : (
        <span className="text-ink-faint">Add the client&apos;s GitHub repo above to have Claude Code build this — or paste the address below when it&apos;s deployed.</span>
      )}
    </div>
  );
}

/**
 * Is the PC helper there, right now?
 *
 * Answered before anyone presses build rather than after. Every reason a build
 * refuses to start begins here — the helper not running, or this browser not
 * paired with it — and finding that out from a toast after approving is both
 * too late and too easy to miss.
 */
function PcHelper() {
  const [state, setState] = useState<"asking" | "up" | "unpaired" | "off">("asking");
  const [why, setWhy] = useState("");

  const check = useCallback(() => {
    setState("asking");
    bridgeProbe()
      .then((h) => {
        setWhy(h.problem ?? "");
        setState(!h.up ? "off" : h.paired ? "up" : "unpaired");
      })
      .catch(() => setState("off"));
  }, []);
  useEffect(check, [check]);

  const label =
    state === "asking"
      ? "· checking your PC…"
      : state === "up"
        ? "● PC helper running"
        : state === "unpaired"
          ? "○ PC helper running, this browser isn't paired"
          : "○ PC helper not running — builds can't start";
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${
        state === "up" ? "text-emerald-300" : state === "asking" ? "text-ink-faint" : "text-amber-200"
      }`}
      title={why || undefined}
    >
      {label}
      {state !== "asking" && state !== "up" && (
        <button className="underline hover:text-ink" onClick={check}>
          check again
        </button>
      )}
    </span>
  );
}

/**
 * "Stop & remove" — the way out of a build that is never going to finish.
 *
 * It exists because the failure it undoes is invisible: a thread that died
 * with the bridge, or one that read its base and quit, leaves the version
 * saying "building" for ever. There was no button for that, so the only way
 * back was to stop using the project.
 */
function StopBuild({ busy, onStop }: { busy: boolean; onStop: () => void }) {
  const [sure, setSure] = useState(false);
  if (!sure) {
    return (
      <button className="rounded-md border border-rose-500/40 px-2 py-0.5 text-[11px] text-rose-300" onClick={() => setSure(true)}>
        Stop &amp; remove
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-rose-200">
      Remove this version and build it again?
      <button
        className="rounded-md border border-rose-400/60 bg-rose-400/20 px-2 py-0.5 font-semibold text-rose-100 disabled:opacity-50"
        disabled={busy}
        onClick={onStop}
      >
        {busy ? "Stopping…" : "Yes, stop it"}
      </button>
      <button className="rounded-md border border-line px-2 py-0.5 text-ink-muted" onClick={() => setSure(false)}>
        Keep waiting
      </button>
    </span>
  );
}

/**
 * The build running on the owner's PC, followed live.
 *
 * The thread lives in the bridge, so this shows what it is doing rather than
 * owning it: closing the console does not stop the build, and opening it again
 * reattaches to the thread id stored on the batch. The preview is only offered
 * as a link and a "use this address" — the owner still presses ship, so nothing
 * reaches the client without a human deciding it is right.
 */
function BuildThread({
  threadId,
  liveUrl,
  onUseUrl,
}: {
  threadId: string;
  /** Where this version goes live once main deploys ("/apps/…" for the owner's apps). */
  liveUrl?: string;
  onUseUrl: (url: string) => void;
}) {
  const build = useBuild(threadId, true);
  const [pushing, setPushing] = useState(false);
  const [said, setSaid] = useState("");
  const links = buildLinks(build.view.turns.map((t) => t.text).join("\n"));
  const what = build.phase === "working" ? latestWord(build.view) : "";
  const done = build.phase === "done";
  const bad = build.phase === "failed" || build.phase === "lost";
  const gate = build.gate;
  return (
    <>
      <span className={done ? "text-emerald-200" : bad ? "text-rose-200" : "text-sky-200"}>
        ● {done ? "Built on your PC" : PHASE_LABEL[build.phase]}
      </span>
      {build.summary?.model && <span className="rounded bg-brand/20 px-1.5 py-0.5 text-[10.5px] text-indigo-200">{build.summary.model}</span>}
      {what && <span className="min-w-0 truncate text-ink-faint">{what}</span>}
      {/*
        Answered here, not in App Builder. A permission card that can only be
        answered in another app is a build that stalls until the owner happens
        to look somewhere else, which is the same as a build that failed.
      */}
      {gate && (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-amber-100">
          <span className="min-w-0 truncate" title={gate.why || gate.command || gate.path}>
            Needs you: {gate.title || gate.name}
          </span>
          <button
            className="rounded border border-amber-300/60 bg-amber-300/20 px-1.5 py-0.5 text-[11px] font-semibold"
            onClick={() => void build.decide(gate.gateId, true)}
          >
            Allow
          </button>
          <button
            className="rounded border border-amber-300/30 px-1.5 py-0.5 text-[11px]"
            onClick={() => void build.decide(gate.gateId, false)}
          >
            Not now
          </button>
        </span>
      )}
      {links.preview && (
        <>
          <a className="text-accent underline" href={links.preview} target="_blank" rel="noreferrer">
            Preview ↗
          </a>
          <button className="rounded border border-sky-400/40 px-1.5 py-0.5 text-[11px]" onClick={() => onUseUrl(links.preview!)}>
            Use this address
          </button>
        </>
      )}
      {links.pr && (
        <a className="text-accent underline" href={links.pr} target="_blank" rel="noreferrer">
          Pull request ↗
        </a>
      )}
      {done && (
        <button
          disabled={pushing}
          className="rounded-md border border-emerald-400/50 bg-emerald-400/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-100 disabled:opacity-50"
          onClick={async () => {
            setPushing(true);
            try {
              const out = await pushThreadToMain(threadId);
              setSaid(out.message);
              if (out.ok && liveUrl) onUseUrl(liveUrl);
            } finally {
              setPushing(false);
            }
          }}
        >
          {pushing ? "Pushing…" : "Push to main"}
        </button>
      )}
      {said && <span className="text-emerald-200">{said}</span>}
      {build.error && <span className="text-amber-200">{build.error}</span>}
    </>
  );
}

function AddVersion({ project: p, busy, run, say }: { project: ClientProject; busy: string; run: Run; say: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [summary, setSummary] = useState("");
  if (!open) {
    return (
      <button className="text-xs text-ink-muted hover:text-ink" onClick={() => setOpen(true)}>
        + Add a version by hand
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        className="w-56 rounded border border-line bg-panel-2 px-2 py-1 text-xs"
        placeholder="https://… (blank = still building)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <input
        className="w-48 rounded border border-line bg-panel-2 px-2 py-1 text-xs"
        placeholder="What changed"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
      />
      <button
        className="rounded border border-brand/50 bg-brand/20 px-2 py-1 text-xs"
        disabled={busy === "addVersion"}
        onClick={async () => {
          const out = await run<{ project: ClientProject; version: ReviewVersion }>("addVersion", {
            action: "addVersion",
            id: p.id,
            siteUrl: url,
            summary,
          });
          if (out) {
            setOpen(false);
            setUrl("");
            setSummary("");
            say(out.version.status === "review" ? `${out.version.number} is live and the client was notified.` : `${out.version.number} added as building.`);
          }
        }}
      >
        Add
      </button>
      <button className="text-xs text-ink-faint" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}

function RequestTable({ project: p }: { project: ClientProject }) {
  const byVersion = useMemo(() => {
    const vs = sortVersions(p.versions).reverse();
    return vs
      .map((v) => ({ v, reqs: p.requests.filter((r) => r.versionId === v.id) }))
      .filter((x) => x.reqs.length);
  }, [p]);
  if (!byVersion.length) return <p className="text-xs text-ink-faint">No requests yet.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[520px] text-[12px]">
        <thead className="bg-panel-2 text-left text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">
          <tr>
            <th className="px-3 py-1.5">Ver</th>
            <th className="px-2 py-1.5">Request</th>
            <th className="px-2 py-1.5">Status</th>
            <th className="px-3 py-1.5 text-right">When</th>
          </tr>
        </thead>
        <tbody>
          {byVersion.flatMap(({ v, reqs }) =>
            reqs.map((r) => (
              <tr key={r.id} className="border-t border-line-soft align-top">
                <td className="px-3 py-1.5 text-ink-faint">{v.number}</td>
                <td className="px-2 py-1.5">
                  {r.text}
                  {r.adminText && <span className="block text-accent">→ {r.adminText}</span>}
                </td>
                <td className={`px-2 py-1.5 capitalize ${REQ_TONE[r.status]}`}>{r.status}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right text-ink-faint">{ago(r.createdAt)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function CreateDialog({
  timeline,
  busy,
  onClose,
  onCreate,
}: {
  timeline: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onCreate: (input: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [summary, setSummary] = useState("");
  const [lane, setLane] = useState<ContentLane>("auto");
  const [timelineProjectId, setTimelineProjectId] = useState("");
  const [repo, setRepo] = useState("");
  const [vercelProject, setVercelProject] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <form
        className="w-full max-w-md space-y-3 rounded-xl border border-line bg-panel p-4"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({ name, clientName, inviteEmail, siteUrl, summary, lane, timelineProjectId, repo, vercelProject });
        }}
      >
        <h2 className="text-base font-semibold">New client project</h2>
        <Field label="Projects Timeline project (optional)">
          <select
            className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm"
            value={timelineProjectId}
            onChange={(e) => {
              setTimelineProjectId(e.target.value);
              const t = timeline.find((x) => x.id === e.target.value);
              if (t && !name) setName(t.name);
            }}
          >
            <option value="">Not linked</option>
            {timeline.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Project name">
          <input required className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Glow Spa website" />
        </Field>
        <Field label="Client name">
          <input className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Dana" />
        </Field>
        <Field label="Client's Google email (optional — only this account can open the link)">
          <input type="email" className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="dana@gmail.com" />
        </Field>
        <Field label="v1 website URL">
          <input className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://glow-spa.vercel.app" />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="GitHub repo (lets approved edits build themselves)">
            <input className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 font-mono text-[13px]" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="legacymiles/glow-spa-site" />
          </Field>
          <Field label="Vercel project (optional)">
            <input className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 font-mono text-[13px]" value={vercelProject} onChange={(e) => setVercelProject(e.target.value)} placeholder="glow-spa-site" />
          </Field>
        </div>
        <Field label="What v1 is (optional)">
          <textarea className="h-16 w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-sm" value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        <Field label="Model lane">
          <div className="flex rounded-md border border-line bg-panel-2 p-0.5">
            {LANES.map((l) => (
              <button
                type="button"
                key={l.id}
                title={l.hint}
                onClick={() => setLane(l.id)}
                className={`flex-1 rounded px-2 py-1 text-xs ${lane === l.id ? "bg-brand/30" : "text-ink-muted"}`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">{LANES.find((l) => l.id === lane)?.hint}</p>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim()} className="rounded-md border border-brand/50 bg-brand/25 px-3 py-1.5 text-sm font-medium disabled:opacity-40">
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[11.5px] text-ink-faint">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}
