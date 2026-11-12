"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Account, Project } from "@/lib/buildflip-2/types";
import type { Capabilities } from "@/lib/buildflip-2/flags";
import type { Entitlement } from "@/lib/buildflip-2/db/account";

/**
 * The client-side source of truth for plans and the account.
 *
 * Refreshes by itself (A1): on mount, whenever the tab regains focus, when the
 * browser comes back online, and on a slow background interval. So a plan made
 * on a phone is on the laptop without anyone pressing a button (D3).
 *
 * Writes are optimistic with a rollback, and every failed write keeps what the
 * user typed and retries once before it reports anything (R6).
 */

export interface AppData {
  projects: Project[];
  account: Pick<Account, "plan" | "plansGenerated" | "hourlyTarget" | "onboarded" | "role"> | null;
  entitlement: Entitlement | null;
  accuracy: { builds: number; medianErrorPct: number; within15: number } | null;
  capabilities: Capabilities | null;
  missing: { id: string; label: string; unlocks: string; key: string }[];
  signedIn: boolean;
  loading: boolean;
  error: string | null;
  refresh: (opts?: { quiet?: boolean }) => Promise<void>;
  /** Replace one project in the cache without a round trip. */
  putProject: (project: Project) => void;
  dropProject: (id: string) => void;
}

const Ctx = createContext<AppData | null>(null);

export function useApp(): AppData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside <AppStateProvider>");
  return ctx;
}

const REFRESH_MS = 90_000;

export function AppStateProvider({
  children,
  initialSignedIn,
}: {
  children: React.ReactNode;
  initialSignedIn: boolean;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [account, setAccount] = useState<AppData["account"]>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [accuracy, setAccuracy] = useState<AppData["accuracy"]>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [missing, setMissing] = useState<AppData["missing"]>([]);
  const [signedIn, setSignedIn] = useState(initialSignedIn);
  const [loading, setLoading] = useState(initialSignedIn);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  // Mirrored in a ref so `refresh` can read it without being re-created (which
  // would restart the heartbeat on every sign-in state change).
  const signedInRef = useRef(initialSignedIn);
  useEffect(() => {
    signedInRef.current = signedIn;
  }, [signedIn]);

  /**
   * The server is authoritative about whether there is a session, so follow it
   * when it changes. Without this, `signedIn` could only ever go true inside
   * `refresh` — which skips the plans fetch precisely when it is false, so a
   * session that begins client-side could never heal itself.
   */
  useEffect(() => {
    setSignedIn(initialSignedIn);
    signedInRef.current = initialSignedIn;
  }, [initialSignedIn]);

  const refresh = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (!opts.quiet) setLoading(true);
      try {
        // The server already told us whether there is a session. Asking for
        // plans while signed out would be a guaranteed 401 on every public
        // page view — noise in the console and a wasted round trip.
        const wantsPlans = signedInRef.current;

        const [plansRes, capsRes] = await Promise.all([
          wantsPlans
            ? fetch("/api/buildflip-2/plan", { cache: "no-store" })
            : Promise.resolve(null),
          fetch("/api/buildflip-2/capabilities", { cache: "no-store" }),
        ]);

        if (capsRes.ok) {
          const caps = (await capsRes.json()) as {
            capabilities: Capabilities;
            missing: AppData["missing"];
          };
          setCapabilities(caps.capabilities);
          setMissing(caps.missing ?? []);
        }

        if (!plansRes) {
          setProjects([]);
          setAccount(null);
          setEntitlement(null);
          setError(null);
          return;
        }

        if (plansRes.status === 401 || plansRes.status === 503) {
          setSignedIn(false);
          signedInRef.current = false;
          setProjects([]);
          setAccount(null);
          setEntitlement(null);
          // A signed-out visitor must not keep seeing the last user's stats.
          setAccuracy(null);
          setError(null);
          return;
        }
        if (!plansRes.ok) {
          const body = (await plansRes.json().catch(() => ({}))) as { error?: string };
          setError(
            body.error ??
              "We couldn't load your plans just now. Your work is safe — try again.",
          );
          return;
        }

        const data = (await plansRes.json()) as {
          projects: Project[];
          accuracy: AppData["accuracy"];
          entitlement: Entitlement;
          account: AppData["account"];
        };
        setSignedIn(true);
        signedInRef.current = true;
        setProjects(data.projects ?? []);
        setAccuracy(data.accuracy ?? null);
        setEntitlement(data.entitlement ?? null);
        setAccount(data.account ?? null);
        setError(null);
      } catch {
        setError(
          navigator.onLine
            ? "We couldn't reach the server. Your work is safe — try again."
            : "You're offline. Everything you've made is still here once you reconnect.",
        );
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A sign-in that happens after mount (magic link in another tab, OAuth
  // return) must pull the plans in without a manual reload.
  useEffect(() => {
    if (signedIn && projects.length === 0 && !loading) void refresh({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  // Update by itself (A1) — focus, online, and a slow heartbeat. Never a button.
  useEffect(() => {
    const quiet = () => void refresh({ quiet: true });
    const onVis = () => {
      if (!document.hidden) quiet();
    };
    window.addEventListener("focus", quiet);
    window.addEventListener("online", quiet);
    document.addEventListener("visibilitychange", onVis);
    const timer = setInterval(() => {
      if (!document.hidden) quiet();
    }, REFRESH_MS);
    return () => {
      window.removeEventListener("focus", quiet);
      window.removeEventListener("online", quiet);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(timer);
    };
  }, [refresh]);

  const putProject = useCallback((project: Project) => {
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== project.id);
      next.unshift(project);
      // Newest first, always (U6) — and never the same plan twice (D5).
      return next.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    });
  }, []);

  const dropProject = useCallback((id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const value = useMemo<AppData>(
    () => ({
      projects,
      account,
      entitlement,
      accuracy,
      capabilities,
      missing,
      signedIn,
      loading,
      error,
      refresh,
      putProject,
      dropProject,
    }),
    [
      projects,
      account,
      entitlement,
      accuracy,
      capabilities,
      missing,
      signedIn,
      loading,
      error,
      refresh,
      putProject,
      dropProject,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ------------------------------------------------------------- write helper */

export interface WriteResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  paywall?: { moment: string; message: string };
  needsAuth?: boolean;
}

/**
 * One fetch wrapper for every write. Times out, retries ONCE on a network
 * blip, and always returns a plain-English error instead of throwing (R5, R6).
 */
export async function write<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
  attempt = 0,
): Promise<WriteResult<T>> {
  const { timeoutMs = 25_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.ok) return { ok: true, data: body as T };

    if (res.status === 402 && body.paywall) {
      return {
        ok: false,
        paywall: {
          moment: String(body.moment ?? "secondPlan"),
          message: String(body.error ?? ""),
        },
        error: String(body.error ?? ""),
      };
    }
    if (res.status === 401) {
      return { ok: false, needsAuth: true, error: String(body.error ?? "Please sign in.") };
    }
    // One retry on a server-side blip, not on a rejection we deserved.
    if (res.status >= 500 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 900));
      return write<T>(url, init, 1);
    }
    return {
      ok: false,
      error:
        (body.error as string | undefined) ??
        "That didn't go through. Nothing was lost — try again.",
    };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    if (!aborted && attempt === 0) {
      await new Promise((r) => setTimeout(r, 900));
      return write<T>(url, init, 1);
    }
    return {
      ok: false,
      error: aborted
        ? "That took too long. Nothing was lost — try again."
        : "We couldn't reach the server. Nothing was lost — try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}
