"use client";

// ---------------------------------------------------------------------------
// The Dashboard — where Jarvis reports in.
//
// The surface the owner asked for by name: the place updates arrive, with the
// knowledge graph as its hero rather than as a decoration in a corner. Memory
// and the Profile are PANELS here rather than rail tabs, which is the whole
// "fewer side tabs" change — and Record is gone, replaced by the Profile it
// should always have been.
//
// Layout is three columns on a wide screen and one on a phone:
//
//   left    the inspector — what you are looking at, or what you owe yourself
//   centre  the graph, and under it the sliders
//   right   the updates stream
//
// Only the graph is luminous. Every other pixel here is matte greyscale with
// colour coming from data alone, because that is what lets a dense panel be
// read rather than merely looked at.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { GraphControls } from "./GraphControls";
import { GraphInspector } from "./GraphInspector";
// WebGL never renders on the server, and importing three + R3F into the
// server bundle for a panel that may never be opened is pure weight. Loaded on
// demand, with a placeholder that holds the layout so the page does not jump.
const KnowledgeGraph = dynamic(() => import("./KnowledgeGraph").then((m) => m.KnowledgeGraph), {
  ssr: false,
  loading: () => <div className="h-full w-full" style={{ background: "#07080d" }} aria-hidden />,
});
import { VaultStatus } from "./VaultStatus";
import { ImprovePanel } from "./ImprovePanel";
import { RecordFiles } from "./RecordFiles";
import { ScreenScan } from "./ScreenScan";

import { MemoryTab } from "../jarvis/MemoryTab";
import { NewDashboard } from "../new-dashboard/NewDashboard";
import { RecordTab } from "../jarvis/RecordTab";
import { UpdatesPanel } from "../jarvis/UpdatesPanel";
import { ReminderBanner } from "../jarvis/ReminderBanner";

import { useForceGraph } from "@/lib/jarvis/graph/useForceGraph";
import { namedNotePath } from "@/lib/jarvis/vault/ops";
import type { VaultNode } from "@/lib/jarvis/graph/types";
import type { UseVault } from "@/lib/new-jarvis/useVault";
import type { UseImprove } from "@/lib/new-jarvis/useImprove";
import type { UpdatesApi } from "@/lib/jarvis/useUpdates";
import type { JarvisStore, MemorySource } from "@/lib/jarvis/types";
import type { DueReminder } from "@/lib/recall/calendar/reminders";
import type { UseQueue } from "@/lib/new-jarvis/useQueue";
import { QueueBoard } from "./QueueBoard";
import { Deck } from "./Deck";
import { FinishSetup, resumeStep, type OnboardingStep } from "./Onboarding";
import type { SetupStatus } from "@/lib/new-jarvis/useSetup";
import { getOnboarding } from "@/lib/new-jarvis/onboarding";
import type { CameraWatch } from "@/lib/new-jarvis/useCameraWatch";
import type { UseJarvisProfile } from "@/lib/jarvis-profile/useJarvisProfile";
import { JarvisProfile } from "./JarvisProfile";
import type { CalendarEvent } from "@/lib/recall/calendar/types";

type Pane = "deck" | "graph" | "memory" | "profile" | "jarvis" | "improve" | "queue";

const PANES: { id: Pane; label: string; icon: keyof typeof Icon }[] = [
  // The Deck is where the owner lands: favorites, last used, and Camera
  // Autopilot with its chat. The Brain graph is one tap away, unchanged.
  { id: "deck", label: "Deck", icon: "Home" },
  { id: "graph", label: "Brain", icon: "Grid" },
  { id: "memory", label: "Memory", icon: "Database" },
  { id: "profile", label: "Profile", icon: "Users" },
  // Jarvis's own side of the profile, beside the owner's: the self-learning
  // build checklist and the habits Jarvis has picked up.
  { id: "jarvis", label: "Jarvis Profile", icon: "Bot" },
  { id: "improve", label: "Improve", icon: "Bulb" },
  // The queue is a pane here as well as a tab in the rail, mounted from the
  // one hook so both see the same rows and the same verdicts. The dashboard is
  // where the owner lands, and "what have I left unfinished" belongs with
  // "what do I know" and "who am I" rather than only behind its own door.
  { id: "queue", label: "In Queue", icon: "ListChecks" },
];

