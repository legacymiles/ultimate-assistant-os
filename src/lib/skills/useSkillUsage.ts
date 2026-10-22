"use client";

// The Skills Library's call counts, kept fresh on their own: read on open,
// every minute while the page is visible, and whenever the tab comes back —
// so a skill used in Claude Code a moment ago shows without a refresh button.

import { useEffect, useState } from "react";
import { cleanUsage, type UsageData } from "./usage";

const REFRESH_MS = 60_000;

export interface SkillUsageState {
  /** null until loaded, or when counts aren't available (local mode, signed out). */
  usage: UsageData | null;
  loaded: boolean;
  /** Why there are no counts, in plain words. */
  reason: string | null;
}

export function useSkillUsage(): SkillUsageState {
  const [state, setState] = useState<SkillUsageState>({ usage: null, loaded: false, reason: null });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/skills/usage", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { usage?: unknown; reason?: string };
        if (!alive) return;
        setState({
          usage: data.usage ? cleanUsage(data.usage) : null,
          loaded: true,
          reason: data.usage ? null : data.reason || (res.ok ? null : "Couldn't load skill usage right now."),
        });
      } catch {
        if (alive) setState((s) => ({ ...s, loaded: true, reason: s.usage ? null : "Couldn't load skill usage right now." }));
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
    window.addEventListener("focus", onShow);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, []);

  return state;
}
