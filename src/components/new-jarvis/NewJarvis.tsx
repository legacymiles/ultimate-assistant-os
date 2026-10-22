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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import "./new-jarvis.css";
import "./new-jarvis-shell.css";
import "./deck.css";
import "./new-jarvis-hud.css";
import { HudField, Reactor } from "./HudField";
import { WorldField } from "./WorldField";

import { StatusDock } from "./StatusDock";
import { VoiceOrb } from "./VoiceOrb";
import { QueueBoard } from "./QueueBoard";
import { SiteErrorsPage } from "./SiteErrors";
import { openConnections } from "./Connections";
import { GoalCheck } from "./GoalCheck";
import { AppBuilderSheet, type BuilderView } from "./AppBuilderSheet";
import { PcConnect } from "./PcConnect";
import { TOPIC_LABEL, topicOf } from "@/lib/new-jarvis/felix";
import { useQueue } from "@/lib/new-jarvis/useQueue";
import type { ReactorMode } from "@/lib/new-jarvis/reactor";

import { useBridge } from "@/lib/new-jarvis/useBridge";
import { useWakeVoice } from "@/lib/new-jarvis/useWakeVoice";
import { runBlock, type WireMessage } from "@/lib/new-jarvis/runner";
import { MAX_LIVE_BLOCKS, newBlock, type Block, type Gate, type Mode } from "@/lib/new-jarvis/types";
import { BLOCKS_KEY, revive, slim } from "@/lib/new-jarvis/persist";
import { adoptLegacy, newThreadId, reviveThreads, THREADS_KEY, titleFrom, type Thread } from "@/lib/new-jarvis/threads";
import { ChatView } from "./ChatView";

// The owner's existing surfaces, mounted whole.
import { Recall } from "../recall/Recall";
import { ListsBoard } from "../recall/lists/ListsBoard";
import { CalendarTab } from "../jarvis/CalendarTab";
import { StudioTab } from "../jarvis/StudioTab";
import { InboxTab } from "../jarvis/InboxTab";
import { SkillsLibrary } from "../skills/SkillsLibrary";
import { SyncStatusPanel } from "../jarvis/SyncStatusPanel";
import { ToolsTab } from "../jarvis/ToolsTab";
import { PasswordVault } from "./PasswordVault";
import { Telephony } from "./Telephony";
import { HarnessConsole } from "./HarnessConsole";
import { ArmoryTab } from "./ArmoryTab";
import { gapsForAudit, readAll } from "@/lib/armory/catalog";
import { ReflexStrip } from "./ReflexStrip";
import { reflex as runReflex, savedACall } from "@/lib/new-jarvis/reflex";
import { PluginsTab } from "../jarvis/PluginsTab";
import { RouterTab } from "../jarvis/RouterTab";
import { SettingsTab } from "../jarvis/SettingsTab";
import { Blueprint } from "../blueprint/Blueprint";
import { AppShell } from "../AppShell";

// The Dashboard, which now carries Memory, the Profile and the self-audit as
// panels rather than as three more entries in the rail.
import { DashboardPanel } from "./DashboardPanel";
import { Onboarding, SetupButton, resumeStep, type OnboardingBridge, type OnboardingStep } from "./Onboarding";
import { getOnboarding, useOnboarding } from "@/lib/new-jarvis/onboarding";
import { useSetup } from "@/lib/new-jarvis/useSetup";
import { useCameraWatch } from "@/lib/new-jarvis/useCameraWatch";
import { readChecklistPrompt, useJarvisProfile } from "@/lib/jarvis-profile/useJarvisProfile";
import { IphoneGuide } from "./IphoneGuide";
import { CHAT_MODEL_KEY, isSubscription } from "@/lib/new-jarvis/chatModels";
import { plainBridgeError, plainSiteError } from "@/lib/new-jarvis/plainErrors";
import { BridgeError } from "@/lib/new-jarvis/bridge";
import { MAX_CHAT_MEDIA, buildUserContent, prepareMedia, type ChatMedia } from "@/lib/new-jarvis/chatMedia";
import { noteLaunch } from "@/lib/new-jarvis/launcher";
import { useVault } from "@/lib/new-jarvis/useVault";
import { noteOpened, useImprove } from "@/lib/new-jarvis/useImprove";
import { ASK_EVENT, parseAsk } from "@/lib/new-jarvis/askEvent";
import { useUpdates } from "@/lib/jarvis/useUpdates";
import { toCalEvent } from "@/lib/jarvis/useDashboardCalendar";
import type { CalendarEvent } from "@/lib/recall/calendar/types";

