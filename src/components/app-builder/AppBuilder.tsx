"use client";

// ---------------------------------------------------------------------------
// App Builder — the shell.
//
// Three rooms, one project at a time:
//   1. The idea — type it, or drop a recording of an app or workflow.
//   2. The purpose — the super agent's questions (Felix step 1), with what it
//      took apart from the recording beside them.
//   3. The features — the Orbit (throw features in or out), the dense table,
//      the agent chat, and the blueprint with Build it.
//
// Design skill driving the look: interactive-web-studio (the hub default).
// One signature mechanic — the Orbit — and everything else stays quiet: the
// hub's near-black instrument panel, colour only for state (amber open, green
// accepted, red denied), Syne for the few headlines, JetBrains Mono for ids.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { tally } from "@/lib/app-builder/engine";
import { useAppBuilder } from "@/lib/app-builder/useAppBuilder";
import { APP_TYPE_LABEL, type BuilderProject } from "@/lib/app-builder/types";
import { specFromProject } from "@/lib/mockup/spec";
import { MockupBakeOff } from "@/components/mockup/MockupBakeOff";
import { joinEdits, type EditPick } from "@/lib/mockup/edit";
import type { MockupSpec } from "@/lib/mockup/types";
import { AgentChat } from "./AgentChat";
import { Blueprint, Pipeline, Recording } from "./Blueprint";
import { FeatureTable } from "./FeatureTable";
import { Orbit } from "./Orbit";
import { IdeaStage, Interview } from "./Stages";
import { Waiting } from "./Waiting";
import { BuildStarted } from "./BuildStarted";
import { isNewBuild, phaseLabel } from "@/lib/app-builder/build";
import { reviewHref } from "@/lib/app-builder/review";
import { ModelPicker } from "../new-jarvis/ModelPicker";
import { useChatModel } from "@/lib/new-jarvis/useChatModel";
import "./app-builder.css";

type Pane = "features" | "chat" | "blueprint";

const CHAT_CHIPS = ["More ideas like the best ones", "What would make people pay for this?", "What's missing for launch?", "Accept all"];
const EDIT_CHIPS = ["Which of these edits are vague?", "What could these edits break on a phone?"];

