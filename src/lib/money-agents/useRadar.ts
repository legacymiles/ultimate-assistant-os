"use client";

// ---------------------------------------------------------------------------
// Opportunity Radar state for Money Agent Studio.
//
// - The owner's radar (rules, catches, starred/dismissed plays, added
//   companies) syncs to their account under its own key, next to the board.
// - The feed (AI-read news) comes from /api/money-agents/radar/feed; the last
//   one is kept on this device so the tab paints instantly.
// - Prices come from /api/money-agents/radar/quotes every minute while the
//   page is visible, and the move bot checks every rule against them. A catch
//   is saved, shown, and — when the owner allowed it — pops a notification.
//
// The bot runs whenever Money Agent Studio is open (any tab of it). It never
// trades; the scorecard shows what following its catches would have done.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import {
  EMPTY_RADAR,
  addCatches,
  checkRule,
  normalizeRadar,
  symbolsToQuote,
  toggleSaved,
  upsertRule,
  type Catch,
  type Company,
  type Opportunity,
  type Quote,
  type RadarState,
  type WatchRule,
} from "./radar";
import { CATALYSTS, COMPANIES } from "./radarSeed";

export const RADAR_KEY = "money-agents:radar:v1";
const FEED_CACHE = "money-agents:radar:feed";
const POLL_MS = 60_000;

export interface Feed {
  plays: Opportunity[];
  by: "ai" | "rules" | "none";
  at: string;
  warning?: string;
}

function loadRadar(): RadarState {
  return normalizeRadar(loadLocal<RadarState>(RADAR_KEY, EMPTY_RADAR));
}

function loadFeed(): Feed | null {
  try {
    const raw = window.localStorage.getItem(FEED_CACHE);
    return raw ? (JSON.parse(raw) as Feed) : null;
  } catch {
    return null;
  }
}

