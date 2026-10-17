"use client";

// ---------------------------------------------------------------------------
// Website Redesigner V2 — the bake-off console.
//
// One brief, three design skills, three real builds in three git worktrees,
// compared side by side. Google Stitch returns mockups; this returns three
// running apps on three ports and a branch you can land.
//
// The shape of the screen follows the Forge direction: the crucible is the
// monument, the console is docked beneath it, and the HUD labels sit in the
// corners. The 3D never takes a click — it is a readout of the lanes, and the
// lanes are what you work in.
//
// The rule that matters most here: ASSUME THE BRIDGE IS OFF, because most of
// the time it is. Nothing 500s, no button lies, and when nothing can be built
// the briefs are still produced and copyable — which is V1's whole output, so
// the floor of V2 is V1.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DEFAULT_SKILLS } from "@/lib/redesigner/engine";
import { buildBrief, laneBranch, type Target } from "@/lib/redesigner/v2/brief";
import { factsFor, pickableApps, type ScrapeResult } from "@/lib/redesigner/v2/facts";
import {
  laneHeat,
  laneStatus,
  liveGateOf,
  useBakeOff,
  type Lane,
} from "@/lib/redesigner/v2/useBakeOff";
import { claimPairedToken, probe, BRIDGE_OFFLINE, type BridgeHealth } from "@/lib/new-jarvis/bridge";
import { loadLocal, saveSynced } from "@/lib/sync/appState";

import "./bakeoff.css";

// The canvas is heavy and useless on the server; the console must render
// without waiting for it.
const Forge = dynamic(() => import("./Forge").then((m) => m.Forge), {
  ssr: false,
  loading: () => null,
});

/**
 * A phone gets the still.
 *
 * This is a desk tool — the compare view needs three builds side by side — so a
 * phone is reading about it rather than running one, and a WebGL scene there
 * costs battery to tell a story the poster already tells. Matched on a COARSE
 * POINTER rather than width, because what makes the live version worth its cost
 * is hovering a lane, and a narrow desktop window still has a mouse.
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return coarse;
}

const VERDICT_KEY = "redesigner:v2:verdicts";

interface Verdict {
  at: number;
  skill: string;
  target: string;
  /** The skills it beat, so the leaderboard counts appearances as well as wins. */
  against: string[];
}

type TargetKind = Target["kind"];

const KINDS: Array<{ id: TargetKind; label: string; hint: string }> = [
  { id: "new", label: "New app", hint: "Describe it and three lanes build it" },
  { id: "my-app", label: "One of my apps", hint: "Rebuilt from its real feature list" },
  { id: "url", label: "A URL", hint: "Keep what it does, replace how it looks" },
  { id: "hub-page", label: "A hub page", hint: "Reskin one page in place" },
];

