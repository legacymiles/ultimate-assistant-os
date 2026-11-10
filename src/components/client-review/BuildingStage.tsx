"use client";

// ---------------------------------------------------------------------------
// "Building now" — the stage a brand-new app gets before it has an address.
//
// A first build has no site to frame yet, so the old page showed an orb and a
// sentence. That is the longest wait in the product and the one place a client
// (or the owner) has nothing to look at. This fills the stage with the build
// itself: a field that follows the pointer, the live step, and the same lines
// the Chat Intake is narrating. It stays until the version lands; the page then
// reloads itself into the real app.
//
// Purely visual. The Chat Intake still owns the feed, the gates and the input.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { feedItems, type FeedItem } from "@/lib/client-review/liveBuild";
import { waitedFor } from "@/lib/client-review/building";
import type { LiveBuild } from "./LiveBuild";

export function BuildingStage({ name, number, since, live }: { name: string; number: string; since: string; live: LiveBuild }) {
  const [point, setPoint] = useState({ x: 52, y: 44 });
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  // The newest few things the agent touched. Enough to feel the code moving,
  // few enough to read at a glance from across the room.
  const lines = useMemo(() => feedItems(live.build.view, 8).slice(-6), [live.build.view]);
  const latest = lines.at(-1);
  const gate = live.build.gate;
  const running = live.finish.kind === "running";
  const state = gate
    ? "Needs you in the chat"
    : live.build.offline
      ? "Can't see your PC — still building there"
      : live.build.phase === "resuming"
        ? "Picking the build back up…"
        : live.build.phase === "paused"
          ? "Waiting for a limit to reset — it resumes itself"
          : live.standing.kind === "stalled"
          ? "Nothing is running"
          : live.finish.kind === "failed"
            ? "The build stopped — see the chat"
            : live.finish.kind === "no-preview"
              ? "Built, but it printed no preview — see the chat"
              : live.finish.kind === "publish"
                ? "Built — putting it on the page…"
                : latest
                  ? describe(latest)
                  : "Reading the brief…";
  const title = running ? ["BUILDING", "NOW"] : live.finish.kind === "publish" ? ["BUILT", "NOW"] : ["BUILD", "PAUSED"];

  const spot = (x: number, y: number) => setPoint({ x, y });

  return (
    <div
      className="cr-build-stage"
      style={{ "--cr-px": `${point.x}%`, "--cr-py": `${point.y}%` } as CSSProperties}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        spot(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
      }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 100;
        const y = ((e.clientY - r.top) / r.height) * 100;
        spot(x, y);
        const id = Date.now();
        setRipples((rs) => [...rs.slice(-3), { id, x, y }]);
        window.setTimeout(() => setRipples((rs) => rs.filter((r) => r.id !== id)), 1400);
      }}
      role="status"
      aria-live="polite"
      aria-label={`${name} is building`}
    >
      <div className="cr-build-grid" aria-hidden />
      <div className="cr-build-glow" aria-hidden />
      <div className="cr-build-rings" aria-hidden>
        <i />
        <i />
        <i />
        <b />
      </div>
      <div className="cr-build-ripples" aria-hidden>
        {ripples.map((r, i) => (
          <span key={r.id} style={{ left: `${r.x}%`, top: `${r.y}%` }} className={`is-${i % 2}`} />
        ))}
      </div>

      <div className="cr-build-copy">
        <p className="cr-build-kicker">
          {name} <span>·</span> {number}
        </p>
        <h1 className={`cr-build-title${running ? "" : " is-paused"}`}>
          <span>{title[0]}</span>
          <em>{title[1]}</em>
        </h1>
        <p className="cr-build-live">
          <span className={`cr-build-dot${running ? "" : " is-paused"}`} aria-hidden />
          {state}
          <span className="cr-build-clock">{waitedFor(since, now)}</span>
        </p>
        <p className="cr-build-hint">
          The build is running on the PC. The chat beside this is the agent&apos;s own log — open it to steer, or leave it alone; it reloads the app here by itself when it&apos;s ready.
        </p>

        {(lines.length > 0 || running) && (
          <ol className="cr-build-lines" aria-hidden>
            {lines.map((l) => (
              <li key={l.id} className={`is-${l.kind}`}>
                <span>{lineVerb(l)}</span>
                <code>{lineTarget(l)}</code>
              </li>
            ))}
            {!lines.length && (
              <>
                <li className="is-ghost"><span>Read</span><code>package.json</code></li>
                <li className="is-ghost"><span>Edit</span><code>src/app/page.tsx</code></li>
              </>
            )}
          </ol>
        )}
      </div>

      <span className="cr-build-foot" aria-hidden>
        move the cursor · click to send a ripple
      </span>
    </div>
  );
}

function lineVerb(l: FeedItem): string {
  if (l.kind === "tool") return l.verb || "Tool";
  if (l.kind === "you") return "You";
  return "Says";
}

function lineTarget(l: FeedItem): string {
  if (l.kind === "tool") return l.target || l.id;
  return l.text.replace(/\s+/g, " ").slice(0, 120);
}

function describe(l: FeedItem): string {
  if (l.kind === "tool") return `${l.verb || "Working"} ${l.target || ""}`.trim();
  if (l.kind === "you") return "Your note landed";
  return l.text.replace(/\s+/g, " ").slice(0, 140);
}