export function AppBuilder() {
  const ab = useAppBuilder();
  const { current, busy } = ab;
  const { model: harnessModel, setModel: setHarnessModel } = useChatModel();
  const [charge, setCharge] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("features");
  const [side, setSide] = useState<"chat" | "blueprint">("chat");

  // Opened inside Jarvis (the chat pulls App Builder up over itself): Jarvis
  // already shows the name and a back button, so drop the duplicate brand.
  useEffect(() => {
    try {
      if (window.self !== window.top) document.documentElement.dataset.abEmbed = "1";
    } catch {
      document.documentElement.dataset.abEmbed = "1";
    }
  }, []);

  useEffect(() => {
    setSelected(null);
    setHover(null);
  }, [current?.id]);

  // One watcher for the whole screen, so the top bar and the build panel can
  // never say different things about the same request.
  // One build per project, read straight off the hook that owns it, so the
  // top bar and the panel can never say different things about it.
  const threadId = current?.handoff?.thread?.id;
  const build = ab.thread;

  // The moment a build is handed off, put the build panel on screen. The
  // status used to live in a side tab the owner wasn't looking at, which is
  // half the reason pressing Build it felt like nothing had happened.
  //
  // `seen` is what tells a NEW build from one that was already running when
  // the page opened: only the former gets the "it's being built" screen, so
  // reopening a project mid-build doesn't greet you with it again.
  // `undefined` means "not looked yet"; null means "looked, and there was no
  // build". The distinction is the whole thing: the common case is a page that
  // opens with NO thread and gains one when Build it is pressed, so a ref that
  // starts at null would read that arrival as "it was already running" and
  // never show the screen. This effect therefore runs on every render of the
  // project, not only when a thread exists.
  // ONE effect watching both, because two of them fought and the pop-up lost.
  //
  // It was a thread effect that recorded what it had seen, plus a project
  // effect that reset that record. Both run on mount, in declaration order,
  // so the reset always landed last: the record went back to "not looked
  // yet", and when the build then started the thread effect read that as a
  // first look and returned. The screen could never appear — not a race, a
  // certainty.
  const seen = useRef<{ project: string | null; thread: string | null } | null>(null);
  const [justStarted, setJustStarted] = useState(false);
  const projectId = current?.id ?? null;
  useEffect(() => {
    const had = seen.current;
    seen.current = { project: projectId, thread: threadId ?? null };
    if (threadId) {
      setSide("blueprint");
      setPane("blueprint");
    }
    if (isNewBuild(had, { project: projectId, thread: threadId ?? null })) setJustStarted(true);
    else if (!had || had.project !== projectId) setJustStarted(false);
  }, [projectId, threadId]);

  // `?idea=` (Website Redesigner › Showcase › Use this idea) means a new app:
  // put the idea stage on screen, which prefills its box from the address.
  const { ready, open } = ab;
  useEffect(() => {
    if (!ready) return;
    try {
      if (new URLSearchParams(window.location.search).get("idea")) open(null);
    } catch {
      /* nothing to read */
    }
  }, [ready, open]);

  const t = tally(current?.features ?? []);
  const stage = current?.stage ?? "idea";
  const name = current?.understanding?.name ?? "New app";
  const ops = ab.apply;

  const orbitProps = useMemo(
    () => ({
      onAccept: (id: string) => ops([{ op: "accept", id }]),
      onDeny: (id: string) => ops([{ op: "deny", id }]),
      onSelect: (id: string) => setSelected((s) => (s === id ? null : id)),
      onHover: setHover,
    }),
    [ops],
  );

  if (!ab.ready) return <div className="ab ab-loading" aria-busy="true" />;

  const chat = (
    <AgentChat
      chat={current?.chat ?? []}
      busy={busy === "chat"}
      onSay={(text, media) => ab.say(text, media)}
      chips={stage === "features" ? (current?.edit ? EDIT_CHIPS : CHAT_CHIPS) : []}
      placeholder={stage === "interview" ? "Tell the agent more, or attach another recording" : undefined}
    />
  );

  return (
    <div className="ab">
      <header className="ab-top">
        <div className="ab-brand">
          <span className="ab-mark" aria-hidden />
          <span className="ab-wordmark">App Builder</span>
        </div>
        <div className="ab-projects">
          <label className="ab-sr" htmlFor="ab-project">
            Project
          </label>
          <select id="ab-project" value={current?.id ?? ""} onChange={(e) => ab.open(e.target.value || null)}>
            <option value="">＋ New app</option>
            {ab.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {(p.understanding?.name ?? p.idea).slice(0, 40)}
                {p.edit ? ` · ${p.edit.version} client edit` : p.origin === "redesign" ? " · redesign" : p.origin === "chat" ? " · from chat" : p.origin === "autopilot" ? " · from camera" : ""}
              </option>
            ))}
          </select>
          {current && (
            <button
              className="ab-icon"
              aria-label="Delete this project"
              title="Delete this project"
              onClick={() => {
                if (window.confirm(`Delete “${name}” from App Builder? This can't be undone.`)) ab.remove(current.id);
              }}
            >
              🗑
            </button>
          )}
        </div>
        <div style={{ marginLeft: "auto" }}>
          <ModelPicker value={harnessModel} onChange={setHarnessModel} />
        </div>
        <Pipeline project={current} />
        {stage === "features" && current && (
          <div className="ab-topbuild">
            <span className="ab-tally">
              <b className="is-yes">{t.accepted}</b> in · <b className="is-open">{t.proposed}</b> open · <b className="is-no">{t.denied}</b> out
            </span>
            {/* Once it is handed off this stops being a button that can be
                pressed twice and becomes the way back to the live status. */}
            {threadId ? (
              <button
                className={`ab-queued is-${build.phase}`}
                title="Show where this build is"
                onClick={() => {
                  setSide("blueprint");
                  setPane("blueprint");
                }}
              >
                <span className="ab-queued-dot" aria-hidden />
                {phaseLabel(build.phase, build.summary)}
              </button>
            ) : (
              <button className="ab-primary-sm" disabled={!t.accepted || busy !== null} onClick={() => ab.build()}>
                {busy === "build" ? "Starting…" : current.edit ? "Build edits →" : "Build it →"}
              </button>
            )}
          </div>
        )}
      </header>

      {justStarted && current && (
        <BuildStarted
          project={current}
          onWatch={() => {
            const review = current.handoff?.review;
            if (!review) {
              // No review link (the owner unchecked it): the build panel is
              // the only place this one can be watched.
              setJustStarted(false);
              return;
            }
            const href = `${reviewHref(review.token)}&watch=1`;
            // App Builder can be running inside Jarvis's sheet. "Watch it
            // build" means the app's own page, not the sheet inside the app
            // that started it — top-level when we are framed.
            try {
              if (window.top && window.top !== window) window.top.location.assign(href);
              else window.location.assign(href);
            } catch {
              window.location.assign(href);
            }
          }}
          onHome={() => {
            setJustStarted(false);
            ab.open(null);
          }}
        />
      )}

      {(ab.error || ab.notice) && (
        <div className={`ab-banner${ab.error ? " is-error" : ""}`} role={ab.error ? "alert" : "status"}>
          <span>{ab.error ?? ab.notice}</span>
          <button aria-label="Dismiss" onClick={ab.error ? ab.clearError : ab.clearNotice}>
            ✕
          </button>
        </div>
      )}

      {/* ----- 1. the idea --------------------------------------------------- */}
      {(!current || (stage === "idea" && !current.pending && busy !== "interview")) && (
        <main className="ab-stage ab-stage-idea">
          <div className="ab-backdrop" aria-hidden>
            <Orbit features={[]} name={name} charge={charge} ambient />
          </div>
          <IdeaStage busy={busy === "interview"} onType={(n) => setCharge(Math.min(1, n / 220))} onStart={(idea, media) => ab.start(idea, media)} />
        </main>
      )}

      {/* ----- waking up: a hand-off from Jarvis chat, or the first call ------ */}
      {current && stage === "idea" && (current.pending || busy === "interview") && (
        <main className="ab-stage ab-stage-idea">
          <div className="ab-backdrop" aria-hidden>
            <Orbit features={[]} name={name} charge={0.6} ambient />
          </div>
          <div className="ab-waking">
            <p className="ab-eyebrow">
              {current.origin === "redesign"
                ? "From Website Redesigner"
                : current.origin === "autopilot"
                  ? "From Camera Autopilot"
                  : current.origin === "chat"
                    ? "From Jarvis chat"
                    : "Starting"}
            </p>
            <h2>
              {busy === "interview"
                ? current.redesign
                  ? `Reading ${current.redesign.title}…`
                  : current.sources?.length
                    ? "Watching your recording…"
                    : "Reading your idea…"
                : name}
            </h2>
            <p className="ab-lede">{current.idea}</p>
            {busy === "interview" && (
              <Waiting
                what={
                  current.redesign
                    ? "Taking the site apart, then asking what the redesign is for"
                    : current.sources?.length
                      ? "Watching every frame, then asking what the app is for"
                      : "Reading it, then asking what the app is for"
                }
                note={current.sources?.length ? "A recording takes longer than words — usually 20–60 seconds." : undefined}
              />
            )}
            {busy !== "interview" && (
              <button className="ab-primary" onClick={ab.resume}>
                Start the super agent <span aria-hidden>→</span>
              </button>
            )}
          </div>
        </main>
      )}

      {/* ----- 2. the purpose ------------------------------------------------ */}
      {current && stage === "interview" && (
        <main className="ab-stage ab-stage-interview">
          <div className="ab-backdrop" aria-hidden>
            <Orbit features={[]} name={name} charge={0.4} ambient />
          </div>
          <div className="ab-interview-grid">
            <div className="ab-col">
              {(current.teardown || current.sources?.length) && <Recording project={current} />}
              <Interview
                questions={current.questions}
                answers={current.answers}
                busy={busy === "features"}
                onAnswer={ab.setAnswer}
                onDesign={(g) => ab.design(g)}
              />
            </div>
            <aside className="ab-col ab-col-side">{chat}</aside>
          </div>
        </main>
      )}

      {/* ----- 3. the features ------------------------------------------------ */}
      {current && stage === "features" && current.understanding && (
        <main className="ab-stage ab-stage-features">
          <nav className="ab-panes" aria-label="Sections">
            {(["features", "chat", "blueprint"] as Pane[]).map((p) => (
              <button key={p} aria-pressed={pane === p} onClick={() => setPane(p)}>
                {p === "features" ? `Features ${t.accepted}/${current.features.length}` : p === "chat" ? "Agent" : threadId ? "Build ·" : "Build"}
              </button>
            ))}
          </nav>
          <div className="ab-work">
            <section className={`ab-col ab-col-main${pane === "features" ? " is-pane" : ""}`}>
              <div className="ab-orbit-wrap">
                <div className="ab-orbit-label">
                  <span>{current.edit ? `Client edits · ${current.edit.version}` : APP_TYPE_LABEL[current.understanding.appType]}</span>
                  <span className="ab-orbit-hint">Drag a feature into the core to accept · fling it out to deny · tap to see it</span>
                </div>
                <Orbit features={current.features} name={name} selectedId={selected} hoverId={hover} {...orbitProps} />
              </div>
              <FeatureTable
                features={current.features}
                selectedId={selected}
                hoverId={hover}
                onSelect={setSelected}
                onHover={setHover}
                onOps={ab.apply}
              />
              {/*
                The look, under the features it is drawn from. This is the
                stage the pipeline always had on paper and never on screen:
                the owner approved a feature list and then waited for a built
                app to find out what it looked like. Three drawings and a
                choice close that hole, and the choice reaches the brief.
              */}
              <LookSection project={current} onChoose={ab.chooseLook} />
            </section>
            <aside className={`ab-col ab-col-side${pane !== "features" ? " is-pane" : ""}`}>
              <div className="ab-sidetabs" role="tablist" aria-label="Side panel">
                <button role="tab" aria-selected={side === "chat"} onClick={() => setSide("chat")}>
                  Agent
                </button>
                <button role="tab" aria-selected={side === "blueprint"} onClick={() => setSide("blueprint")}>
                  {threadId ? `Build · ${phaseLabel(build.phase, build.summary).toLowerCase()}` : "Blueprint & build"}
                </button>
              </div>
              <div className={`ab-side-chat${side === "chat" ? " is-desk" : ""}${pane === "chat" ? " is-mob" : ""}`}>{chat}</div>
              <div className={`ab-side-blueprint${side === "blueprint" ? " is-desk" : ""}${pane === "blueprint" ? " is-mob" : ""}`}>
                <Blueprint
                  project={current}
                  busy={busy}
                  step={ab.step}
                  build={build}
                  bridge={ab.bridge}
                  onBridgeRefresh={ab.refreshBridge}
                  moving={ab.moving}
                  onBuild={ab.build}
                  onMove={ab.absorb}
                  onRetire={ab.retire}
                  onFileForLater={ab.fileForLater}
                  onStop={ab.thread.stop}
                  onCards={ab.sendCards}
                  onRename={ab.rename}
                  onDepth={ab.setDepth}
                  onNoReview={ab.setNoReview}
                />
              </div>
            </aside>
          </div>
        </main>
      )}
    </div>
  );
}

