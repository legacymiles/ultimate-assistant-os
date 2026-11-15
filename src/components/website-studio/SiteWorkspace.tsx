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
//
// But only on the full road. An edit takes the quick lane by default (see
// src/lib/website-studio/lane.ts): change it, typecheck, merge — and no
// Software Factory afterwards, which used to run after EVERY edit. The switch
// in the side panel puts an edit on the full road when it is really a feature.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { admin, portal, ApiError } from "@/lib/client-review/client";
import { approveAndStart, connectToPc, undoTo } from "@/lib/client-review/buildHere";
import { blockerAdvice, type Blocker } from "@/lib/client-review/liveBuild";
import type { EditLaneId, EditPick } from "@/lib/mockup/edit";
import type { ClientProject, PortalView } from "@/lib/client-review/types";
import { call, probe, type BridgeHealth } from "@/lib/new-jarvis/bridge";
import { useChatModel } from "@/lib/new-jarvis/useChatModel";
import type { WorkSummary } from "@/lib/new-jarvis/harness/types";
import { canPaintEdit, needsLookPass } from "@/lib/website-studio/edits";
import { editChecklist, laneFor, laneOf, wantsFactory } from "@/lib/website-studio/lane";
import { shotFor, undoPlan } from "@/lib/website-studio/undo";
import { coerceIdeas, decide, foldIdeas, type EditIdea } from "@/lib/website-studio/ideas";
import { FACTORY_DONE, factoryBrief, type StageFacts } from "@/lib/website-studio/pipeline";
import { BuildFeed, BuildSteer, useLiveBuild } from "../client-review/LiveBuild";
import { LookPass } from "../client-review/LookPass";
import { ModelPicker } from "../new-jarvis/ModelPicker";
import { DesignSlash } from "./DesignSlash";
import { EditChecklist } from "./EditChecklist";
import { EditIdeas } from "./EditIdeas";
import { PipelineRail } from "./PipelineRail";
import { ShipPanel } from "./ShipPanel";
import { WorkShell, type StageDevice, type WorkTab } from "./WorkShell";
import "../client-review/client-review.css";

interface Props {
  token: string;
  owner: boolean;
  onBack: () => void;
  /** The library's data is stale once something lands here. */
  onChanged?: () => void;
}

type Tab = "chat" | "look" | "build" | "changes" | "versions" | "ship";