interface Props {
  vault: UseVault;
  improve: UseImprove;
  updates: UpdatesApi;
  store: JarvisStore;
  commit: (next: JarvisStore) => void;
  reminders: DueReminder[];
  onDismissReminder: (id: string, minutes: number) => void;
  bridgeUp: boolean;
  /**
   * The In Queue board, passed in rather than mounted here.
   *
   * The shell holds it because the dock shows the unfinished count at all
   * times. Mounting a second copy for this pane would scan the repo twice and,
   * worse, give the two boards separate verdict state — so a pip clicked on
   * the dashboard would not be clicked on the tab.
   */
  queue: UseQueue;
  /** Where a tab-opening update should send the owner. */
  go: (tab: string) => void;
  /** What Jarvis calls the owner, for the Deck's greeting. */
  ownerName?: string;
  /** The Finish-setup checklist, owned by the shell so the hero and Profile agree. */
  setup: SetupStatus;
  onOpenSetup: (step: OnboardingStep) => void;
  /** Hand-typed and Dashboard calendar events, merged by the shell. */
  events: CalendarEvent[];
  /** The 10-minute iPhone check, owned by the shell. */
  camera: CameraWatch;
  /** Jarvis Profile's checklist, owned by the shell so it learns from any tab. */
  jarvisProfile: UseJarvisProfile;
}

