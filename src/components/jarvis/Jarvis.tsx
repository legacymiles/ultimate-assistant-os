"use client";

// ---------------------------------------------------------------------------
// Jarvis — the shell.
//
// One left rail, one tab at a time, one store. The shell owns nothing but
// navigation and the pieces every tab needs (the active profile, the store,
// and a commit function); each tab is its own file so none of them grows into
// the 700-line component this app started as.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { NewDashboard } from "../new-dashboard/NewDashboard";
import { CalendarTab } from "./CalendarTab";
import { ChatTab } from "./ChatTab";
import { StudioTab } from "./StudioTab";
import { InboxTab } from "./InboxTab";
import { DashboardTab } from "./DashboardTab";
import { MemoryTab } from "./MemoryTab";
import { RoutinesTab } from "./RoutinesTab";
import { VoiceModal } from "./VoiceModal";
import { isDashboardTool, runDashboardTool } from "@/lib/jarvis/dashboardBridge";
import { ReminderBanner } from "./ReminderBanner";
import { Recall } from "../recall/Recall";
import { ListsBoard } from "../recall/lists/ListsBoard";
import { SkillsLibrary } from "../skills/SkillsLibrary";
import { AiRankings } from "../ai-rankings/AiRankings";
import { ToolsTab } from "./ToolsTab";
import { SettingsTab } from "./SettingsTab";
import { toCalEvent, useDashboardCalendar } from "@/lib/jarvis/useDashboardCalendar";
import { loadLocal } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { STORE_KEY, emptyStore } from "@/lib/new-dashboard/model";
import type { DashboardStore, Profile } from "@/lib/new-dashboard/types";
import { nodesFrom } from "./MemoryTab";
import { emptyJarvis, JARVIS_KEY, loadJarvis, saveJarvis, uid } from "@/lib/jarvis/store";
import { useMemory } from "@/lib/jarvis/useMemory";
import { useUpdates } from "@/lib/jarvis/useUpdates";
import type { ChatTurn, Conversation, JarvisStore } from "@/lib/jarvis/types";

export type TabId =
  | "dashboard" | "chat" | "inbox" | "calendar" | "studio"
  | "folders" | "photos" | "lists"
  | "memory" | "routines" | "skills" | "tools" | "rankings" | "profile" | "settings";

type RailTab = { id: TabId; label: string; icon: keyof typeof Icon };

/**
 * The rail. Folders, Photos and Lists are the old Dashboard app, moved in whole
 * — there is one dashboard now, and it is this one. Toolbox is a folder in the
 * rail rather than a tab: it opens to Skills, Tools and AI Rankings.
 */
const GROUPS: { title: string; items: (RailTab | { toolbox: RailTab[] })[] }[] = [
  {
    title: "Assistant",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "Grid" },
      { id: "chat", label: "Chat", icon: "Bot" },
      { id: "inbox", label: "Inbox", icon: "Inbox" },
      { id: "calendar", label: "Calendar", icon: "Calendar" },
    ],
  },
  {
    title: "Create",
    items: [{ id: "studio", label: "Studio", icon: "Film" }],
  },
  {
    title: "Your stuff",
    items: [
      { id: "folders", label: "Folders", icon: "Folder" },
      { id: "photos", label: "Photos", icon: "Image" },
      { id: "lists", label: "Lists", icon: "ListChecks" },
    ],
  },
  {
    title: "Jarvis",
    items: [
      { id: "memory", label: "Memory", icon: "Database" },
      { id: "routines", label: "Routines", icon: "Clock" },
      {
        toolbox: [
          { id: "skills", label: "Skills", icon: "Sparkles" },
          { id: "tools", label: "Tools", icon: "Layers" },
          { id: "rankings", label: "AI Rankings", icon: "Star" },
        ],
      },
      { id: "profile", label: "Profile", icon: "Users" },
      { id: "settings", label: "Settings", icon: "Settings" },
    ],
  },
];

const TOOLBOX: RailTab[] = GROUPS.flatMap((g) => g.items.flatMap((i) => ("toolbox" in i ? i.toolbox : [])));
const TABS: RailTab[] = GROUPS.flatMap((g) =>
  g.items.flatMap((i) => ("toolbox" in i ? i.toolbox : [i])),
);

function isTab(v: string): v is TabId {
  return TABS.some((t) => t.id === v);
}

