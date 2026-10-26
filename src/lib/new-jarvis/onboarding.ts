"use client";

// ---------------------------------------------------------------------------
// First-run onboarding for New Jarvis.
//
// Shown once, on first open, and skippable at every step — or skipped
// entirely. It is always one click away again: the Setup button in the top
// bar, the "setup" command in the chat, the #setup link, and the "Finish
// setup" checklist in Dashboard › Profile. It reopens on the step the owner
// left, not back at Welcome.
//
// The answers do not live only here. Each step writes into the store that
// already owns that fact — the name into the Profile, "what I do" into Jarvis
// memory, image habits into Camera Autopilot's rules — so finishing onboarding
// changes how the rest of Jarvis behaves rather than filling a form nobody reads.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";

export const ONBOARDING_KEY = "jarvis-onboarding:v1";
const CHANGED = "jarvis-onboarding-changed";

/** "skipped" = the owner said "skip setup entirely": never auto-opens again. */
export type OnboardingStatus = "new" | "later" | "done" | "skipped";

export interface OnboardingData {
  status: OnboardingStatus;
  about: { name: string; call: string; role: string; businesses: string; goals: string[] };
  /** Preset Autopilot rules the owner chose (ids from PRESET_RULES). */
  photoHabits: string[];
  /** Steps the owner has been through, done or skipped. */
  seen: string[];
  /** Where they were when they closed it, so reopening resumes there. */
  lastStep: string;
  updatedAt: string;
}

export const EMPTY_ONBOARDING: OnboardingData = {
  status: "new",
  about: { name: "", call: "", role: "", businesses: "", goals: [] },
  photoHabits: [],
  seen: [],
  lastStep: "",
  updatedAt: "",
};

/** One tap answers for "What do you do?" — typing is still allowed. */
export const ROLES = [
  "Business owner",
  "Funding broker",
  "Contractor",
  "Music producer",
  "Developer",
  "Trader",
  "Real estate",
  "Content creator",
  "Student",
];

/** Name suggestions for "What should I call you?", from what they typed as their name. */
export function callSuggestions(name: string): string[] {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return [...new Set([first, "Boss", "Chief", "Sir"].filter(Boolean))];
}

/** "a, b , c" ↔ ["a","b","c"] — businesses are typed as chips but stored as text. */
export function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export const GOALS = [
  "Run my businesses",
  "Sort my photos",
  "Make music",
  "Handle email",
  "Find deals & leads",
  "Plan my day",
  "Build apps",
];

export function getOnboarding(): OnboardingData {
  const d = loadLocal<Partial<OnboardingData>>(ONBOARDING_KEY, EMPTY_ONBOARDING);
  return {
    ...EMPTY_ONBOARDING,
    ...d,
    about: { ...EMPTY_ONBOARDING.about, ...(d.about ?? {}) },
    photoHabits: Array.isArray(d.photoHabits) ? d.photoHabits : [],
    seen: Array.isArray(d.seen) ? d.seen : [],
    lastStep: typeof d.lastStep === "string" ? d.lastStep : "",
  };
}

export function saveOnboarding(patch: Partial<OnboardingData>): OnboardingData {
  const next = { ...getOnboarding(), ...patch, updatedAt: new Date().toISOString() };
  saveSynced(ONBOARDING_KEY, next);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
  return next;
}

export function useOnboarding(): [OnboardingData, boolean] {
  const [data, setData] = useState<OnboardingData>(EMPTY_ONBOARDING);
  // Settled once the remote copy has been reconciled, so a second device does
  // not pop the welcome flow at someone who finished it on their phone.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const read = () => setData(getOnboarding());
    read();
    window.addEventListener(CHANGED, read);
    return () => window.removeEventListener(CHANGED, read);
  }, []);
  useRemotePull(ONBOARDING_KEY, () => {
    setData(getOnboarding());
    setSettled(true);
  });
  return [data, settled];
}

export interface SetupItem {
  id: "about" | "birthdays" | "brain" | "keys" | "accounts" | "iphone" | "habits" | "favorites" | "sync";
  label: string;
  detail: string;
  done: boolean;
}

/** What is still open. Pure, so the Profile checklist and tests agree. */
export function setupChecklist(input: {
  onboarding: OnboardingData;
  connectedAccounts: number;
  iphoneLinked: boolean;
  rules: number;
  favorites: number;
  /** Family & friends' birthdays saved. Undefined = don't list the item (older callers). */
  birthdays?: number;
  /** An AI key is set (OpenRouter or the gateway). Unknown counts as not yet. */
  thinkingReady?: boolean;
  /** Jarvis thinks with the person's own Claude subscription (through their PC). */
  subscriptionBrain?: boolean;
  /** Memory + skill sync across devices; null while unknown (signed out, still loading). */
  sync?: { done: boolean; detail: string } | null;
}): SetupItem[] {
  const a = input.onboarding.about;
  const items: SetupItem[] = [
    {
      id: "about",
      label: "Tell Jarvis about you",
      detail: "Your name, what you do and your businesses",
      done: Boolean(a.name.trim() && a.role.trim()),
    },
    ...(input.birthdays === undefined
      ? []
      : [
          {
            id: "birthdays" as const,
            label: "Add family & friends' birthdays",
            detail: "On your Calendar every year, reminders 2 days before",
            done: input.birthdays > 0,
          },
        ]),
    {
      id: "brain",
      label: "Choose Jarvis's brain",
      detail: "Your own Claude subscription, or a cloud model key",
      done: Boolean(input.subscriptionBrain || input.thinkingReady),
    },
    {
      id: "accounts",
      label: "Connect your accounts",
      detail: "Email, calendar, drive and business tools",
      done: input.connectedAccounts > 0,
    },
    {
      id: "iphone",
      label: "Link your iPhone camera roll",
      detail: "Feeds Camera Autopilot with new photos",
      done: input.iphoneLinked,
    },
    {
      id: "habits",
      label: "Teach Camera Autopilot your habits",
      detail: "Where songs, repos, receipts and the rest go",
      done: input.rules > 0,
    },
    {
      id: "favorites",
      label: "Star your favorite apps",
      detail: "They sit at the top of your Dashboard",
      done: input.favorites > 0,
    },
  ];
  if (input.sync) {
    items.push({ id: "sync", label: "Sync memory & skills to every device", detail: input.sync.detail, done: input.sync.done });
  }
  return items;
}
