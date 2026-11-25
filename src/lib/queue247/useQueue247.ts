"use client";

// ---------------------------------------------------------------------------
// The 24/7 Queue in the browser.
//
// Polls GET /api/queue247/tasks every 4 s while the page is visible, stops
// when the tab is hidden and fetches at once when it comes back. The owner's
// buttons are optimistic: the same pure applyOwnerAction() the server uses
// patches the row on screen first, and the server's answer replaces it (or the
// row is put back and the server's sentence shown).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyOwnerAction, ActionError, type NewTaskInput, type OwnerAction } from "./engine";
import type { Task, TaskMessage } from "./types";
import type { QueueSnapshot } from "./view";

export const POLL_MS = 4000;

export type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  /** 503: the database is not configured on this deployment. */
  | { kind: "offline"; message: string }
  /** 401: not signed in. */
  | { kind: "signed-out"; message: string }
  | { kind: "error"; message: string };

export interface CommandReply {
  reply: string;
  clarify: string | null;
  created: Task[];
  acted: Task[];
  planner: "ai" | "offline";
  /** The model that planned it. */
  model?: string;
  /** Something about the attached pictures the owner should know (one was dropped, Storage refused one). */
  notice?: string;
  error?: string;
}

/** What the chat sends besides the words: the model pick ("" = Auto) and reference pictures. */
export interface CommandExtras {
  model?: string;
  images?: { dataUrl: string; name: string }[];
}

/** Turns any failed response into one sentence a person can act on. */
export async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) return j.error;
  } catch {
    /* not JSON */
  }
  if (res.status === 401) return "Sign in to use your 24/7 Queue.";
  if (res.status === 503) return "The 24/7 Queue's database is not set up on this deployment yet.";
  if (res.status >= 500) return "The server hit a problem. Try again in a moment.";
  return `The request did not go through (${res.status}).`;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Could not reach the server — check your connection.");
  }
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new Error("Could not reach the server — check your connection.");
  }
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export interface UseQueue247 {
  data: QueueSnapshot | null;
  state: LoadState;
  /** The server's clock at the last fetch, advanced by the local one between fetches. */
  now: Date;
  /** Last action error, in plain English; cleared by the next success or dismiss(). */
  notice: string | null;
  dismiss: () => void;
  /** Task ids with a button press in flight. */
  busy: Set<string>;
  refresh: () => Promise<void>;
  act: (id: string, act: OwnerAction) => Promise<Task | null>;
  /** Resolves with the new task; rejects with a plain-English Error. */
  create: (task: NewTaskInput | Record<string, unknown>) => Promise<Task>;
  remove: (id: string) => Promise<boolean>;
  command: (text: string, taskId?: string, extras?: CommandExtras) => Promise<CommandReply>;
  messages: (taskId?: string) => Promise<TaskMessage[]>;
  readNotifications: () => Promise<void>;
  seenFindings: (ids: string[]) => Promise<void>;
}

