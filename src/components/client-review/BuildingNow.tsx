"use client";

// ---------------------------------------------------------------------------
// The Building screen.
//
// Open an app whose next version is still being made and this is what you get
// — not the app, and not the app with a spinner over it. The app on screen
// during a build is the OLD app, and a person who clicks into it, looks at it
// and sees nothing different has been told a small lie by the interface.
//
// It is a list rather than a single card because the only question a person
// has while waiting is whether anything else is ahead of them. Usually there
// is one row.
//
// It leaves by itself. The list keeps showing a build for a few minutes after
// it ships (`state: "ready"`), so this screen can watch a row flip and open
// the built version — no refresh, no "it's done, click here". A row that
// vanishes without ever going `ready` was stopped, and that is said in those
// words rather than by quietly going back.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { admin, ApiError, portal } from "@/lib/client-review/client";
import { call } from "@/lib/new-jarvis/bridge";
import { waitedFor, type BuildRow } from "@/lib/client-review/building";
import { useBuild } from "@/lib/app-builder/useBuild";
import { PHASE_LABEL, latestWord } from "@/lib/app-builder/build";
import "./client-review.css";

/** Fast while something is building — this is a screen someone is watching. */
const POLL_MS = 5_000;

export function BuildingNow({
  /** The app the person clicked, if they came from one: its row is the lead. */
  token,
  onOpen,
  onBack,
  onLookAnyway,
  current,
}: {
  token?: string;
  /** Open a finished build's app, in the client view. */
  onOpen: (token: string) => void;
  /** Back to the Client Review main page. */
  onBack: () => void;
  /**
   * Look at the version that is already live instead of waiting. Offered, not
   * the default: the build is what the person came for, and a screen that
   * quietly shows the old site instead is the bug this screen exists to fix.
   */
  onLookAnyway?: () => void;
  /** The live version's number, for the words on that button. */
  current?: string;
}) {
  const [builds, setBuilds] = useState<BuildRow[] | null>(null);
  const [owner, setOwner] = useState(false);
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState("");
  const [gone, setGone] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  // Every token seen building in this visit, so a row that disappears can be
  // told apart from one that was never there.
  const watched = useRef<Set<string>>(new Set());
  const opened = useRef(false);

  const load = useCallback(async () => {
    try {
      const { builds, owner } = await portal.building();
      setBuilds(builds);
      setOwner(owner);
      setError("");
      for (const b of builds) if (b.state === "building") watched.current.add(b.token);
      const here = new Set(builds.map((b) => b.token));
      setGone([...watched.current].filter((t) => !here.has(t)));
    } catch (e) {
      setError(e instanceof ApiError && e.flags.signIn ? "Sign in to see what is building." : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const onShow = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load]);

  // The clock for "4 min", ticking on its own so the number is never stale.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  // The whole point: a build finishes and the person is taken to it. Only the
  // one they came in for, and only once — being moved twice is worse than not
  // being moved at all.
  const done = builds?.find((b) => b.state === "ready" && (!token || b.token === token));
  useEffect(() => {
    if (!done || opened.current) return;
    opened.current = true;
    const t = window.setTimeout(() => onOpen(done.token), 1100);
    return () => window.clearTimeout(t);
  }, [done, onOpen]);

  /**
   * Stop a build and put the edits back, so it can be built again.
   *
   * The thread is killed first and the record second. The other order leaves
   * Claude Code writing into a worktree for a build nothing is waiting on,
   * which is how a "stopped" build quietly opens a pull request an hour later.
   * A thread that has already died makes `harness/stop` fail, and that must
   * not block the part that actually unsticks the screen.
   */
  const stop = useCallback(
    async (row: BuildRow) => {
      if (!row.projectId) return;
      setStopping(row.versionId);
      setError("");
      try {
        if (row.threadId) await call("harness/stop", { id: row.threadId }).catch(() => {});
        await admin.act({ action: "cancelBuild", id: row.projectId, versionId: row.versionId });
        watched.current.delete(row.token);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "It couldn't be stopped.");
      } finally {
        setStopping("");
      }
    },
    [load],
  );

  const rows = builds ?? [];
  const lead = token ? rows.find((b) => b.token === token) : undefined;
  const others = rows.filter((b) => b !== lead);
  const stopped = gone.filter((t) => !token || t === token);

  return (
    <div className="cr-root is-embedded crb">
      <header className="crb-top">
        <button className="cr-btn ghost crb-back" onClick={onBack} aria-label="Back to Client Review">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span>Back</span>
        </button>
        <p className="cr-kicker">Jarvis</p>
        <h1>{rows.some((b) => b.state === "building") ? "Building" : "Nothing is building"}</h1>
      </header>

      <div className="crb-reactor" aria-hidden>
        <span className="r1" />
        <span className="r2" />
        <span className="r3" />
        <span className="core" />
      </div>

      {error && <p className="cr-error">{error}</p>}
      {!builds && !error && <p className="crb-quiet">Looking…</p>}

      <ul className="crb-list">
        {lead && (
          <Row key={lead.token} row={lead} now={now} lead onOpen={onOpen} onStop={owner ? stop : undefined} stopping={stopping} />
        )}
        {others.map((b) => (
          <Row key={b.token} row={b} now={now} onOpen={onOpen} onStop={owner ? stop : undefined} stopping={stopping} />
        ))}
      </ul>

      {stopped.map((t) => (
        <p key={t} className="crb-stopped" role="status">
          That build was stopped before it finished. Your edit requests are safe — they are back in Client Review waiting
          to be built again.
        </p>
      ))}

      {onLookAnyway && (
        <button className="cr-btn ghost crb-anyway" onClick={onLookAnyway}>
          {current ? `Look at ${current} while you wait` : "Look at the live version"}
        </button>
      )}

      {builds && !rows.length && !stopped.length && (
        <p className="crb-quiet">
          {token
            ? "This one is not being built right now."
            : "Nothing is being built right now. When you send edits and they are approved, the build shows up here."}
        </p>
      )}
    </div>
  );
}

function Row({
  row,
  now,
  lead = false,
  onOpen,
  onStop,
  stopping,
}: {
  row: BuildRow;
  now: number;
  lead?: boolean;
  onOpen: (token: string) => void;
  /** Owner only: stop this build and hand the edits back. */
  onStop?: (row: BuildRow) => void;
  stopping: string;
}) {
  const ready = row.state === "ready";
  const lines = row.summary
    .split("\n")
    .map((l) => l.replace(/^[•\-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
  return (
    <li className={`crb-row ${ready ? "is-ready" : "is-building"} ${lead ? "is-lead" : ""}`}>
      <div className="crb-row-head">
        <b>{row.name}</b>
        <span className="crb-ver">{row.version}</span>
        <span className="crb-state">{ready ? "Ready — opening it…" : `Building · ${waitedFor(row.since, now)}`}</span>
      </div>
      {lines.length > 0 && (
        <ul className="crb-what">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      {row.threadId && !ready && <OwnerLive threadId={row.threadId} />}
      {/*
        No thread and an error: the press failed and this version is stuck.
        Saying so here is the difference between "it is taking a while" and
        "nothing is happening and nothing will".
      */}
      {row.error && !ready && (
        <p className="crb-row-error">Nothing is running. The last try said: {row.error.message}</p>
      )}
      <div className="crb-row-actions">
        {ready && (
          <button className="cr-btn" onClick={() => onOpen(row.token)}>
            See {row.version} now
          </button>
        )}
        {onStop && !ready && (
          <button
            className="crb-stop"
            disabled={stopping === row.versionId}
            onClick={() => onStop(row)}
            title="Stop this build, remove the version, and put the edits back as a pending batch"
          >
            {stopping === row.versionId ? "Stopping…" : "Stop & remove"}
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * What the owner's PC is actually doing, on this screen.
 *
 * Only the owner ever gets a `threadId`, so this only ever renders for them.
 * The permission buttons are the reason it is here rather than a link to the
 * Admin console: a build parked on a permission card is a build that waits
 * forever if the only place to answer it is somewhere else.
 */
function OwnerLive({ threadId }: { threadId: string }) {
  const build = useBuild(threadId, true);
  const gate = build.gate;
  const what = build.phase === "working" ? latestWord(build.view) : "";
  return (
    <div className="crb-live">
      <span className="crb-live-phase">{PHASE_LABEL[build.phase]}</span>
      {build.summary?.model && <span className="crb-live-model">{build.summary.model}</span>}
      {what && <span className="crb-live-what">{what}</span>}
      {gate && (
        <span className="crb-gate">
          <span className="crb-gate-what" title={gate.why || gate.command || gate.path}>
            Needs you: {gate.title || gate.name}
          </span>
          <button onClick={() => void build.decide(gate.gateId, true)}>Allow</button>
          <button className="ghost" onClick={() => void build.decide(gate.gateId, false)}>
            Not now
          </button>
        </span>
      )}
      {build.error && <span className="crb-live-what">{build.error}</span>}
    </div>
  );
}
