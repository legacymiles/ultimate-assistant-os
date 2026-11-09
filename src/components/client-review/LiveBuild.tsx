"use client";

// ---------------------------------------------------------------------------
// The build, live, inside the Chat Intake.
//
// The site stays on screen and the chat narrates the build beside it — every
// file Claude Code reads or edits, every command it runs, its own words in
// between — the way Claude Code shows its work next to a preview. Nothing
// navigates: when the build ends, the preview it printed is put on the
// version and the page reloads the site once, by itself.
//
// `useLiveBuild` owns the watching and the finish, so it keeps working while
// the intake is shrunk to its orb. `BuildFeed` and `BuildSteer` only draw it:
// the feed in the chat's list, the steer box where the compose box would be.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PHASE_LABEL } from "@/lib/app-builder/build";
import { useBuild, type UseBuild } from "@/lib/app-builder/useBuild";
import { waitedFor, type BuildRow } from "@/lib/client-review/building";
import { publishBuilt, removeBuild } from "@/lib/client-review/buildHere";
import { portal } from "@/lib/client-review/client";
import { feedItems, finishOf, type Finish } from "@/lib/client-review/liveBuild";
import { call } from "@/lib/new-jarvis/bridge";
import { askedBefore } from "@/lib/new-jarvis/harness/families";

/** A watched build: quick enough to feel live, slow enough to leave the server alone. */
const ROW_POLL_MS = 4_000;

export interface LiveBuild {
  /** This project's build row, once the server has answered. */
  row: BuildRow | null;
  /** Only the owner has a thread to watch; a client sees the progress line. */
  build: UseBuild;
  watching: boolean;
  finish: Finish;
  /** Putting the preview on the version: "", "working", or what went wrong. */
  publish: "" | "working" | { error: string };
  retryPublish: () => void;
  /** Use an address by hand, when the build printed none. */
  useAddress: (url: string) => Promise<void>;
  stop: () => Promise<void>;
  stopping: boolean;
}

export function useLiveBuild({
  token,
  active,
  onDone,
}: {
  token: string;
  /** A version is being built on this project. */
  active: boolean;
  /** The build landed (here or anywhere): reload the page's data. */
  onDone: () => void;
}): LiveBuild {
  const [row, setRow] = useState<BuildRow | null>(null);
  const [publish, setPublish] = useState<LiveBuild["publish"]>("");
  const [stopping, setStopping] = useState(false);
  const published = useRef<string | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const load = useCallback(async () => {
    try {
      const { builds } = await portal.building();
      const mine = builds.find((b) => b.token === token) ?? null;
      setRow(mine);
      // Finished somewhere else (another tab, Ship): pull it in now rather
      // than on the page's next slow tick.
      if (mine?.state === "ready") doneRef.current();
    } catch {
      // The page's own poll still runs; a missed tick here is not worth a banner.
    }
  }, [token]);

  useEffect(() => {
    if (!active) {
      setRow(null);
      return;
    }
    void load();
    const id = window.setInterval(() => document.visibilityState === "visible" && void load(), ROW_POLL_MS);
    return () => window.clearInterval(id);
  }, [active, load]);

  const threadId = active && row?.state === "building" ? row.threadId : undefined;
  const build = useBuild(threadId, true);
  const watching = Boolean(threadId);
  const finish: Finish = watching ? finishOf(build.phase, build.view) : { kind: "running" };

  const doPublish = useCallback(
    async (url: string) => {
      if (!row?.projectId) return;
      setPublish("working");
      try {
        await publishBuilt(row.projectId, row.versionId, url);
        setPublish("");
        doneRef.current();
      } catch (e) {
        published.current = null;
        setPublish({ error: e instanceof Error ? e.message : "It couldn't be put on the page." });
      }
    },
    [row?.projectId, row?.versionId],
  );

  // The whole point: built → on the page, with nobody pressing anything. Once
  // per version, so a re-render or a second poll never publishes it twice.
  useEffect(() => {
    if (finish.kind !== "publish" || !row?.projectId || row.state !== "building") return;
    if (published.current === row.versionId) return;
    published.current = row.versionId;
    void doPublish(finish.url);
  }, [finish, row, doPublish]);

  /** Kill the thread first, then the record: the other order lets a "stopped" build open a PR later. */
  const stop = useCallback(async () => {
    if (!row?.projectId) return;
    setStopping(true);
    try {
      if (row.threadId) await call("harness/stop", { id: row.threadId }).catch(() => {});
      await removeBuild(row.projectId, row.versionId);
      doneRef.current();
    } catch (e) {
      setPublish({ error: e instanceof Error ? e.message : "It couldn't be stopped." });
    } finally {
      setStopping(false);
    }
  }, [row]);

  return {
    row,
    build,
    watching,
    finish,
    publish,
    retryPublish: () => finish.kind === "publish" && void doPublish(finish.url),
    useAddress: (url: string) => doPublish(url),
    stop,
    stopping,
  };
}