/**
 * The look pass, drawn from whatever is on the feature list right now.
 *
 * The spec is memoised on the pieces that actually change the drawing — the
 * features, the understanding and a picked direction — rather than on the
 * project object, which gets a new `updatedAt` on every keystroke elsewhere
 * and would otherwise redraw three iframes while the owner types in the chat.
 */
function LookSection({
  project,
  onChoose,
}: {
  project: BuilderProject;
  onChoose: (skill: string, pick?: EditPick) => void;
}) {
  const spec = useMemo(
    () => specFromProject(project),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.features, project.understanding, project.teardown, project.idea],
  );

  // A client edit changes a site that already has a look, so there is no look
  // to choose — but there IS a question to answer before the build: "is this
  // what the client meant?". So an edit gets the edit bake-off: the approved
  // edits, painted three ways onto a screenshot of the page the client is on.
  if (project.edit) return <EditLookSection project={project} spec={spec} onChoose={onChoose} />;

  const accepted = project.features.some((f) => f.status === "accepted");
  return (
    <section id="ab-look" className="ab-look" aria-label="Pick the look">
      <p className={`ab-look-step${project.look ? " is-done" : ""}`}>
        <b>{project.look ? "✓ Look picked" : "Next · pick the look"}</b>
        <span>features → mockups → depth → build on your PC → Client Review</span>
      </p>
      {!accepted && <p className="ab-look-wait">These draw from the whole list for now. Accept features and they redraw from yours — Flux 2 paints them once you have.</p>}
      {
        <MockupBakeOff
          spec={spec}
          // Painting costs a GPU minute per lane; wait until the list means something.
          pictures={accepted}
          // A skill the owner pinned in the Redesigner leads lane 1.
          recommended={project.redesign?.skills?.[0] ?? project.understanding?.designSkill}
          chosen={project.look ?? null}
          onChoose={onChoose}
          chooseLabel={project.redesign ? "Redesign it like this" : "Build this look"}
          caption={
            project.look
              ? `The build is held to ${project.look.skill}. Pick another to change it.`
              : project.redesign
                ? `${project.redesign.title}, redrawn three ways with its own words and links. Pick one and the build is held to it.`
                : "Drawn from the features you accepted. Pick one and the build brief is held to it."
          }
        />
      }
    </section>
  );
}