import { loadLocal, saveLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { STORE_KEY, emptyStore } from "@/lib/new-dashboard/model";
import type { DashboardStore, Profile } from "@/lib/new-dashboard/types";
import { JARVIS_KEY, loadJarvis, saveJarvis, uid } from "@/lib/jarvis/store";
import { isDashboardTool, runDashboardTool } from "@/lib/jarvis/dashboardBridge";
import { captureToRecord, FieldStash } from "@/lib/new-jarvis/capture";
import { savedFields } from "@/lib/new-jarvis/savedFields";
import { getRecord } from "@/lib/jarvis/record/store";
import { isSensitive, labelForKey } from "@/lib/jarvis/record/types";
import type { JarvisStore } from "@/lib/jarvis/types";
import { useDashboardCalendar } from "@/lib/jarvis/useDashboardCalendar";

type TabId =
  | "dashboard" | "console" | "studio" | "harness" | "queue" | "site-errors"
  | "folders" | "photos" | "lists" | "calendar" | "inbox"
  | "skills" | "tools" | "passwords" | "calls" | "router" | "architect" | "timeline" | "plugins" | "settings";

type Tab = { id: TabId; label: string; icon: keyof typeof Icon };

/** Options a programmatic submit can set — the onboarding hand-off uses both. */
type SubmitOpts = {
  mode?: Mode;
  skipReflex?: boolean;
  /** Attachments handed over with the job (Camera Autopilot's photo), instead of the box's. */
  media?: ChatMedia[];
};

/** What, typed in the chat, reopens setup rather than going to the model. */
const SETUP_COMMAND = /^\/?(?:(?:open|start|resume|run|redo|restart|finish)\s+)?(?:the\s+|my\s+)?(?:setup|set\s*up(?:\s+jarvis)?|onboarding)[.!?]?$/i;

/**
 * The rail — three entries and More (it was nineteen, then five).
 *
 * This is the "fewer side tabs, better minimal UI" change, and the three moves
 * that made it possible are worth recording:
 *
 *   Memory stopped being a tab and became a panel on the Dashboard, where it
 *   sits next to the Profile — the two things that are really about the same
 *   subject, finally in the same place.
 *
 *   Record is gone. Its 47-field life record IS the Profile, and framing it as
 *   a separate "Record" made it read as a filing cabinet rather than as the
 *   owner. The store is untouched; only the framing changed.
 *
 *   Routines is gone, along with the old /apps/jarvis shell that carried it.
 *   The store field stays (old saved data still loads); nothing shows it.
 *
 * Folders, Photos, Lists, Calendar and Inbox fold into one "Yours" group, and
 * the Toolbox is the group from the old shell, moved over whole.
 */
const GROUPS: { id: string; label: string; icon: keyof typeof Icon; items: Tab[] }[] = [
  {
    id: "work",
    label: "Work",
    icon: "Layers",
    items: [
      // In Queue answers "what should I work on"; Code is the coding agent
      // (Claude Code or the DeepSeek harness) on the repo in its own branch.
      { id: "queue", label: "Queue", icon: "ListChecks" },
      { id: "harness", label: "Code", icon: "Layers" },
      // The crash log. It sat on the Dashboard until 2026-10-19; it is a
      // fix-it list for whoever builds, so it lives with the build tools.
      { id: "site-errors", label: "Site errors", icon: "Flag" },
    ],
  },
  {
    id: "yours",
    label: "Yours",
    icon: "Folder",
    items: [
      { id: "folders", label: "Folders", icon: "Folder" },
      { id: "photos", label: "Photos", icon: "Image" },
      { id: "lists", label: "Lists", icon: "ListChecks" },
      { id: "calendar", label: "Calendar", icon: "Calendar" },
      { id: "inbox", label: "Inbox", icon: "Inbox" },
    ],
  },
  {
    id: "toolbox",
    label: "Toolbox",
    icon: "Toolbox",
    items: [
      { id: "skills", label: "Skills", icon: "Sparkles" },
      { id: "tools", label: "Armory", icon: "Toolbox" },
      { id: "passwords", label: "Passwords", icon: "Key" },
      { id: "calls", label: "Calls", icon: "Bell" },
      { id: "router", label: "Router", icon: "Target" },
      { id: "architect", label: "Architect", icon: "Bulb" },
      { id: "timeline", label: "Timeline", icon: "Flag" },
      { id: "plugins", label: "Apps", icon: "Launch" },
      { id: "settings", label: "Settings", icon: "Settings" },
    ],
  },
];

/**
 * The rail: three entries the owner chose, and More for everything else.
 * A tab opened from More borrows a fourth slot while it is open, so the rail
 * always shows where you are.
 */
const TOP: Tab[] = [
  { id: "dashboard", label: "Dashboard", icon: "Grid" },
  // Chat: the super agent — ask, hand it a job, or give it a picture, clip
  // or recording and say what to do with it.
  { id: "console", label: "Chat", icon: "Bot" },
  { id: "studio", label: "Studio", icon: "Film" },
];

const TABS: Tab[] = [...TOP, ...GROUPS.flatMap((g) => g.items)];

function isTab(v: string): v is TabId {
  return TABS.some((t) => t.id === v);
}

export function NewJarvis() {
  const [tab, setTab] = useState<TabId>("dashboard");
  // Studio and App plugins have their own look; everywhere else, the galaxy.
  const galaxyOff = tab === "studio" || tab === "plugins";
  /** The More sheet — every section that is not on the rail. */
  const [moreOpen, setMoreOpen] = useState(false);
  /** App Builder opened over Jarvis by the app_builder tool (shrunk = a pill, still working). */
  const [builder, setBuilder] = useState<BuilderView | null>(null);
  const [builderMin, setBuilderMin] = useState(false);
  /** Files dragged over the window: anywhere is a drop target for Chat. */
  const [dropping, setDropping] = useState(false);
  /** The rail's core — the point the fallback field's sweep turns around. */
  const coreRef = useRef<HTMLButtonElement>(null);
  /** The content area — the galaxy centres itself on it. */
  const mainRef = useRef<HTMLElement>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState("");
  // Goal check (Felix + prompt enhancer): the text it opened on, or null when closed.
  const [goalFor, setGoalFor] = useState<string | null>(null);
  const goalTopic = useMemo(() => topicOf(input), [input]);
  const [mode, setMode] = useState<Mode>("do");

  // --- the Chat's brain and attachments ---------------------------------------
  // Brain: Claude on the person's own subscription (through the PC), or a
  // cloud model on OpenRouter ("" = Claude in the cloud). Synced, so every
  // device thinks alike. Media: what goes with the next message.
  const [chatModel, setChatModelState] = useState("");
  useEffect(() => setChatModelState(loadLocal<string>(CHAT_MODEL_KEY, "")), []);
  useRemotePull(CHAT_MODEL_KEY, () => setChatModelState(loadLocal<string>(CHAT_MODEL_KEY, "")));
  const setChatModel = useCallback((id: string) => {
    setChatModelState(id);
    saveSynced(CHAT_MODEL_KEY, id);
  }, []);

  const [media, setMedia] = useState<ChatMedia[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [mediaError, setMediaError] = useState("");
  useEffect(() => {
    if (!mediaError) return;
    const t = setTimeout(() => setMediaError(""), 6000);
    return () => clearTimeout(t);
  }, [mediaError]);
  const addFiles = useCallback((files: File[]) => {
    const room = Math.max(0, MAX_CHAT_MEDIA - media.length - preparing);
    if (files.length > room) setMediaError(`Up to ${MAX_CHAT_MEDIA} attachments at once — the rest were left out.`);
    for (const f of files.slice(0, room)) {
      setPreparing((n) => n + 1);
      void prepareMedia(f)
        .then((m) => setMedia((list) => [...list, m]))
        .catch((e: unknown) => setMediaError(e instanceof Error ? e.message : `Couldn't read ${f.name}.`))
        .finally(() => setPreparing((n) => n - 1));
    }
  }, [media.length, preparing]);
  const [speakReplies, setSpeakReplies] = useState(true);
  /** Which face the Reactor is showing. Theirs to pick; it is the thing they look at most. */
  const [reactorMode, setReactorMode] = useState<ReactorMode>("ring");

  const bridge = useBridge();

  // The ledger is kept, because the whole argument of this surface is that a
  // block from an hour ago is still there. Deliberately device-local rather
  // than synced: a block records what was done from THIS browser to THIS
  // machine, and a phone showing a ledger of steps it cannot re-run would be
  // a worse lie than no ledger at all.
  const loaded = useRef(false);
  // Chat's conversations. Device-local, beside the blocks they group.
  const [threads, setThreads] = useState<Thread[]>([]);
  /** The open conversation; null = a new one that starts on the first message. */
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const activeThreadRef = useRef<string | null>(null);
  activeThreadRef.current = activeThread;
  useEffect(() => {
    const adopted = adoptLegacy(revive(loadLocal<unknown>(BLOCKS_KEY, [])), reviveThreads(loadLocal<unknown>(THREADS_KEY, [])));
    setBlocks(adopted.blocks);
    setThreads(adopted.threads);
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (loaded.current) saveLocal(THREADS_KEY, threads);
  }, [threads]);
  const blocksRef = useRef<Block[]>([]);
  const threadsRef = useRef<Thread[]>([]);
  threadsRef.current = threads;
  useEffect(() => {
    blocksRef.current = blocks;
    if (!loaded.current) return;
    // A running block patches its steps many times a second, so while work is
    // in flight the write is debounced — the cost of recording history must
    // not land in the middle of doing it. The moment everything settles the
    // write is immediate, because a debounce there loses the finished answer
    // to a reload one tick later, and the block comes back looking abandoned.
    const live = blocks.some((b) => b.status === "running" || b.status === "waiting");
    if (!live) {
      saveLocal(BLOCKS_KEY, slim(blocks));
      return;
    }
    const t = setTimeout(() => saveLocal(BLOCKS_KEY, slim(blocksRef.current)), 800);
    return () => clearTimeout(t);
  }, [blocks]);

  // A tab closed mid-run still gets its ledger written. pagehide is the one
  // event that fires reliably on a real close, a navigation and an iOS
  // background — unload does not.
  useEffect(() => {
    const flush = () => {
      if (loaded.current) saveLocal(BLOCKS_KEY, slim(blocksRef.current));
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

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

  // --- first-run onboarding --------------------------------------------------
  // Opens by itself once the synced copy has been checked, so finishing on the
  // phone means the laptop never asks again. After that it opens from the
  // Setup button in the top bar, the "setup" chat command, #setup, or Profile's
  // "Finish setup" — and always on the step it was closed on.
  const setup = useSetup();
  const [onboarding, onboardingSettled] = useOnboarding();
  const [setupStep, setSetupStep] = useState<OnboardingStep | null>(null);
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !onboardingSettled) return;
    autoOpened.current = true;
    if (onboarding.status === "new") setSetupStep("welcome");
  }, [onboarding.status, onboardingSettled]);
  const openSetup = useCallback(() => {
    setSetupStep(resumeStep(getOnboarding().lastStep, setup.items));
  }, [setup.items]);
  // The hash router below is mounted once; it reaches the current opener here.
  const openSetupRef = useRef(openSetup);
  openSetupRef.current = openSetup;

  // --- the Dashboard's three feeds ----------------------------------------
  // All three are owned by the SHELL, not by the Dashboard tab. The updates
  // badge and its browser pop-ups have to work from every tab, the vault sweep
  // must survive the owner wandering off to Studio mid-sweep, and the audit
  // reads the rail, which only the shell knows.
  const briefStore = useMemo<JarvisStore | null>(() => {
    if (!store) return null;
    // Hand-typed Jarvis events merged with the Dashboard calendar, so the feed
    // and the calendar tab cannot disagree about what is coming up.
    return { ...store, events: [...store.events, ...dash.events.map(toCalEvent)] };
  }, [store, dash.events]);

  // Every 10 minutes, from whichever tab is open: new iPhone photos are pulled
  // into Camera Autopilot and the feed below raises the notification.
  const camera = useCameraWatch();
  // The backend checklist (in Profile): learns from chats and keeps the Claude
  // Code skill current from whichever tab is open.
  const jarvisProfile = useJarvisProfile();
  // The iPhone setup guide. Opened from the Camera widget, Settings, setup's
  // Connect step, or /apps/jarvis#iphone — which is what its QR code opens.
  const [iphoneGuide, setIphoneGuide] = useState(false);
  const updates = useUpdates(briefStore, commit, dash.events, camera.inbox);
  // The Calendar widget wants one list: the Dashboard calendar plus anything
  // typed straight into Jarvis, in the Dashboard's event shape.
  const widgetEvents = useMemo<CalendarEvent[]>(
    () => [
      ...dash.events,
      ...(store?.events ?? []).map((e) => ({
        id: e.id,
        title: e.title,
        date: e.date,
        time: e.start || null,
        endTime: e.end || null,
        location: e.where,
        notes: e.notes,
        reminders: [],
        source: "manual" as CalendarEvent["source"],
        createdAt: "",
        updatedAt: "",
      })),
    ],
    [dash.events, store?.events],
  );
  const vault = useVault(bridge);
  // The queue is mounted up here rather than inside its own tab because the
  // dock shows its count at all times: a board that only counted itself once
  // you opened it would be a board you had to remember to go and look at.
  const queue = useQueue(store);

  // What the armory knows, so the self-audit can raise a real gap instead of
  // nothing. Fetched once; a key does not change while the tab is open.
  const [envKeys, setEnvKeys] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    void fetch("/api/jarvis/armory", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { keys?: Record<string, boolean> }) => setEnvKeys(d.keys ?? {}))
      .catch(() => setEnvKeys({}));
  }, []);

  const missingKeys = useMemo(() => {
    if (!envKeys) return [];
    return gapsForAudit(
      readAll({
        keys: envKeys,
        bridge: bridge.health.capabilities ?? {},
        bridgeUp: bridge.health.up && bridge.health.paired,
      }),
    );
  }, [bridge.health, envKeys]);

  // Logins still readable, so the security auditor can raise the real number
  // rather than a zero nobody measured.
  const [plaintextLogins, setPlaintextLogins] = useState(0);

  /**
   * The reflex pass, over what is in the box right now.
   *
   * Everything it reads is already in memory — vault notes and memories — so
   * this is microseconds and can run on every keystroke. It is deliberately NOT
   * debounced: watching it change its mind as you type is how the owner learns
   * what it can settle without asking the model.
   */
  const known = useMemo(
    () =>
      vault.graph.nodes
        .filter((n) => n.kind === "note")
        .slice(0, 2000)
        .map((n) => ({
          key: n.key,
          title: n.title,
          content: vault.bodies.get(n.path ?? n.key)?.slice(0, 1200) ?? "",
          tags: n.tags,
        })),
    [vault.bodies, vault.graph.nodes],
  );

  /** Set when the owner has said "ask the model anyway" for this exact text. */
  const [overrideFor, setOverrideFor] = useState("");

  const reflex = useMemo(
    () =>
      runReflex({
        text: input,
        mode,
        capabilities: bridge.health.capabilities ?? {},
        bridgeReady: bridge.health.up && bridge.health.paired,
        known,
        // No echo test here: that is a voice concern and useWakeVoice already
        // rejects its own speech before a command is ever raised.
      }),
    [bridge.health, input, known, mode],
  );
  useEffect(() => {
    void import("@/lib/recall/store")
      .then((m) => setPlaintextLogins(m.allCredentials().filter((c) => Boolean(c.password)).length))
      .catch(() => setPlaintextLogins(0));
  }, []);

  const improve = useImprove({
    store,
    graph: vault.graph,
    pendingCaptures: vault.waiting.length,
    rail: TABS.map((t) => ({ id: t.id, label: t.label })),
    bridgePaired: bridge.health.paired,
    // Reported as a fact the auditor can act on rather than left for it to
    // guess: this page now runs the same gate /apps/jarvis does, so the list
    // is empty — and if that regresses, the auditor is how the owner finds out.
    ungatedRoutes: [],
    plaintextCredentials: plaintextLogins,
    // Real, from the armory. This was a hardcoded empty list when the auditor
    // was built, which meant its "features switched off for want of a key"
    // finding could never fire — an auditor that cannot see is worse than no
    // auditor, because it reports all-clear.
    missingKeys,
    // Whether Jev / Span can be reached. Unknown until the armory answers, so
    // the "add a key" proposal never fires on a guess.
    decisionKey: envKeys ? Boolean(envKeys.OPENROUTER_API_KEY) : undefined,
  });

  // --- gates ---------------------------------------------------------------
  // A gate is a promise the block's buttons resolve. Keeping the resolver here
  // rather than in the block means a run survives the owner switching tabs
  // mid-gate: the block is unmounted, the promise is not.
  /**
   * Field values a page handed this tab, for the life of the tab only.
   *
   * Never written into a block, never persisted, never sent upstream. This is
   * the thing that lets the assistant save what it reads without a model ever
   * being shown the value.
   */
  const stash = useRef(new FieldStash());

  const gateResolvers = useRef(new Map<string, (yes: boolean) => void>());
  const aborts = useRef(new Map<string, AbortController>());

  const patch = useCallback((id: string, p: Partial<Block>) => {
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...p } : b)));
  }, []);

  /** Past blocks as conversation, so a follow-up knows what "it" means. */
  const historyFor = useCallback((thread: string): WireMessage[] => {
    // The conversation it is part of, not whatever else happened lately.
    const recent = blocks.filter((b) => b.thread === thread && b.status === "done" && b.answer).slice(0, 6).reverse();
    return recent.flatMap((b): WireMessage[] => [
      { role: "user", content: b.command },
      { role: "assistant", content: b.answer },
    ]);
  }, [blocks]);

  // Voice needs to call submit, and submit needs to speak the answer. The ref
  // breaks that cycle without either one being recreated on every keystroke.
  const submitRef = useRef<(text?: string, source?: Block["source"], opts?: SubmitOpts) => void>(() => {});

  const voice = useWakeVoice({
    speakReplies,
    onInterrupt: () => {
      // Talking over it stops whatever is speaking; it does not cancel the
      // work, which may already have changed something.
    },
    onCommand: (text) => submitRef.current(text, "voice"),
  });


  /** The running turn's attachments and where it came from, for tools that take them (app_builder). */
  const turnRef = useRef<{ media: ChatMedia[]; origin: "chat" | "autopilot" }>({ media: [], origin: "chat" });

  /**
   * One tool call, sent wherever it actually runs.
   *
   * Hub tools touch the owner's own stores in this tab and work with the local
   * agent stopped; bridge tools need the PC. `page_fields` is the one call that
   * is both: the bridge reads it, and its values are peeled off here so they
   * never reach a block, a saved ledger, or a model.
   */
  const runTool = useCallback(
    async (route: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (route === "browser/fields") {
        const res = await bridge.run(route, args);
        const values = (res.values ?? {}) as Record<string, string>;
        stash.current.put(values);
        const { values: _dropped, ...rest } = res;
        return { ...rest, held: Object.keys(values).length };
      }

      if (!route.startsWith("hub/")) return bridge.run(route, args);

      const tool = route.slice(4);

      if (tool === "record_capture") {
        const map = (args.map ?? {}) as Record<string, string>;
        const pageKeys = Object.keys(map);
        if (!pageKeys.length) throw new Error("No fields were named.");
        const { values, missing } = stash.current.take(pageKeys);
        if (!Object.keys(values).length) {
          throw new Error(
            stash.current.size === 0
              ? "Nothing is held from a page — call page_fields first."
              : `None of those keys are on the page that was read. It has: ${stash.current.keys().slice(0, 12).join(", ")}`,
          );
        }
        // Page key → Record key, so what is written is named the way the
        // Record names it, not the way some form did.
        const intoRecord: Record<string, string> = {};
        for (const [pageKey, value] of Object.entries(values)) {
          const recordKey = String(map[pageKey] ?? "").trim();
          if (recordKey) intoRecord[recordKey] = value;
        }
        const origin = String(args.because ?? "").trim() || "Jarvis, from a page you had open";
        const out = await captureToRecord({ values: intoRecord, origin });
        if (!out.written.length) {
          // A key the Record does not have matches no field and writes
          // nothing — which from outside looks exactly like the feature being
          // broken. Name the real ones so the next attempt lands.
          const { RECORD_KEYS } = await import("@/lib/new-jarvis/agentTools");
          throw new Error(
            `None of those are Record fields, so nothing was saved. Valid keys: ${RECORD_KEYS.join(", ")}`,
          );
        }
        return {
          saved: out.written,
          skipped: [...out.skipped, ...missing],
          note: "Written locally. The values were not sent anywhere.",
        };
      }

      if (tool === "record_fill") {
        // The value is read here, in the owner's tab, and goes straight to the
        // page through the bridge. It is not returned, so no model sees it.
        const key = String(args.key ?? "").trim();
        if (!key || isSensitive(key)) {
          throw new Error("That's a sensitive field, so Jarvis never types it in. Fill it in yourself.");
        }
        const value = getRecord().fields[key]?.value?.trim();
        const label = labelForKey(key) ?? key;
        if (!value) throw new Error(`Your Life Record doesn't have your ${label} yet. Add it in Profile, or type it here yourself.`);
        await bridge.run("browser/type", {
          ref: args.ref,
          value,
          name: args.name,
          ...(args.tabId ? { tabId: args.tabId } : {}),
        });
        return { filled: label, into: String(args.name ?? ""), note: "Typed from your Life Record in your own tab — the value wasn't sent to any model." };
      }

      if (tool === "propose_memory") {
        const title = String(args.title ?? "").trim();
        const content = String(args.content ?? "").trim();
        if (!title || !content) throw new Error("A memory needs a title and something to remember.");
        const current = loadJarvis();
        commit({
          ...current,
          proposals: [
            {
              id: uid(),
              title,
              content,
              source: "chat" as const,
              origin: String(args.origin ?? "").trim() || "Jarvis",
              conversationId: current.chat?.id ?? "",
              createdAt: new Date().toISOString(),
            },
            ...current.proposals,
          ],
        });
        return { proposed: title, note: "Waiting for your yes on the Memory tab." };
      }

      if (tool === "app_builder") {
        // Every new app goes through App Builder (the owner's rule). The
        // turn's own attachments — a typed message's, or Camera Autopilot's
        // photo or clip — go with it, so its super agent can watch them.
        const { handToAppBuilder } = await import("@/lib/app-builder/fromChat");
        const turn = turnRef.current;
        const out = await handToAppBuilder({ idea: String(args.idea ?? ""), media: turn.media, origin: turn.origin });
        // Pull App Builder up for them right here — on a phone too — instead
        // of handing back a link to go find.
        setBuilder((b) => ({ url: out.url, name: out.name, n: (b?.n ?? 0) + 1 }));
        setBuilderMin(false);
        return {
          opened: out.url,
          project: out.name,
          shownOnScreen: true,
          ...(out.media ? { recordings: out.media } : {}),
          note: `App Builder is now OPEN on their screen with this request, and its super agent has started — it ${out.media ? "watches what was attached, " : ""}asks what the app is for, and proposes features to accept, deny or edit. Tell them in one short line that it's open in front of them and what to do next (answer its questions there). Do not paste the link.`,
        };
      }

      if (tool === "web_search" || tool === "web_read") {
        // Run by the website, so a lookup never needs the PC.
        const res = await fetch("/api/new-jarvis/web", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            tool === "web_search" ? { action: "search", q: String(args.query ?? "") } : { action: "read", url: String(args.url ?? "") },
          ),
        }).catch(() => null);
        const data = (await res?.json().catch(() => null)) as Record<string, unknown> | null;
        if (!res || !data) throw new Error(plainSiteError(res?.status ?? 0));
        if (typeof data.error === "string") throw new Error(data.error);
        return data;
      }

      if (tool === "queue_build") {
        // A change to an existing app, handed to Claude Code through In Queue —
        // how code gets written with the PC off.
        const { buildRequest } = await import("@/lib/new-jarvis/queueBuild");
        const { PROJECTS } = await import("@/lib/catalog");
        const job = buildRequest(String(args.app ?? ""), String(args.request ?? ""), PROJECTS);
        if (String(args.request ?? "").trim().length < 3) throw new Error("Say what should change, in a line or more.");
        const images = turnRef.current.media.flatMap((m) =>
          m.parts.flatMap((p) => (p.type === "image_url" && p.image_url.url.startsWith("data:image/") ? [p.image_url.url] : [])),
        ).slice(0, 4);
        const res = await fetch("/api/new-jarvis/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add", folder: job.folder, text: job.text, images, from: "jarvis-chat" }),
        }).catch(() => null);
        const data = (await res?.json().catch(() => null)) as { added?: { id: string }[]; error?: string } | null;
        if (!res || !res.ok) throw new Error(data?.error ?? "In Queue didn't take it. Sign in to Jarvis and try again.");
        return {
          queued: job.app ? job.app.title : "Inbox",
          already: !data?.added?.length,
          note: `${data?.added?.length ? "Filed" : "That exact request was already waiting"} in In Queue › ${job.app ? job.app.title : "Inbox"}. Claude Code builds it from the repo and clears it when it's done — the owner can watch it in the Queue tab. Tell them that in one short line.`,
        };
      }

      if (isDashboardTool(tool)) {
        const said = await runDashboardTool(tool, args);
        dash.refresh();
        return { done: said };
      }

      throw new Error(`Jarvis doesn't know how to do "${route}" yet.`);
    },
    [bridge, commit, dash],
  );

  const submit = useCallback(
    async (rawText?: string, source: Block["source"] = "typed", opts: SubmitOpts = {}) => {
      // Attachments go with what was typed, never with a voice command or a
      // job handed over by setup.
      const handed = opts.media ?? null;
      const attached = handed ?? (source === "typed" && rawText === undefined ? media : []);
      turnRef.current = { media: attached, origin: handed ? "autopilot" : "chat" };
      const command = (rawText ?? input).trim() || (attached.length ? "Look at what I attached." : "");
      if (!command) return;
      const runMode = opts.mode ?? mode;

      // Which conversation this goes into. The first message of a new chat
      // opens it, named after what was asked.
      let thread = activeThreadRef.current;
      if (!thread || !threadsRef.current.some((t) => t.id === thread)) {
        thread = newThreadId();
        const now = Date.now();
        const made: Thread = { id: thread, title: titleFrom(command), createdAt: now, updatedAt: now };
        setThreads((ts) => [made, ...ts]);
        setActiveThread(thread);
        activeThreadRef.current = thread;
      } else {
        const id = thread;
        setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, updatedAt: Date.now() } : t)));
      }

      // "setup" / "onboarding" in the box reopens setup instead of asking the model.
      if (source === "typed" && SETUP_COMMAND.test(command)) {
        setInput("");
        openSetupRef.current();
        return;
      }

      // The reflex gets first refusal.
      //
      // Only for typed input, only when the owner has not already said "ask
      // anyway" for this exact text, and only for the two routes that settle
      // something. `wait` is advisory — pressing enter on a half-sentence is
      // the owner overruling it, and a box that refuses to submit is a box
      // people come to hate.
      if (source === "typed" && !attached.length && !opts.skipReflex && overrideFor !== command && savedACall(reflex.route)) {
        const block = newBlock({ command, mode: runMode, source, thread });
        setBlocks((bs) => [
          {
            ...block,
            status: "done" as const,
            ms: Math.max(1, Math.round(reflex.micros / 1000)),
            answer:
              reflex.route === "answer" && reflex.best
                ? `${reflex.because}

${reflex.best.excerpt ?? ""}`.trim()
                : reflex.because,
          },
          ...bs,
        ].slice(0, MAX_LIVE_BLOCKS));
        setInput("");
        setTab("console");
        return;
      }

      if (source === "typed") setInput("");
      if (attached.length && !handed) setMedia([]);
      const { content } = buildUserContent(command, attached);

      const block = newBlock({
        command,
        mode: runMode,
        source,
        thread,
        ...(attached.length ? { media: attached.map((m) => ({ kind: m.kind, name: m.name, thumb: m.thumb })) } : {}),
        ...(chatModel ? { model: chatModel } : {}),
      });
      setBlocks((bs) => [block, ...bs].slice(0, MAX_LIVE_BLOCKS));
      setTab("console");

      const controller = new AbortController();
      aborts.current.set(block.id, controller);
      const history = historyFor(thread);

      const outcome = await runBlock(
        { command, mode: runMode, history, content },
        {
          signal: controller.signal,
          update: (p) => patch(block.id, p),
          think: async (messages) => {
            const ask = {
              // Names of the Life Record fields filled in, never their values,
              // so Jev can fill a form box from them (src/lib/new-jarvis/savedFields.ts).
              saved: savedFields(getRecord()),
              mode: runMode,
              capabilities: bridge.health.paired ? bridge.health.capabilities ?? {} : {},
              ownerName: profile?.name ?? "",
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              // The owner's backend checklist (in Profile), followed on every build.
              checklist: readChecklistPrompt(),
            };
            const post = async (body: Record<string, unknown>) => {
              const res = await fetch("/api/new-jarvis/agent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify(body),
              });
              // A timeout page or a crash is HTML, not JSON — say what it means.
              const data = (await res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null;
              if (!data) throw new Error(plainSiteError(res.status));
              if (!res.ok) throw new Error(data.error ?? plainSiteError(res.status));
              return data;
            };

            // Claude on the person's own plan: the PC's local agent thinks,
            // with exactly the instructions and tools the cloud brain gets.
            // With the PC off it does NOT stop: the cloud brain takes the turn,
            // same instructions and tools, so the job still gets done.
            if (isSubscription(chatModel) && bridge.health.up && bridge.health.paired) {
              // Sent with the messages so the fast lane (Jev clicks, reads
              // after a click) can answer this step without the PC thinking.
              const prepared = await post({ ...ask, messages, prepare: true });
              if (prepared.toolCall) return prepared as never;
              try {
                return (await bridge.run("brain/claude", { system: prepared.system, tools: prepared.tools, messages })) as never;
              } catch (e) {
                if (e instanceof BridgeError) throw new Error(plainBridgeError(e.status, e.message));
                throw e;
              }
            }

            return (await post({ messages, ...ask, ...(chatModel && !isSubscription(chatModel) ? { model: chatModel } : {}) })) as never;
          },
          runTool,
          askGate: (gate: Gate) =>
            new Promise<boolean>((resolve) => {
              gateResolvers.current.set(block.id, resolve);
            }),
        },
      );

      aborts.current.delete(block.id);
      gateResolvers.current.delete(block.id);
      // The round trip the Reactor reports. Stopped HERE rather than inside
      // the voice hook, because the hook only learns an answer exists when it
      // starts reading it aloud — which on a long answer is seconds later, and
      // would turn an honest latency into a flattering one.
      if (source === "voice") voice.markAnswered();

      // Only the answer is spoken. Reading a failure aloud in a calm voice is
      // how you end up believing a job succeeded.
      if (outcome.status === "done" && outcome.answer && source === "voice") {
        void voice.speak(outcome.answer);
      } else if (voice.listening) {
        voice.setState("waiting");
      }
      void bridge.refresh();
    },
    [bridge, chatModel, historyFor, input, media, mode, overrideFor, patch, profile?.name, reflex, runTool, voice],
  );

  useEffect(() => {
    submitRef.current = (text, source, opts) => void submit(text, source, opts);
  }, [submit]);

  // Work handed in from elsewhere in Jarvis (src/lib/new-jarvis/askEvent.ts).
  //   • An Improvements idea's "Start in chat": the prompt lands in the chat
  //     box for the person to read and send — never sent on their behalf.
  //   • Camera Autopilot's "Do it": the person already said yes on the card,
  //     so it runs now, in Do mode, with the photo attached — the same agent
  //     and tools as anything typed here.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const ask = parseAsk((e as CustomEvent<unknown>).detail);
      if (!ask) return;
      if (!ask.send) {
        setInput(ask.text);
        window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".nj-command textarea")?.focus(), 60);
        return;
      }
      void (async () => {
        const prepared = await Promise.all((ask.files ?? []).map((f) => prepareMedia(f).catch(() => null)));
        const handed = prepared.filter((m): m is ChatMedia => Boolean(m));
        submitRef.current(ask.text, "typed", { mode: ask.mode ?? "do", skipReflex: true, media: handed });
      })();
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);

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

  /** The PC's local agent as the key rows need it (onboarding and Profile › Connections). */
  const keysBridge = useMemo<OnboardingBridge>(
    () => ({
      connected: bridge.health.up && bridge.health.paired,
      files: bridge.health.up && bridge.health.paired && bridge.health.capabilities?.files === true,
      browser: bridge.health.up && bridge.health.paired && bridge.health.capabilities?.browser === true,
      run: bridge.run,
    }),
    [bridge.health.up, bridge.health.paired, bridge.health.capabilities?.files, bridge.health.capabilities?.browser, bridge.run],
  );
  /** "Jarvis, do it": straight to the super-agent, in Do mode, past the reflex — a job, not a question. */
  const askAgent = useCallback((task: string) => {
    setTab("console");
    window.location.hash = "console";
    submitRef.current(task, "typed", { mode: "do", skipReflex: true });
  }, []);

  // The tab lives in the hash, so reload and back land where the owner was.
  useEffect(() => {
    const read = () => {
      // Links from before there was one Jarvis say ?tab=plugins, or name a
      // surface that is a panel now. Both land where that thing lives.
      const legacy: Record<string, string> = { chat: "console", memory: "dashboard", record: "dashboard", profile: "dashboard", routines: "dashboard" };
      const fromQuery = new URLSearchParams(window.location.search).get("tab") ?? "";
      const raw = window.location.hash.replace("#", "") || fromQuery;
      const h = legacy[raw] ?? raw;
      // A shareable way back into setup: /apps/jarvis#setup
      if (h === "iphone") {
        setIphoneGuide(true);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        return;
      }
      // Profile › Connections, optionally one row open: /apps/jarvis#connections/youtube
      if (h === "connections" || h.startsWith("connections/")) {
        setTab("dashboard");
        openConnections(h.split("/")[1] || undefined);
        window.history.replaceState(null, "", window.location.pathname + window.location.search + "#dashboard");
        return;
      }
      if (h === "setup" || h === "onboarding") {
        openSetupRef.current();
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        return;
      }
      if (isTab(h)) setTab(h);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const go = useCallback((id: TabId) => {
    setTab(id);
    window.location.hash = id;
    setMoreOpen(false);
    // What the self-audit's "nobody opens this" finding is measured from.
    // Device-local on purpose: a phone that never opens Studio must not teach
    // the auditor that the laptop never opens Studio either.
    noteOpened(id);
    // "Last used" on the Deck. The Dashboard itself is where that row lives,
    // so returning to it is not a launch worth listing.
    if (id !== "dashboard") noteLaunch("tab", id, TABS.find((t) => t.id === id)?.label ?? id);
  }, []);

  /** An update row naming a tab. Strings, because the feed predates this rail. */
  const goByName = useCallback(
    (name: string) => {
      // The feed's older ids point at surfaces that are now panels rather than
      // tabs. Memory is the Dashboard now, and so is a pending action.
      if (name === "iphone") {
        setIphoneGuide(true);
        return;
      }
      // Client Review is an App plugin: its notifications open the app itself.
      if (name === "clients") {
        window.open("/apps/client-review", "_blank", "noopener");
        return;
      }
      const mapped = name === "memory" ? "dashboard" : name === "chat" ? "console" : name;
      if (isTab(mapped)) go(mapped);
    },
    [go],
  );

  const running = blocks.some((b) => b.status === "running" || b.status === "waiting");
  /** The open conversation, oldest first — the order a chat reads in. */
  const chatBlocks = useMemo(
    () => (activeThread ? blocks.filter((b) => b.thread === activeThread).reverse() : []),
    [blocks, activeThread],
  );
  const visiting = TOP.some((t) => t.id === tab) ? null : TABS.find((t) => t.id === tab) ?? null;

  // The rail's light slides to whichever entry is current. Measured rather
  // than computed, because the borrowed slot and the core change the stack.
  const railRef = useRef<HTMLElement>(null);
  const [beam, setBeam] = useState<React.CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    const on = railRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!on) return setBeam({ opacity: 0 });
    setBeam({ opacity: 1, transform: `translateY(${on.offsetTop + 6}px)`, height: on.offsetHeight - 12 });
  }, [tab, visiting?.id]);
  // The capability tally moved into the dock, which is the only thing that
  // reads it now.

  return (
    <div className="nj nj-hud">
      {iphoneGuide && <IphoneGuide camera={camera} onClose={() => setIphoneGuide(false)} />}
      {setupStep && (
        <Onboarding
          start={setupStep}
          onClose={() => {
            setSetupStep(null);
            setup.refresh();
          }}
          go={goByName}
          store={store}
          commit={commit}
          onProfileChanged={reload}
          setup={setup}
          brain={chatModel}
          onBrain={setChatModel}
          bridge={keysBridge}
          ask={askAgent}
        />
      )}
      {/* The living background: a breathing galaxy, modeled in Blender
          (tools/jarvis-world), behind Chat, Dashboard, Settings and the rest —
          but not Studio or App plugins, which have their own look (it pauses
          there). It talks along with Talk. The old canvas field stands in
          wherever WebGL cannot. */}
      <div className={`nj-field ${galaxyOff ? "is-off" : ""}`} aria-hidden>
        <WorldField
          busy={running}
          anchorRef={mainRef}
          voice={{ analyser: voice.analyser, state: voice.state }}
          hidden={galaxyOff}
          fallback={<HudField originRef={coreRef} busy={running} />}
        />
      </div>

      <header className="nj-top flex shrink-0 items-center gap-2.5 px-3 py-2">
        <Link href="/" className="nj-top__back">
          <Icon.ArrowLeft width={13} height={13} />
          <span className="hidden sm:inline">Hub</span>
        </Link>
        <span className="nj-wordmark">Jarvis</span>
        <span className="nj-status" data-busy={running || undefined}>
          <i aria-hidden />
          {running ? "Working" : "Standing by"}
        </span>
        <span className="hidden truncate text-xs text-ink-muted md:inline">
          {profile ? `${profile.name}'s assistant` : "your assistant"}
        </span>
        <div className="ml-auto">
          <SetupButton setup={setup} onOpen={openSetup} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav ref={railRef} aria-label="Sections" className="nj-rail">
          <button
            ref={coreRef}
            type="button"
            className="nj-rail__core"
            onClick={() => go("dashboard")}
            title="Dashboard"
            aria-label="Dashboard"
          >
            <Reactor busy={running} size={36} />
          </button>
          <span className="nj-rail__beam" style={beam} aria-hidden />

          {TOP.map((t) => (
            <RailButton
              key={t.id}
              tab={t}
              on={tab === t.id}
              onClick={() => go(t.id)}
              badge={
                t.id === "console" && running
                  ? "live"
                  : t.id === "dashboard" && updates.unread > 0
                    ? "unread"
                    : null
              }
            />
          ))}

          {/* A section opened from More borrows a slot while it is open. */}
          {visiting && <RailButton key={`v-${visiting.id}`} tab={visiting} on onClick={() => setMoreOpen(true)} visiting />}

          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            title="More sections"
            className="nj-rail__btn nj-rail__more"
            data-open={moreOpen || undefined}
          >
            <Icon.Menu width={16} height={16} />
            <span className="nj-rail__label">More</span>
            {queue.counts.wip > 0 && <span className="nj-pip nj-pip-wip absolute right-1.5 top-1.5" aria-hidden />}
          </button>
        </nav>

        {builder && (
          <AppBuilderSheet
            view={builder}
            minimized={builderMin}
            onMinimize={() => setBuilderMin(true)}
            onRestore={() => setBuilderMin(false)}
            onClose={() => {
              setBuilder(null);
              setBuilderMin(false);
            }}
          />
        )}

        {moreOpen && (
          <MoreSheet
            current={tab}
            queued={queue.counts.wip}
            onPick={(id) => go(id)}
            onClose={() => setMoreOpen(false)}
          />
        )}

        <main
          ref={mainRef}
          className="relative flex min-w-0 flex-1 flex-col"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            if (!dropping) setDropping(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
          }}
          onDrop={(e) => {
            setDropping(false);
            // The command line takes its own drops; this is everywhere else.
            if (e.nativeEvent.defaultPrevented) return;
            const files = Array.from(e.dataTransfer.files);
            if (!files.length) return;
            e.preventDefault();
            addFiles(files);
            if (tab !== "console") go("console");
          }}
        >
          {dropping && (
            <div className="nj-drop" aria-hidden>
              <div className="nj-drop__ring">
                <Icon.Upload width={22} height={22} />
                <span>Drop to hand it to Jarvis</span>
                <small>pictures · video · audio</small>
              </div>
            </div>
          )}
          {/* No command bar across the top (owner's ask, Oct 2026): Chat has its
              own composer and Studio its own, each with a mic. */}
          {mediaError && tab !== "console" && (
            <p className="border-b border-line bg-panel px-4 py-1.5 text-[11px] text-amber-300">{mediaError}</p>
          )}

          {/* The phone-only strip that used to stand in for the missing right
              column is gone with the column itself. Both facts it carried now
              live in the dock across the bottom, at every width — which means
              the phone and the laptop finally show the same thing in the same
              place instead of two layouts that drift apart. */}

          <div
            key={tab === "photos" ? "folders" : tab}
            className={`nj-resolve min-h-0 flex-1 ${tab === "console" ? "overflow-hidden" : "nj-read overflow-y-auto"}`}
          >
            {/* The Dashboard is its own column layout and owns its scrolling,
                so it sits outside the shared scroll container. */}
            {tab === "dashboard" && store ? (
              <DashboardPanel
                vault={vault}
                improve={improve}
                updates={updates}
                store={store}
                commit={commit}
                reminders={dash.reminders.queue}
                onDismissReminder={dash.reminders.dismiss}
                bridgeUp={bridge.health.up && bridge.health.paired}
                queue={queue}
                go={goByName}
                ownerName={onboarding.about.call || profile?.name || onboarding.about.name || undefined}
                setup={setup}
                onOpenSetup={setSetupStep}
                events={widgetEvents}
                camera={camera}
                jarvisProfile={jarvisProfile}
                keysBridge={keysBridge}
                ask={askAgent}
              />
            ) : tab === "console" ? (
              <ChatView
                threads={threads}
                active={activeThread}
                blocks={chatBlocks}
                paired={bridge.health.paired && bridge.health.up && !bridge.health.settingUp}
                pc={(variant) => <PcConnect health={bridge.health} ready={bridge.ready} refresh={bridge.refresh} variant={variant} />}
                notice={mediaError || undefined}
                above={
                  goalFor !== null ? (
                    <GoalCheck
                      key={goalFor}
                      text={goalFor}
                      topic={topicOf(goalFor)}
                      onClose={() => setGoalFor(null)}
                      onUse={(prompt) => {
                        setInput(prompt);
                        setGoalFor(null);
                      }}
                    />
                  ) : input.trim() ? (
                    <ReflexStrip
                      reflex={reflex}
                      onAccept={() => {
                        setOverrideFor("");
                        void submit();
                      }}
                      onAnyway={() => {
                        setOverrideFor(input.trim());
                        setTimeout(() => submitRef.current(input.trim(), "typed"), 0);
                      }}
                    />
                  ) : undefined
                }
                composer={{
                  value: input,
                  onChange: setInput,
                  onSubmit: () => void submit(),
                  mode,
                  onMode: setMode,
                  voiceState: voice.state,
                  heard: voice.heard,
                  micSupported: voice.supported,
                  onMic: voice.toggle,
                  busy: chatBlocks.some((b) => b.status === "running" || b.status === "waiting"),
                  model: chatModel,
                  onModel: setChatModel,
                  media,
                  onFiles: addFiles,
                  onRemoveMedia: (id) => setMedia((list) => list.filter((m) => m.id !== id)),
                  preparing,
                  onEnhance: () => setGoalFor(input),
                  goalHint: goalTopic && goalFor === null ? TOPIC_LABEL[goalTopic] : null,
                }}
                onNew={() => setActiveThread(null)}
                onSelect={setActiveThread}
                onRename={(id, title) => setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, title } : t)))}
                onDelete={(id) => {
                  // Stop anything still running in it, then let it go.
                  for (const b of blocksRef.current) if (b.thread === id) aborts.current.get(b.id)?.abort();
                  setBlocks((bs) => bs.filter((b) => b.thread !== id));
                  setThreads((ts) => ts.filter((t) => t.id !== id));
                  if (activeThreadRef.current === id) setActiveThread(null);
                }}
                onAnswerGate={answerGate}
                onRerun={(b) => void submit(b.command, b.source)}
                onStop={stop}
              />
            ) : tab === "harness" ? (
              // Branched here, ahead of the store gate: a harness thread reads
              // the repo and nothing from the dashboard, so making it wait on
              // "Loading your things…" would delay the one tab that has no
              // reason to.
              <HarnessConsole paired={bridge.health.up && bridge.health.paired} />
            ) : tab === "queue" ? (
              // Also ahead of the gate. The board reads the repo and, for the
              // one signal that needs it, a store it treats as optional — so
              // it can draw itself fully while the dashboard is still loading.
              <QueueBoard queue={queue} />
            ) : tab === "site-errors" ? (
              <SiteErrorsPage />
            ) : !store ? (
              <div className="p-6 text-xs text-ink-muted">Loading your things…</div>
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
                {tab === "studio" && (
                  <StudioTab store={store} commit={commit} profile={profile} onDashboardChanged={dash.refresh} />
                )}
                {tab === "skills" && (
                  <>
                    <section className="mb-3 rounded-xl border border-line bg-panel p-3" aria-label="Sync to every device">
                      <h2 className="mb-2 text-xs font-semibold text-ink">Skills on every device</h2>
                      <SyncStatusPanel />
                    </section>
                    <SkillsLibrary chromeless />
                  </>
                )}
                {tab === "tools" && (
                  <ArmoryTab bridge={bridge.health.capabilities ?? {}} bridgeUp={bridge.health.up && bridge.health.paired} />
                )}
                {tab === "calls" && (
                  <div className="p-3">
                    <div className="mx-auto max-w-xl">
                      <Telephony updates={updates.updates} lastSeenAt={updates.seenAt} />
                    </div>
                  </div>
                )}
                {tab === "passwords" && (
                  <div className="p-3">
                    <div className="mx-auto max-w-xl">
                      <PasswordVault />
                    </div>
                  </div>
                )}
                {tab === "router" && <RouterTab />}
                {tab === "architect" && <Blueprint chromeless />}
                {tab === "timeline" && <AppShell chromeless />}
                {tab === "plugins" && <PluginsTab />}
                {/* SettingsTab's `go` is typed against the OLD shell's tab
                    union, which is a superset of this one for the ids it
                    actually sends. Narrowed through the same name check the
                    hash router uses rather than cast blindly. */}
                {tab === "settings" && (
                  <SettingsTab go={((t: string) => goByName(t)) as never} updates={updates} camera={camera} />
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {/* The column's two jobs, re-housed. The dock is one line across the
          full width instead of 300px down the side of every block; the orb is
          the voice UI as an object that floats over the console rather than a
          panel parked where you never look. */}
      <StatusDock
        voice={voice}
        health={bridge.health}
        ready={bridge.ready}
        hasToken={bridge.hasToken}
        onPair={(t) => void bridge.pair(t)}
        onUnpair={bridge.unpair}
        onRefresh={bridge.refresh}
        running={blocks.filter((b) => b.status === "running" || b.status === "waiting").length}
        queued={queue.counts.wip}
        onQueue={() => go("queue")}
      />

      <VoiceOrb
        voice={voice}
        mode={reactorMode}
        onMode={setReactorMode}
        speakReplies={speakReplies}
        onSpeakReplies={setSpeakReplies}
      />
    </div>
  );
}

/** One rail entry. Labelled under the icon; the current one carries the beam. */
function RailButton({
  tab,
  on,
  onClick,
  visiting = false,
  badge = null,
}: {
  tab: Tab;
  on: boolean;
  onClick: () => void;
  /** Opened from More: it holds a slot only while it is the current tab. */
  visiting?: boolean;
  badge?: "live" | "unread" | null;
}) {
  const I = Icon[tab.icon];
  return (
    <button
      type="button"
      onClick={onClick}
      title={tab.label}
      aria-current={on ? "page" : undefined}
      className="nj-rail__btn"
      data-on={on || undefined}
      data-visiting={visiting || undefined}
    >
      <I width={16} height={16} />
      <span className="nj-rail__label">{tab.label}</span>
      {badge === "live" && <span className="nj-dot absolute right-1.5 top-1.5 bg-brand" data-live="true" aria-hidden />}
      {badge === "unread" && <span className="nj-dot absolute right-1.5 top-1.5 bg-support" aria-hidden />}
    </button>
  );
}

/**
 * More — every section that is not on the rail, in one sheet.
 *
 * Typing filters it and Enter opens the first match, so a section is two
 * keystrokes away without a rail that lists nineteen of them.
 */
function MoreSheet({
  current,
  queued,
  onPick,
  onClose,
}: {
  current: TabId;
  queued: number;
  onPick: (id: TabId) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((t) => !needle || t.label.toLowerCase().includes(needle) || g.label.toLowerCase().includes(needle)),
  })).filter((g) => g.items.length);
  const first = groups[0]?.items[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  let n = 0;
  return (
    <div className="nj-more" role="dialog" aria-label="More sections">
      <button type="button" className="nj-more__scrim" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div className="nj-more__sheet">
        <div className="nj-more__head">
          <span className="nj-kicker">All sections</span>
          <div className="nj-more__find">
            <Icon.Search width={14} height={14} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && first) onPick(first.id);
              }}
              placeholder="Find a section…"
              aria-label="Find a section"
            />
          </div>
        </div>
        {groups.length === 0 && <p className="px-1 py-6 text-center text-xs text-ink-muted">Nothing called that.</p>}
        {groups.map((g) => (
          <section key={g.id} className="nj-more__group">
            <h3 className="nj-more__label">{g.label}</h3>
            <div className="nj-more__grid">
              {g.items.map((t) => {
                const I = Icon[t.icon];
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="nj-more__tile"
                    data-on={t.id === current || undefined}
                    style={{ "--i": n++ } as React.CSSProperties}
                    onClick={() => onPick(t.id)}
                  >
                    <I width={18} height={18} />
                    <span>{t.label}</span>
                    {t.id === "queue" && queued > 0 && <em data-num>{queued}</em>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
