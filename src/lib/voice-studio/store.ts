"use client";

// ---------------------------------------------------------------------------
// Voice Studio — persistence.
//
// Two homes, on purpose. localStorage keeps the full records including their
// base64 audio, so this device plays clips with no network at all and offline
// behaviour is exactly what it always was. The synced copy in app_state keeps
// the same records with the audio replaced by a storage path, because a jsonb
// row is the wrong place for tens of megabytes of base64.
//
// So a clip you recorded here plays from memory; the same clip on your phone
// plays from a signed URL resolved out of the voice-clips bucket. See media.ts.
// ---------------------------------------------------------------------------

import { pushRemote, stampLocal } from "@/lib/sync/appState";
import { uploadClip } from "./media";
import { MAX_HISTORY, type ClonedVoice, type HistoryItem } from "./types";
import { scopedKey } from "@/lib/sync/identity";

/** Also the app_state sync keys; components pass them to useRemotePull. */
export const HISTORY_KEY = "voice-studio.history";
export const VOICES_KEY = "voice-studio.voices";

function read<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(scopedKey(key));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeLocal<T>(key: string, value: T[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(scopedKey(key), JSON.stringify(value));
  } catch {
    // Quota exceeded (base64 audio is heavy) — drop the oldest and retry once.
    try {
      window.localStorage.setItem(scopedKey(key), JSON.stringify(value.slice(0, Math.ceil(value.length / 2))));
    } catch {
      /* give up silently — persistence is best-effort */
    }
  }
}

/**
 * Records with `audioDataUrl` swapped for `audioPath`.
 *
 * Anything still holding a data: URL that failed to upload is sent with neither
 * field rather than with the base64 inline: the metadata is worth syncing on
 * its own, and a row that quietly grows by a megabyte per clip is not.
 */
async function toSyncShape<T extends { id: string; audioDataUrl?: string; audioPath?: string }>(
  items: T[],
): Promise<Omit<T, "audioDataUrl">[]> {
  return Promise.all(
    items.map(async (item) => {
      const { audioDataUrl, ...rest } = item;
      if (item.audioPath || !audioDataUrl) return rest as Omit<T, "audioDataUrl">;
      const audioPath = (await uploadClip(item.id, audioDataUrl)) ?? undefined;
      return { ...rest, audioPath } as Omit<T, "audioDataUrl">;
    }),
  );
}

/**
 * Write locally now, then upload any new audio and push the light copy.
 *
 * The remote half is deliberately not awaited. Uploading a clip can take a
 * while and the user must never wait on it to carry on working; if it fails,
 * localStorage already holds the real record.
 */
function write<T extends { id: string; audioDataUrl?: string; audioPath?: string }>(
  key: string,
  value: T[],
): void {
  writeLocal(key, value);
  stampLocal(key);
  void (async () => {
    const light = await toSyncShape(value);
    // Keep the paths we just minted locally too, so the next save does not
    // re-upload the same bytes.
    const byId = new Map(light.map((l) => [l.id, (l as { audioPath?: string }).audioPath]));
    const merged = value.map((v) =>
      v.audioPath || !byId.get(v.id) ? v : { ...v, audioPath: byId.get(v.id) },
    );
    if (merged.some((m, i) => m !== value[i])) writeLocal(key, merged);
    await pushRemote(key, light);
  })();
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
