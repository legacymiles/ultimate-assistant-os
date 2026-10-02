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

import { MemoryTab } from "../jarvis/MemoryTab";
import { NewDashboard } from "../new-dashboard/NewDashboard";
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

type Pane = "graph" | "memory" | "profile" | "improve";

const PANES: { id: Pane; label: string; icon: keyof typeof Icon }[] = [
  { id: "graph", label: "Brain", icon: "Grid" },
  { id: "memory", label: "Memory", icon: "Database" },
  { id: "profile", label: "Profile", icon: "Users" },
  { id: "improve", label: "Improve", icon: "Bulb" },
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
  /** Where a tab-opening update should send the owner. */
  go: (tab: string) => void;
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
  go,
}: Props) {
  const [pane, setPane] = useState<Pane>("graph");
  const [muted, setMuted] = useState<Set<MemorySource>>(new Set());
  const [writing, setWriting] = useState<VaultNode | null>(null);

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

      {reminders.length > 0 && <ReminderBanner queue={reminders} onDismiss={onDismissReminder} />}

      {/* Pane switcher. Memory and Profile live HERE, which is the whole
          point: two fewer entries in the rail, and the two things that are
          really about the same subject sitting next to each other. */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-line bg-panel px-2 py-1">
        {PANES.map((p) => {
          const I = Icon[p.icon];
          const on = pane === p.id;
          const badge = p.id === "improve" ? improve.collected.proposals.length : 0;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPane(p.id)}
              aria-current={on ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition ${
                on ? "bg-elevated text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"
              }`}
            >
              <I width={11} height={11} aria-hidden />
              {p.label}
              {badge > 0 && (
                <span className="rounded-full bg-line px-1 font-mono text-[9px] text-ink-muted" data-num>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
        {updates.unread > 0 && (
          <span className="ml-auto rounded-full border border-line px-1.5 py-0.5 font-mono text-[9.5px] text-ink-muted" data-num>
            {updates.unread} new
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {pane === "graph" ? (
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
        ) : pane === "memory" ? (
          <div className="h-full overflow-y-auto">
            <MemoryTab store={store} commit={commit} />
          </div>
        ) : pane === "profile" ? (
          <div className="h-full overflow-y-auto">
            {/* The Four-Cs profile app, mounted whole. This is also the only
                mount point of the onboarding interview, so putting it here is
                what brings onboarding into New Jarvis at all. */}
            <NewDashboard chromeless />
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