export function useRadar(onCatch?: (c: Catch) => void) {
  const [state, setState] = useState<RadarState>(() => (typeof window === "undefined" ? EMPTY_RADAR : loadRadar()));
  const [feed, setFeed] = useState<Feed | null>(null);
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedError, setFeedError] = useState("");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [quotesAt, setQuotesAt] = useState("");
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const stateRef = useRef(state);
  stateRef.current = state;
  const onCatchRef = useRef(onCatch);
  onCatchRef.current = onCatch;

  useRemotePull(RADAR_KEY, () => setState(loadRadar()));

  const commit = useCallback((next: RadarState) => {
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    stateRef.current = stamped;
    setState(stamped);
    saveSynced(RADAR_KEY, stamped);
  }, []);

  const companies: Company[] = useMemo(() => {
    const mine = state.companies.filter((c) => !COMPANIES.some((s) => s.ticker === c.ticker));
    return [...COMPANIES, ...mine];
  }, [state.companies]);

  // ----- feed -------------------------------------------------------------
  const refreshFeed = useCallback(async (fresh = false) => {
    setFeedBusy(true);
    setFeedError("");
    try {
      const res = await fetch(`/api/money-agents/radar/feed${fresh ? "?fresh=1" : ""}`);
      const data = (await res.json()) as Feed & { error?: string };
      if (!res.ok) {
        setFeedError(data.error ?? "The radar couldn't load the news. Try Refresh.");
        return;
      }
      const f: Feed = { plays: data.plays ?? [], by: data.by ?? "none", at: data.at ?? new Date().toISOString(), warning: data.warning };
      setFeed(f);
      try {
        window.localStorage.setItem(FEED_CACHE, JSON.stringify(f));
      } catch {
        /* a convenience */
      }
    } catch {
      setFeedError("Couldn't reach the website. Check your connection and try Refresh.");
    } finally {
      setFeedBusy(false);
    }
  }, []);

  useEffect(() => {
    const cached = loadFeed();
    if (cached) setFeed(cached);
    // A feed older than 20 minutes is refreshed on arrival.
    if (!cached || Date.now() - Date.parse(cached.at) > 20 * 60_000) void refreshFeed();
  }, [refreshFeed]);

  // ----- quotes + the move bot ------------------------------------------
  const symbols = useMemo(() => symbolsToQuote(state, feed?.plays ?? [], companies), [state, feed, companies]);
  const symbolsKey = symbols.join(",");

  const poll = useCallback(async () => {
    if (!symbolsKey) return;
    try {
      const res = await fetch(`/api/money-agents/radar/quotes?s=${encodeURIComponent(symbolsKey)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { quotes?: Record<string, Quote> };
      const got = data.quotes ?? {};
      setQuotes((prev) => ({ ...prev, ...got }));
      setQuotesAt(new Date().toISOString());

      const now = new Date();
      const st = stateRef.current;
      const found: Catch[] = [];
      for (const r of st.rules) {
        const q = got[r.symbol];
        if (!q) continue;
        const c = checkRule(r, q, [...found, ...st.catches], CATALYSTS, now);
        if (c) found.push(c);
      }
      if (found.length) {
        const next = addCatches(st, found);
        if (next !== st) {
          commit(next);
          for (const c of found) {
            onCatchRef.current?.(c);
            try {
              if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                new Notification(`${c.label}: ${c.reason}`, { body: `Price ${c.price.toLocaleString()} — Money Agent Studio › Radar`, tag: c.id });
              }
            } catch {
              /* some phones only allow notifications from a service worker */
            }
          }
        }
      }
    } catch {
      /* next poll tries again */
    }
  }, [symbolsKey, commit]);

  useEffect(() => {
    void poll();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    const back = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", back);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", back);
    };
  }, [poll]);

  // ----- notifications ----------------------------------------------------
  useEffect(() => {
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  const askNotify = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    try {
      setPerm(await Notification.requestPermission());
    } catch {
      setPerm(Notification.permission);
    }
  }, []);

  // ----- edits ------------------------------------------------------------
  const saveRule = useCallback((r: WatchRule) => commit(upsertRule(stateRef.current, r)), [commit]);
  const removeRule = useCallback(
    (id: string) => commit({ ...stateRef.current, rules: stateRef.current.rules.filter((r) => r.id !== id) }),
    [commit],
  );
  const star = useCallback((o: Opportunity) => commit(toggleSaved(stateRef.current, o)), [commit]);
  const hide = useCallback(
    (id: string) => {
      const st = stateRef.current;
      commit({ ...st, hidden: [...st.hidden.filter((h) => h !== id), id], saved: st.saved.filter((s) => s.id !== id) });
    },
    [commit],
  );
  const unhide = useCallback((id: string) => commit({ ...stateRef.current, hidden: stateRef.current.hidden.filter((h) => h !== id) }), [commit]);
  const clearCatches = useCallback(() => commit({ ...stateRef.current, catches: [] }), [commit]);
  const addCompany = useCallback(
    (c: Company) => {
      const st = stateRef.current;
      if (st.companies.some((x) => x.ticker === c.ticker) || COMPANIES.some((x) => x.ticker === c.ticker)) return false;
      commit({ ...st, companies: [{ ...c, custom: true }, ...st.companies] });
      return true;
    },
    [commit],
  );
  const removeCompany = useCallback(
    (ticker: string) => commit({ ...stateRef.current, companies: stateRef.current.companies.filter((c) => c.ticker !== ticker) }),
    [commit],
  );

  const today = new Date().toISOString().slice(0, 10);
  const catchesToday = state.catches.filter((c) => c.at.slice(0, 10) === today).length;

  return {
    state,
    feed,
    feedBusy,
    feedError,
    refreshFeed,
    quotes,
    quotesAt,
    companies,
    catalysts: CATALYSTS,
    perm,
    askNotify,
    saveRule,
    removeRule,
    star,
    hide,
    unhide,
    clearCatches,
    addCompany,
    removeCompany,
    catchesToday,
    pollNow: poll,
  };
}

export type Radar = ReturnType<typeof useRadar>;
