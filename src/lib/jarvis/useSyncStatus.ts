"use client";

// The sync status for the device this page is open on: what
// /api/jarvis/sync-status reports, run through syncPlan(). Shared by the
// Skills everywhere card, the New Jarvis Skills tab and Finish setup.

import { useCallback, useEffect, useMemo, useState } from "react";
import { detectDevice, syncPlan, type DeviceKind, type SyncPlan, type SyncStatusReport } from "./syncSteps";

export function useSyncStatus() {
  const [report, setReport] = useState<SyncStatusReport | null>(null);
  const [error, setError] = useState(false);
  const [device, setDevice] = useState<DeviceKind>("other");
  const [origin, setOrigin] = useState("");

  const refresh = useCallback(() => {
    fetch("/api/jarvis/sync-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: SyncStatusReport) => {
        setReport(d);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    setDevice(detectDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0));
    setOrigin(window.location.origin);
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const plan: SyncPlan | null = useMemo(() => (report ? syncPlan(report, device, origin) : null), [report, device, origin]);
  return { report, plan, device, error, refresh };
}
