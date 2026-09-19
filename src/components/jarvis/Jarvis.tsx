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
import { ChatTab } from "./ChatTab";
import { DashboardTab } from "./DashboardTab";
import { MemoryTab } from "./MemoryTab";
import { Placeholder } from "./Placeholder";
import { RoutinesTab } from "./RoutinesTab";
import { loadLocal } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { STORE_KEY, emptyStore } from "@/lib/new-dashboard/model";
import type { DashboardStore, Profile } from "@/lib/new-dashboard/types";
import { JARVIS_KEY, loadJarvis, saveJarvis } from "@/lib/jarvis/store";
import type { JarvisStore } from "@/lib/jarvis/types";

export type TabId = "dashboard" | "chat" | "inbox" | "calendar" | "memory" | "routines" | "profile";

const TABS: { id: TabId; label: string; icon: keyof typeof Icon }[] = [
  { id: "dashboard", label: "Dashboard", icon: "Grid" },
  { id: "chat", label: "Chat", icon: "Bot" },
  { id: "inbox", label: "Inbox", icon: "Inbox" },
  { id: "calendar", label: "Calendar", icon: "Calendar" },
  { id: "memory", label: "Memory", icon: "Database" },
  { id: "routines", label: "Routines", icon: "ListChecks" },
  { id: "profile", label: "Profile", icon: "Users" },
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

  const go = (id: TabId) => {
    setTab(id);
    window.location.hash = id;
  };

  if (!store) return <div className="min-h-dvh" />;

  const rail = (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-panel px-2 py-1.5 md:h-[calc(100dvh-49px)] md:w-44 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:px-2 md:py-3">
      {TABS.map((t) => {
        const I = Icon[t.icon];
        const on = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
              on ? "bg-panel-2 text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"
            }`}
          >
            <I width={14} height={14} />
            <span className={on ? "" : "hidden sm:inline"}>{t.label}</span>
          </button>
        );
      })}
      <div className="hidden md:mt-auto md:block md:px-1 md:pt-4">
        <p className="text-[10px] leading-relaxed text-ink-faint">
          Apps: not connected
          <br />
          Voice: stage 3
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
            disabled
            title="Voice arrives in stage 3"
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-faint opacity-60"
          >
            <Icon.Mic width={14} height={14} />
            <span className="hidden sm:inline">Talk</span>
          </button>
        </div>
      </div>

      <div className="md:flex">
        {rail}
        <main className="min-w-0 flex-1">
          {tab === "dashboard" && (
            <DashboardTab profile={profile} store={store} go={go} />
          )}
          {tab === "memory" && <MemoryTab store={store} commit={commit} />}
          {tab === "profile" && <NewDashboard chromeless />}
          {tab === "chat" && <ChatTab store={store} commit={commit} profile={profile} />}
          {tab === "inbox" && (
            <Placeholder
              stage={4}
              title="Inbox"
              does="Messages from the sites you connect, in one list, with reply drafts you approve before anything is sent."
            />
          )}
          {tab === "calendar" && (
            <Placeholder
              stage={4}
              title="Calendar"
              does="Your real calendar, with Jarvis able to add and move events — always showing you the exact event first."
            />
          )}
          {tab === "routines" && <RoutinesTab store={store} commit={commit} profile={profile} />}
        </main>
      </div>
    </div>
  );
}
