"use client";

// The owner's workflow notifications — storage and the hook. Synced, so a rule
// written on the phone fires on the laptop. Rule logic is in watchRules.ts.

import { useEffect, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { coerceRule, type ParsedWatch, type Watch } from "./watchRules";

export * from "./watchRules";

export const WATCHES_KEY = "jarvis-watches:v1";
export const WATCHES_CHANGED = "jarvis-watches-changed";

// ----- store ---------------------------------------------------------------

export function getWatches(): Watch[] {
  const raw = loadLocal<unknown>(WATCHES_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((w) => {
      const x = w as Partial<Watch>;
      const rule = coerceRule(x.rule);
      if (!x.id || !rule) return null;
      return {
        id: String(x.id),
        prompt: String(x.prompt ?? ""),
        title: String(x.title ?? x.prompt ?? "Notification").slice(0, 80),
        rule,
        on: x.on !== false,
        createdAt: typeof x.createdAt === "string" ? x.createdAt : new Date(0).toISOString(),
      } satisfies Watch;
    })
    .filter((w): w is Watch => w !== null);
}

function save(list: Watch[]): Watch[] {
  saveSynced(WATCHES_KEY, list);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WATCHES_CHANGED));
  return list;
}

export function addWatch(prompt: string, parsed: ParsedWatch): Watch {
  const w: Watch = {
    id: `w_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    prompt: prompt.trim(),
    title: parsed.title.trim().slice(0, 80) || prompt.trim().slice(0, 80),
    rule: parsed.rule,
    on: true,
    createdAt: new Date().toISOString(),
  };
  save([...getWatches(), w]);
  return w;
}

export function toggleWatch(id: string): void {
  save(getWatches().map((w) => (w.id === id ? { ...w, on: !w.on } : w)));
}

export function removeWatch(id: string): void {
  save(getWatches().filter((w) => w.id !== id));
}

export function useWatches(): Watch[] {
  const [list, setList] = useState<Watch[]>([]);
  useEffect(() => {
    const read = () => setList(getWatches());
    read();
    window.addEventListener(WATCHES_CHANGED, read);
    return () => window.removeEventListener(WATCHES_CHANGED, read);
  }, []);
  useRemotePull(WATCHES_KEY, () => setList(getWatches()));
  return list;
}

