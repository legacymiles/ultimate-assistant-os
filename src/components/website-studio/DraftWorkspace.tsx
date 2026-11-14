"use client";

// ---------------------------------------------------------------------------
// The workspace, on a website that does not exist yet.
//
// Same shell as a live site — the canvas on the right, the conversation on the
// left — except the canvas has nothing deployed to show, so it shows the thing
// that is true at this moment instead: the questions, then the main design,
// then the supporting pages as a prototype you can walk, then the build, and
// finally the site itself.
//
// Everything underneath is App Builder's, unchanged: the same project in the
// same synced store, so a draft started here opens at /apps/app-builder?p=<id>
// and a project Jarvis chat handed over opens here. Consolidation moved the
// screen, not the data.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppBuilder } from "@/lib/app-builder/useAppBuilder";
import { specFromProject } from "@/lib/mockup/spec";
import { approve, draftFlows, type FlowPlan } from "@/lib/website-studio/flows";
import { combine, studioSkills } from "@/lib/website-studio/skills";
import type { StageFacts } from "@/lib/website-studio/pipeline";
import { FeatureTable } from "../app-builder/FeatureTable";
import { MockupBakeOff } from "../mockup/MockupBakeOff";
import "../app-builder/app-builder.css";
import { BuildFeed, BuildSteer } from "../client-review/LiveBuild";
import { FlowStudio } from "./FlowStudio";
import { PipelineRail } from "./PipelineRail";
import { SkillsMenu } from "./SkillsMenu";
import { WorkShell, type StageDevice, type WorkTab } from "./WorkShell";
import "../client-review/client-review.css";

interface Props {
  draftId: string;
  onBack: () => void;
  onChanged?: () => void;
}

type Tab = "chat" | "plan" | "pages" | "build";

