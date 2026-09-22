"use client";

// ---------------------------------------------------------------------------
// The Updates feed, wired to live data.
//
// This hook lives in the SHELL, not in the dashboard tab, for the same reason
// the reminder hook does: an update that only arrives while you happen to be
// looking at the dashboard is not a notification. The rail badge and the
// pop-ups have to work from wherever you are, so the shell owns the one
// instance and hands the result down.
//
// Three of the five sources are already in this browser (calendar, photos,
// memory proposals and pending actions are all local state the shell holds).
// Only the family board is on the server, so only it is polled — every minute
// while the tab is visible, and immediately on focus, because coming back to
// the window is exactly when you want to know what you missed.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listsApi } from "@/lib/recall/lists/client";
import { descendantFolderIds, getData, photosRoot, KEY as RECALL_KEY } from "@/lib/recall/store";
import { notificationPermission } from "@/lib/recall/calendar/reminders";
import { useRemotePull } from "@/lib/sync/useSync";
import {
  collectUpdates,
  dismissAll,
  dismissUpdate,
  markAllRead,
  recordNotified,
  toNotify,
  UPDATE_LABEL,
  type Collected,
  type JarvisUpdate,
  type UpdateSettings,
} from "./updates";
import type { CalendarEvent } from "@/lib/recall/calendar/types";
import type { BoardPayload } from "@/lib/recall/lists/types";
import type { RecallData } from "@/lib/recall/types";
import type { JarvisStore } from "./types";

/** How often the family board is re-read. */
const POLL_MS = 60_000;
/** How often the feed is recomputed, so "in 40m" and the calendar window move. */
const TICK_MS = 30_000;
/** Above this, one pop-up saying how many rather than a stack of them. */
const POPUP_BURST = 3;

export interface UpdatesApi extends Collected {
  settings: UpdateSettings;
  /** Set once the board has been asked for, so the panel can tell loading from empty. */
  ready: boolean;
  /** ISO watermark: everything at or before this has been seen. */
  seenAt: string;
  /** Why the board could not be read, or "". Never treated as "no updates". */
  boardError: string;
  markRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
  patchSettings: (patch: Partial<UpdateSettings>) => void;
  refresh: () => void;
}

export function useUpdates(
  store: JarvisStore | null,
  commit: (next: JarvisStore) => void,
  events: CalendarEvent[],
): UpdatesApi {
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [boardError, setBoardError] = useState("");
  const [ready, setReady] = useState(false);
  // Starts empty rather than reading storage during render: this hook renders
  // on the server too, where there is no localStorage.
  const [recall, setRecall] = useState<RecallData>({ folders: [], items: [] });
  const [tick, setTick] = useState(0);

  // commit needs the store as it is at the moment of the click, not as it was
  // when the callback was made — a pop-up firing mid-edit must not resurrect
  // a stale blob.
  const latest = useRef(store);
  latest.current = store;

  const refresh = useCallback(() => {
    listsApi
      .load()
      .then((b) => {
        setBoard(b);
        setBoardError("");
      })
      .catch((e: unknown) => {
        setBoard(null);
        setBoardError(e instanceof Error ? e.message : "The family board could not be read.");
      })
      .finally(() => setReady(true));
    setRecall(getData());
  }, []);

  useEffect(refresh, [refresh]);
  useRemotePull(RECALL_KEY, refresh);

  // Poll only while the tab is on screen: a backgrounded tab polling a server
  // every minute all day is somebody's battery.
  useEffect(() => {
    const poll = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") refresh();
    };
    const id = window.setInterval(poll, POLL_MS);
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const photoFolderIds = useMemo(() => {
    const root = photosRoot(recall.folders);
    return root ? descendantFolderIds(recall.folders, root.id) : new Set<string>();
  }, [recall.folders]);

  const settings = store?.updates.settings;
  const state = store?.updates.state;

  const collected = useMemo<Collected>(() => {
    if (!settings || !state) {
      return { updates: [], unread: 0, unreadIds: new Set<string>(), counts: {} as Collected["counts"] };
    }
    return collectUpdates(
      {
        board,
        events,
        items: recall.items,
        photoFolderIds,
        proposals: store?.proposals ?? [],
        actions: store?.actions ?? [],
      },
      settings,
      state,
      Date.now(),
    );
    // `tick` is the clock: it is in the deps precisely so time passing
    // recomputes the feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, events, recall.items, photoFolderIds, store?.proposals, store?.actions, settings, state, tick]);

  // ----- pop-ups -----------------------------------------------------------
  useEffect(() => {
    const s = latest.current;
    if (!s || !settings || !state) return;
    if (notificationPermission() !== "granted") return;
    const due = toNotify(collected.updates, settings, state);
    if (!due.length) return;

    try {
      if (due.length <= POPUP_BURST) {
        for (const u of due) {
          new Notification(`${UPDATE_LABEL[u.source]} · Jarvis`, {
            body: u.who ? `${u.title} — ${u.detail} (${u.who})` : `${u.title} — ${u.detail}`,
            tag: u.id,
          });
        }
      } else {
        new Notification("Jarvis", {
          body: `${due.length} new updates.`,
          tag: "jarvis-updates-burst",
        });
      }
    } catch {
      // A browser that refuses the constructor still gets the in-app feed;
      // the ids are recorded either way so it does not retry every tick.
    }

    commit({
      ...s,
      updates: { settings, state: recordNotified(state, due.map((u) => u.id)) },
    });
  }, [collected.updates, settings, state, commit]);

  // ----- actions -----------------------------------------------------------
  const write = useCallback(
    (next: { settings?: UpdateSettings; state?: JarvisStore["updates"]["state"] }) => {
      const s = latest.current;
      if (!s) return;
      commit({
        ...s,
        updates: {
          settings: next.settings ?? s.updates.settings,
          state: next.state ?? s.updates.state,
        },
      });
    },
    [commit],
  );

  const markRead = useCallback(() => {
    const s = latest.current;
    if (s) write({ state: markAllRead(s.updates.state) });
  }, [write]);

  const dismiss = useCallback(
    (id: string) => {
      const s = latest.current;
      if (s) write({ state: dismissUpdate(s.updates.state, id) });
    },
    [write],
  );

  const shown = collected.updates;
  const clearAll = useCallback(() => {
    const s = latest.current;
    if (s) write({ state: dismissAll(s.updates.state, shown) });
  }, [write, shown]);

  const patchSettings = useCallback(
    (patch: Partial<UpdateSettings>) => {
      const s = latest.current;
      if (s) write({ settings: { ...s.updates.settings, ...patch } });
    },
    [write],
  );

  return {
    ...collected,
    settings: settings ?? ({} as UpdateSettings),
    ready,
    seenAt: state?.seenAt ?? "",
    boardError,
    markRead,
    dismiss,
    clearAll,
    patchSettings,
    refresh,
  };
}

export type { JarvisUpdate };
