"use client";

// ---------------------------------------------------------------------------
// New Jarvis — the shell.
//
// Three columns that never change: the rail, the centre, and the right-hand
// column carrying voice and this machine's capabilities. What swaps is only
// the middle, and only between the console and a tab the owner went to; the
// command line stays above all of it, so asking for something is never
// somewhere you have to navigate to.
//
// The existing tabs are MOUNTED, not rebuilt. They read the same stores as
// /apps/jarvis — same keys, same Supabase rows — so the owner's folders,
// photos, lists, calendar, memory and Record are the same data seen through a
// different frame, and nothing here can migrate, copy or lose any of it.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import "./new-jarvis.css";

import { BlockView } from "./Blocks";
import { CommandLine } from "./CommandLine";
import { BridgePanel, VoicePanel } from "./SidePanels";

import { useBridge } from "@/lib/new-jarvis/useBridge";
import { useWakeVoice } from "@/lib/new-jarvis/useWakeVoice";
import { runBlock, type WireMessage } from "@/lib/new-jarvis/runner";
import { MAX_LIVE_BLOCKS, newBlock, type Block, type Gate, type Mode } from "@/lib/new-jarvis/types";

// The owner's existing surfaces, mounted whole.
import { Recall } from "../recall/Recall";
import { ListsBoard } from "../recall/lists/ListsBoard";
import { CalendarTab } from "../jarvis/CalendarTab";
import { MemoryTab } from "../jarvis/MemoryTab";
import { RecordTab } from "../jarvis/RecordTab";
import { StudioTab } from "../jarvis/StudioTab";
import { RoutinesTab } from "../jarvis/RoutinesTab";
import { InboxTab } from "../jarvis/InboxTab";
import { SkillsLibrary } from "../skills/SkillsLibrary";
import { ToolsTab } from "../jarvis/ToolsTab";
import { PluginsTab } from "../jarvis/PluginsTab";

import { loadLocal } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { STORE_KEY, emptyStore } from "@/lib/new-dashboard/model";
import type { DashboardStore, Profile } from "@/lib/new-dashboard/types";
import { JARVIS_KEY, loadJarvis, saveJarvis } from "@/lib/jarvis/store";
import type { JarvisStore } from "@/lib/jarvis/types";
import { useDashboardCalendar } from "@/lib/jarvis/useDashboardCalendar";

type TabId =
  | "console" | "folders" | "photos" | "lists" | "calendar" | "inbox"
  | "memory" | "record" | "studio" | "routines" | "skills" | "tools" | "plugins";

const TABS: { id: TabId; label: string; icon: keyof typeof Icon }[] = [
  { id: "console", label: "Console", icon: "Bot" },
  { id: "folders", label: "Folders", icon: "Folder" },
  { id: "photos", label: "Photos", icon: "Image" },
  { id: "lists", label: "Lists", icon: "ListChecks" },
  { id: "calendar", label: "Calendar", icon: "Calendar" },
  { id: "inbox", label: "Inbox", icon: "Inbox" },
  { id: "memory", label: "Memory", icon: "Database" },
  { id: "record", label: "Record", icon: "Shield" },
  { id: "studio", label: "Studio", icon: "Film" },
  { id: "routines", label: "Routines", icon: "Clock" },
  { id: "skills", label: "Skills", icon: "Sparkles" },
  { id: "tools", label: "Tools", icon: "Layers" },
  { id: "plugins", label: "Apps", icon: "Launch" },
];

function isTab(v: string): v is TabId {
  return TABS.some((t) => t.id === v);
}

