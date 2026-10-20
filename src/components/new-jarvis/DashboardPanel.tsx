"use client";

// ---------------------------------------------------------------------------
// The Dashboard — where Jarvis reports in.
//
// The surface the owner asked for by name: the Deck (widgets) first, and the
// rest one tap away — Memory (the Map, a living web of everything Jarvis knows,
// plus the list), Profile (who you are, how you work, the backend checklist),
// Improve and In Queue. Memory and the Profile are PANELS here rather than rail
// tabs, which is the whole "fewer side tabs" change.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { VaultStatus } from "./VaultStatus";
import { MemoryMap } from "./MemoryMap";
import { ImprovePanel } from "./ImprovePanel";
import { RecordFiles } from "./RecordFiles";
import { ScreenScan } from "./ScreenScan";

import { MemoryTab } from "../jarvis/MemoryTab";
import { NewDashboard } from "../new-dashboard/NewDashboard";
import { RecordTab } from "../jarvis/RecordTab";
import { ReminderBanner } from "../jarvis/ReminderBanner";

import type { UseVault } from "@/lib/new-jarvis/useVault";
import type { UseImprove } from "@/lib/new-jarvis/useImprove";
import type { UpdatesApi } from "@/lib/jarvis/useUpdates";
import type { JarvisStore } from "@/lib/jarvis/types";
import type { DueReminder } from "@/lib/recall/calendar/reminders";
import type { UseQueue } from "@/lib/new-jarvis/useQueue";
import { QueueBoard } from "./QueueBoard";
import { Deck } from "./Deck";
import { FinishSetup, resumeStep, type OnboardingBridge, type OnboardingStep } from "./Onboarding";
import { Connections, OPEN_CONNECTIONS, takePendingConnections } from "./Connections";
import type { SetupStatus } from "@/lib/new-jarvis/useSetup";
import { getOnboarding } from "@/lib/new-jarvis/onboarding";
import type { CameraWatch } from "@/lib/new-jarvis/useCameraWatch";
import type { UseJarvisProfile } from "@/lib/jarvis-profile/useJarvisProfile";
import { BackendChecklist } from "./BackendChecklist";
import type { CalendarEvent } from "@/lib/recall/calendar/types";

type Pane = "deck" | "memory" | "profile" | "personas" | "improve" | "queue";

// Personas Studio, mounted whole as the Personas pane. Loaded only when the
// pane is opened, so the Dashboard doesn't carry the Studio's weight.
const PersonasStudio = dynamic(() => import("../social-personas/SocialPersonas").then((m) => m.PersonasStudio), {
  ssr: false,
  loading: () => <div className="p-4 text-xs text-ink-faint">Opening Personas Studio…</div>,
});

const PANES: { id: Pane; label: string; icon: keyof typeof Icon }[] = [
  // The Deck is where the owner lands: favorites, last used, and Camera
  // Autopilot with its chat.
  { id: "deck", label: "Deck", icon: "Home" },
  // Memory holds the web of everything Jarvis knows (the Map, which replaced
  // the old vault-only Brain tab) and the list of memories behind it.
  { id: "memory", label: "Memory", icon: "Database" },
  { id: "profile", label: "Profile", icon: "Users" },
  // Right under Memory and Profile: the content studio for the owner's personas.
  { id: "personas", label: "Personas", icon: "Film" },
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
  /** The backend checklist (shown in Profile), owned by the shell so it learns from any tab. */
  jarvisProfile: UseJarvisProfile;
  /** The PC's local agent, for saving pasted keys (Profile › Connections). */
  keysBridge: OnboardingBridge;
  /** Hand a job to the super-agent chat ("Jarvis, do it"). */
  ask: (task: string) => void;
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
  keysBridge,
  ask,
}: Props) {
  const [pane, setPane] = useState<Pane>("deck");
  /** Memory: the web, or the list. */
  const [memoryFace, setMemoryFace] = useState<"map" | "list">("map");
  /** Bumped when a screen scan writes, to remount the profile beneath it. */
  const [profileKey, setProfileKey] = useState(0);
  /** Which half of the profile is showing. */
  const [profileFace, setProfileFace] = useState<"details" | "aios" | "checklist" | "connections">("details");
  /** A Connections row to open on arrival (from a link like #connections/youtube). */
  const [connFocus, setConnFocus] = useState<string | null>(null);
  useEffect(() => {
    const open = () => {
      const p = takePendingConnections();
      if (!p) return;
      setPane("profile");
      setProfileFace("connections");
      setConnFocus(p.capability);
    };
    open();
    window.addEventListener(OPEN_CONNECTIONS, open);
    return () => window.removeEventListener(OPEN_CONNECTIONS, open);
  }, []);

  const notes = useMemo(() => vault.graph.nodes.filter((n) => n.kind === "note").length, [vault.graph.nodes]);

  return (
    // h-full, not flex-1: the parent is a block scroll container, where
    // flex-1 means nothing and the panel would collapse to its content height,
    // leaving the graph floating above a band of dead space.
    <div className="flex h-full min-h-0 flex-col">
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
        ) : pane === "queue" ? (
          <QueueBoard queue={queue} />
        ) : pane === "personas" ? (
          <div className="h-full min-h-0">
            <PersonasStudio embedded />
          </div>
        ) : pane === "memory" ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-0.5 border-b border-line-soft px-3 py-1.5">
              {(
                [
                  { id: "map", label: "Map" },
                  { id: "list", label: "List" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMemoryFace(t.id)}
                  aria-current={memoryFace === t.id ? "page" : undefined}
                  className={`rounded px-2 py-1 text-[11px] transition ${
                    memoryFace === t.id ? "bg-elevated text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {memoryFace === "map" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                {/* The vault's sync line: only when there is a vault to sync. */}
                {(vault.present || notes > 0) && (
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
                <div className="min-h-0 flex-1">
                  <MemoryMap queue={queue} store={store} vault={vault} />
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <MemoryTab store={store} commit={commit} />
              </div>
            )}
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
                  // The one build checklist lives here, in the owner's
                  // Profile, rather than behind a tab of its own.
                  { id: "checklist", label: "Backend checklist" },
                  // Every API key, each with a clickable step-by-step guide.
                  { id: "connections", label: "Connections" },
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
              {profileFace === "connections" ? (
                <Connections setup={setup} bridge={keysBridge} ask={ask} focus={connFocus} />
              ) : profileFace === "checklist" ? (
                <BackendChecklist api={jarvisProfile} />
              ) : profileFace === "details" ? (
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
