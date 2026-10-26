"use client";

// Skills Library › Spend — what each skill costs, kept fresh like the call
// counts (on open, every minute while visible, when the tab comes back), plus
// the owner's two controls: a weekly cap and a fixed model tier.

import { useCallback, useEffect, useState } from "react";
import { normalizeSpend, type RouteTier, type SpendDoc } from "./spend";

const REFRESH_MS = 60_000;

export interface SkillSpendState {
  spend: SpendDoc | null;
  loaded: boolean;
  /** Set when a cap or pin could not be saved. */
  error: string | null;
  setCap: (skill: string, dollars: number | null) => Promise<void>;
  setPin: (skill: string, tier: RouteTier | null) => Promise<void>;
}

export function useSkillSpend(): SkillSpendState {
  const [spend, setSpend] = useState<SpendDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/skills/spend", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { spend?: unknown };
        if (alive && data.spend) setSpend(normalizeSpend(data.spend));
      } catch {
        /* keep what we had */
      } finally {
        if (alive) setLoaded(true);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);

  const patch = useCallback(async (body: Record<string, unknown>) => {
    setError(null);
    try {
      const res = await fetch("/api/skills/spend", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { spend?: unknown; error?: string };
      if (!res.ok || !data.spend) throw new Error(data.error || "Couldn't save that.");
      setSpend(normalizeSpend(data.spend));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that.");
    }
  }, []);

  return {
    spend,
    loaded,
    error,
    setCap: (skill, dollars) => patch({ skill, cap: dollars }),
    setPin: (skill, tier) => patch({ skill, pin: tier }),
  };
}