/** The build, narrated: drawn at the bottom of the chat's list. */
export function BuildFeed({
  live,
  number,
  since,
  owner,
}: {
  live: LiveBuild;
  /** "v3" */
  number: string;
  since: string;
  owner: boolean;
}) {
  const { build, watching, finish, publish, row } = live;
  const [now, setNow] = useState(() => Date.now());
  const [sure, setSure] = useState(false);
  const [address, setAddress] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const items = watching ? feedItems(build.view) : [];
  const gate = build.gate;
  const repeat = gate ? askedBefore(build.view, gate) : false;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  // Follow the newest line, like a terminal — unless the person has scrolled
  // up to read something, which is never yanked away from them.
  const stick = useRef(true);
  useLayoutEffect(() => {
    const list = endRef.current?.closest(".cr-list") as HTMLElement | null;
    if (!list) return;
    const onScroll = () => {
      stick.current = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, []);
  const last = items.at(-1);
  useLayoutEffect(() => {
    const list = endRef.current?.closest(".cr-list") as HTMLElement | null;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, [items.length, last?.kind === "say" ? last.text.length : 0, gate?.gateId, finish.kind, publish]);

  const state =
    publish === "working"
      ? `Putting ${number} on the page…`
      : finish.kind === "publish"
        ? `${number} is built`
        : finish.kind === "no-preview"
          ? `${number} is built — no preview yet`
          : finish.kind === "failed"
            ? "The build stopped"
            : watching
              ? PHASE_LABEL[build.phase]
              : row?.error
                ? "Nothing is running"
                : "Building";
  const tone = finish.kind === "failed" || row?.error ? "bad" : gate ? "ask" : finish.kind === "running" ? "run" : "ok";

  return (
    <li className="cr-feed" aria-live="polite">
      <div className={`cr-feed-head tone-${tone}`}>
        <span className="cr-feed-dot" aria-hidden />
        <b>{watching ? "Claude Code" : "Jarvis"}</b>
        <span className="cr-feed-state">{state}</span>
        <span className="cr-feed-time">{waitedFor(since, now)}</span>
        {watching && build.summary?.model && <span className="cr-feed-model">{build.summary.model}</span>}
      </div>

      {!watching && !row?.error && (
        <p className="cr-feed-quiet">
          {owner
            ? "Waiting for your PC to report in…"
            : `Your approved changes are being built into ${number}. The site on the left reloads by itself when it's ready — no need to refresh.`}
        </p>
      )}
      {row?.error && (
        <p className="cr-feed-error">Nothing is running. The last try said: {row.error.message}</p>
      )}

      {items.length > 0 && (
        <ol className="cr-feed-log">
          {items.map((it) =>
            it.kind === "tool" ? (
              <li key={it.id} className={`cr-feed-tool is-${it.status}`}>
                <ToolMark status={it.status} />
                <span className="cr-feed-verb">{it.verb}</span>
                <code title={it.target}>{it.target}</code>
              </li>
            ) : it.kind === "you" ? (
              <li key={it.id} className="cr-feed-you">
                {it.text}
              </li>
            ) : (
              <li key={it.id} className={`cr-feed-say ${it.live ? "is-live" : ""}`}>
                {it.text}
              </li>
            ),
          )}
        </ol>
      )}
      {watching && build.phase === "working" && !items.length && <p className="cr-feed-quiet">Reading the brief…</p>}

      {gate && (
        <div className="cr-feed-gate" role="group" aria-label="Claude Code is asking">
          <p>
            <b>Needs you:</b> {gate.title || gate.name}
          </p>
          {(gate.command || gate.path) && <code>{gate.command || gate.path}</code>}
          {/* One answer per act, not per call: on a repeat, Always leads. */}
          <div className="cr-row">
            {gate.risk !== "grave" && repeat && (
              <button className="cr-btn small" onClick={() => void build.decide(gate.gateId, true, true)}>
                Always
              </button>
            )}
            <button className={`cr-btn small ${repeat ? "ghost" : ""}`} onClick={() => void build.decide(gate.gateId, true)}>
              Allow{repeat ? " once" : ""}
            </button>
            {gate.risk !== "grave" && !repeat && (
              <button className="cr-btn small ghost" onClick={() => void build.decide(gate.gateId, true, true)}>
                Always
              </button>
            )}
            <button className="cr-btn small ghost" onClick={() => void build.decide(gate.gateId, false)}>
              Not now
            </button>
          </div>
        </div>
      )}

      {finish.kind === "publish" && typeof publish === "object" && (
        <div className="cr-feed-end is-bad">
          <p>Built, but it couldn&apos;t be put on the page: {publish.error}</p>
          <button className="cr-btn small" onClick={live.retryPublish}>Try again</button>
        </div>
      )}
      {finish.kind === "no-preview" && (
        <div className="cr-feed-end">
          <p>{finish.why}</p>
          {finish.pr && (
            <a className="cr-link" href={finish.pr} target="_blank" rel="noreferrer">
              Open the pull request
            </a>
          )}
          {owner && (
            <form
              className="cr-feed-address"
              onSubmit={(e) => {
                e.preventDefault();
                if (address.trim()) void live.useAddress(address.trim());
              }}
            >
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Preview address, if you have one"
                aria-label="Preview address"
              />
              <button className="cr-btn small" disabled={!address.trim() || publish === "working"}>
                Show it here
              </button>
            </form>
          )}
        </div>
      )}
      {finish.kind === "failed" && <p className="cr-feed-error">{finish.why}</p>}
      {build.error && <p className="cr-feed-error">{build.error}</p>}
      {typeof publish === "object" && finish.kind !== "publish" && <p className="cr-feed-error">{publish.error}</p>}

      {owner && row?.projectId && finish.kind !== "publish" && (
        <div className="cr-feed-stop">
          {sure ? (
            <>
              <span>Stop it and put the edits back?</span>
              <button className="cr-btn small danger" disabled={live.stopping} onClick={() => void live.stop()}>
                {live.stopping ? "Stopping…" : "Yes, stop"}
              </button>
              <button className="cr-btn small ghost" onClick={() => setSure(false)}>Keep going</button>
            </>
          ) : (
            <button className="cr-link" onClick={() => setSure(true)}>
              {finish.kind === "failed" || row.error ? "Remove it and put the edits back" : "Stop this build"}
            </button>
          )}
        </div>
      )}
      <div ref={endRef} />
    </li>
  );
}

/** Talk to the build while it runs — where the compose box would be. */
export function BuildSteer({ live }: { live: LiveBuild }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const busy = live.finish.kind !== "running" || !live.watching;
  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    await live.build.say(text.trim());
    setText("");
    setSending(false);
  };
  return (
    <div className="cr-compose cr-steer">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={busy ? "The build has finished." : "Tell Claude Code something while it works…"}
        rows={2}
        maxLength={4000}
        disabled={busy}
        aria-label="Message to Claude Code"
      />
      <div className="cr-row">
        <span className="cr-steer-hint">It reads this at its next step.</span>
        <button className="cr-btn small" onClick={() => void send()} disabled={busy || !text.trim() || sending}>
          {sending ? "Sending…" : "Send to Claude Code"}
        </button>
      </div>
    </div>
  );
}

function ToolMark({ status }: { status: string }) {
  if (status === "running" || status === "escalating") return <span className="cr-feed-spin" aria-label="Running" />;
  const ok = status === "ok";
  return (
    <svg className="cr-feed-mark" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label={ok ? "Done" : "Failed"}>
      {ok ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M6 6l12 12M18 6L6 18" />}
    </svg>
  );
}
