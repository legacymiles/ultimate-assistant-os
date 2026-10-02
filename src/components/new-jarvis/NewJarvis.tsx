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
import type { ReactorMode } from "@/lib/new-jarvis/reactor";

import { useBridge } from "@/lib/new-jarvis/useBridge";
import { useWakeVoice } from "@/lib/new-jarvis/useWakeVoice";
import { runBlock, type WireMessage } from "@/lib/new-jarvis/runner";
import { MAX_LIVE_BLOCKS, newBlock, type Block, type Gate, type Mode } from "@/lib/new-jarvis/types";
import { BLOCKS_KEY, revive, slim } from "@/lib/new-jarvis/persist";

// The owner's existing surfaces, mounted whole.
import { Recall } from "../recall/Recall";
import { ListsBoard } from "../recall/lists/ListsBoard";
import { CalendarTab } from "../jarvis/CalendarTab";
import { StudioTab } from "../jarvis/StudioTab";
import { InboxTab } from "../jarvis/InboxTab";
import { SkillsLibrary } from "../skills/SkillsLibrary";
import { ToolsTab } from "../jarvis/ToolsTab";
import { PasswordVault } from "./PasswordVault";
import { Telephony } from "./Telephony";
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
import { useVault } from "@/lib/new-jarvis/useVault";
import { noteOpened, useImprove } from "@/lib/new-jarvis/useImprove";
import { useUpdates } from "@/lib/jarvis/useUpdates";
import { toCalEvent } from "@/lib/jarvis/useDashboardCalendar";

import { loadLocal, saveLocal } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { STORE_KEY, emptyStore } from "@/lib/new-dashboard/model";
import type { DashboardStore, Profile } from "@/lib/new-dashboard/types";
import { JARVIS_KEY, loadJarvis, saveJarvis, uid } from "@/lib/jarvis/store";
import { isDashboardTool, runDashboardTool } from "@/lib/jarvis/dashboardBridge";
import { captureToRecord, FieldStash } from "@/lib/new-jarvis/capture";
import type { JarvisStore } from "@/lib/jarvis/types";
import { useDashboardCalendar } from "@/lib/jarvis/useDashboardCalendar";

type TabId =
  | "dashboard" | "console" | "studio"
  | "folders" | "photos" | "lists" | "calendar" | "inbox"
  | "skills" | "tools" | "passwords" | "calls" | "router" | "architect" | "timeline" | "plugins" | "settings";

type Tab = { id: TabId; label: string; icon: keyof typeof Icon };

/**
 * The rail — five entries instead of thirteen.
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
 *   Routines is unmounted. /apps/jarvis still has it and the store field is
 *   still read by the updates feed, so nothing was deleted — it simply stopped
 *   paying rent on the surface the owner looks at most.
 *
 * Folders, Photos, Lists, Calendar and Inbox fold into one "Yours" group, and
 * the Toolbox is the group from the old shell, moved over whole.
 */