export function useQueue247(enabled = true): UseQueue247 {
  const [data, setData] = useState<QueueSnapshot | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [skew, setSkew] = useState(0);
  const [tick, setTick] = useState(() => Date.now());
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      let res: Response;
      try {
        res = await fetch("/api/queue247/tasks", { cache: "no-store" });
      } catch {
        if (mounted.current) setState((s) => (s.kind === "ready" ? s : { kind: "error", message: "Could not reach the server — check your connection." }));
        return;
      }
      if (!mounted.current) return;
      if (res.status === 503) return setState({ kind: "offline", message: await readError(res) });
      if (res.status === 401) return setState({ kind: "signed-out", message: await readError(res) });
      if (!res.ok) {
        const message = await readError(res);
        // Keep showing the last good board through a blip; say so only when there is nothing to show.
        setState((s) => (s.kind === "ready" ? s : { kind: "error", message }));
        return;
      }
      const snap = (await res.json()) as QueueSnapshot;
      if (!mounted.current) return;
      setData(snap);
      const server = Date.parse(snap.now);
      if (Number.isFinite(server)) setSkew(server - Date.now());
      setState({ kind: "ready" });
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Poll while visible; refetch on focus / visibility.
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        void refresh();
        setTick(Date.now());
      }, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else stop();
    };
    const onFocus = () => void refresh();
    void refresh();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, refresh]);

  const mark = (id: string, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const replaceTask = (t: Task) => setData((d) => (d ? { ...d, tasks: d.tasks.map((x) => (x.id === t.id ? t : x)) } : d));

  const act = useCallback(
    async (id: string, a: OwnerAction): Promise<Task | null> => {
      const before = data?.tasks.find((t) => t.id === id);
      if (before) {
        try {
          const patch = applyOwnerAction(before, a, new Date(Date.now() + skew));
          replaceTask({ ...before, ...patch } as Task);
        } catch (e) {
          if (e instanceof ActionError) {
            setNotice(e.message);
            return null;
          }
        }
      }
      mark(id, true);
      try {
        const { task } = await postJson<{ task: Task }>("/api/queue247/tasks", { action: "act", id, act: a });
        replaceTask(task);
        setNotice(null);
        return task;
      } catch (e) {
        if (before) replaceTask(before);
        setNotice((e as Error).message);
        return null;
      } finally {
        mark(id, false);
      }
    },
    [data, skew],
  );

  const create = useCallback(async (input: NewTaskInput | Record<string, unknown>) => {
    // A failure rejects; the form that called this shows the sentence beside its own button.
    const { task } = await postJson<{ task: Task }>("/api/queue247/tasks", { action: "create", task: input });
    setData((d) => (d ? { ...d, tasks: [task, ...d.tasks.filter((t) => t.id !== task.id)] } : d));
    setNotice(null);
    return task;
  }, []);

  const remove = useCallback(async (id: string) => {
    mark(id, true);
    try {
      await postJson("/api/queue247/tasks", { action: "delete", id });
      setData((d) => (d ? { ...d, tasks: d.tasks.filter((t) => t.id !== id) } : d));
      return true;
    } catch (e) {
      setNotice((e as Error).message);
      return false;
    } finally {
      mark(id, false);
    }
  }, []);

  const command = useCallback(
    async (text: string, taskId?: string, extras: CommandExtras = {}) => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const out = await postJson<CommandReply>("/api/queue247/command", {
        text,
        taskId,
        tz,
        ...(extras.model ? { model: extras.model } : {}),
        ...(extras.images?.length ? { images: extras.images } : {}),
      });
      void refresh();
      return out;
    },
    [refresh],
  );

  const messages = useCallback(async (taskId?: string) => {
    const { messages } = await getJson<{ messages: TaskMessage[] }>(
      `/api/queue247/command${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ""}`,
    );
    return messages ?? [];
  }, []);

  const readNotifications = useCallback(async () => {
    setData((d) => (d ? { ...d, notifications: d.notifications.map((n) => ({ ...n, read: true })) } : d));
    try {
      await postJson("/api/queue247/tasks", { action: "read_notifications" });
    } catch {
      /* the next poll shows the truth */
    }
  }, []);

  const seenFindings = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const set = new Set(ids);
    setData((d) => (d ? { ...d, findings: d.findings.map((f) => (set.has(f.id) ? { ...f, seen: true } : f)) } : d));
    try {
      await postJson("/api/queue247/tasks", { action: "seen_findings", ids });
    } catch {
      /* the next poll shows the truth */
    }
  }, []);

  const now = useMemo(() => new Date(tick + skew), [tick, skew]);

  return {
    data,
    state,
    now,
    notice,
    dismiss: () => setNotice(null),
    busy,
    refresh,
    act,
    create,
    remove,
    command,
    messages,
    readNotifications,
    seenFindings,
  };
}
