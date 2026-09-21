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
import { toCalEvent, useDashboardCalendar } from "@/lib/jarvis/useDashboardCalendar";
import { loadLocal } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { STORE_KEY, emptyStore } from "@/lib/new-dashboard/model";
import type { DashboardStore, Profile } from "@/lib/new-dashboard/types";
import { nodesFrom } from "./MemoryTab";
import { emptyJarvis, JARVIS_KEY, loadJarvis, saveJarvis, uid } from "@/lib/jarvis/store";
import { useMemory } from "@/lib/jarvis/useMemory";
import type { ChatTurn, Conversation, JarvisStore } from "@/lib/jarvis/types";

export type TabId =
  | "dashboard" | "chat" | "inbox" | "calendar"
  | "folders" | "photos" | "lists"
  | "memory" | "routines" | "skills" | "profile";

/**
 * The rail, in three groups. Folders, Photos and Lists are the old Dashboard
 * app, moved in whole — there is one dashboard now, and it is this one.
 */
const TABS: { id: TabId; label: string; icon: keyof typeof Icon; group: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "Grid", group: "Assistant" },
  { id: "chat", label: "Chat", icon: "Bot", group: "Assistant" },
  { id: "inbox", label: "Inbox", icon: "Inbox", group: "Assistant" },
  { id: "calendar", label: "Calendar", icon: "Calendar", group: "Assistant" },
  { id: "folders", label: "Folders", icon: "Folder", group: "Your stuff" },
  { id: "photos", label: "Photos", icon: "Image", group: "Your stuff" },
  { id: "lists", label: "Lists", icon: "ListChecks", group: "Your stuff" },
  { id: "memory", label: "Memory", icon: "Database", group: "Jarvis" },
  { id: "routines", label: "Routines", icon: "Clock", group: "Jarvis" },
  { id: "skills", label: "Skills", icon: "Sparkles", group: "Jarvis" },
  { id: "profile", label: "Profile", icon: "Users", group: "Jarvis" },
];

function isTab(v: string): v is TabId {
  return TABS.some((t) => t.id === v);
}

export function Jarvis() {
  const [tab, setTab] = useState<TabId>("dashboard");
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

  const rail = (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-panel px-2 py-1.5 md:h-[calc(100dvh-49px)] md:w-44 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:px-2 md:py-3">
      {TABS.map((t, i) => {
        const I = Icon[t.icon];
        const on = tab === t.id;
        const first = i === 0 || TABS[i - 1].group !== t.group;
        return (
          <div key={t.id} className="contents">
          {first && (
            <span
              className={`hidden px-2.5 pb-1 text-[10px] font-medium text-ink-faint md:block ${i === 0 ? "" : "pt-3"}`}
            >
              {t.group}
            </span>
          )}
          <button
            onClick={() => go(t.id)}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
              on ? "bg-panel-2 text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"
            }`}
          >
            <I width={14} height={14} />
            <span className={on ? "" : "hidden sm:inline"}>{t.label}</span>
          </button>
          </div>
        );
      })}
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
            <DashboardTab profile={profile} store={briefStore ?? store} go={go} />
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
          {tab === "skills" && <SkillsLibrary chromeless />}
          {tab === "memory" && <MemoryTab store={store} commit={commit} />}
          {tab === "profile" && <NewDashboard chromeless />}
          {tab === "chat" && (
            <ChatTab store={store} commit={commit} profile={profile} onDashboardChanged={dash.refresh} />
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
