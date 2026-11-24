"use client";

// The lab's one data hook. The server owns the state (server_docs), so the
// page reads it, polls while open, and sends every change as an action. The
// open page also nudges the agent forward (POST agent.tick) when the agent is
// running and the page has been idle for a while — one of the three things
// that keep the loop moving, beside the PC worker and the scheduled tick.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResponse, LabAction, LabResponse } from "@/lib/h3-lab/api";
import type { LabState } from "@/lib/h3-lab/model";

export interface LabHook {
  state: LabState | null;
  meta: Omit<LabResponse, "state"> | null;
  error: string | null;
  busy: string | null;
  /** Last result line for the tally bar. */
  status: { text: string; tone: "ok" | "bad" } | null;
  act: (action: LabAction, label?: string) => Promise<ActionResponse | null>;
  reload: () => Promise<void>;
}

const POLL_MS = 8000;
const PAGE_TICK_MS = 90_000;

export function useLab(): LabHook {
  const [state, setState] = useState<LabState | null>(null);
  const [meta, setMeta] = useState<LabHook["meta"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<LabHook["status"]>(null);
  const lastTick = useRef(0);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/h3-lab/lab", { cache: "no-store" });
      const json = (await res.json()) as LabResponse | { error: string };
      if (!res.ok || "error" in json) throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
      const { state: s, ...rest } = json;
      setState(s);
      setMeta(rest);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the lab.");
    }
  }, []);

  const act = useCallback(async (action: LabAction, label?: string) => {
    setBusy(label ?? action.action);
    try {
      const res = await fetch("/api/h3-lab/lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const json = (await res.json()) as ActionResponse | { error: string };
      if (!res.ok || "error" in json) throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
      setState(json.state);
      const line = json.notice ?? json.step?.did ?? (label ? `${label} — done` : null);
      if (line) setStatus({ text: line, tone: "ok" });
      return json;
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : "That did not work.", tone: "bad" });
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [reload]);

  // The open page is one of the agent's heartbeats.
  useEffect(() => {
    if (!state || state.agent.mode !== "running") return;
    const id = window.setInterval(async () => {
      if (document.visibilityState !== "visible" || Date.now() - lastTick.current < PAGE_TICK_MS) return;
      lastTick.current = Date.now();
      try {
        const res = await fetch("/api/h3-lab/agent/tick", { method: "POST" });
        if (res.ok) void reload();
      } catch {
        /* the next poll shows whatever happened */
      }
    }, 15_000);
    return () => window.clearInterval(id);
  }, [state, reload]);

  return { state, meta, error, busy, status, act, reload };
}
