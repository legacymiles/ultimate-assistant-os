"use client";

// ---------------------------------------------------------------------------
// The workspace, on a website that exists — a client site, or one of the hub's
// own apps opened for editing.
//
// This REPLACES Client Review's floating chat. Same data, same documents, same
// link secrets, same push notifications: nothing was copied or migrated, the
// project is read and written exactly where it already lived. What changed is
// that the conversation is a panel beside the site instead of a popup over it,
// and that everything the three apps used to show in four different places —
// the requests, the build narration, the files being changed, the versions —
// is four tabs of that one panel.
//
// It is also where "ship first" stops being a sentence in a brief: when a
// build reports the site live, the Studio says the after-live message into the
// SAME thread, which is what starts Software Factory and the deep security
// scan. Once, never early, and the thread itself is the record that it was
// sent — so a second device opening this page cannot send it again.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { admin, portal, ApiError } from "@/lib/client-review/client";
import { approveAndStart, connectToPc } from "@/lib/client-review/buildHere";
import type { ClientProject, PortalView } from "@/lib/client-review/types";
import { call } from "@/lib/new-jarvis/bridge";
import type { WorkSummary } from "@/lib/new-jarvis/harness/types";
import { FACTORY_DONE, factoryBrief, type StageFacts } from "@/lib/website-studio/pipeline";
import { BuildFeed, BuildSteer, useLiveBuild } from "../client-review/LiveBuild";
import { PipelineRail } from "./PipelineRail";
import { WorkShell, type StageDevice, type WorkTab } from "./WorkShell";
import "../client-review/client-review.css";

interface Props {
  token: string;
  owner: boolean;
  onBack: () => void;
  /** The library's data is stale once something lands here. */
  onChanged?: () => void;
}

type Tab = "chat" | "build" | "changes" | "versions";

