"use client";

import { useCallback, useEffect, useState } from "react";
import { AUTOPILOT_CHANGED, getAutopilot } from "@/lib/recall/photos/autopilot";
import { useLauncher } from "./launcher";
import { setupChecklist, useOnboarding, type SetupItem } from "./onboarding";

export interface ConnectorApp {
  slug: string;
  name: string;
  connected: boolean;
}

export interface SetupStatus {
  items: SetupItem[];
  left: number;
  connectors: { available: boolean; reason: string; connectUrl: string; apps: ConnectorApp[] } | null;
  iphoneLinked: boolean;
  refresh: () => void;
}

/**
 * Everything the "Finish setup" checklist needs, read from the stores and
 * endpoints that actually own each fact — so ticking an item off anywhere in
 * Jarvis ticks it off here.
 */
export function useSetup(): SetupStatus {
  const [onboarding] = useOnboarding();
  const launcher = useLauncher();
  const [rules, setRules] = useState(0);
  const [connectors, setConnectors] = useState<SetupStatus["connectors"]>(null);
  const [iphoneLinked, setIphone] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/jarvis/connectors")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setConnectors(d))
      .catch(() => {});
    fetch("/api/dashboard/inbox")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setIphone(Boolean(d.linked)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const read = () => setRules(getAutopilot().rules.filter((r) => r.on).length);
    read();
    window.addEventListener(AUTOPILOT_CHANGED, read);
    // Coming back from a connect window should tick the box without a reload.
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(AUTOPILOT_CHANGED, read);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const items = setupChecklist({
    onboarding,
    connectedAccounts: connectors?.apps.filter((a) => a.connected).length ?? 0,
    iphoneLinked,
    rules,
    favorites: launcher.favorites.length,
  });
  return { items, left: items.filter((i) => !i.done).length, connectors, iphoneLinked, refresh };
}