export function Jarvis() {
  const [tab, setTab] = useState<TabId>("dashboard");
  /** Whether the Toolbox folder in the rail is open. Opening a tool inside it always opens it. */
  const [toolboxOpen, setToolboxOpen] = useState(false);
  useEffect(() => {
    if (TOOLBOX.some((t) => t.id === tab)) setToolboxOpen(true);
  }, [tab]);
  const [store, setStore] = useState<JarvisStore | null>(null);
  const [profiles, setProfiles] = useState<DashboardStore>(emptyStore);

  // The tab lives in the hash so a reload, a bookmark and the back button all
  // land where the owner was.
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.replace("#", "");
      if (isTab(h)) setTab(h);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

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

  const [talking, setTalking] = useState(false);
  /** A message Studio hands to Chat; the nonce lets the same text be sent twice. */
  const [chatDraft, setChatDraft] = useState<{ text: string; nonce: number } | null>(null);

  // The ball inside the voice window needs the same memories the Memory tab
  // draws. One empty store instance keeps the hook's inputs stable before the
  // real store has loaded.
  const blank = useMemo(emptyJarvis, []);
  const memory = useMemory(store ?? blank, commit);
  const voiceNodes = useMemo(
    () => nodesFrom(memory.memories, store?.mutedSources ?? []),
    [memory.memories, store?.mutedSources],
  );

  const dash = useDashboardCalendar();
  // The Updates feed lives here rather than in the dashboard tab so its badge
  // and its pop-ups keep working from whichever tab the owner is on.
  const updates = useUpdates(store, commit, dash.events);
  /** Hand-typed Jarvis events plus the Dashboard calendar, for the brief. */
  const briefStore = useMemo(
    () => (store ? { ...store, events: [...store.events, ...dash.events.map(toCalEvent)] } : null),
    [store, dash.events],
  );

  const go = (id: TabId) => {
    setTab(id);
    window.location.hash = id;
  };

  if (!store) return <div className="min-h-dvh" />;

  const turns = store.conversations[0]?.turns ?? [];

  /** The one client-side path to a real action, used by chat and by voice. */
  const runAction = async (action: { tool: string }, args: Record<string, unknown>): Promise<string> => {
    if (isDashboardTool(action.tool)) {
      const said = await runDashboardTool(action.tool, args);
      dash.refresh();
      return said;
    }
    const res = await fetch("/api/jarvis/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: action.tool, args, confirmed: true }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) throw new Error(data.error ?? "It failed.");
    return "Done.";
  };

  /** A spoken exchange is kept in the same conversation the Chat tab shows. */
  const keepExchange = (question: string, answer: string) => {
    const now = new Date().toISOString();
    const pair: ChatTurn[] = [
      { id: uid(), role: "you", text: question, at: now, spoken: true },
      { id: uid(), role: "jarvis", text: answer, at: now, spoken: true },
    ];
    const existing = store.conversations[0];
    const next: Conversation = existing
      ? { ...existing, turns: [...existing.turns, ...pair], updatedAt: now }
      : { id: uid(), title: "Conversation", startedAt: now, updatedAt: now, turns: pair };
    commit({ ...store, conversations: [next, ...store.conversations.slice(existing ? 1 : 0)] });
  };

  const railButton = (t: RailTab, nested: boolean) => {
    const I = Icon[t.icon];
    const on = tab === t.id;
    // Only the dashboard carries a count: it is where the feed is.
    const badge = t.id === "dashboard" ? updates.unread : 0;
    return (
      <button
        key={t.id}
        onClick={() => go(t.id)}
        aria-current={on ? "page" : undefined}
        className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
          nested ? "md:ml-3 md:border-l md:border-line md:rounded-l-none md:pl-3" : ""
        } ${on ? "bg-panel-2 text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"}`}
      >
        <I width={14} height={14} />
        <span className={on ? "" : "hidden sm:inline"}>{t.label}</span>
        {badge > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-brand px-1.5 text-[10px] font-semibold tabular-nums text-white">
            {badge > 99 ? "99+" : badge}
            <span className="sr-only"> new updates</span>
          </span>
        )}
      </button>
    );
  };

  const rail = (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-panel px-2 py-1.5 md:h-[calc(100dvh-49px)] md:w-44 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:px-2 md:py-3">
      {GROUPS.map((g, gi) => (
        <div key={g.title} className="contents">
          <span
            className={`hidden px-2.5 pb-1 text-[10px] font-medium text-ink-faint md:block ${gi === 0 ? "" : "pt-3"}`}
          >
            {g.title}
          </span>
          {g.items.map((item) => {
            if ("toolbox" in item) {
              const inside = item.toolbox.some((t) => t.id === tab);
              return (
                <div key="toolbox" className="contents">
                  <button
                    onClick={() => {
                      // Closed: open it and land on Skills (unless a tool in it is
                      // already showing). Open: fold it away again.
                      if (toolboxOpen && !inside) return setToolboxOpen(false);
                      setToolboxOpen(true);
                      if (!inside) go(item.toolbox[0].id);
                    }}
                    aria-expanded={toolboxOpen}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                      inside ? "text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"
                    }`}
                  >
                    <Icon.Toolbox width={14} height={14} />
                    <span className={inside ? "" : "hidden sm:inline"}>Toolbox</span>
                    <Icon.Chevron
                      width={11}
                      height={11}
                      className={`ml-auto hidden text-ink-faint transition-transform md:block ${toolboxOpen ? "rotate-90" : ""}`}
                    />
                  </button>
                  {toolboxOpen &&
                    item.toolbox.map((t) => railButton(t, true))}
                </div>
              );
            }
            return railButton(item, false);
          })}
        </div>
      ))}
      <div className="hidden md:mt-auto md:block md:px-1 md:pt-4">
        <p className="text-[10px] leading-relaxed text-ink-faint">
          Voice: on
        </p>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          aria-label="Back to hub"
        >
          <Icon.ArrowLeft width={14} height={14} />
          <span className="hidden sm:inline">Hub</span>
        </Link>
        <span className="ml-1 text-sm font-semibold text-ink">Jarvis</span>
        <span className="hidden text-xs text-ink-faint sm:inline">
          · {profile ? `${profile.name}'s assistant` : "your AI Operating System"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTalking(true)}
            title="Talk to Jarvis"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Mic width={14} height={14} />
            <span className="hidden sm:inline">Talk</span>
          </button>
        </div>
      </div>

      <div className="md:flex">
        {rail}
        <main className="min-w-0 flex-1">
          <ReminderBanner queue={dash.reminders.queue} onDismiss={dash.reminders.dismiss} />
          {tab === "dashboard" && (
            <DashboardTab profile={profile} store={briefStore ?? store} updates={updates} go={go} />
          )}
          {/* One Dashboard instance serves both tabs, so an open folder survives
              a hop to Photos and back. */}
          {(tab === "folders" || tab === "photos") && (
            <Recall section={tab} onSection={go} />
          )}
          {tab === "lists" && (
            <div className="p-3 sm:p-4">
              <ListsBoard />
            </div>
          )}
          {tab === "studio" && (
            <StudioTab
              onStartChat={(text) => {
                setChatDraft({ text, nonce: Date.now() });
                go("chat");
              }}
            />
          )}
          {tab === "skills" && <SkillsLibrary chromeless />}
          {tab === "tools" && <ToolsTab />}
          {tab === "rankings" && <AiRankings embedded />}
          {tab === "settings" && <SettingsTab go={go} updates={updates} />}
          {tab === "memory" && <MemoryTab store={store} commit={commit} />}
          {tab === "profile" && <NewDashboard chromeless />}
          {tab === "chat" && (
            <ChatTab
              store={store}
              commit={commit}
              profile={profile}
              onDashboardChanged={dash.refresh}
              draft={chatDraft}
            />
          )}
          {tab === "inbox" && <InboxTab store={store} commit={commit} profile={profile} />}
          {tab === "calendar" && (
            <CalendarTab store={store} commit={commit} dashboard={dash.events} onDashboard={dash.setEvents} />
          )}
          {tab === "routines" && <RoutinesTab store={store} commit={commit} profile={profile} />}
        </main>
      </div>

      <VoiceModal
        open={talking}
        onClose={() => setTalking(false)}
        nodes={voiceNodes}
        ownerName={profile?.name ?? ""}
        history={turns}
        onExchange={keepExchange}
        runAction={runAction}
        onProposals={(list) =>
          commit({
            ...store,
            proposals: [
              ...list.map((p) => ({
                id: uid(),
                title: p.title,
                content: p.content,
                source: "chat" as const,
                origin: "a spoken conversation",
                conversationId: store.conversations[0]?.id ?? "",
                createdAt: new Date().toISOString(),
              })),
              ...store.proposals,
            ],
          })
        }
      />
    </div>
  );
}