export function NewJarvis() {
  const [tab, setTab] = useState<TabId>("console");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("do");
  const [speakReplies, setSpeakReplies] = useState(true);
  /** The phone-only panel strip; the wide layout shows both panels always. */
  const [panelsOpen, setPanelsOpen] = useState(false);

  const bridge = useBridge();

  // --- the owner's stores, exactly as /apps/jarvis reads them --------------
  const [store, setStore] = useState<JarvisStore | null>(null);
  const [profiles, setProfiles] = useState<DashboardStore>(emptyStore);
  const reload = useCallback(() => {
    setStore(loadJarvis());
    setProfiles(loadLocal<DashboardStore>(STORE_KEY, emptyStore()));
  }, []);
  useEffect(reload, [reload]);
  useRemotePull(JARVIS_KEY, reload);
  useRemotePull(STORE_KEY, reload);
  const commit = useCallback((next: JarvisStore) => {
    setStore(next);
    saveJarvis(next);
  }, []);
  const profile: Profile | null = useMemo(
    () => profiles.profiles.find((p) => p.id === profiles.activeId) ?? profiles.profiles[0] ?? null,
    [profiles],
  );
  const dash = useDashboardCalendar();

  // --- gates ---------------------------------------------------------------
  // A gate is a promise the block's buttons resolve. Keeping the resolver here
  // rather than in the block means a run survives the owner switching tabs
  // mid-gate: the block is unmounted, the promise is not.
  const gateResolvers = useRef(new Map<string, (yes: boolean) => void>());
  const aborts = useRef(new Map<string, AbortController>());

  const patch = useCallback((id: string, p: Partial<Block>) => {
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...p } : b)));
  }, []);

  /** Past blocks as conversation, so a follow-up knows what "it" means. */
  const historyFor = useCallback((): WireMessage[] => {
    const recent = blocks.filter((b) => b.status === "done" && b.answer).slice(0, 4).reverse();
    return recent.flatMap((b): WireMessage[] => [
      { role: "user", content: b.command },
      { role: "assistant", content: b.answer },
    ]);
  }, [blocks]);

  // Voice needs to call submit, and submit needs to speak the answer. The ref
  // breaks that cycle without either one being recreated on every keystroke.
  const submitRef = useRef<(text?: string, source?: Block["source"]) => void>(() => {});

  const voice = useWakeVoice({
    speakReplies,
    onInterrupt: () => {
      // Talking over it stops whatever is speaking; it does not cancel the
      // work, which may already have changed something.
    },
    onCommand: (text) => submitRef.current(text, "voice"),
  });

  const submit = useCallback(
    async (rawText?: string, source: Block["source"] = "typed") => {
      const command = (rawText ?? input).trim();
      if (!command) return;
      if (source === "typed") setInput("");

      const block = newBlock({ command, mode, source });
      setBlocks((bs) => [block, ...bs].slice(0, MAX_LIVE_BLOCKS));
      setTab("console");

      const controller = new AbortController();
      aborts.current.set(block.id, controller);
      const history = historyFor();

      const outcome = await runBlock(
        { command, mode, history },
        {
          signal: controller.signal,
          update: (p) => patch(block.id, p),
          think: async (messages) => {
            const res = await fetch("/api/new-jarvis/agent", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                messages,
                mode,
                capabilities: bridge.health.paired ? bridge.health.capabilities ?? {} : {},
                ownerName: profile?.name ?? "",
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              }),
            });
            const data = (await res.json()) as { error?: string };
            if (!res.ok) throw new Error(data.error ?? `The agent answered ${res.status}.`);
            return data;
          },
          runTool: (route, args) => bridge.run(route, args),
          askGate: (gate: Gate) =>
            new Promise<boolean>((resolve) => {
              gateResolvers.current.set(block.id, resolve);
            }),
        },
      );

      aborts.current.delete(block.id);
      gateResolvers.current.delete(block.id);
      // Only the answer is spoken. Reading a failure aloud in a calm voice is
      // how you end up believing a job succeeded.
      if (outcome.status === "done" && outcome.answer && source === "voice") {
        void voice.speak(outcome.answer);
      } else if (voice.listening) {
        voice.setState("waiting");
      }
      void bridge.refresh();
    },
    [bridge, historyFor, input, mode, patch, profile?.name, voice],
  );

  useEffect(() => {
    submitRef.current = (text, source) => void submit(text, source);
  }, [submit]);

  const answerGate = useCallback(
    (id: string, yes: boolean) => {
      const resolve = gateResolvers.current.get(id);
      if (!resolve) {
        // The run that opened this gate is gone — the component remounted
        // under it. Nothing is waiting on the answer any more, so the honest
        // thing is to close the block as stopped rather than leave a pair of
        // buttons that do nothing when pressed.
        patch(id, { status: "stopped", gate: null, error: "This run was interrupted before you answered." });
        return;
      }
      resolve(yes);
      gateResolvers.current.delete(id);
    },
    [patch],
  );

  const stop = useCallback((id: string) => {
    aborts.current.get(id)?.abort();
    gateResolvers.current.get(id)?.(false);
    gateResolvers.current.delete(id);
  }, []);

  // The tab lives in the hash, so reload and back land where the owner was.
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.replace("#", "");
      if (isTab(h)) setTab(h);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const go = (id: TabId) => {
    setTab(id);
    window.location.hash = id;
  };

  const running = blocks.some((b) => b.status === "running" || b.status === "waiting");
  const caps = bridge.health.capabilities;
  const readyCount = caps ? ["browser", "shell", "files", "system"].filter((k) => caps[k as "browser"] === true).length : 0;

  return (
    <div className="nj">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          <Icon.ArrowLeft width={13} height={13} />
          <span className="hidden sm:inline">Hub</span>
        </Link>
        <span className="text-sm font-semibold text-ink">New Jarvis</span>
        <span className="hidden text-xs text-ink-faint sm:inline">
          · {profile ? `${profile.name}'s assistant` : "the console"}
        </span>
        <Link
          href="/apps/jarvis"
          className="ml-auto rounded-lg border border-line px-2 py-1 text-[11px] text-ink-faint transition hover:bg-panel-2 hover:text-ink-muted"
        >
          Old Jarvis
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Sections"
          className="flex w-[var(--nj-rail)] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-panel py-2"
        >
          {TABS.map((t) => {
            const I = Icon[t.icon];
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => go(t.id)}
                title={t.label}
                aria-current={on ? "page" : undefined}
                className={`group relative mx-1.5 flex flex-col items-center gap-0.5 rounded-md py-1.5 transition ${
                  on ? "bg-elevated text-ink" : "text-ink-faint hover:bg-panel-2 hover:text-ink-muted"
                }`}
              >
                <I width={15} height={15} />
                <span className="text-[9.5px] leading-none">{t.label}</span>
                {t.id === "console" && running && (
                  <span className="nj-dot absolute right-1 top-1 bg-brand" data-live="true" aria-hidden />
                )}
              </button>
            );
          })}
        </nav>

        <main className="flex min-w-0 flex-1 flex-col">
          <CommandLine
            value={input}
            onChange={setInput}
            onSubmit={() => void submit()}
            mode={mode}
            onMode={setMode}
            voiceState={voice.state}
            heard={voice.heard}
            micSupported={voice.supported}
            onMic={voice.toggle}
            busy={false}
          />

          {/* On a phone the right-hand column is gone, and with it the only
              place that says whether voice is on and whether this PC can be
              reached — including the pairing control. One tappable strip
              brings both back rather than leaving the agent unfixable from the
              device the owner most often has in their hand. */}
          <div className="border-b border-line bg-panel lg:hidden">
            <button
              type="button"
              onClick={() => setPanelsOpen((o) => !o)}
              aria-expanded={panelsOpen}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
            >
              <span className={`nj-dot ${voice.listening ? "bg-core" : "bg-ink-faint/50"}`} data-live={voice.state === "hearing"} aria-hidden />
              <span className="text-[11px] text-ink-muted">
                {voice.listening ? "Voice on" : "Voice off"}
              </span>
              <span className="text-[11px] text-ink-faint">·</span>
              <span className="text-[11px] text-ink-muted" data-num>
                {bridge.health.up && bridge.health.paired
                  ? `${readyCount} of 4 ready on this PC`
                  : bridge.health.up
                    ? "PC not paired"
                    : "PC not reachable"}
              </span>
              <Icon.Chevron
                width={11}
                height={11}
                className={`ml-auto text-ink-faint transition-transform ${panelsOpen ? "rotate-90" : ""}`}
                aria-hidden
              />
            </button>
            {panelsOpen && (
              <div className="border-t border-line-soft">
                <VoicePanel
                  state={voice.state}
                  level={voice.level}
                  heard={voice.heard}
                  error={voice.error}
                  supported={voice.supported}
                  onToggle={voice.toggle}
                  speakReplies={speakReplies}
                  onSpeakReplies={setSpeakReplies}
                />
                <BridgePanel
                  health={bridge.health}
                  ready={bridge.ready}
                  hasToken={bridge.hasToken}
                  onPair={(t) => void bridge.pair(t)}
                  onUnpair={bridge.unpair}
                  onRefresh={bridge.refresh}
                />
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "console" ? (
              <div className="space-y-2 p-3">
                {blocks.length === 0 ? (
                  <Empty paired={bridge.health.paired && bridge.health.up} />
                ) : (
                  blocks.map((b) => (
                    <BlockView
                      key={b.id}
                      block={b}
                      onAnswerGate={(yes) => answerGate(b.id, yes)}
                      onRerun={() => void submit(b.command, b.source)}
                      onStop={() => stop(b.id)}
                      onToggle={() => patch(b.id, { collapsed: !b.collapsed })}
                    />
                  ))
                )}
              </div>
            ) : !store ? (
              <div className="p-6 text-xs text-ink-faint">Loading your things…</div>
            ) : (
              <>
                {(tab === "folders" || tab === "photos") && (
                  <Recall section={tab} onSection={(s) => go(s as TabId)} />
                )}
                {tab === "lists" && (
                  <div className="p-3">
                    <ListsBoard />
                  </div>
                )}
                {tab === "calendar" && (
                  <CalendarTab store={store} commit={commit} dashboard={dash.events} onDashboard={dash.setEvents} />
                )}
                {tab === "inbox" && <InboxTab store={store} commit={commit} profile={profile} />}
                {tab === "memory" && <MemoryTab store={store} commit={commit} />}
                {tab === "record" && <RecordTab />}
                {tab === "studio" && (
                  <StudioTab store={store} commit={commit} profile={profile} onDashboardChanged={dash.refresh} />
                )}
                {tab === "routines" && <RoutinesTab store={store} commit={commit} profile={profile} />}
                {tab === "skills" && <SkillsLibrary chromeless />}
                {tab === "tools" && <ToolsTab />}
                {tab === "plugins" && <PluginsTab />}
              </>
            )}
          </div>
        </main>

        <aside className="hidden w-[var(--nj-aside)] shrink-0 overflow-y-auto border-l border-line bg-panel lg:block">
          <VoicePanel
            state={voice.state}
            level={voice.level}
            heard={voice.heard}
            error={voice.error}
            supported={voice.supported}
            onToggle={voice.toggle}
            speakReplies={speakReplies}
            onSpeakReplies={setSpeakReplies}
          />
          <BridgePanel
            health={bridge.health}
            ready={bridge.ready}
            hasToken={bridge.hasToken}
            onPair={(t) => void bridge.pair(t)}
            onUnpair={bridge.unpair}
            onRefresh={bridge.refresh}
          />
        </aside>
      </div>
    </div>
  );
}