export function SiteWorkspace({ token, owner, onBack, onChanged }: Props) {
  const { model: harnessModel, setModel: setHarnessModel } = useChatModel();
  const [view, setView] = useState<PortalView | null>(null);
  const [project, setProject] = useState<ClientProject | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("chat");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState("");
  /** Set when the last attempt was stopped by something a press can fix. */
  const [blocker, setBlocker] = useState<Blocker | null>(null);
  const [work, setWork] = useState<WorkSummary | null>(null);
  /** The PC helper, as it is right now. Owner only — a client never builds. */
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [diff, setDiff] = useState("");
  const alive = useRef(true);
  /** The site's frame, so its page can be photographed before and after an edit. */
  const frameRef = useRef<HTMLIFrameElement>(null);
  /** Bumped on every frame load; the after-picture waits for a fresh one. */
  const [frameLoads, setFrameLoads] = useState(0);
  const capturedFor = useRef("");
  const [undoing, setUndoing] = useState("");
  /** Ideas that go with the edit just sent: App Builder's accept-or-deny list, for an edit. */
  const [ideas, setIdeas] = useState<{ requestId: string; text: string; items: EditIdea[]; loading: boolean; note?: string } | null>(null);
  const [ideasBusy, setIdeasBusy] = useState(false);

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
  /**
   * The version an edit is written against.
   *
   * Not optional, and not left to the server to guess: `addRequest` and
   * `sendToJarvis` both resolve a version by id and refuse without one, which
   * is what made Send look like it did nothing at all.
   */
  const askVersionId = view?.currentVersionId ?? view?.versions.at(-1)?.id ?? null;
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

  // A quick edit never gets the factory follow-up; the thread says which lane it is.
  const buildLane = laneOf(live.build.view);
  const factoryWanted = wantsFactory(live.build.view);

  useEffect(() => {
    if (!owner || !live.watching || !factoryWanted || factoryStarted || factoryDone || sentFactory.current) return;
    if (!liveUrl || live.finish.kind === "running") return;
    sentFactory.current = true;
    void live.build
      .say(factoryBrief({ name: view?.name ?? "The site", liveUrl, repo: project?.repo }))
      .catch(() => {
        sentFactory.current = false;
      });
  }, [owner, live.watching, live.finish.kind, live.build, factoryWanted, factoryStarted, factoryDone, liveUrl, view?.name, project?.repo]);

  // ----- Software Factory: off for an edit, one switch to put it on --------------------
  //
  // Remembered per website on this device. Off is the default because this
  // screen is where a live site is EDITED; a new website gets the factory from
  // its own first build, which is not started from here.
  const factoryKey = `website-studio:factory:${token}`;
  const [factory, setFactoryState] = useState(false);
  useEffect(() => {
    try {
      setFactoryState(window.localStorage.getItem(factoryKey) === "1");
    } catch {
      setFactoryState(false);
    }
  }, [factoryKey]);
  const setFactory = useCallback(
    (on: boolean) => {
      setFactoryState(on);
      try {
        window.localStorage.setItem(factoryKey, on ? "1" : "0");
      } catch {
        // Private window: the switch still works for this visit.
      }
    },
    [factoryKey],
  );

  // ----- is the harness there? --------------------------------------------------------
  //
  // Asked on open and kept fresh, rather than only discovered by a failed
  // build. The owner pressed Send and nothing visible happened; the honest
  // fix is to say the PC is unreachable BEFORE the press, every time.
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    const read = () =>
      probe()
        .then((h) => alive && setHealth(h))
        .catch(() => alive && setHealth(null));
    void read();
    const id = window.setInterval(() => document.visibilityState === "visible" && void read(), 20_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [owner]);

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
  //
  // Two steps, not one, because of the owner's standing rule (Nov 2026): an
  // edit to a page that exists is painted three ways onto that page before
  // anything is built, and the pick is what starts the build. Send files the
  // request and opens the look pass; the pick runs the build. A site with no
  // address yet has nothing to paint onto, so it builds the way it always did.

  /**
   * The page as it looks right now. The owner's hub apps are framed
   * same-origin, so the frame's own document can be drawn; a client's site on
   * another domain cannot be read, which just means no picture.
   */
  const captureFrame = useCallback(async (): Promise<string> => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement) return "";
    try {
      const html2canvas = (await import("html2canvas-pro")).default;
      const canvas = await html2canvas(doc.documentElement, {
        backgroundColor: "#0a0b0f",
        scale: 0.5,
        useCORS: true,
        logging: false,
        windowWidth: doc.documentElement.clientWidth,
        windowHeight: doc.documentElement.clientHeight,
      });
      return canvas.toDataURL("image/jpeg", 0.72);
    } catch {
      return "";
    }
  }, []);

  /** Approve what is waiting and start Claude Code on the PC. */
  const startBuild = useCallback(async () => {
    if (!view) return;
    // The before picture: what Versions shows beside Undo.
    const before = await captureFrame();
    const out = await approveAndStart(token, askVersionId ?? undefined, before || undefined, laneFor(factory));
    setNote(out.message);
    setBlocker(out.blocker ?? null);
    if (out.state === "working") {
      // The chat panel shows the checklist while it works, so the owner stays
      // where they typed the edit.
      setTab("chat");
      await load();
      onChanged?.();
    }
  }, [view, token, askVersionId, load, onChanged, factory, captureFrame]);

  /**
   * A few ideas that belong with the edit just sent, fetched beside it — the
   * edit is already filed and the look pass is painting, so nothing waits.
   */
  const loadIdeas = useCallback(
    async (requestId: string, edit: string) => {
      setIdeas({ requestId, text: edit, items: [], loading: true });
      let items: EditIdea[] = [];
      let notice = "";
      try {
        const res = await fetch("/api/app-builder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "editIdeas", idea: edit, site: `${view?.name ?? "This website"} — ${liveUrl || "not deployed yet"}` }),
        });
        const json = (await res.json().catch(() => ({}))) as { ideas?: unknown; notice?: string };
        items = coerceIdeas(json.ideas);
        notice = json.notice ?? "";
      } catch {
        notice = "Couldn't reach the idea writer just now — your edit is unaffected.";
      }
      if (!alive.current) return;
      setIdeas((cur) => (cur?.requestId === requestId ? { ...cur, items, loading: false, note: notice || undefined } : cur));
    },
    [view?.name, liveUrl],
  );

  /** Add or skip one idea. Before the build starts, the request's wording is what changes. */
  const decideIdea = useCallback(
    async (id: string, choice: "accepted" | "denied") => {
      if (!ideas || !view) return;
      const items = decide(ideas.items, id, choice);
      setIdeas({ ...ideas, items });
      if (building) return; // too late for this pass: "Send as the next edit" carries them
      setIdeasBusy(true);
      try {
        await admin.act({ action: "review", id: view.projectId, requestId: ideas.requestId, adminText: foldIdeas(ideas.text, items) });
        void load();
      } catch (e) {
        setIdeas((cur) => (cur ? { ...cur, note: e instanceof Error ? e.message : "That didn't save." } : cur));
      } finally {
        setIdeasBusy(false);
      }
    },
    [ideas, view, building, load],
  );

  /** The build already started: the accepted ideas go in as one more edit. */
  const sendIdeasLate = useCallback(async () => {
    if (!ideas || !askVersionId) return;
    const yes = ideas.items.filter((i) => i.status === "accepted");
    if (!yes.length) return;
    setIdeasBusy(true);
    try {
      const body = [`Following "${ideas.text.slice(0, 120)}":`, ...yes.map((i) => `- ${i.title}: ${i.detail}`)].join("\n");
      await portal.act(token, { action: "add", versionId: askVersionId, text: body });
      setView(await portal.act(token, { action: "send", versionId: askVersionId }));
      setIdeas(null);
      setNote("Filed as the next edit. Build it when this one lands.");
    } catch (e) {
      setIdeas((cur) => (cur ? { ...cur, note: e instanceof Error ? e.message : "That didn't go through." } : cur));
    } finally {
      setIdeasBusy(false);
    }
  }, [ideas, askVersionId, token]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || sending || !view) return;
    setSending(true);
    setNote("");
    setBlocker(null);
    if (!askVersionId) {
      setNote("There is no version to ask against yet — the first one has to be built first.");
      setSending(false);
      return;
    }
    try {
      await portal.act(token, { action: "add", versionId: askVersionId, text: body });
      const sentView = await portal.act(token, { action: "send", versionId: askVersionId });
      setView(sentView);
      setText("");
      if (owner) {
        const filed = sentView.requests.filter((r) => r.text === body).at(-1);
        if (filed) void loadIdeas(filed.id, body);
      }
      if (!owner) {
        setNote("Sent. Jarvis has it — you'll hear when it's approved and when the new version is ready.");
        return;
      }
      if (canPaintEdit({ liveUrl, building }, owner)) {
        setTab("look");
        setNote("Painting three readings of that edit onto the page. Pick one and the build starts.");
        return;
      }
      await startBuild();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [text, sending, view, token, owner, liveUrl, building, askVersionId, startBuild, loadIdeas]);

  /** Anything that runs a build from a press: one place for busy and the note. */
  const run = useCallback(
    async (job: () => Promise<void>) => {
      if (sending) return;
      setSending(true);
      setNote("");
      setBlocker(null);
      try {
        await job();
      } catch (e) {
        setNote(e instanceof Error ? e.message : String(e));
      } finally {
        setSending(false);
      }
    },
    [sending],
  );

  /** The look pass picked one: save it on the project, then build that. */
  const pickLook = useCallback(
    (skill: string, pick?: EditPick) =>
      run(async () => {
        setView(await portal.act(token, { action: "look", skill, ...(pick ? { edit: pick } : {}) }));
        await startBuild();
      }),
    [run, token, startBuild],
  );

  /** Owner only: keep the three paintings on the project so the client sees them too. */
  const saveMockups = useCallback(
    async (edit: string, lanes: { lane: EditLaneId; image: string; label: string; instruction: string }[]) => {
      try {
        setView(await portal.act(token, { action: "mockups", edit, lanes }));
      } catch {
        // A nicety for the client's link. A build never waits on it.
      }
    },
    [token],
  );

  // Once a version has landed and the frame has reloaded on it, keep what it
  // actually looks like — the picture Versions shows for it from then on.
  useEffect(() => {
    if (!owner || building || !current?.siteUrl || current.image || !view?.projectId || !frameLoads) return;
    if (capturedFor.current === current.id) return;
    const versionId = current.id;
    const projectId = view.projectId;
    const t = window.setTimeout(async () => {
      capturedFor.current = versionId;
      const image = await captureFrame();
      if (!image) return;
      await admin.act({ action: "image", id: projectId, versionId, image }).catch(() => null);
      void load();
    }, 4000);
    return () => window.clearTimeout(t);
  }, [owner, building, current?.id, current?.image, current?.siteUrl, view?.projectId, frameLoads, captureFrame, load]);

  /** Back to an earlier version: its code back on main, and on the client's link. */
  const undoVersion = useCallback(
    async (versionId: string) => {
      if (!project) return;
      const plan = undoPlan(project.versions, versionId);
      if (!plan) return;
      if (plan.blocked) {
        setNote(plan.blocked);
        return;
      }
      if (!window.confirm(plan.says)) return;
      setUndoing(versionId);
      setNote("");
      try {
        const out = await undoTo(project, versionId);
        setNote(out.message);
        await load();
        onChanged?.();
      } finally {
        setUndoing("");
      }
    },
    [project, load, onChanged],
  );

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

  /** What the owner watches while Claude works: its own task list, or the lane's steps. */
  const checklist = useMemo(
    () =>
      live.watching
        ? editChecklist(live.build.view, buildLane, {
            live: live.finish.kind === "publish" && !building,
            running: building && live.finish.kind === "running",
          })
        : [],
    [live.watching, live.build.view, live.finish.kind, buildLane, building],
  );
  const checklistTitle = buildLane === "quick" ? "Quick edit" : "Full build";

  /** Answering, and holding a token this browser has. */
  const pcReady = Boolean(health?.up && health?.paired);
  const waiting = view?.pending ?? 0;
  const changed = work?.files.length ?? 0;
  const canPaint = needsLookPass({ liveUrl, building, requests: view?.requests ?? [] }, owner);
  const tabs: WorkTab[] = [
    { id: "chat", label: "Chat", count: waiting },
    ...(canPaint ? [{ id: "look", label: "Look" }] : []),
    { id: "build", label: "Build", live: building },
    ...(owner ? [{ id: "changes", label: "Changes", count: changed }] : []),
    { id: "versions", label: "Versions", count: view?.versions.length ?? 0 },
    ...(owner && project ? [{ id: "ship", label: "Ship" }] : []),
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
        tab === "look" && view && canPaint ? (
          <div className="ws-canvas-pad">
            <LookPass
              view={view}
              busy={sending ? "look" : ""}
              onPick={pickLook}
              onSaveMockups={saveMockups}
            />
          </div>
        ) : liveUrl ? (
          <iframe
            ref={frameRef}
            onLoad={() => setFrameLoads((n) => n + 1)}
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
        tab === "chat" || tab === "look" ? (
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
            {owner && ideas && (
              <EditIdeas
                items={ideas.items}
                loading={ideas.loading}
                late={building}
                note={ideas.note}
                busy={ideasBusy}
                onDecide={(id, choice) => void decideIdea(id, choice)}
                onSendLate={() => void sendIdeasLate()}
              />
            )}
            {owner && building && checklist.length > 0 && <EditChecklist items={checklist} title={checklistTitle} compact />}
          </div>
        ) : tab === "build" ? (
          <div className="cr-list ws-build">
            {checklist.length > 0 ? <EditChecklist items={checklist} title={checklistTitle} /> : <PipelineRail facts={facts} compact />}
            {owner && health && (
              <p className={`ws-note ${pcReady ? "faint" : "warn"}`}>
                {pcReady
                  ? "Your PC is connected — Claude Code runs these builds on it."
                  : health.problem || "Your PC isn't connected, so a build can't start from here."}
              </p>
            )}
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
        ) : tab === "ship" && owner && project ? (
          <ShipPanel project={project} liveUrl={liveUrl} onChanged={() => void load()} onDeleted={() => {
            onChanged?.();
            onBack();
          }} />
        ) : (
          <div className="cr-list ws-versions">
            <p className="ws-hint">
              Each version as it looked when it landed.{owner ? " Undo puts that one back — its code on main and on your client's link." : ""}
            </p>
            {owner && note && <p className="ws-notice">{note}</p>}
            {(view?.versions ?? [])
              .slice()
              .reverse()
              .map((v) => {
                const shot = shotFor(view?.versions ?? [], v);
                const showing = v.id === view?.currentVersionId;
                return (
                  <article key={v.id} className={`ws-ver ${v.status}${showing ? " showing" : ""}`}>
                    {shot ? (
                      <img className="ws-ver-shot" src={shot} alt={`${v.number} as it looked`} loading="lazy" />
                    ) : (
                      <div className="ws-ver-shot blank" aria-hidden>
                        No picture yet
                      </div>
                    )}
                    <header>
                      <b>{v.number}</b>
                      <span className={`ws-dot state-${v.status}`} aria-hidden />
                      {showing ? "showing now" : v.status}
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
                    {owner && !showing && v.siteUrl && v.status !== "building" && (
                      <button className="ws-btn ghost small ws-undo" disabled={Boolean(undoing) || building} onClick={() => void undoVersion(v.id)}>
                        {undoing === v.id ? "Going back…" : `Undo to ${v.number}`}
                      </button>
                    )}
                  </article>
                );
              })}
          </div>
        )
      }
      panelFoot={
        tab === "build" && building ? (
          <BuildSteer live={live} />
        ) : tab === "chat" || tab === "look" ? (
          <div className="ws-compose">
            <div className="ws-compose-box">
              {/* `/` lists the owner's website design skills — the design
                  roster, nothing else — and writes the one picked into the edit
                  as a sentence the build agent acts on. */}
              {owner && <DesignSlash text={text} onText={setText} />}
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
                placeholder={
                  owner
                    ? "What should change? Press / for a skill. Sending paints it three ways first."
                    : "What would you like changed?"
                }
                aria-label="Ask for a change"
                disabled={sending}
              />
            </div>
            {owner && (
              <div className="ws-compose-tools">
                {/* The model that builds the edit, where the edit is typed. */}
                <ModelPicker value={harnessModel} onChange={setHarnessModel} up />
                <label className="ws-factory" title="Off: a quick edit — change, typecheck, merge, live in minutes. On: the full road, then Software Factory deepens the backend after it is live.">
                  <input type="checkbox" checked={factory} onChange={(e) => setFactory(e.target.checked)} />
                  Software Factory <em>{factory ? "· full build" : "· off for edits"}</em>
                </label>
              </div>
            )}
            <div className="ws-compose-bar">
              {note ? (
                <span className={`ws-note${blocker ? " warn" : ""}`}>{note}</span>
              ) : (
                <span className="ws-note faint">{owner ? "Send, pick a look, and it builds" : "Jarvis reviews it first"}</span>
              )}
              <button className="ws-btn small" onClick={() => void send()} disabled={sending || !text.trim()}>
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
            {/* Said before the press, not only after a failed one. */}
            {owner && health && !pcReady && !note && (
              <p className="ws-note warn">{health.problem || "Your PC isn't connected, so a build can't start from here yet."}</p>
            )}
            {/* Named by the blocker the attempt actually came back with, or by
                the helper being unreachable: a press that can fix it is
                offered, and one that cannot is not pretended. */}
            {owner && (blocker ? blockerAdvice(blocker).canConnect : Boolean(health) && !pcReady) && (
              <button
                className="ws-btn ghost small"
                onClick={() =>
                  void connectToPc().then((still) => {
                    setBlocker(still);
                    setNote(still ? blockerAdvice(still).text : "Connected to your PC. Press Send again.");
                  })
                }
              >
                Connect to my PC
              </button>
            )}
            {owner && canPaint && (
              <button
                className="ws-btn ghost small"
                disabled={sending}
                onClick={() => void run(() => startBuild())}
              >
                Skip the mockups and build it as asked
              </button>
            )}
          </div>
        ) : null
      }
    />
  );
}
