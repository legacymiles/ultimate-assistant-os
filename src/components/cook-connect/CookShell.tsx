"use client";

// The frame: a left rail of destinations, a slim top bar, and the view.
// The rail collapses to a bottom bar on a phone, because a 216px sidebar on a
// 375px screen is most of the screen.

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useCook, type Route } from "./CookConnect";
import {
  BackIcon, BookIcon, FeedIcon, PeopleIcon, PlayIcon, SoundOffIcon, SoundOnIcon, TrophyIcon, UserIcon,
} from "./icons";
import { Avatar, Button, cx } from "./ui";
import { sounds } from "@/lib/cook-connect/sounds";

interface NavItem {
  id: string;
  label: string;
  route: Route;
  icon: (p: { size?: number }) => ReactNode;
}

const NAV: NavItem[] = [
  { id: "play", label: "Play", route: { page: "play" }, icon: PlayIcon },
  { id: "explore", label: "Explore", route: { page: "explore" }, icon: PeopleIcon },
  { id: "cookbooks", label: "Cookbooks", route: { page: "cookbooks" }, icon: BookIcon },
  { id: "journal", label: "Journal", route: { page: "journal" }, icon: FeedIcon },
  { id: "leaderboards", label: "Boards", route: { page: "leaderboards" }, icon: TrophyIcon },
];

/** Which rail item a route belongs under, including its detail screens. */
function sectionFor(route: Route): string {
  switch (route.page) {
    case "explore":
    case "profile":
    case "group": return "explore";
    case "cookbooks":
    case "cookbook":
    case "recipe":
    case "new-recipe":
    case "new-cookbook":
    case "shared": return "cookbooks";
    case "play":
    case "spades":
    case "chess": return "play";
    case "journal": return "journal";
    case "leaderboards": return "leaderboards";
  }
}

const TITLES: Record<string, string> = {
  play: "Play",
  explore: "Explore",
  cookbooks: "Cookbooks",
  journal: "Journal",
  leaderboards: "Leaderboards",
};

export function CookShell({ children }: { children: ReactNode }) {
  const { route, navigate, back, canGoBack, profile, isLocal, signOut } = useCook();
  const [muted, setMuted] = useState(() => sounds.muted);
  const section = sectionFor(route);
  const isDetail = !NAV.some((n) => n.route.page === route.page);

  const toggleSound = () => {
    const next = !muted;
    sounds.muted = next;
    setMuted(next);
    if (!next) sounds.playerJoin();
  };

  return (
    <div className="cc flex min-h-screen flex-col md:flex-row">
      {/* Rail — desktop */}
      <nav
        aria-label="Cook Connect sections"
        className="sticky top-0 z-30 hidden h-screen w-[216px] shrink-0 flex-col border-r
                   border-[var(--cc-line)] bg-[var(--cc-panel)] md:flex"
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <Wordmark />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.route)}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold",
                  "transition-colors duration-150",
                  active
                    ? "bg-[var(--cc-elevated)] text-[var(--cc-ink)]"
                    : "text-[var(--cc-ink-muted)] hover:bg-[var(--cc-panel-2)] hover:text-[var(--cc-ink)]",
                )}
              >
                <span className={active ? "text-[var(--cc-ember)]" : ""}>
                  <Icon size={17} />
                </span>
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="border-t border-[var(--cc-line)] p-2">
          {profile && (
            <button
              type="button"
              onClick={() => navigate({ page: "profile", userId: profile.id })}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left
                         transition-colors duration-150 hover:bg-[var(--cc-panel-2)]"
            >
              <Avatar id={profile.id} name={profile.display_name} url={profile.avatar_url} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{profile.display_name}</span>
                <span className="block truncate text-[11px] text-[var(--cc-ink-faint)]">@{profile.handle}</span>
              </span>
            </button>
          )}
          <div className="mt-1 flex items-center gap-1 px-1">
            <button
              type="button"
              onClick={toggleSound}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-[var(--cc-ink-faint)]
                         transition-colors duration-150 hover:text-[var(--cc-ink-muted)]"
            >
              {muted ? <SoundOffIcon size={14} /> : <SoundOnIcon size={14} />}
              {muted ? "Sound off" : "Sound on"}
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="ml-auto rounded-md px-1.5 py-1 text-[11px] text-[var(--cc-ink-faint)]
                         transition-colors duration-150 hover:text-[var(--cc-ink-muted)]"
            >
              Sign out
            </button>
          </div>
          {isLocal && (
            <p className="mt-2 rounded-md border border-[#3a3420] bg-[#1c1a10] px-2 py-1.5 text-[11px] leading-snug text-[var(--cc-gold)]">
              Demo mode — everything is stored in this browser.
            </p>
          )}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        {/* Top bar */}
        <header
          className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-[var(--cc-line)]
                     bg-[color-mix(in_srgb,var(--cc-canvas)_88%,transparent)] px-3 backdrop-blur-sm md:px-4"
        >
          <div className="md:hidden">
            <Wordmark compact />
          </div>
          {canGoBack && isDetail && (
            <Button variant="ghost" onClick={back} className="-ml-1 px-2">
              <BackIcon size={15} />
              Back
            </Button>
          )}
          <h1 className="hidden text-[13px] font-semibold text-[var(--cc-ink-muted)] md:block">
            {TITLES[section]}
          </h1>
          <div className="ml-auto flex items-center gap-1.5">
            {/* Out of the app entirely, back to the assistant. A real link, so
                it leaves Cook Connect rather than moving inside it. */}
            <Link
              href="/apps/jarvis"
              aria-label="Back to Jarvis"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cc-line)]
                         bg-[var(--cc-elevated)] px-3 py-1.5 text-[13px] font-semibold
                         text-[var(--cc-ink-muted)] transition-colors duration-150
                         hover:border-[#39405a] hover:text-[var(--cc-ink)]"
            >
              <BackIcon size={14} />
              Jarvis
            </Link>
            <Button variant="primary" onClick={() => navigate({ page: "play" })}>
              <PlayIcon size={14} />
              Start a game
            </Button>
          </div>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      {/* Rail — phone */}
      <nav
        aria-label="Cook Connect sections"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--cc-line)]
                   bg-[var(--cc-panel)] md:hidden"
      >
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.route)}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold",
                "transition-colors duration-150",
                active ? "text-[var(--cc-ember)]" : "text-[var(--cc-ink-faint)]",
              )}
            >
              <Icon size={18} />
              {item.label}
            </button>
          );
        })}
        {profile && (
          <button
            type="button"
            onClick={() => navigate({ page: "profile", userId: profile.id })}
            className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold text-[var(--cc-ink-faint)]"
          >
            <UserIcon size={18} />
            You
          </button>
        )}
      </nav>
    </div>
  );
}

/** The mark: a pot that is also a table, which is the whole app in one glyph. */
function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4.5 9.5h15l-1.2 8.2a2.5 2.5 0 0 1-2.5 2.1H8.2a2.5 2.5 0 0 1-2.5-2.1z"
          fill="none"
          stroke="var(--cc-ember)"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M3 9.5h18" stroke="var(--cc-ember)" strokeWidth="1.6" strokeLinecap="round" />
        <path
          d="M9 6.2c0-1.2 1.2-1.4 1.2-2.6M14.2 6.2c0-1.2 1.2-1.4 1.2-2.6"
          fill="none"
          stroke="var(--cc-live)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span className={compact ? "text-[14px] font-bold tracking-tight" : "text-[15px] font-bold tracking-tight"}>
        Cook<span className="text-[var(--cc-ember)]">Connect</span>
      </span>
    </span>
  );
}