/**
 * The empty console.
 *
 * It teaches the surface rather than announcing that it is empty: four real
 * commands the owner can read and reuse, and an honest line about what is
 * reachable right now.
 */
function Empty({ paired }: { paired: boolean }) {
  const examples = [
    "what did I decide about the hub's AI provider?",
    "open my Vercel dashboard and tell me if the last deploy failed",
    "which node processes are running, and how much memory each",
    "read tools/jarvis-bridge/README.md and summarise what it does",
  ];
  return (
    <div className="mx-auto max-w-xl px-2 py-10">
      <p className="text-sm text-ink">
        Ask it something, or tell it what to do. Say <span className="font-mono text-brand">&ldquo;Jarvis&rdquo;</span>{" "}
        and it listens.
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        Every request becomes a block below — what you said, every step it took, and what came back. Nothing scrolls
        away.
      </p>
      <ul className="mt-5 space-y-1.5">
        {examples.map((e) => (
          <li key={e} className="rounded-md border border-line-soft bg-panel px-3 py-2 font-mono text-[11.5px] text-ink-muted">
            {e}
          </li>
        ))}
      </ul>
      <p className="mt-5 text-[11px] leading-relaxed text-ink-faint">
        {paired
          ? "This PC is reachable, so the last three will actually run."
          : "The last three need the local agent on your PC. Without it, it can still think, remember and answer — it just cannot touch the machine."}
      </p>
    </div>
  );
}
