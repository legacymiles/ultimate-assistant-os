"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Doc, PersonStats } from "@/lib/contradicting/engine";

export interface RecordView {
  doc: Doc;
  webhook: string;
  webhookError?: string;
  unnamed: { convoId: string; label: string; sample: string; count: number }[];
  stats: PersonStats[];
  caught?: string[];
}

/**
 * The account's record, kept fresh: it polls every 8 s while the page is
 * visible so a receipt from the pendant shows up without touching anything.
 */
export function useRecord() {
  const [view, setView] = useState<RecordView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tzSent = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/contradicting", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Couldn't open your record.");
      setView(json);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open your record.");
    }
  }, []);

  const act = useCallback(async (body: Record<string, unknown>): Promise<RecordView | null> => {
    setBusy(true);
    try {
      const res = await fetch("/api/contradicting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "That didn't work.");
      setView(json);
      setError("");
      return json as RecordView;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
    const tick = () => {
      if (document.visibilityState === "visible") load();
    };
    const id = window.setInterval(tick, 8000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  // Receipts say the time where you live: send the browser's zone once.
  useEffect(() => {
    if (!view || tzSent.current) return;
    tzSent.current = true;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== view.doc.settings.tz) void act({ action: "settings", tz });
  }, [view, act]);

  return { view, error, busy, act, reload: load, clearError: () => setError("") };
}
