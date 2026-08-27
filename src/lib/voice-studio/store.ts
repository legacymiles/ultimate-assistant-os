"use client";

// ---------------------------------------------------------------------------
// Voice Studio — localStorage persistence (offline-first, no DB).
// Recent generations and saved cloned voices survive reloads.
// ---------------------------------------------------------------------------

import { MAX_HISTORY, type ClonedVoice, type HistoryItem } from "./types";

const HISTORY_KEY = "voice-studio.history";
const VOICES_KEY = "voice-studio.voices";

function read<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, value: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded (base64 audio is heavy) — drop the oldest and retry once.
    try {
      window.localStorage.setItem(key, JSON.stringify(value.slice(0, Math.ceil(value.length / 2))));
    } catch {
      /* give up silently — persistence is best-effort */
    }
  }
}

// ----- History -------------------------------------------------------------

export function loadHistory(): HistoryItem[] {
  return read<HistoryItem>(HISTORY_KEY);
}

export function addHistory(item: HistoryItem): HistoryItem[] {
  const next = [item, ...loadHistory()].slice(0, MAX_HISTORY);
  write(HISTORY_KEY, next);
  return next;
}

export function removeHistory(id: string): HistoryItem[] {
  const next = loadHistory().filter((h) => h.id !== id);
  write(HISTORY_KEY, next);
  return next;
}

export function clearHistory(): HistoryItem[] {
  write<HistoryItem>(HISTORY_KEY, []);
  return [];
}

// ----- Saved cloned voices --------------------------------------------------

export function loadVoices(): ClonedVoice[] {
  return read<ClonedVoice>(VOICES_KEY);
}

export function addVoice(voice: ClonedVoice): ClonedVoice[] {
  const next = [voice, ...loadVoices().filter((v) => v.id !== voice.id)];
  write(VOICES_KEY, next);
  return next;
}

export function removeVoice(id: string): ClonedVoice[] {
  const next = loadVoices().filter((v) => v.id !== id);
  write(VOICES_KEY, next);
  return next;
}
