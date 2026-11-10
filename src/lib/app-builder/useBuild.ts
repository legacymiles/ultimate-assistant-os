"use client";

// ---------------------------------------------------------------------------
// The build itself: one harness thread on the owner's own PC.
//
// App Builder presses Build, the bridge on 127.0.0.1 cuts a project folder with
// a repository of its own, Claude Code starts working in it, and this hook is
// how the page watches that happen — the narration, the permission gates, and
// at the end the repository and the live address.
//
// Two things it deliberately does NOT do:
//
//   It does not own the thread id. That lives on the App Builder project, which
//   is synced, so closing the tab or picking the phone up mid-build comes back
//   to the same build rather than losing it.
//
//   It does not auto-approve anything beyond writes inside the thread's own
//   folder. This build makes a GitHub repository and deploys a site; those are
//   exactly the steps that should stop and ask (`trust: "ask"`).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { buildModelFor, buildsWithPick } from "@/lib/client-review/models";
import { readChatModel } from "@/lib/new-jarvis/useChatModel";
import { readTrust } from "@/lib/new-jarvis/trust";
import { BridgeError, call, knownFolder } from "@/lib/new-jarvis/bridge";
import { emptyThread, reduceEvents } from "@/lib/new-jarvis/harness/model";
import { buildHarness } from "@/lib/new-jarvis/harness/choice";
import type { GateCard, HarnessEvent, ThreadSummary, ThreadView } from "@/lib/new-jarvis/harness/types";
import { absorbBrief, absorbTitle } from "./absorb";
import { buildBrief, isForClient, phaseOf, projectSlug, resultLinks, threadTitle, type BuildPhase } from "./build";
import type { BuilderProject } from "./types";

/** How often to re-read, by what the thread is doing. null = stop polling. */
function pollEvery(status: ThreadSummary["status"] | undefined): number | null {
  if (status === "ended") return null;
  if (status === "waiting") return 2_000; // a gate is on screen; stay responsive
  if (status === "thinking") return 1_200;
  return 3_000;
}

export interface UseBuild {
  phase: BuildPhase;
  /** The agent has no such thread (yet) — usually a restart resuming it. */
  missing: boolean;
  /** This tab cannot reach the PC. The build is on the PC, not here. */
  offline: boolean;
  view: ThreadView;
  summary: ThreadSummary | null;
  gate: GateCard | null;
  links: { repo?: string; url?: string };
  /** Plain-English, already fit to show. */
  error: string;
  starting: string;
  /** Returns the thread id, or throws a sentence worth showing. */
  start: (p: BuilderProject) => Promise<string>;
  /**
   * Answer a permission card. `always` widens a yes to every later call of
   * that same tool in this thread — never a no, and never a grave tool.
   */
  decide: (gateId: string, allow: boolean, always?: boolean) => Promise<void>;
  say: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  refresh: () => void;
}

/**
 * How long a 404 is treated as "the bridge is putting it back together".
 *
 * A restart resumes a durable build in seconds, but it has to wait for the PC
 * to come back and, sometimes, for the SDK to finish installing. Three
 * minutes is long enough not to call a live build dead; after that the chat
 * offers the honest way out.
 */
const RESUME_GRACE_MS = 3 * 60_000;

