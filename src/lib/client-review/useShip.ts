"use client";

// ---------------------------------------------------------------------------
// The "ready to push" list, shared by the Ship widget and the In Queue card.
//
// It reads the owner's Client Review console endpoint — the one place that knows
// which versions are still open — and nothing else. Pushing is per item: only
// the row being pushed goes busy, so a second site can be pushed while the
// first is still finishing.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { shipItems, pushThreadToMain, type ShipItem } from "@/lib/client-review/pushMain";
import type { ClientProject } from "@/lib/client-review/types";

const POLL_MS = 45_000;

export interface UseShip {
  items: ShipItem[];
  loading: boolean;
  error: string;
  /** The id of the item being pushed right now, or "". */
  pushing: string;
  /** Pushed in this session, so the card can say so before the poll catches up. */
  pushed: Set<string>;
  push: (item: ShipItem) => Promise<string>;
  refresh: () => void;
}

export function useShip(): UseShip {
  const [items, setItems] = useState<ShipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pushing, setPushing] = useState("");
  const [pushed, setPushed] = useState<Set<string>>(new Set());
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/client-review/admin", { cache: "no-store" });
      if (!res.ok) {
        // A signed-out tab is the normal case on a phone that has not opened the
        // console yet; saying so once is enough.
        setError(res.status === 401 ? "Sign in to Jarvis to see what is ready." : "Couldn't read Client Review just now.");
        setItems([]);
        return;
      }
      const data = (await res.json()) as { projects?: ClientProject[] };
      if (!alive.current) return;
      setItems(shipItems(data.projects ?? []));
      setError("");
    } catch {
      if (alive.current) setError("Couldn't reach the hub just now.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onShow = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      alive.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load]);

  const push = useCallback(async (item: ShipItem) => {
    if (!item.threadId) return "This one is in In Queue — there is no build on your PC to push.";
    setPushing(item.versionId);
    try {
      const out = await pushThreadToMain(item.threadId);
      if (out.ok) setPushed((prev) => new Set(prev).add(item.versionId));
      return out.message;
    } catch (e) {
      return e instanceof Error ? e.message : "The push didn't run.";
    } finally {
      setPushing("");
    }
  }, []);

  return { items, loading, error, pushing, pushed, push, refresh: () => void load() };
}