export function BakeOff() {
  const [kind, setKind] = useState<TargetKind>("new");
  const [idea, setIdea] = useState("");
  const [slug, setSlug] = useState("");
  const [url, setUrl] = useState("");
  const [route, setRoute] = useState("");
  const [intent, setIntent] = useState("");
  const [picked, setPicked] = useState<string[]>([
    "interactive-web-studio",
    "impeccable",
    "taste-skill",
  ]);
  const [health, setHealth] = useState<BridgeHealth>(BRIDGE_OFFLINE);
  const [preparing, setPreparing] = useState("");
  const [prepError, setPrepError] = useState("");
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const bake = useBakeOff({ paired: health.paired });
  const coarse = useCoarsePointer();
  const apps = useMemo(() => pickableApps(), []);

  useEffect(() => {
    let live = true;
    // `pair.cmd` hands the page its token in the URL FRAGMENT, which is never
    // sent to any server. Claiming it here is what makes V2 pairable at all —
    // without this the console can only ever report the agent as unreachable.
    claimPairedToken();
    void probe().then((h) => live && setHealth(h));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    setVerdicts(loadLocal<Verdict[]>(VERDICT_KEY, []));
  }, []);

  const target: Target = useMemo(() => {
    switch (kind) {
      case "my-app":
        return { kind: "my-app", slug };
      case "url":
        return { kind: "url", url };
      case "hub-page":
        return { kind: "hub-page", route };
      default:
        return { kind: "new", idea };
    }
  }, [kind, idea, slug, url, route]);

  const ready =
    picked.length >= 2 &&
    ((kind === "new" && idea.trim().length > 8) ||
      (kind === "my-app" && !!slug) ||
      (kind === "url" && url.trim().length > 3) ||
      (kind === "hub-page" && route.trim().length > 1));

  // --- running ------------------------------------------------------------

  const run = useCallback(async () => {
    setPrepError("");
    setPreparing("Gathering the facts…");
    try {
      let scrape: ScrapeResult | undefined;
      if (kind === "url") {
        try {
          const res = await fetch("/api/redesign/scrape", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url.trim() }),
          });
          if (res.ok) scrape = (await res.json()) as ScrapeResult;
        } catch {
          // A scrape that fails is not fatal: the lane still gets the URL and
          // whatever was typed, which is enough to build from.
        }
      }
      const facts = await factsFor(target, scrape);
      const briefs = picked.map((skill) => ({
        skill,
        route: facts.route,
        title: `${facts.name} · ${skill}`,
        brief: buildBrief({
          skill,
          target,
          facts,
          intent,
          branch: laneBranch(facts.name, skill),
        }),
      }));
      setPreparing("");
      await bake.start(briefs);
    } catch (err) {
      setPreparing("");
      setPrepError((err as Error).message);
    }
  }, [kind, url, target, picked, intent, bake]);

  const declareWinner = useCallback(
    async (lane: Lane) => {
      const others = bake.lanes.filter((l) => l.skill !== lane.skill).map((l) => l.skill);
      await bake.land(lane.skill, `${lane.skill} won the bake-off`);
      await bake.discardOthers(lane.skill);
      const next: Verdict[] = [
        ...verdicts,
        {
          at: Date.now(),
          skill: lane.skill,
          target: targetLabel(kind, { idea, slug, url, route }),
          against: others,
        },
      ];
      setVerdicts(next);
      // Cheap, no model spend, and after a few runs it is the only honest answer
      // to "which of my skills actually makes the coolest UI".
      void saveSynced(VERDICT_KEY, next);
      setConfirming(null);
    },
    [bake, verdicts, kind, idea, slug, url, route],
  );

  const gate = liveGateOf(bake.lanes);

  // Empty, not three zeroed placeholders: a placeholder is a lane reporting
  // "stone cold", which pins the forge dark and makes the hero look broken on
  // the deployed hub, where there is never a local agent. Nothing here means
  // nothing is running, and the forge shows its own idle pour instead.
  const forgeLanes = useMemo(
    () =>
      bake.lanes.map((lane) => ({
        heat: laneHeat(lane),
        failed: laneStatus(lane) === "failed",
        hovered: hovered === lane.skill,
      })),
    [bake.lanes, hovered],
  );

  const board = useMemo(() => leaderboard(verdicts), [verdicts]);

  return (
    <div className="bo" data-running={bake.lanes.length > 0 ? "yes" : "no"}>
      <div className="bo-stage" aria-hidden="true">
        {coarse ? (
          <img className="bo-poster" src="/models/forge-crucible-poster.png" alt="" />
        ) : (
          <Forge lanes={forgeLanes} />
        )}
      </div>

      <header className="bo-hud bo-hud-tl">
        <span className="bo-word">Bake-off</span>
        <span className="bo-sub">Website Redesigner · V2</span>
      </header>
      <div className="bo-hud bo-hud-tr">
        <HarnessToggle bake={bake} />
      </div>

      {bake.lanes.length === 0 ? (
        <main className="bo-brief">
          <h1 className="bo-head">
            Three skills. One brief. <em>Three real builds.</em>
          </h1>
          <p className="bo-lede">
            Every lane gets the same brief and a different design skill, builds it for real in its
            own worktree, and comes back running on its own port. You pick the winner by eye.
          </p>

          <section className="bo-field">
            <span className="bo-label">Target</span>
            <div className="bo-kinds">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className="bo-kind"
                  data-on={kind === k.id ? "yes" : "no"}
                  onClick={() => setKind(k.id)}
                >
                  <strong>{k.label}</strong>
                  <span>{k.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="bo-field">
            {kind === "new" && (
              <textarea
                className="bo-input bo-area"
                placeholder="A tool that files my receipts by vendor and shows what I spend where…"
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                rows={3}
              />
            )}
            {kind === "my-app" && (
              <select
                className="bo-input"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              >
                <option value="">Pick an app…</option>
                {apps.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.title}
                    {a.tagline ? ` — ${a.tagline}` : ""}
                  </option>
                ))}
              </select>
            )}
            {kind === "url" && (
              <input
                className="bo-input"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
            {kind === "hub-page" && (
              <input
                className="bo-input"
                placeholder="/apps/new-jarvis"
                value={route}
                onChange={(e) => setRoute(e.target.value)}
              />
            )}
          </section>

          <section className="bo-field">
            <span className="bo-label">
              Anything else <em>(optional, passed to every lane verbatim)</em>
            </span>
            <input
              className="bo-input"
              placeholder="make it feel like a workshop, not a SaaS dashboard"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
            />
          </section>

          <section className="bo-field">
            <span className="bo-label">
              Design skills <em>({picked.length} lanes)</em>
            </span>
            <div className="bo-skills">
              {DEFAULT_SKILLS.map((s) => {
                const on = picked.includes(s.name);
                const wins = board.find((b) => b.skill === s.name)?.wins ?? 0;
                return (
                  <button
                    key={s.name}
                    type="button"
                    className="bo-skill"
                    data-on={on ? "yes" : "no"}
                    title={s.description}
                    onClick={() =>
                      setPicked((prev) =>
                        on ? prev.filter((p) => p !== s.name) : [...prev, s.name],
                      )
                    }
                  >
                    <span className="bo-skill-name">{s.name}</span>
                    {wins > 0 && <span className="bo-wins">{wins}★</span>}
                  </button>
                );
              })}
            </div>
          </section>

          {bake.blocked && (
            <p className="bo-warn">
              {bake.blocked} <br />
              <span className="bo-warn-soft">
                You can still generate the briefs and paste them into Claude Code by hand.
              </span>
            </p>
          )}
          {prepError && <p className="bo-warn">{prepError}</p>}

          <button
            type="button"
            className="bo-go"
            disabled={!ready || !!preparing || !!bake.working}
            onClick={run}
          >
            {preparing || bake.working || `Run the bake-off · ${picked.length} lanes`}
          </button>
          {!ready && (
            <p className="bo-hint">
              {picked.length < 2
                ? "Pick at least two design skills — one lane is not a bake-off."
                : "Describe the target to begin."}
            </p>
          )}

          {board.length > 0 && (
            <section className="bo-board">
              <span className="bo-label">Which skill keeps winning</span>
              <ol>
                {board.map((row) => (
                  <li key={row.skill}>
                    <span className="bo-board-skill">{row.skill}</span>
                    <span className="bo-board-bar">
                      <i style={{ width: `${(row.wins / board[0].wins) * 100}%` }} />
                    </span>
                    <span className="bo-board-n">
                      {row.wins}/{row.ran}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </main>
      ) : (
        <main className="bo-lanes">
          <div className="bo-lanes-head">
            <span className="bo-label">
              {bake.restoring
                ? "rejoining the run…"
                : `${bake.lanes.length} lanes · ${
                    bake.harness === "claude" ? "Claude Code" : "DeepSeek"
                  }`}
            </span>
            <div className="bo-lanes-actions">
              <button type="button" className="bo-ghost" onClick={() => void bake.stopAll()}>
                Stop all
              </button>
              <button type="button" className="bo-ghost" onClick={bake.reset}>
                New brief
              </button>
            </div>
          </div>

          <div className="bo-grid">
            {bake.lanes.map((lane) => (
              <LanePanel
                key={lane.skill}
                lane={lane}
                focused={focus === lane.skill}
                onHover={setHovered}
                onFocus={() => setFocus(focus === lane.skill ? null : lane.skill)}
                onServe={() => void bake.serve(lane.skill)}
                onNudge={() => void bake.nudge(lane.skill)}
                onWin={() => setConfirming(lane.skill)}
              />
            ))}
          </div>
        </main>
      )}

      {gate && (
        <GatePanel
          laneSkill={gate.lane.skill}
          gate={gate.gate}
          onDecide={(allow) => void bake.decide(gate.lane.skill, gate.gate.gateId, allow)}
        />
      )}

      {confirming && (
        <ConfirmWin
          skill={confirming}
          losers={bake.lanes.filter((l) => l.skill !== confirming && l.id).map((l) => l.skill)}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const lane = bake.lanes.find((l) => l.skill === confirming);
            if (lane) void declareWinner(lane);
          }}
        />
      )}
    </div>
  );
}

// --- pieces ----------------------------------------------------------------

function HarnessToggle({ bake }: { bake: ReturnType<typeof useBakeOff> }) {
  if (!bake.choices.length) {
    return <span className="bo-sub">no local agent</span>;
  }
  return (
    <div className="bo-toggle" role="group" aria-label="Which harness builds the lanes">
      {bake.choices.map((c) => (
        <button
          key={c.id}
          type="button"
          className="bo-toggle-b"
          data-on={bake.harness === c.id ? "yes" : "no"}
          disabled={!c.available}
          // The `why` string IS the fix. Hiding it behind "unavailable" turns a
          // one-line install into a mystery.
          title={c.available ? c.blurb : c.why}
          onClick={() => bake.setHarness(c.id)}
        >
          {c.id === "claude" ? "Claude" : "DeepSeek"}
          {!c.available && <span className="bo-dot" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

function LanePanel({
  lane,
  focused,
  onHover,
  onFocus,
  onServe,
  onNudge,
  onWin,
}: {
  lane: Lane;
  focused: boolean;
  onHover: (skill: string | null) => void;
  onFocus: () => void;
  onServe: () => void;
  onNudge: () => void;
  onWin: () => void;
}) {
  const status = laneStatus(lane);
  const turn = lane.view.turns[lane.view.turns.length - 1];
  const tools = turn?.tools ?? [];
  const wrote = tools.filter((t) => t.kindOf === "write").length;

  return (
    <section
      className="bo-lane"
      data-status={status}
      data-focused={focused ? "yes" : "no"}
      onMouseEnter={() => onHover(lane.skill)}
      onMouseLeave={() => onHover(null)}
    >
      <header className="bo-lane-head">
        <button type="button" className="bo-lane-name" onClick={onFocus}>
          {lane.skill}
        </button>
        <span className="bo-chip" data-status={status}>
          {statusLabel(status)}
        </span>
      </header>

      {lane.error ? (
        // A failed lane keeps its place carrying its error. "Why did this
        // skill's lane fail" is itself a result of a bake-off.
        <p className="bo-lane-error">{lane.error}</p>
      ) : (
        <>
          <div className="bo-lane-meta">
            <span>{wrote} files written</span>
            {lane.summary?.usd ? <span>${lane.summary.usd.toFixed(2)}</span> : null}
            {lane.summary?.worktree?.branch && (
              <span className="bo-branch">{lane.summary.worktree.branch}</span>
            )}
          </div>

          {lane.url ? (
            <div className="bo-frame">
              <iframe src={lane.url} title={`${lane.skill} build`} />
              {lane.compiling && <span className="bo-compiling">still compiling…</span>}
            </div>
          ) : (
            <pre className="bo-log">
              {(turn?.text || lane.view.detail || "waiting for the first turn…").slice(-1400)}
            </pre>
          )}

          {status === "paused" && (
            // A lane that stops to report is not a lane that finished. Saying so
            // and offering the one useful reply beats a chip reading "finished"
            // over a half-built app.
            <p className="bo-lane-paused">
              Stopped to report{lane.nudges > 0 ? ` · told to continue ${lane.nudges}×` : ""}. A
              whole app is rarely one turn&rsquo;s work.
            </p>
          )}

          <div className="bo-lane-actions">
            {status === "paused" && (
              <button type="button" className="bo-ghost bo-keep" onClick={onNudge}>
                Keep going
              </button>
            )}
            <button
              type="button"
              className="bo-ghost"
              onClick={onServe}
              disabled={!lane.id || lane.compiling}
            >
              {lane.url ? "Restart preview" : lane.compiling ? "Starting…" : "Serve it"}
            </button>
            <button type="button" className="bo-win" onClick={onWin} disabled={!lane.id}>
              This one won
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function GatePanel({
  laneSkill,
  gate,
  onDecide,
}: {
  laneSkill: string;
  gate: { title: string; why: string; risk: string; patch: string; command: string };
  onDecide: (allow: boolean) => void;
}) {
  return (
    <aside className="bo-gate" data-risk={gate.risk}>
      <header>
        <span className="bo-label">{laneSkill} is asking</span>
        <strong>{gate.title}</strong>
        {gate.why && <p>{gate.why}</p>}
      </header>
      {(gate.patch || gate.command) && <pre>{gate.patch || gate.command}</pre>}
      <div className="bo-gate-actions">
        <button type="button" className="bo-ghost" onClick={() => onDecide(false)}>
          Refuse
        </button>
        <button type="button" className="bo-win" onClick={() => onDecide(true)}>
          Allow
        </button>
      </div>
    </aside>
  );
}

function ConfirmWin({
  skill,
  losers,
  onCancel,
  onConfirm,
}: {
  skill: string;
  losers: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="bo-modal" role="dialog" aria-modal="true">
      <div className="bo-modal-card">
        <strong>Land {skill}?</strong>
        <p>
          Its branch is committed and merged into your base when the base is clean.
          {losers.length > 0 && (
            <>
              {" "}
              The other {losers.length === 1 ? "lane" : "lanes"} —{" "}
              <em>{losers.join(", ")}</em> — are <strong>deleted</strong>: worktree and branch, gone.
            </>
          )}
        </p>
        <div className="bo-gate-actions">
          <button type="button" className="bo-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="bo-win" onClick={onConfirm}>
            Land it
          </button>
        </div>
      </div>
    </div>
  );
}

// --- plain functions -------------------------------------------------------

function statusLabel(status: string): string {
  switch (status) {
    case "building":
      return "building";
    case "waiting":
      return "needs you";
    case "serving":
      return "running";
    case "paused":
      return "paused";
    case "done":
      return "finished";
    case "failed":
      return "failed";
    case "starting":
      return "starting";
    default:
      return "idle";
  }
}

function targetLabel(
  kind: TargetKind,
  v: { idea: string; slug: string; url: string; route: string },
): string {
  switch (kind) {
    case "my-app":
      return v.slug;
    case "url":
      return v.url;
    case "hub-page":
      return v.route;
    default:
      return v.idea.slice(0, 60);
  }
}

/** Wins and appearances per skill, most wins first. */
export function leaderboard(verdicts: Verdict[]): Array<{ skill: string; wins: number; ran: number }> {
  const wins = new Map<string, number>();
  const ran = new Map<string, number>();
  for (const v of verdicts) {
    wins.set(v.skill, (wins.get(v.skill) ?? 0) + 1);
    for (const s of [v.skill, ...v.against]) ran.set(s, (ran.get(s) ?? 0) + 1);
  }
  return [...wins.entries()]
    .map(([skill, n]) => ({ skill, wins: n, ran: ran.get(skill) ?? n }))
    .sort((a, b) => b.wins - a.wins || a.skill.localeCompare(b.skill));
}
