"use client";

// The frame. Cook Connect is two apps in one account: a big Cookbook / Connect
// switch sits at the top of the rail (and of the screen on a phone), and the
// destinations under it are that side's own. Profile, follows and followers
// are the same on both — it is one account.
// The rail collapses to a bottom bar on a phone, because a 216px sidebar on a
// 375px screen is most of the screen.

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useCook, type Route } from "./CookConnect";
import {
  BackIcon, BookIcon, FeedIcon, GearIcon, PeopleIcon, PlateIcon, PlayIcon, PlusIcon, SoundOffIcon, SoundOnIcon, TrophyIcon, UserIcon,
} from "./icons";
import { Avatar, Button, cx } from "./ui";
import { SideToggle } from "./SideToggle";
import { sounds } from "@/lib/cook-connect/sounds";
import { SIDES, type Side } from "@/lib/cook-connect/sides";
import { usePersonal } from "@/lib/cook-connect/personal";

interface NavItem {
  id: string;
  label: string;
  /** Shorter word for the phone's bottom bar, where six tabs share 375px. */
  short?: string;
  route: Route;
  icon: (p: { size?: number }) => ReactNode;
}

/** Each half's own destinations. Explore and Boards are on both, showing that side's things. */
const NAV: Record<Side, NavItem[]> = {
  cookbook: [
    { id: "cookbooks", label: "Cookbooks", short: "Books", route: { page: "cookbooks" }, icon: BookIcon },
    { id: "feed", label: "Feed", route: { page: "feed" }, icon: FeedIcon },
    { id: "explore", label: "Explore", route: { page: "explore" }, icon: PeopleIcon },
    { id: "journal", label: "Journal", route: { page: "journal" }, icon: PlateIcon },
    { id: "leaderboards", label: "Boards", route: { page: "leaderboards" }, icon: TrophyIcon },
  ],
  connect: [
    { id: "play", label: "Play", route: { page: "play" }, icon: PlayIcon },
    { id: "feed", label: "Feed", route: { page: "feed" }, icon: FeedIcon },
    { id: "explore", label: "Explore", route: { page: "explore" }, icon: PeopleIcon },
    { id: "leaderboards", label: "Boards", route: { page: "leaderboards" }, icon: TrophyIcon },
  ],
};

/** Which rail item a route belongs under, including its detail screens. */
function sectionFor(route: Route): string {
  switch (route.page) {
    case "explore":
    case "group": return "explore";
    case "profile":
    case "settings": return "profile";
    case "feed": return "feed";
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
  feed: "Feed",
  explore: "Explore",
  cookbooks: "Cookbooks",
  journal: "Journal",
  leaderboards: "Leaderboards",
  profile: "Profile",
};

export function CookShell({ children }: { children: ReactNode }) {
  const { route, side, setSide, navigate, back, canGoBack, profile, isLocal, signOut, userId } = useCook();
  const { settings } = usePersonal(userId);
  const [muted, setMuted] = useState(() => sounds.muted);
  const section = sectionFor(route);
  const nav = NAV[side];
  const isDetail = !nav.some((n) => n.route.page === route.page);
  const blurb = SIDES.find((s) => s.id === side)?.blurb;

  const toggleSound = () => {
    const next = !muted;
    sounds.muted = next;
    setMuted(next);
    if (!next) sounds.playerJoin();
  };

  return (
    <div
      className="cc flex min-h-screen flex-col md:flex-row"
      data-side={side}
      data-motion={settings.motion === "system" ? undefined : settings.motion}
    >
      {/* Rail — desktop */}
      <nav
        aria-label="Cook Connect sections"
        className="sticky top-0 z-30 hidden h-screen w-[216px] shrink-0 flex-col border-r
                   border-[var(--cc-line)] bg-[var(--cc-panel)] md:flex"
      >
        <div className="flex items-center gap-2 px-4 pb-3 pt-4">
          <Wordmark side={side} />
        </div>

        <div className="px-2.5 pb-3">
          <SideToggle side={side} onChange={setSide} size="rail" />
          <p className="mt-1.5 px-1 text-[11px] leading-snug text-[var(--cc-ink-faint)]">{blurb}</p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto border-t border-[var(--cc-line-soft)] px-2 pt-2">
          {nav.map((item) => {
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
              className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1 text-[11px] text-[var(--cc-ink-faint)]
                         transition-colors duration-150 hover:text-[var(--cc-ink-muted)]"
            >
              {muted ? <SoundOffIcon size={14} /> : <SoundOnIcon size={14} />}
              {muted ? "Muted" : "Sound"}
            </button>
            <button
              type="button"
              onClick={() => navigate({ page: "settings" })}
              className="ml-auto flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-[11px] text-[var(--cc-ink-faint)]
                         transition-colors duration-150 hover:text-[var(--cc-ink-muted)]"
            >
              <GearIcon size={13} />
              Settings
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="whitespace-nowrap rounded-md px-1.5 py-1 text-[11px] text-[var(--cc-ink-faint)]
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
          {canGoBack && isDetail && (
            <Button variant="ghost" onClick={back} className="-ml-1 px-2" aria-label="Back">
              <BackIcon size={15} />
              <span className="hidden sm:inline">Back</span>
            </Button>
          )}
          {/* On a phone the big switch IS the header — two apps, one tap apart. */}
          <div className="flex min-w-0 flex-1 justify-center md:hidden">
            <SideToggle side={side} onChange={setSide} className="w-full max-w-[280px]" />
          </div>
          <h1 className="hidden text-[13px] font-semibold text-[var(--cc-ink-muted)] md:block">
            {TITLES[section]}
          </h1>
          <div className="flex items-center gap-1.5 md:ml-auto">
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
              <span className="hidden sm:inline">Jarvis</span>
            </Link>
            {/* Each side's own main action. Hidden on a phone: the switch needs the room. */}
            <span className="hidden md:block">
              {side === "connect" ? (
                <Button variant="primary" onClick={() => navigate({ page: "play" })}>
                  <PlayIcon size={14} />
                  Start a game
                </Button>
              ) : (
                <Button variant="primary" onClick={() => navigate({ page: "new-cookbook" })}>
                  <PlusIcon size={14} />
                  New cookbook
                </Button>
              )}
            </span>
          </div>
        </header>

        {/* Keyed on the side so flipping halves plays a short hand-off. */}
        <main key={side} className="cc-side-enter min-w-0 flex-1">{children}</main>
      </div>

      {/* Rail — phone */}
      <nav
        aria-label="Cook Connect sections"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--cc-line)]
                   bg-[var(--cc-panel)] md:hidden"
      >
        {nav.map((item) => {
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
              {item.short ?? item.label}
            </button>
          );
        })}
        {profile && (
          <button
            type="button"
            onClick={() => navigate({ page: "profile", userId: profile.id })}
            aria-current={section === "profile" ? "page" : undefined}
            className={cx(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold",
              section === "profile" ? "text-[var(--cc-ember)]" : "text-[var(--cc-ink-faint)]",
            )}
          >
            <UserIcon size={18} />
            You
          </button>
        )}
      </nav>
    </div>
  );
}

/**
 * The mark: a pot that is also a table, which is the whole app in one glyph.
 * The half of the name you are in lights up.
 */
function Wordmark({ compact, side }: { compact?: boolean; side: Side }) {
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
        <span className={side === "cookbook" ? "text-[var(--cc-ember)]" : "text-[var(--cc-ink-muted)]"}>Cook</span>
        <span className={side === "connect" ? "text-[var(--cc-ember)]" : "text-[var(--cc-ink-muted)]"}>Connect</span>
      </span>
    </span>
  );
}