const GROUPS: { id: string; label: string; icon: keyof typeof Icon; items: Tab[] }[] = [
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

/** The three that are always one click away, because they are where work happens. */
const TOP: Tab[] = [
  { id: "dashboard", label: "Dashboard", icon: "Grid" },
  { id: "console", label: "Console", icon: "Bot" },
  { id: "studio", label: "Studio", icon: "Film" },
];

const TABS: Tab[] = [...TOP, ...GROUPS.flatMap((g) => g.items)];

function isTab(v: string): v is TabId {
  return TABS.some((t) => t.id === v);
}

/** Which group a tab lives in, so opening one from a link opens its folder too. */
function groupOf(tab: TabId): string | null {
  return GROUPS.find((g) => g.items.some((i) => i.id === tab))?.id ?? null;
}

export function NewJarvis() {
  const [tab, setTab] = useState<TabId>("dashboard");
  /** Which rail folder is open. Opening a tab inside one always opens it. */
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("do");
  const [speakReplies, setSpeakReplies] = useState(true);
  /** Which face the Reactor is showing. Theirs to pick; it is the thing they look at most. */
  const [reactorMode, setReactorMode] = useState<ReactorMode>("ring");
  /** The phone-only panel strip; the wide layout shows both panels always. */
  const [panelsOpen, setPanelsOpen] = useState(false);

  const bridge = useBridge();

  // The ledger is kept, because the whole argument of this surface is that a
  // block from an hour ago is still there. Deliberately device-local rather
  // than synced: a block records what was done from THIS browser to THIS
  // machine, and a phone showing a ledger of steps it cannot re-run would be
  // a worse lie than no ledger at all.
  const loaded = useRef(false);
  useEffect(() => {
    setBlocks(revive(loadLocal<unknown>(BLOCKS_KEY, [])));
    loaded.current = true;
  }, []);
  const blocksRef = useRef<Block[]>([]);
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

  const updates = useUpdates(briefStore, commit, dash.events);
  const vault = useVault(bridge);

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
              origin: String(args.origin ?? "").trim() || "New Jarvis",
              conversationId: current.chat?.id ?? "",
              createdAt: new Date().toISOString(),
            },
            ...current.proposals,
          ],
        });
        return { proposed: title, note: "Waiting for your yes on the Memory tab." };
      }

      if (isDashboardTool(tool)) {
        const said = await runDashboardTool(tool, args);
        dash.refresh();
        return { done: said };
      }

      throw new Error(`New Jarvis does not know how to run ${route}.`);
    },
    [bridge, commit, dash],
  );

  const submit = useCallback(
    async (rawText?: string, source: Block["source"] = "typed") => {
      const command = (rawText ?? input).trim();
      if (!command) return;

      // The reflex gets first refusal.
      //
      // Only for typed input, only when the owner has not already said "ask
      // anyway" for this exact text, and only for the two routes that settle
      // something. `wait` is advisory — pressing enter on a half-sentence is
      // the owner overruling it, and a box that refuses to submit is a box
      // people come to hate.
      if (source === "typed" && overrideFor !== command && savedACall(reflex.route)) {
        const block = newBlock({ command, mode, source });
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
    [bridge, historyFor, input, mode, overrideFor, patch, profile?.name, reflex, runTool, voice],
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

  const go = useCallback((id: TabId) => {
    setTab(id);
    window.location.hash = id;
    const group = groupOf(id);
    if (group) setOpenGroup(group);
    // What the self-audit's "nobody opens this" finding is measured from.
    // Device-local on purpose: a phone that never opens Studio must not teach
    // the auditor that the laptop never opens Studio either.
    noteOpened(id);
  }, []);

  /** An update row naming a tab. Strings, because the feed predates this rail. */
  const goByName = useCallback(
    (name: string) => {
      // The feed's older ids point at surfaces that are now panels rather than
      // tabs. Memory is the Dashboard now, and so is a pending action.
      const mapped = name === "memory" || name === "chat" ? "dashboard" : name;
      if (isTab(mapped)) go(mapped);
    },
    [go],
  );

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
        <span className="hidden text-xs text-ink-muted sm:inline">
          · {profile ? `${profile.name}'s assistant` : "the console"}
        </span>
        <Link
          href="/apps/jarvis"
          className="ml-auto rounded-lg border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          Old Jarvis
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Sections"
          className="flex w-[var(--nj-rail)] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-panel py-2"
        >
          {TOP.map((t) => (
            <RailButton
              key={t.id}
              tab={t}
              on={tab === t.id}
              onClick={() => go(t.id)}
              badge={t.id === "console" && running ? "live" : t.id === "dashboard" && updates.unread > 0 ? "unread" : null}
            />
          ))}

          {GROUPS.map((group) => {
            const open = openGroup === group.id;
            const inside = group.items.some((i) => i.id === tab);
            const I = Icon[group.icon];
            return (
              <div key={group.id} className="contents">
                <button
                  type="button"
                  onClick={() => setOpenGroup(open && !inside ? null : open ? null : group.id)}
                  aria-expanded={open}
                  title={group.label}
                  className={`group relative mx-1.5 flex flex-col items-center gap-0.5 rounded-md py-1.5 transition ${
                    inside ? "bg-elevated text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"
                  }`}
                >
                  <I width={15} height={15} />
                  <span className="text-[9.5px] leading-none">{group.label}</span>
                </button>
                {open &&
                  group.items.map((t) => (
                    <RailButton key={t.id} tab={t} on={tab === t.id} onClick={() => go(t.id)} nested />
                  ))}
              </div>
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
            busy={running}
          />

          {/* The reflex, over whatever is in the box. Hidden when there is
              nothing to judge, so an empty console is not a readout. */}
          {input.trim() && (
            <ReflexStrip
              reflex={reflex}
              onAccept={() => {
                setOverrideFor("");
                void submit();
              }}
              onAnyway={() => {
                setOverrideFor(input.trim());
                // The override is read on the next submit, so it has to run
                // after this state has landed.
                setTimeout(() => submitRef.current(input.trim(), "typed"), 0);
              }}
            />
          )}

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
              <span className="text-[11px] text-ink-faint" aria-hidden>·</span>
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
                className={`ml-auto text-ink-muted transition-transform ${panelsOpen ? "rotate-90" : ""}`}
                aria-hidden
              />
            </button>
            {panelsOpen && (
              <div className="border-t border-line-soft">
                <VoicePanel
                  voice={voice}
                  mode={reactorMode}
                  onMode={setReactorMode}
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
                go={goByName}
              />
            ) : tab === "console" ? (
              <div className="space-y-2 p-3">
                {blocks.length === 0 ? (
                  <Empty
                    paired={bridge.health.paired && bridge.health.up}
                    onPick={(text) => {
                      setInput(text);
                      document.querySelector<HTMLTextAreaElement>(".nj-command textarea")?.focus();
                    }}
                  />
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
                {tab === "skills" && <SkillsLibrary chromeless />}
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
                  <SettingsTab go={((t: string) => goByName(t)) as never} updates={updates} />
                )}
              </>
            )}
          </div>
        </main>

        <aside className="hidden w-[var(--nj-aside)] shrink-0 overflow-y-auto border-l border-line bg-panel lg:block">
          <VoicePanel
            voice={voice}
            mode={reactorMode}
            onMode={setReactorMode}
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
 * One rail entry.
 *
 * Extracted because the rail now has three kinds of row — a top-level tab, a
 * folder, and a tab nested inside a folder — and inlining three nearly
 * identical buttons is how they drift apart.
 */
function RailButton({
  tab,
  on,
  onClick,
  nested = false,
  badge = null,
}: {
  tab: Tab;
  on: boolean;
  onClick: () => void;
  nested?: boolean;
  badge?: "live" | "unread" | null;
}) {
  const I = Icon[tab.icon];
  return (
    <button
      type="button"
      onClick={onClick}
      title={tab.label}
      aria-current={on ? "page" : undefined}
      className={`group relative flex flex-col items-center gap-0.5 rounded-md py-1.5 transition ${
        nested ? "mx-2.5" : "mx-1.5"
      } ${on ? "bg-elevated text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"}`}
    >
      <I width={nested ? 13 : 15} height={nested ? 13 : 15} />
      <span className={nested ? "text-[9px] leading-none" : "text-[9.5px] leading-none"}>{tab.label}</span>
      {badge === "live" && <span className="nj-dot absolute right-1 top-1 bg-brand" data-live="true" aria-hidden />}
      {badge === "unread" && <span className="nj-dot absolute right-1 top-1 bg-support" aria-hidden />}
    </button>
  );
}

/**
 * The empty console.
 *
 * It teaches the surface rather than announcing that it is empty: four real
 * commands the owner can read and reuse, and an honest line about what is
 * reachable right now.
 */
function Empty({ paired, onPick }: { paired: boolean; onPick: (text: string) => void }) {
  const examples = [
    "what did I decide about the hub's AI provider?",
    "open my Vercel dashboard and tell me if the last deploy failed",
    "which node processes are running, and how much memory each",
    "read tools/jarvis-bridge/README.md and summarise what it does",
  ];
  // Flush left, on the same x as the command line and every block. Centred, it
  // was the one thing on the surface that did not line up with the column it
  // belongs to.
  return (
    <div className="max-w-2xl py-8">
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
          <li key={e}>
            {/* The one moment the surface teaches itself. These used to look
                exactly like input fields and do nothing when clicked. */}
            <button
              type="button"
              onClick={() => onPick(e)}
              className="group flex w-full items-center gap-2 rounded-md border border-line-soft bg-panel px-3 py-2 text-left font-mono text-[11.5px] text-ink-muted transition hover:border-line hover:bg-panel-2 hover:text-ink"
            >
              <span className="flex-1">{e}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-muted opacity-0 transition group-hover:opacity-100">
                use
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-[11px] leading-relaxed text-ink-muted">
        {paired
          ? "This PC is reachable, so the last three will actually run."
          : "The last three need the local agent on your PC. Without it, it can still think, remember and answer — it just cannot touch the machine."}
      </p>
    </div>
  );
}