export function DashboardPanel({
  vault,
  improve,
  updates,
  store,
  commit,
  reminders,
  onDismissReminder,
  bridgeUp,
  queue,
  go,
  ownerName,
  setup,
  onOpenSetup,
  events,
  camera,
  jarvisProfile,
}: Props) {
  const [pane, setPane] = useState<Pane>("deck");
  const [muted, setMuted] = useState<Set<MemorySource>>(new Set());
  const [writing, setWriting] = useState<VaultNode | null>(null);
  /** Bumped when a screen scan writes, to remount the profile beneath it. */
  const [profileKey, setProfileKey] = useState(0);
  /** Which half of the profile is showing. */
  const [profileFace, setProfileFace] = useState<"details" | "aios">("details");

  // Sources the owner has switched off are removed from the graph entirely
  // rather than merely dimmed: a filter that leaves the node in place still
  // has it pulling on the layout, so the graph would not actually relax.
  const visible = useMemo(
    () => ({
      ...vault.graph,
      nodes: vault.graph.nodes.filter((n) => n.kind !== "note" || !muted.has(n.source)),
    }),
    [vault.graph, muted],
  );

  const graph = useForceGraph(visible);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of vault.graph.nodes) {
      if (node.kind !== "note") continue;
      map.set(node.source, (map.get(node.source) ?? 0) + 1);
    }
    return map;
  }, [vault.graph.nodes]);

  const ghosts = useMemo(() => vault.graph.nodes.filter((n) => n.kind === "ghost").length, [vault.graph.nodes]);
  const notes = useMemo(() => vault.graph.nodes.filter((n) => n.kind === "note").length, [vault.graph.nodes]);

  const selected = useMemo(
    () => graph.nodes.find((n) => n.key === graph.selection.selected) ?? null,
    [graph.nodes, graph.selection.selected],
  );

  const toggleSource = useCallback((source: MemorySource) => {
    setMuted((m) => {
      const next = new Set(m);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  return (
    // h-full, not flex-1: the parent is a block scroll container, where
    // flex-1 means nothing and the panel would collapse to its content height,
    // leaving the graph floating above a band of dead space.
    <div className="flex h-full min-h-0 flex-col">
      {/* The vault's sync line belongs to the Brain; on the Deck it was one
          more strip of chrome between the owner and their stuff. */}
      {pane === "graph" && (
        <VaultStatus
          mirrorOnly={vault.mirrorOnly}
          present={vault.present}
          root={vault.root}
          progress={vault.progress}
          waiting={vault.waiting.length}
          notes={notes}
          error={vault.error}
          bridgeUp={bridgeUp}
          onSweep={() => void vault.sweep()}
          onFlush={() => void vault.flush()}
        />
      )}

      {reminders.length > 0 && <ReminderBanner queue={reminders} onDismiss={onDismissReminder} />}

      {/* Pane switcher, minimal: the pane you are on, and everything else
          behind one "more" button. The owner asked for fewer tabs — the Deck
          is where they live, and the rest is one tap away, not six. */}
      <PaneSwitcher
        pane={pane}
        onPane={setPane}
        improveBadge={improve.collected.proposals.length}
        unread={updates.unread}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        {pane === "deck" ? (
          <Deck
            go={go}
            ownerName={ownerName}
            unread={updates.unread}
            setupLeft={setup.left}
            onSetup={() => onOpenSetup(resumeStep(getOnboarding().lastStep, setup.items))}
            updates={updates}
            events={events}
            camera={camera}
            store={store}
            audit={improve.collected.proposals}
            queue={queue}
          />
        ) : pane === "graph" ? (
          <div className="flex h-full min-h-0 flex-col lg:flex-row">
            {/* left — the inspector */}
            <aside className="order-2 shrink-0 overflow-y-auto border-line bg-panel lg:order-1 lg:w-[270px] lg:border-r">
              <GraphInspector
                graph={visible}
                selected={selected}
                body={bodyOf(vault, selected)}
                onSelect={graph.select}
                onWriteGhost={setWriting}
                root={vault.root}
              />
            </aside>

            {/* centre — the graph */}
            <div className="order-1 flex min-h-0 flex-1 flex-col lg:order-2">
              <div className="relative min-h-[280px] flex-1">
                {notes === 0 && ghosts === 0 ? (
                  <EmptyBrain present={vault.present} root={vault.root} bridgeUp={bridgeUp} onSweep={() => void vault.sweep()} />
                ) : (
                  <>
                    <KnowledgeGraph graph={graph} onWriteGhost={setWriting} />
                    <Hud notes={notes} ghosts={ghosts} edges={visible.edges.length} hovered={graph.selection.hovered} nodes={graph.nodes} />
                  </>
                )}
              </div>
              <div className="shrink-0 border-t border-line bg-panel lg:hidden">
                <GraphControls
                  params={graph.params}
                  onParams={graph.setParams}
                  search={graph.search}
                  onSearch={graph.setSearch}
                  matches={graph.matches.size}
                  counts={counts}
                  ghosts={ghosts}
                  muted={muted}
                  onToggleSource={toggleSource}
                  onResettle={graph.resettle}
                  moving={graph.moving}
                />
              </div>
            </div>

            {/* right — controls above the stream */}
            <aside className="order-3 hidden w-[260px] shrink-0 overflow-y-auto border-l border-line bg-panel lg:block">
              <GraphControls
                params={graph.params}
                onParams={graph.setParams}
                search={graph.search}
                onSearch={graph.setSearch}
                matches={graph.matches.size}
                counts={counts}
                ghosts={ghosts}
                muted={muted}
                onToggleSource={toggleSource}
                onResettle={graph.resettle}
                moving={graph.moving}
              />
              <div className="border-t border-line p-2">
                <UpdatesPanel api={updates} go={(t) => go(String(t))} />
              </div>
            </aside>
          </div>
        ) : pane === "queue" ? (
          <QueueBoard queue={queue} />
        ) : pane === "jarvis" ? (
          <JarvisProfile api={jarvisProfile} />
        ) : pane === "memory" ? (
          <div className="h-full overflow-y-auto">
            <MemoryTab store={store} commit={commit} />
          </div>
        ) : pane === "profile" ? (
          <div className="flex h-full min-h-0 flex-col">
            {/* Two halves of one subject, and both are "the profile":
                WHO YOU ARE is the life record — the 47 fields a form asks for.
                HOW YOU WORK is the Four-Cs intake, which also carries the
                onboarding interview.
                The record half had no mount in this shell at all until now,
                which meant a screen scan could write facts the owner then had
                no way to see. */}
            <div className="flex shrink-0 items-center gap-0.5 border-b border-line-soft px-3 py-1.5">
              {(
                [
                  { id: "details", label: "Who you are" },
                  { id: "aios", label: "How you work" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setProfileFace(t.id)}
                  aria-current={profileFace === t.id ? "page" : undefined}
                  className={`rounded px-2 py-1 text-[11px] transition ${
                    profileFace === t.id ? "bg-elevated text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {profileFace === "details" ? (
                <>
                  {/* Reading a screen belongs HERE, above the record it writes
                      into. What it proposes is judged against that record, so
                      the two want to be in one place. */}
                  <div className="space-y-2.5 border-b border-line-soft p-3">
                    <FinishSetup setup={setup} onOpen={onOpenSetup} go={go} />
                    <ScreenScan onSaved={() => setProfileKey((n) => n + 1)} />
                    {/* The documents sit with the reader that made them, and
                        are keyed with the record so one just kept appears. */}
                    <RecordFiles key={`files-${profileKey}`} onChanged={() => setProfileKey((n) => n + 1)} />
                  </div>
                  {/* Keyed, so the record redraws with what a scan just saved
                      rather than what it held when it mounted. */}
                  <RecordTab key={profileKey} />
                </>
              ) : (
                <NewDashboard chromeless />
              )}
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto p-3">
            <div className="mx-auto max-w-2xl">
              <ImprovePanel
                collected={improve.collected}
                summary={improve.summary}
                approved={improve.state.approved}
                onApprove={improve.approve}
                onSnooze={improve.snooze}
                onDismiss={improve.dismiss}
                unavailable={improve.unavailable}
              />
            </div>
          </div>
        )}
      </div>

      {writing && (
        <WriteGhost
          node={writing}
          onClose={() => setWriting(null)}
          onWrite={async (body) => {
            // The path is the TITLE, not a timestamped slug. Links resolve by
            // basename, so a note written for [[Jarvis Studio]] has to be
            // called "Jarvis Studio.md" or every link that asked for it is
            // still dangling — which is the one thing this button promises
            // to fix.
            await vault.capture({ title: writing.title, body, path: namedNotePath(writing.title) });
            setWriting(null);
          }}
        />
      )}

      {/* The stream, on a phone, where there is no third column for it. */}
      {pane === "graph" && (
        <div className="shrink-0 border-t border-line bg-panel p-2 lg:hidden">
          <UpdatesPanel api={updates} go={(t) => go(String(t))} />
        </div>
      )}
    </div>
  );
}

function PaneSwitcher({
  pane,
  onPane,
  improveBadge,
  unread,
}: {
  pane: Pane;
  onPane: (p: Pane) => void;
  improveBadge: number;
  unread: number;
}) {
  const [open, setOpen] = useState(false);
  const current = PANES.find((p) => p.id === pane) ?? PANES[0];
  const others = PANES.filter((p) => p.id !== pane);
  const Cur = Icon[current.icon];
  return (
    <div className="relative flex shrink-0 items-center gap-1 border-b border-line-soft px-3 py-1.5">
      {pane !== "deck" && (
        <button
          type="button"
          onClick={() => onPane("deck")}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-muted transition hover:text-ink"
        >
          <Icon.ArrowLeft width={11} height={11} aria-hidden />
          Deck
        </button>
      )}
      <span className="inline-flex items-center gap-1.5 px-1.5 py-1 text-[11px] font-medium text-ink">
        <Cur width={11} height={11} aria-hidden />
        {current.label}
      </span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="More dashboard views"
        className="ml-auto inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
      >
        {unread > 0 && (
          <span className="rounded-full border border-line px-1.5 font-mono text-[9.5px]" data-num>
            {unread} new
          </span>
        )}
        <Icon.Menu width={13} height={13} aria-hidden />
      </button>
      {open && (
        <>
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <ul className="absolute right-2 top-full z-40 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-2xl">
            {others.map((p) => {
              const I = Icon[p.icon];
              const badge = p.id === "improve" ? improveBadge : 0;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPane(p.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
                  >
                    <I width={12} height={12} aria-hidden />
                    {p.label}
                    {badge > 0 && (
                      <span className="ml-auto rounded-full bg-line px-1.5 font-mono text-[9px]" data-num>
                        {badge}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** The note's raw markdown, when the graph happens to be holding it. */
function bodyOf(vault: UseVault, node: VaultNode | null): string | undefined {
  if (!node?.path) return undefined;
  // The graph's nodes do not carry bodies; the inspector reads frontmatter from
  // whatever the sweep last held. Returning undefined simply means the
  // inspector shows the title and links without an excerpt, which is honest.
  return vault.bodies?.get(node.path);
}

/**
 * The readout over the graph.
 *
 * Typography leads, even here: the counts are the headline and the graph is the
 * illustration, not the other way round. Hovering replaces the counts with the
 * node's own name, so the pointer always has an answer.
 */
function Hud({
  notes,
  ghosts,
  edges,
  hovered,
  nodes,
}: {
  notes: number;
  ghosts: number;
  edges: number;
  hovered: string | null;
  nodes: VaultNode[];
}) {
  const node = hovered ? nodes.find((n) => n.key === hovered) : null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
      {node ? (
        <>
          <p className="text-[13px] font-medium leading-tight text-ink">{node.title}</p>
          <p className="mt-0.5 font-mono text-[10px] text-ink-muted">
            {node.kind === "ghost" ? "not written yet · click to write it" : node.path}
          </p>
        </>
      ) : (
        <>
          <p className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">Your brain</p>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            <span className="font-mono text-ink" data-num>
              {notes}
            </span>{" "}
            notes ·{" "}
            <span className="font-mono text-ink" data-num>
              {edges}
            </span>{" "}
            links
            {ghosts > 0 && (
              <>
                {" "}
                ·{" "}
                <span className="font-mono text-amber-300" data-num>
                  {ghosts}
                </span>{" "}
                not written yet
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}

/** Nothing indexed. Teaches the surface rather than announcing emptiness. */
function EmptyBrain({
  present,
  root,
  bridgeUp,
  onSweep,
}: {
  present: boolean | null;
  root: string;
  bridgeUp: boolean;
  onSweep: () => void;
}) {
  return (
    <div className="flex h-full items-center">
      <div className="max-w-md p-5">
        <h2 className="text-[15px] font-semibold text-ink">Your second brain is empty.</h2>
        {present === false ? (
          <>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
              There is no vault at{" "}
              <code className="font-mono text-[11px] text-ink">{root || "the expected folder"}</code>. Create that folder
              and open it in Obsidian — or point <code className="font-mono text-[11px] text-ink">JARVIS_VAULT</code> at
              the one you already have.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Write a few notes with <code className="font-mono">[[links]]</code> between them and sweep. The links are
              what turn a folder of files into a graph.
            </p>
          </>
        ) : bridgeUp ? (
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
            Your PC is reachable. Sweep and it will read the vault.
          </p>
        ) : (
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
            Nothing is indexed yet, and your PC is not reachable to read the vault. You can still capture notes here —
            they become searchable immediately and land on disk when the agent is next running.
          </p>
        )}
        <button
          type="button"
          onClick={onSweep}
          className="mt-3 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-[11.5px] text-ink transition hover:border-ink-faint hover:bg-elevated"
        >
          Sweep the vault
        </button>
      </div>
    </div>
  );
}

/**
 * The signature moment: a ghost becomes a note.
 *
 * Pre-titled, because the name already exists — every link pointing at it
 * chose that name, and changing it here would orphan all of them. The owner
 * only has to supply the thing they have been meaning to write down.
 */
function WriteGhost({
  node,
  onClose,
  onWrite,
}: {
  node: VaultNode;
  onClose: () => void;
  onWrite: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Write ${node.title}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl border border-line bg-panel shadow-2xl">
        <header className="flex items-start gap-2 border-b border-line px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">Write it into existence</p>
            <h2 className="mt-0.5 truncate text-[14px] font-semibold text-ink">{node.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-faint transition hover:text-ink"
          >
            <Icon.Close width={12} height={12} />
          </button>
        </header>

        <div className="p-3">
          <textarea
            ref={area}
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            placeholder={`What you have been meaning to write down about ${node.title}. Three lines is plenty — [[link]] to anything related.`}
            className="w-full resize-y rounded-md border border-line bg-panel-2 px-2.5 py-2 text-[12px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
          />
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
            Saved to <code className="font-mono">notes/</code> in your vault. Every link already pointing at this name
            starts working the moment it exists.
          </p>
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-3 py-2.5">
          <button
            type="button"
            disabled={!body.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onWrite(body);
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md border border-line bg-brand px-2.5 py-1.5 text-[11.5px] font-medium text-white transition hover:bg-[var(--nj-brand-press)] disabled:opacity-50"
          >
            {busy ? "Writing…" : "Write the note"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1.5 text-[11.5px] text-ink-muted transition hover:text-ink"
          >
            Not now
          </button>
        </footer>
      </div>
    </div>
  );
}
