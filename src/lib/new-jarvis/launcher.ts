"use client";

// ---------------------------------------------------------------------------
// The launcher — favorite apps and the ones used last.
//
// Favorites are starred on the Apps page (Jarvis › Toolbox › Apps); the Deck
// shows them as its first row. "Last used" is recorded whenever an app plugin
// or a Jarvis tab is opened, so the Deck can offer one-tap return.
//
// Synced: a favorite starred on the phone should be on the laptop's Deck too.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";

export const LAUNCHER_KEY = "jarvis-launcher:v1";
const CHANGED = "jarvis-launcher-changed";
const MAX_RECENT = 8;

export type LaunchKind = "app" | "tab";

export interface RecentEntry {
  kind: LaunchKind;
  /** A catalog slug for an app, a tab id for a tab. */
  id: string;
  label: string;
  at: string;
}

export interface LauncherData {
  favorites: string[];
  recent: RecentEntry[];
}

const EMPTY: LauncherData = { favorites: [], recent: [] };

export function getLauncher(): LauncherData {
  const d = loadLocal<LauncherData>(LAUNCHER_KEY, EMPTY);
  return {
    favorites: Array.isArray(d?.favorites) ? d.favorites : [],
    recent: Array.isArray(d?.recent) ? d.recent : [],
  };
}

function save(d: LauncherData): LauncherData {
  saveSynced(LAUNCHER_KEY, d);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
  return d;
}

export function toggleFavorite(slug: string): LauncherData {
  const d = getLauncher();
  d.favorites = d.favorites.includes(slug) ? d.favorites.filter((s) => s !== slug) : [...d.favorites, slug];
  return save(d);
}

export function noteLaunch(kind: LaunchKind, id: string, label: string): LauncherData {
  const d = getLauncher();
  d.recent = [
    { kind, id, label, at: new Date().toISOString() },
    ...d.recent.filter((r) => !(r.kind === kind && r.id === id)),
  ].slice(0, MAX_RECENT);
  return save(d);
}

/** Live view of the launcher; re-reads on any write and after the remote pull. */
export function useLauncher(): LauncherData {
  const [data, setData] = useState<LauncherData>(EMPTY);
  useEffect(() => {
    const read = () => setData(getLauncher());
    read();
    window.addEventListener(CHANGED, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(CHANGED, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  useRemotePull(LAUNCHER_KEY, () => setData(getLauncher()));
  return data;
}

/** "4m", "2h", "Yesterday" — short enough for a chip. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d === 1 ? "Yesterday" : `${d}d`;
}
