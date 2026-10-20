"use client";

// ---------------------------------------------------------------------------
// YouTube videos — the browser store. One synced blob (`youtube-videos:v1`),
// so the phone and the laptop show the same list; per account, because
// app_state rows are keyed by the signed-in user.
//
// Automatic, no buttons: it re-reads when another tab saves, and pulls from
// the server again whenever the page comes back into view, so a link saved on
// the phone is there when the laptop wakes up. New saves fetch their title
// and channel by themselves.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { loadLocal, reconcile, saveSynced } from "@/lib/sync/appState";
import { parsePaste } from "./links";
import { EMPTY, addLinks, normalize, removeVideo, restoreVideo, setMeta, toggleWatched, type Library, type SavedVideo } from "./library";

export const LIBRARY_KEY = "youtube-videos:v1";
const CHANGED = "youtube-videos-changed";

function read(): Library {
  return normalize(loadLocal<unknown>(LIBRARY_KEY, EMPTY));
}

function write(lib: Library) {
  saveSynced(LIBRARY_KEY, lib);
  window.dispatchEvent(new Event(CHANGED));
}

export interface SaveOutcome {
  added: number;
  bumped: number;
  /** True when the text held no link at all. */
  nothing: boolean;
  /** The newest id, to scroll to / highlight. */
  first?: string;
}

export interface UseLibrary {
  videos: SavedVideo[];
  ready: boolean;
  save: (text: string) => SaveOutcome;
  remove: (id: string) => SavedVideo | undefined;
  undo: (v: SavedVideo) => void;
  watched: (id: string) => void;
}

export function useLibrary(): UseLibrary {
  const [lib, setLib] = useState<Library>(EMPTY);
  const [ready, setReady] = useState(false);
  const looking = useRef(new Set<string>());

  // Titles: one lookup per video, ever. `looked` stops retries on private ones.
  const fill = useCallback((l: Library) => {
    for (const v of l.videos) {
      if (v.title || v.looked || looking.current.has(v.id)) continue;
      looking.current.add(v.id);
      void fetch(`/api/youtube-videos/meta?url=${encodeURIComponent(v.url)}`)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}))
        .then((m: { title?: string; author?: string; thumb?: string }) => {
          const cur = read();
          if (!cur.videos.some((x) => x.id === v.id)) return;
          write(setMeta(cur, v.id, m));
        })
        .finally(() => looking.current.delete(v.id));
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const l = read();
      setLib(l);
      fill(l);
    };
    const pull = () => void reconcile(LIBRARY_KEY).then(sync, sync);
    sync();
    void reconcile(LIBRARY_KEY)
      .catch(() => undefined)
      .then(() => {
        sync();
        setReady(true);
      });
    const onVisible = () => document.visibilityState === "visible" && pull();
    const onStorage = (e: StorageEvent) => e.key?.includes(LIBRARY_KEY) && sync();
    window.addEventListener(CHANGED, sync);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", pull);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(CHANGED, sync);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", pull);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fill]);

  const save = useCallback((text: string): SaveOutcome => {
    const links = parsePaste(text);
    if (!links.length) return { added: 0, bumped: 0, nothing: true };
    const r = addLinks(read(), links);
    write(r.library);
    return { added: r.added.length, bumped: r.bumped.length, nothing: false, first: r.library.videos[0]?.id };
  }, []);

  const remove = useCallback((id: string) => {
    const r = removeVideo(read(), id);
    write(r.library);
    return r.removed;
  }, []);

  const undo = useCallback((v: SavedVideo) => write(restoreVideo(read(), v)), []);
  const watched = useCallback((id: string) => write(toggleWatched(read(), id)), []);

  return { videos: lib.videos, ready, save, remove, undo, watched };
}
