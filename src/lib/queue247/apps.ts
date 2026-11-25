// ---------------------------------------------------------------------------
// Which projects the 24/7 Queue knows about.
//
// Hub apps are recognised automatically from the catalog — a new app added to
// PROJECTS is a queue target the moment it exists, with no registration step.
// Outside websites register through the API (queue_apps) and declare their own
// capabilities. Nothing here is hard-coded per example: a hub app's
// capabilities are derived from what it is (every app can take a code change;
// apps whose catalog text is about video/prompting, trading, monitoring get
// the matching executors suggested to the planner).
// ---------------------------------------------------------------------------

import { PROJECTS } from "@/lib/catalog";
import type { QueueApp } from "./types";

export interface KnownApp {
  id: string;
  name: string;
  source: "hub" | "external";
  description: string;
  /** Executor ids that suit this app. */
  executors: string[];
  url: string | null;
  callback?: boolean;
}

const HINTS: { test: RegExp; executors: string[] }[] = [
  { test: /\bh3\b|prompt lab|video (recreat|revers)|storyboard/i, executors: ["h3-recreate", "research"] },
  { test: /\bmt4\b|\bmt5\b|expert advisor|\bea\b|trading|forex|backtest/i, executors: ["mt4-discovery", "monitor", "research"] },
  { test: /photo|media|gallery|backup/i, executors: ["monitor", "research"] },
];

export function hubApps(): KnownApp[] {
  return PROJECTS.filter((p) => p.status === "live" || p.appUrl).map((p) => {
    const text = `${p.slug} ${p.title} ${p.tag ?? ""} ${p.overview}`;
    const extra = HINTS.filter((h) => h.test.test(text)).flatMap((h) => h.executors);
    return {
      id: p.slug,
      name: p.title,
      source: "hub" as const,
      description: (p.tag || p.overview).slice(0, 220),
      executors: [...new Set(["code-change", ...extra, "research"])],
      url: p.appUrl ?? p.externalUrl ?? null,
    };
  });
}

export function externalAsKnown(a: QueueApp): KnownApp {
  return {
    id: a.id,
    name: a.name,
    source: "external",
    description: a.description.slice(0, 220),
    executors: ["app-webhook", "monitor", "research"],
    url: a.url,
    callback: Boolean(a.callback_url),
  };
}

export function allApps(external: QueueApp[]): KnownApp[] {
  return [...hubApps(), ...external.map(externalAsKnown)];
}

/** Best match for a name the owner typed ("trading studio", "H3 lab", "photos"). */
export function findApp(apps: KnownApp[], name: string): KnownApp | undefined {
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!n) return undefined;
  return (
    apps.find((a) => a.id === n.replace(/ /g, "-")) ??
    apps.find((a) => a.name.toLowerCase() === n) ??
    apps.find((a) => a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase()))
  );
}

/** A compact catalogue for the planner prompt — one line per app. */
export function appsForPrompt(apps: KnownApp[]): string {
  return apps
    .map((a) => `- ${a.id} — ${a.name}${a.source === "external" ? " (outside app)" : ""}: ${a.description} [suits: ${a.executors.join(", ")}]`)
    .join("\n");
}
