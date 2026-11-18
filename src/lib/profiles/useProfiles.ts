"use client";

// ---------------------------------------------------------------------------
// The Profiles store: one JSON blob, local first, synced across devices.
//
// Same shape as the other single-blob apps (see lib/sync/appState.ts):
// localStorage is the read path, every save also goes to the owner's
// app_state row when Supabase is configured and they are signed in, and a
// device that has never seen the data pulls it once on mount.
//
// Every write goes through apply(), which uses applyChanges() and writes a
// log entry holding the exact inverse — that is what "Changed today → Undo"
// runs.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { applyChanges, newId, type Applied } from "./changes";
import { emptyProfiles, seedProfiles } from "./seed";
import { hueOf, whereLabel } from "./tree";
import type { Change, LogEntry, ProfilesData } from "./types";

export const STORE_KEY = "profiles:v1";

function load(): ProfilesData {
  const got = loadLocal<ProfilesData | null>(STORE_KEY, null);
  return got && got.version === 1 && got.nodes?.root ? got : seedProfiles();
}

export interface ProfilesStore {
  data: ProfilesData;
  ready: boolean;
  /** Apply a change set and log it. Returns what happened. */
  apply: (changes: Change[], text?: string) => Applied & { logId?: string };
  /** The newest log entry's id, read synchronously after an apply. */
  lastLog: () => string | undefined;
  undo: (logId: string) => void;
  setSettings: (patch: Partial<ProfilesData["settings"]>) => void;
  clearExamples: () => void;
  restoreExamples: () => void;
}

export function useProfiles(): ProfilesStore {
  // The seed renders on the server and the first client frame, so markup
  // matches; the saved copy replaces it right after mount.
  const [data, setData] = useState<ProfilesData>(() => seedProfiles());
  const [ready, setReady] = useState(false);
  const ref = useRef(data);
  ref.current = data;

  useEffect(() => {
    setData(load());
    setReady(true);
  }, []);
  useRemotePull(STORE_KEY, () => setData(load()));

  const commit = useCallback((next: ProfilesData) => {
    ref.current = next;
    setData(next);
    saveSynced(STORE_KEY, next);
  }, []);

  const apply = useCallback(
    (changes: Change[], text?: string): Applied & { logId?: string } => {
      const r = applyChanges(ref.current, changes);
      if (!r.done.length) return r;
      const focus = r.focus ?? "root";
      const entry: LogEntry = {
        id: newId("log"),
        at: Date.now(),
        text: text ?? r.done.join(" · "),
        where: r.data.nodes[focus] ? whereLabel(r.data, focus) : "",
        hue: r.data.nodes[focus] ? hueOf(r.data, focus) : 208,
        undo: r.undo,
      };
      commit({ ...r.data, log: [entry, ...r.data.log].slice(0, 80) });
      return { ...r, logId: entry.id };
    },
    [commit],
  );

  const undo = useCallback(
    (logId: string) => {
      const entry = ref.current.log.find((l) => l.id === logId);
      if (!entry || entry.undone) return;
      const r = applyChanges(ref.current, entry.undo);
      commit({ ...r.data, log: r.data.log.map((l) => (l.id === logId ? { ...l, undone: true } : l)) });
    },
    [commit],
  );

  const setSettings = useCallback(
    (patch: Partial<ProfilesData["settings"]>) => commit({ ...ref.current, settings: { ...ref.current.settings, ...patch } }),
    [commit],
  );

  const clearExamples = useCallback(() => {
    const cur = ref.current;
    const fresh = emptyProfiles();
    // Keep anything the owner added themselves, wherever it was filed.
    for (const n of Object.values(cur.nodes)) if (!n.example && n.id !== "root") fresh.nodes[n.id] = n;
    for (const n of Object.values(fresh.nodes)) {
      n.children = n.children.filter((c) => fresh.nodes[c]);
      n.links = n.links.filter((c) => fresh.nodes[c]);
    }
    const orphans = Object.keys(fresh.nodes).filter((id) => id !== "root" && !Object.values(fresh.nodes).some((p) => p.children.includes(id)));
    fresh.nodes.root.children.push(...orphans);
    commit({ ...fresh, settings: cur.settings });
  }, [commit]);

  const restoreExamples = useCallback(() => commit({ ...seedProfiles(), settings: ref.current.settings }), [commit]);

  const lastLog = useCallback(() => ref.current.log[0]?.id, []);

  return { data, ready, apply, lastLog, undo, setSettings, clearExamples, restoreExamples };
}