export function DraftWorkspace({ draftId, onBack, onChanged }: Props) {
  const ab = useAppBuilder();
  const [tab, setTab] = useState<Tab>("chat");
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<FlowPlan | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const p = ab.current;

  // Open the one asked for. App Builder keeps the current project in its own
  // store, so this is the same "open" a link into App Builder does.
  useEffect(() => {
    if (ab.ready && ab.current?.id !== draftId && ab.projects.some((x) => x.id === draftId)) ab.open(draftId);
  }, [ab, draftId]);

  useEffect(() => {
    if (p?.flows) setPlan(p.flows);
  }, [p?.flows]);

  const accepted = useMemo(() => (p?.features ?? []).filter((f) => f.status === "accepted"), [p?.features]);
  const look = p?.look?.skill ?? p?.understanding?.designSkill ?? "";
  const built = p?.handoff?.built;

  // Stage two is written the moment there is a look and a feature list, with
  // no model and no PC — the owner can reach it offline (checklist R4).
  const makePlan = useCallback(() => {
    if (!p?.understanding || !accepted.length || !look) return;
    const next = draftFlows(p.understanding, p.features, look);
    setPlan(next);
  }, [p, accepted.length, look]);

  useEffect(() => {
    if (!plan && look && accepted.length && p?.understanding) makePlan();
  }, [plan, look, accepted.length, p?.understanding, makePlan]);

  const savePlan = useCallback(
    (next: FlowPlan) => {
      setPlan(next);
      // Kept on the project, in the synced store, because the build brief
      // reads it later — a plan that lived in this component would be gone
      // the moment the tab closed.
      if (p) ab.setFlows(next);
    },
    [ab, p],
  );

  const facts: StageFacts = {
    understood: Boolean(p?.understanding),
    planned: accepted.length > 0,
    lookPicked: Boolean(p?.look),
    flowsApproved: Boolean(plan?.approvedAt),
    buildStarted: Boolean(p?.handoff?.thread || p?.handoff?.queueId),
    live: Boolean(built?.url),
    factoryStarted: false,
    factoryDone: false,
    plain: p?.depth === "plain",
  };

  const stage: "ask" | "look" | "pages" | "build" | "live" = built?.url
    ? "live"
    : p?.handoff?.thread
      ? "build"
      : !p?.understanding || !accepted.length
        ? "ask"
        : !p.look
          ? "look"
          : "pages";

  // The panel follows the work: there is exactly one thing to do at a time,
  // and the owner should not have to find which tab it is on.
  useEffect(() => {
    if (stage === "ask" && p?.understanding) setTab("plan");
    if (stage === "look") setTab("plan");
    if (stage === "pages") setTab("pages");
    if (stage === "build" || stage === "live") setTab("build");
  }, [stage, p?.understanding]);

  const tabs: WorkTab[] = [
    { id: "chat", label: "Chat" },
    { id: "plan", label: "Features", count: accepted.length },
    { id: "pages", label: "Pages", count: plan?.screens.length ?? 0 },
    { id: "build", label: "Build", live: Boolean(p?.handoff?.thread && !built?.url) },
  ];

  if (!ab.ready) {
    return (
      <div className="ws-center">
        <span className="ws-spin" aria-label="Opening" />
      </div>
    );
  }
  if (!p) {
    return (
      <div className="ws-center">
        <div className="ws-empty">
          <h2>That draft isn&apos;t on this device</h2>
          <p>Drafts sync with your Jarvis account. Open it on the device you started it on, or start a new one.</p>
          <button className="ws-btn" onClick={onBack}>
            All websites
          </button>
        </div>
      </div>
    );
  }

  const name = p.understanding?.name || "New website";

  return (
    <WorkShell
      title={name}
      subtitle={p.redesign ? `redesign of ${p.redesign.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : p.understanding?.oneLiner}
      url={built?.url}
      onBack={onBack}
      tabs={tabs}
      tab={tab}
      onTab={(t) => setTab(t as Tab)}
      actions={<SkillsMenu picks={p.skills ?? (look ? [look] : [])} onChange={(picks) => ab.setSkills(picks)} compact />}
      stage={(device: StageDevice) =>
        stage === "live" && built?.url ? (
          <iframe className="ws-site" src={built.url} title={name} sandbox="allow-same-origin allow-scripts allow-forms allow-popups" style={device === "phone" ? { width: 390 } : undefined} />
        ) : stage === "look" ? (
          <div className="ws-canvas-pad">
            <MockupBakeOff
              spec={specFromProject(p)}
              recommended={p.understanding?.designSkill}
              chosen={p.look ?? null}
              onChoose={(skill) => ab.chooseLook(skill)}
              chooseLabel="Build this look"
              as="owner"
              caption="Three directions, drawn from your own words. Pick one and the rest of the site is drawn in it."
            />
          </div>
        ) : stage === "pages" && plan ? (
          <FlowStudio
            plan={plan}
            onPlan={savePlan}
            base={specFromProject(p)}
            device={device === "phone" ? "phone" : "desktop"}
            busy={ab.busy === "build" || ab.busy === "queue"}
            onApprove={() => {
              const done = approve(plan);
              savePlan(done);
              void ab.build();
              onChanged?.();
            }}
          />
        ) : stage === "build" ? (
          <div className="ws-center">
            <div className="ws-empty">
              <PipelineRail facts={facts} />
              <p>The first working site goes live before Software Factory touches it. It appears here the moment it has an address.</p>
            </div>
          </div>
        ) : (
          <div className="ws-center">
            <div className="ws-empty">
              <h2>{p.understanding ? "Approve the features" : "Reading your idea…"}</h2>
              <p>
                {p.understanding
                  ? "Accept the features in the panel and the main design is drawn next."
                  : "Felix is working out the end goal and what this has to be. It takes a moment."}
              </p>
            </div>
          </div>
        )
      }
      panel={
        tab === "build" ? (
          <div className="cr-list ws-build">
            <PipelineRail facts={facts} compact />
            {p.handoff?.thread ? (
              <p className="ws-hint">The build is running on your PC. Its narration is in App Builder&apos;s build panel.</p>
            ) : (
              <p className="ws-hint">Approve the pages and the build starts.</p>
            )}
          </div>
        ) : tab === "plan" ? (
          <div className="cr-list ws-plan">
            {p.features.length ? (
              <FeatureTable
                features={p.features}
                selectedId={picked}
                hoverId={null}
                onSelect={setPicked}
                onHover={() => {}}
                onOps={(ops) => ab.apply(ops)}
              />
            ) : p.questions.length ? (
              <div className="ws-asks">
                <p className="ws-hint">
                  Felix wants to know a few things. Answer what you care about — the rest takes its best guess.
                </p>
                {p.questions.map((q) => (
                  <fieldset key={q.id} className="ws-ask">
                    <legend>{q.label}</legend>
                    {q.hint && <p>{q.hint}</p>}
                    <div className="ws-ask-chips">
                      {q.options.map((o) => {
                        const value = p.answers[q.id];
                        const on = Array.isArray(value) ? value.includes(o) : value === o;
                        return (
                          <button
                            key={o}
                            type="button"
                            className={on ? "on" : ""}
                            aria-pressed={on}
                            onClick={() => {
                              if (!q.multi) return ab.setAnswer(q.id, on ? "" : o);
                              const list = Array.isArray(value) ? value : value ? [String(value)] : [];
                              ab.setAnswer(q.id, on ? list.filter((x) => x !== o) : [...list, o]);
                            }}
                          >
                            {o}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
                <button className="ws-btn" onClick={() => void ab.design(true)} disabled={Boolean(ab.busy)}>
                  {ab.busy === "features" ? "Designing…" : "Design the features"}
                </button>
              </div>
            ) : (
              <p className="ws-hint">{p.understanding ? "Writing the feature list…" : "Reading your idea…"}</p>
            )}
          </div>
        ) : tab === "pages" ? (
          <div className="cr-list">
            {plan ? (
              <>
                <p className="ws-hint">
                  Every screen is drawn in {plan.look}. Walk them on the canvas, revise any one of them, then approve the set —
                  the routes go to the build, the pictures do not.
                </p>
                <ul className="ws-plan-list">
                  {plan.screens.map((s) => (
                    <li key={s.id}>
                      <b>{s.name}</b>
                      <code>{s.route}</code>
                      <span>{s.purpose}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="ws-hint">Pick the main design first and the supporting pages are drawn from it.</p>
            )}
          </div>
        ) : (
          <div className="cr-list ws-chat">
            {p.chat.map((m) => (
              <article key={m.id} className={`ws-msg ${m.role}`}>
                <p>{m.text}</p>
                {m.changes?.length ? (
                  <ul className="ws-msg-changes">
                    {m.changes.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
            {ab.busy && <p className="ws-hint">Working…</p>}
            {ab.error && <p className="ws-error">{ab.error}</p>}
          </div>
        )
      }
      panelFoot={
        tab === "chat" ? (
          <div className="ws-compose">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (text.trim()) {
                    void ab.say(text.trim());
                    setText("");
                  }
                }
              }}
              rows={2}
              placeholder={p.understanding ? "Change the plan — “accept 1 and 3”, “add a gallery”, “drop the blog”." : "One moment…"}
              aria-label="Talk to the agent"
              disabled={Boolean(ab.busy)}
            />
            <div className="ws-compose-bar">
              <span className="ws-note faint">{accepted.length} features accepted</span>
              <button
                className="ws-btn small"
                onClick={() => {
                  if (!text.trim()) return;
                  void ab.say(text.trim());
                  setText("");
                }}
                disabled={Boolean(ab.busy) || !text.trim()}
              >
                Send
              </button>
            </div>
          </div>
        ) : null
      }
    />
  );
}
