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

import { useEffect, useMemo, useState } from "react";
import { tally } from "@/lib/app-builder/engine";
import { useAppBuilder } from "@/lib/app-builder/useAppBuilder";
import { APP_TYPE_LABEL } from "@/lib/app-builder/types";
import { AgentChat } from "./AgentChat";
import { Blueprint, Pipeline, Recording } from "./Blueprint";
import { FeatureTable } from "./FeatureTable";
import { Orbit } from "./Orbit";
import { IdeaStage, Interview } from "./Stages";
import "./app-builder.css";

type Pane = "features" | "chat" | "blueprint";

const CHAT_CHIPS = ["More ideas like the best ones", "What would make people pay for this?", "What's missing for launch?", "Accept all"];
const EDIT_CHIPS = ["Which of these edits are vague?", "What could these edits break on a phone?"];

export function AppBuilder() {
  const ab = useAppBuilder();
  const { current, busy } = ab;
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
                {p.edit ? ` · ${p.edit.version} client edit` : p.origin === "chat" ? " · from chat" : p.origin === "autopilot" ? " · from camera" : ""}
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
        <Pipeline project={current} />
        {stage === "features" && current && (
          <div className="ab-topbuild">
            <span className="ab-tally">
              <b className="is-yes">{t.accepted}</b> in · <b className="is-open">{t.proposed}</b> open · <b className="is-no">{t.denied}</b> out
            </span>
            <button className="ab-primary-sm" disabled={!t.accepted || busy !== null} onClick={ab.sendToQueue}>
              {busy === "queue" ? "Queuing…" : current.edit ? (current.handoff?.queueId ? "Queue again →" : "Build edits →") : "Build it →"}
            </button>
          </div>
        )}
      </header>

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
            <p className="ab-eyebrow">{current.origin === "autopilot" ? "From Camera Autopilot" : current.origin === "chat" ? "From Jarvis chat" : "Starting"}</p>
            <h2>{busy === "interview" ? (current.sources?.length ? "Watching your recording…" : "Reading your idea…") : name}</h2>
            <p className="ab-lede">{current.idea}</p>
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
                {p === "features" ? `Features ${t.accepted}/${current.features.length}` : p === "chat" ? "Agent" : "Blueprint"}
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
            </section>
            <aside className={`ab-col ab-col-side${pane !== "features" ? " is-pane" : ""}`}>
              <div className="ab-sidetabs" role="tablist" aria-label="Side panel">
                <button role="tab" aria-selected={side === "chat"} onClick={() => setSide("chat")}>
                  Agent
                </button>
                <button role="tab" aria-selected={side === "blueprint"} onClick={() => setSide("blueprint")}>
                  Blueprint & build
                </button>
              </div>
              <div className={`ab-side-chat${side === "chat" ? " is-desk" : ""}${pane === "chat" ? " is-mob" : ""}`}>{chat}</div>
              <div className={`ab-side-blueprint${side === "blueprint" ? " is-desk" : ""}${pane === "blueprint" ? " is-mob" : ""}`}>
                <Blueprint project={current} busy={busy} onQueue={ab.sendToQueue} onCards={ab.sendCards} onRename={ab.rename} />
              </div>
            </aside>
          </div>
        </main>
      )}
    </div>
  );
}