export function SiteWorkspace({ token, owner, onBack, onChanged }: Props) {
  const [view, setView] = useState<PortalView | null>(null);
  const [project, setProject] = useState<ClientProject | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("chat");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState("");
  const [work, setWork] = useState<WorkSummary | null>(null);
  const [diff, setDiff] = useState("");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const v = await portal.load(token);
      if (!alive.current) return;
      setView(v);
      setError("");
      if (owner) {
        // The owner's half: the repo, the batches, the build record. A client
        // never sees these, and the portal view never carries them.
        const { project } = await admin.byToken(token);
        if (alive.current) setProject(project);
      }
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    }
  }, [token, owner]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => document.visibilityState === "visible" && void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  const current = view?.versions.find((v) => v.id === view.currentVersionId) ?? null;
  const building = Boolean(view?.buildingVersionId);
  const live = useLiveBuild({
    token,
    active: building,
    onDone: () => {
      void load();
      onChanged?.();
    },
  });

  // ----- ship first: the after-live message ------------------------------------------
  //
  // The thread is the record, not a flag on this page: its turns are on the
  // PC, shared by every device, and a prompt carrying <after_live> is proof
  // the message was already sent. That is what makes "once" true when the
  // owner has this open on a laptop and a phone at the same time.
  const turns = live.build.view.turns;
  const factoryStarted = turns.some((t) => t.prompt.includes("<after_live>"));
  const factoryDone = turns.some((t) => FACTORY_DONE.test(t.text));
  const liveUrl = current?.siteUrl ?? "";
  const sentFactory = useRef(false);

  useEffect(() => {
    if (!owner || !live.watching || factoryStarted || factoryDone || sentFactory.current) return;
    if (!liveUrl || live.finish.kind === "running") return;
    sentFactory.current = true;
    void live.build
      .say(factoryBrief({ name: view?.name ?? "The site", liveUrl, repo: project?.repo }))
      .catch(() => {
        sentFactory.current = false;
      });
  }, [owner, live.watching, live.finish.kind, live.build, factoryStarted, factoryDone, liveUrl, view?.name, project?.repo]);

  // ----- the files being changed ------------------------------------------------------
  const threadId = live.row?.threadId;
  useEffect(() => {
    if (tab !== "changes" || !threadId) return;
    let stop = false;
    const read = async () => {
      try {
        const d = await call<{ diff: string; truncated: boolean; work: WorkSummary }>("harness/diff", { id: threadId });
        if (stop) return;
        setWork(d.work);
        setDiff(d.diff);
      } catch {
        if (!stop) setWork(null);
      }
    };
    void read();
    const id = window.setInterval(() => document.visibilityState === "visible" && void read(), 6_000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [tab, threadId]);

  // ----- asking for a change ----------------------------------------------------------
  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || sending || !view) return;
    setSending(true);
    setNote("");
    try {
      const after = await portal.act(token, { action: "add", text: body });
      setView(after);
      setText("");
      const added = after.requests.filter((r) => r.status === "draft");
      const sent = await portal.act(token, { action: "send", ids: added.map((r) => r.id) });
      setView(sent);
      if (owner) {
        // The owner's Send is Send & build: approving and starting are one
        // action, exactly as they were on the old screen.
        const out = await approveAndStart(token, view.currentVersionId ?? undefined);
        setNote(out.message);
        if (out.state === "working") {
          await load();
          onChanged?.();
        }
      } else {
        setNote("Sent. Jarvis has it — you'll hear when it's approved and when the new version is ready.");
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [text, sending, view, token, owner, load, onChanged]);

  const markReady = useCallback(
    async (versionId: string, siteUrl: string) => {
      if (!view) return;
      try {
        await admin.act({ action: "ready", id: view.projectId, versionId, siteUrl });
        await load();
        onChanged?.();
      } catch (e) {
        setNote(e instanceof Error ? e.message : String(e));
      }
    },
    [view, load, onChanged],
  );

  const facts: StageFacts = useMemo(
    () => ({
      understood: true,
      planned: true,
      lookPicked: Boolean(view?.look ?? view?.designSkill),
      flowsApproved: Boolean(view?.look),
      buildStarted: building || (view?.versions.length ?? 0) > 0,
      live: Boolean(liveUrl),
      factoryStarted,
      factoryDone,
      idle: !building,
    }),
    [view, building, liveUrl, factoryStarted, factoryDone],
  );

  const waiting = view?.pending ?? 0;
  const changed = work?.files.length ?? 0;
  const tabs: WorkTab[] = [
    { id: "chat", label: "Chat", count: waiting },
    { id: "build", label: "Build", live: building },
    ...(owner ? [{ id: "changes", label: "Changes", count: changed }] : []),
    { id: "versions", label: "Versions", count: view?.versions.length ?? 0 },
  ];

  if (error && !view) {
    return (
      <div className="ws-center">
        <div className="ws-empty">
          <h2>Couldn&apos;t open this website</h2>
          <p>{error}</p>
          <button className="ws-btn" onClick={onBack}>
            All websites
          </button>
        </div>
      </div>
    );
  }

  return (
    <WorkShell
      title={view?.name ?? "Opening…"}
      subtitle={view?.clientName ? `for ${view.clientName}` : current?.number}
      url={liveUrl}
      onBack={onBack}
      tabs={tabs}
      tab={tab}
      onTab={(t) => setTab(t as Tab)}
      banner={
        building ? (
          <span className="ws-banner-live">
            <span className="ws-pip" aria-hidden /> Building {view?.versions.find((v) => v.id === view.buildingVersionId)?.number ?? "the next version"} — the
            preview updates itself when it lands.
          </span>
        ) : null
      }
      stage={(device: StageDevice) =>
        liveUrl ? (
          <iframe
            className="ws-site"
            src={liveUrl}
            title={view?.name ?? "The website"}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            style={device === "phone" ? { width: 390 } : undefined}
          />
        ) : (
          <div className="ws-center">
            <div className="ws-empty">
              <h2>{building ? "It's being built" : "No address yet"}</h2>
              <p>
                {building
                  ? "The first version appears here the moment the build reports its address."
                  : "Nothing has been deployed for this one yet. The Build tab shows where it is."}
              </p>
            </div>
          </div>
        )
      }
      panel={
        tab === "chat" ? (
          <div className="cr-list ws-chat">
            {(view?.notices ?? []).map((n) => (
              <article key={n.id} className="ws-msg notice">
                <b>{n.title}</b>
                <p>{n.body}</p>
              </article>
            ))}
            {(view?.requests ?? []).length === 0 && (view?.notices ?? []).length === 0 && (
              <p className="ws-hint">
                Say what should change about this page and it is built from here. The site stays on the right the whole time.
              </p>
            )}
            {(view?.requests ?? []).map((r) => (
              <article key={r.id} className={`ws-msg req ${r.status}`}>
                <p>{r.adminText || r.text}</p>
                <footer>
                  <span className={`ws-dot state-${r.status}`} aria-hidden />
                  {r.status}
                  {r.adminText && r.adminText !== r.text && <em>· reworded</em>}
                </footer>
                {r.adminNote && <p className="ws-msg-note">{r.adminNote}</p>}
              </article>
            ))}
          </div>
        ) : tab === "build" ? (
          <div className="cr-list ws-build">
            <PipelineRail facts={facts} compact />
            {building ? (
              <BuildFeed live={live} number={view?.versions.find((v) => v.id === view.buildingVersionId)?.number ?? ""} since={new Date().toISOString()} owner={owner} />
            ) : (
              <p className="ws-hint">
                {factoryDone
                  ? "Everything is merged and live."
                  : facts.live
                    ? "Live. Ask for a change in Chat and the next version starts from here."
                    : "Nothing is building right now."}
              </p>
            )}
          </div>
        ) : tab === "changes" ? (
          <div className="cr-list ws-changes">
            {work?.files.length ? (
              <>
                <p className="ws-hint">
                  {work.files.length} file{work.files.length === 1 ? "" : "s"} · +{work.added} −{work.removed}
                </p>
                <ul className="ws-files">
                  {work.files.map((f) => (
                    <li key={f.file}>
                      <span className={`ws-file-state s-${f.state.trim().toLowerCase().replace(/[^a-z]/g, "") || "m"}`}>{f.state.trim() || "M"}</span>
                      <code>{f.file}</code>
                    </li>
                  ))}
                </ul>
                {diff && <pre className="ws-diff">{diff.slice(0, 20000)}</pre>}
              </>
            ) : (
              <p className="ws-hint">{threadId ? "Nothing changed yet in this build." : "No build is running, so there is nothing being changed."}</p>
            )}
          </div>
        ) : (
          <div className="cr-list ws-versions">
            {(view?.versions ?? [])
              .slice()
              .reverse()
              .map((v) => (
                <article key={v.id} className={`ws-ver ${v.status}`}>
                  <header>
                    <b>{v.number}</b>
                    <span className={`ws-dot state-${v.status}`} aria-hidden />
                    {v.status}
                  </header>
                  {v.summary && <p>{v.summary}</p>}
                  {v.siteUrl ? (
                    <a href={v.siteUrl} target="_blank" rel="noopener noreferrer">
                      {v.siteUrl}
                    </a>
                  ) : owner && v.status === "building" && live.finish.kind === "publish" ? (
                    <button className="ws-btn small" onClick={() => void markReady(v.id, live.finish.kind === "publish" ? live.finish.url : "")}>
                      Mark ready for the client
                    </button>
                  ) : null}
                </article>
              ))}
          </div>
        )
      }
      panelFoot={
        tab === "build" && building ? (
          <BuildSteer live={live} />
        ) : tab === "chat" ? (
          <div className="ws-compose">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              maxLength={2000}
              placeholder={owner ? "What should change? Sending it starts the build." : "What would you like changed?"}
              aria-label="Ask for a change"
              disabled={sending}
            />
            <div className="ws-compose-bar">
              {note ? <span className="ws-note">{note}</span> : <span className="ws-note faint">{owner ? "Send & build" : "Jarvis reviews it first"}</span>}
              <button className="ws-btn small" onClick={() => void send()} disabled={sending || !text.trim()}>
                {sending ? "Sending…" : owner ? "Send & build" : "Send"}
              </button>
            </div>
            {note.includes("PC") && owner && (
              <button className="ws-btn ghost small" onClick={() => void connectToPc().then(() => setNote("Connected. Press Send & build again."))}>
                Connect to my PC
              </button>
            )}
          </div>
        ) : null
      }
    />
  );
}
