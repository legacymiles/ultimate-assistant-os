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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { applyChanges, newId, type Applied } from "./changes";
import { importRecallProfiles, syncLifeRecord } from "./imports";
import { readRecall, recallMediaFor, syncToRecall } from "./recallBridge";
import { emptyProfiles, seedProfiles } from "./seed";
import { hueOf, whereLabel } from "./tree";
import type { Change, LogEntry, ProfilesData } from "./types";
import type { RecallData } from "@/lib/recall/types";

/** Read Profiles' own blob, bring in the Life record and Dashboard profiles. */
async function withImports(base: ProfilesData): Promise<ProfilesData | null> {
  let next = base;
  let changed = false;
  try {
    const { getRecord } = await import("@/lib/jarvis/record/store");
    const r = syncLifeRecord(next, getRecord());
    if (r.changed) {
      next = r.data;
      changed = true;
    }
  } catch {
    /* no Life record on this device */
  }
  const recall = await readRecall();
  const i = importRecallProfiles(next, recall);
  if (i.count) {
    next = i.data;
    changed = true;
  }
  return changed ? next : null;
}

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
  const [recall, setRecall] = useState<RecallData | null>(null);
  const ref = useRef(data);
  ref.current = data;

  const commit = useCallback((next: ProfilesData) => {
    ref.current = next;
    setData(next);
    saveSynced(STORE_KEY, next);
  }, []);

  /** Bring in the Life record (what Read my screen saves) and Dashboard profiles. */
  const runImports = useCallback(async () => {
    const next = await withImports(ref.current);
    if (next) commit(next);
  }, [commit]);

  useEffect(() => {
    setData(load());
    setReady(true);
  }, []);
  // Imports run only once this device has settled against the account, so a
  // stale local copy is never the one an import is written on top of.
  useRemotePull(STORE_KEY, () => {
    const fresh = load();
    ref.current = fresh;
    setData(fresh);
    void runImports();
    void readRecall().then(setRecall);
  });

  // Read my screen writes to the Life record; pick that up when it happens.
  useEffect(() => {
    const again = () => void runImports();
    window.addEventListener("jarvis:record-changed", again);
    window.addEventListener("focus", again);
    return () => {
      window.removeEventListener("jarvis:record-changed", again);
      window.removeEventListener("focus", again);
    };
  }, [runImports]);

  // Mirror into the Dashboard (Folders, Memory graph, Photos) a moment after
  // each change, and remember the folders and items it made.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(async () => {
      const got = await syncToRecall(ref.current);
      if (got && (Object.keys(got.links).length || Object.keys(got.media).length)) {
        const next: ProfilesData = { ...ref.current, nodes: { ...ref.current.nodes } };
        for (const [id, link] of Object.entries(got.links)) if (next.nodes[id]) next.nodes[id] = { ...next.nodes[id], recall: link };
        if (Object.keys(got.media).length)
          for (const [id, n] of Object.entries(next.nodes))
            if (n.media.some((m) => got.media[m.id])) next.nodes[id] = { ...n, media: n.media.map((m) => (got.media[m.id] ? { ...m, recallItemId: got.media[m.id] } : m)) };
        commit(next);
      }
      setRecall(await readRecall());
    }, 1200);
    return () => clearTimeout(t);
  }, [data, ready, commit]);

  /** What the screens show: each profile's own media plus its Dashboard pictures. */
  const view = useMemo(() => {
    if (!recall) return data;
    let touched = false;
    const nodes: ProfilesData["nodes"] = {};
    for (const [id, n] of Object.entries(data.nodes)) {
      const extra = n.recall ? recallMediaFor(n, recall) : [];
      if (extra.length) touched = true;
      nodes[id] = extra.length ? { ...n, media: [...n.media, ...extra] } : n;
    }
    return touched ? { ...data, nodes } : data;
  }, [data, recall]);

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

  return { data: view, ready, apply, lastLog, undo, setSettings, clearExamples, restoreExamples };
}