/** The edit bake-off for a client edit: the approved edits, painted onto the live page. */
export function EditLookSection({
  project,
  spec,
  onChoose,
}: {
  project: BuilderProject;
  spec: MockupSpec;
  onChoose: (skill: string, pick?: EditPick) => void;
}) {
  const edit = project.edit!;
  // The edits as they will be built: the owner's accepted wording, else the
  // client's own words. Joined into one request, because three readings of
  // the WHOLE batch is the question; a lane per edit would be a different one.
  const text = useMemo(() => {
    const accepted = project.features.filter((f) => f.status === "accepted");
    const lines = accepted.length
      ? accepted.map((f) => edit.items.find((it) => it.featureId === f.id)?.text || f.detail || f.title)
      : edit.items.map((it) => it.text);
    return joinEdits(lines);
  }, [project.features, edit.items]);

  const siteSpec = useMemo(() => ({ ...spec, name: edit.siteName || spec.name }), [spec, edit.siteName]);

  if (!text) return null;
  return (
    <section id="ab-look" className="ab-look" aria-label="Check the change">
      <p className={`ab-look-step${project.look?.edit ? " is-done" : ""}`}>
        <b>{project.look?.edit ? "✓ Version picked" : "Next · check the change"}</b>
        <span>edits → mockups on the live page → build on your PC → Client Review</span>
      </p>
      <MockupBakeOff
        // The site's own name, as Client Review and the Redesigner use it: it
        // is part of the Flux prompt, so the same name means the same pictures.
        spec={siteSpec}
        recommended={project.understanding?.designSkill}
        chosen={project.look ?? null}
        onChoose={onChoose}
        chooseLabel="Build this version"
        edit={text}
        reference={{ url: edit.fromUrl || undefined }}
        caption={
          project.look?.edit
            ? `The build is held to "${project.look.edit.label}". Pick another, or tweak one, to change it.`
            : `${edit.siteName}'s live page with the approved edits painted on, three ways. Pick the one that matches what ${edit.clientName || "the client"} meant.`
        }
      />
    </section>
  );
}