export function useBuild(threadId: string | undefined, paired: boolean): UseBuild {
  const [view, setView] = useState<ThreadView>(emptyThread);
  const [summary, setSummary] = useState<ThreadSummary | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState("");
  // The agent does not know this thread (yet): a restart is resuming it.
  const [missing, setMissing] = useState(false);
  const [missingSince, setMissingSince] = useState<number | null>(null);
  // The tab cannot reach the PC. Very different from the build stopping.
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const cursor = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A missing thread is only "lost" after the grace; this keeps that clock
  // moving while the page otherwise has nothing new to draw.
  useEffect(() => {
    if (!missing) return;
    const id = window.setInterval(() => setNow(Date.now()), 2_000);
    return () => window.clearInterval(id);
  }, [missing]);

  // A different build (or a different project) starts from a clean ledger
  // rather than showing the last one's narration for a beat.
  useEffect(() => {
    cursor.current = 0;
    setView(emptyThread());
    setSummary(null);
    setError("");
    setMissing(false);
    setMissingSince(null);
    setOffline(false);
  }, [threadId]);

  const pull = useCallback(async () => {
    if (!threadId) return;
    try {
      const data = await call<{ events: HarnessEvent[]; cursor: number; dropped: boolean; session: ThreadSummary }>(
        "harness/events",
        { id: threadId, since: cursor.current },
      );
      if (!alive.current) return;
      setOffline(false);
      setMissing(false);
      setMissingSince(null);
      if (data.dropped) {
        // We fell behind the bridge's ring: re-read the thread whole rather
        // than drawing a transcript with a hole in it.
        cursor.current = 0;
        setView(emptyThread());
        return;
      }
      cursor.current = data.cursor;
      setSummary(data.session);
      if (data.events.length) setView((prev) => reduceEvents(prev, data.events));
      setError("");
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof BridgeError && e.status === 404) {
        // A bridge restart drops threads and then picks durable builds back
        // up under the same id. This is a wait, not a death, until the grace
        // runs out.
        setMissing(true);
        setMissingSince((at) => at ?? Date.now());
        setOffline(false);
        setError("");
        return;
      }
      if (e instanceof BridgeError && e.status === 0) {
        // The relay window is closed, or Chrome is holding the request. The
        // build keeps running on the PC; this tab just can't see it.
        setOffline(true);
        setError("Can't reach your PC from this tab right now. The build is still running on it — reconnect and this picks it back up.");
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [threadId]);

  useEffect(() => {
    if (!threadId || !paired) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (typeof document === "undefined" || document.visibilityState === "visible") await pull();
      if (stopped || !alive.current) return;
      // A missing or unreachable thread is polled too: the bridge resuming a
      // build is exactly what the page is waiting for, and stopping the loop
      // is how it used to sit on "Starting the build" forever.
      const every = offline ? 4_000 : missing ? 2_000 : pollEvery(summary?.status);
      if (every == null) return;
      timer.current = setTimeout(tick, every);
    };
    void tick();
    const onShow = () => {
      if (document.visibilityState === "visible") void pull();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onShow);
    };
    // `summary?.status` is a dependency on purpose: the rate follows the build.
  }, [threadId, paired, pull, summary?.status, offline, missing]);

  const start = useCallback(async (p: BuilderProject): Promise<string> => {
    setError("");
    setStarting("Making the project folder…");
    try {
      // The pick in the header is the harness pick. Claude Code only runs a
      // Claude model, so a Claude pick is honoured; anything else keeps the
      // default Claude Code model rather than silently pretending.
      const chosen = readChatModel();
      const buildModel = chosen && (buildsWithPick(chosen) || chosen === "claude-subscription") ? buildModelFor(chosen) : "";
      const brief = buildBrief(p);
      const { session } = await call<{ session: ThreadSummary }>("harness/start", {
        harness: buildHarness(),
        title: threadTitle(p),
        // The bridge makes a real folder with a repository of its own, because
        // a brand-new app has nothing to cut a worktree from.
        project: projectSlug(p),
        // Built for a named client: kept under Projects/clients, apart from
        // the owner's own work, so the folder handed over is only theirs.
        projectClient: isForClient(p),
        laneWrites: true,
        ...(buildModel ? { model: buildModel } : {}),
        // A build is not the tab's to lose. The bridge writes it down before
        // the agent starts, and resumes it in the same folder after a restart
        // — the brief is part of the record for exactly that case.
        durable: true,
        brief,
        // Pinned to "trusted", not inherited from the owner's setting.
        //
        // A build is hours of writing files and running npm, and on "ask" it
        // stops at every single command — which is not a build, it is a
        // hostage situation. "trusted" is safe HERE in a way it would not be
        // elsewhere, because the thread stands in a folder created seconds
        // ago that contains nothing to lose: `autoAllow` still gates every
        // write outside that folder, and still gates anything grave whatever
        // the trust setting says.
        trust: readTrust(),
      });
      setSummary(session);
      setStarting("Handing over the brief…");
      await call("harness/say", { id: session.id, text: brief });
      return session.id;
    } catch (e) {
      // Thrown, not stored. Starting is the caller's operation and it already
      // has somewhere to show a failure; `error` here belongs to the polling
      // loop, which has no caller to throw to.
      throw new Error(
        e instanceof BridgeError && e.status === 0
          ? "The agent on your PC isn't running, so there's nothing to build with. Start Jarvis on that PC and press Build it again."
          : e instanceof BridgeError && e.status === 401
            ? "This browser isn't paired with your PC yet. Pair it in Jarvis on that computer, then press Build it again."
            : e instanceof Error
              ? e.message
              : String(e),
      );
    } finally {
      setStarting("");
    }
  }, []);

  const decide = useCallback(
    async (gateId: string, allow: boolean, always = false) => {
      if (!threadId) return;
      try {
        await call("harness/decide", { id: threadId, gateId, allow, always });
        await pull();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [threadId, pull],
  );

  const say = useCallback(
    async (text: string) => {
      if (!threadId || !text.trim()) return;
      try {
        await call("harness/say", { id: threadId, text });
        await pull();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [threadId, pull],
  );

  const stop = useCallback(async () => {
    if (!threadId) return;
    try {
      await call("harness/stop", { id: threadId });
      await pull();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [threadId, pull]);

  // A 404 is only "lost" after the bridge has had time to resume the job.
  const lost = Boolean(missing && missingSince != null && now - missingSince > RESUME_GRACE_MS);
  return {
    phase: phaseOf(summary, view, missing, { lost, offline }),
    missing,
    offline,
    view,
    summary,
    gate: view.liveGate,
    links: resultLinks(view),
    error,
    starting,
    start,
    decide,
    say,
    stop,
    refresh: () => void pull(),
  };
}

/**
 * Start the thread that moves a finished app into the hub.
 *
 * A standalone function rather than part of the hook, because it starts a
 * SECOND thread — the build's thread is still the project's own, and this one
 * works in a worktree of the hub instead. `knownFolder()` is the bridge's own
 * directory; `repoInfo` resolves the git toplevel from it, so that is enough
 * to find the hub without doing arithmetic on paths.
 */
export async function startAbsorb(p: BuilderProject, from: string): Promise<string> {
  const repo = knownFolder();
  if (!repo) throw new Error("This browser hasn't heard from your PC yet, so I don't know where the hub is. Open Jarvis on that computer and try again.");
  try {
    const { session } = await call<{ session: ThreadSummary }>("harness/start", {
      harness: buildHarness(),
      title: absorbTitle(p),
      repo,
      laneWrites: true,
      // Its own worktree of the hub, so writes land nowhere near the checkout
      // the owner is looking at; `autoAllow` still gates anything outside it.
      trust: "trusted",
    });
    await call("harness/say", { id: session.id, text: absorbBrief(p, from) });
    return session.id;
  } catch (e) {
    throw new Error(
      e instanceof BridgeError && e.status === 0
        ? "The agent on your PC isn't running, so there's nothing to move it with."
        : e instanceof Error
          ? e.message
          : String(e),
    );
  }
}
