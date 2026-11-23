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
// ONE chat, no tabs (owner, 22 Nov 2026 — mockup "One chat"). Every step
// arrives in the conversation as a card the moment it is needed: Felix's
// questions, the feature list and its add-ons, the look, the pages, the build.
// Whatever is waiting on the owner is pinned above the composer as one
// full-width action, so the next thing to press is never hiding at the bottom
// of the canvas or behind a tab. Finished steps fold to a line you can reopen.
//
// Everything underneath is App Builder's, unchanged: the same project in the
// same synced store, so a draft started here opens at /apps/app-builder?p=<id>
// and a project Jarvis chat handed over opens here. Consolidation moved the
// screen, not the data.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { useChatVoice } from "../voice/useChatVoice";
import { ChatVoiceAvatar } from "../voice/ChatVoiceAvatar";
import { frameAddress } from "@/lib/client-review/frame";
import { useAppBuilder } from "@/lib/app-builder/useAppBuilder";
import { DEPTH_BLURB, depthOf } from "@/lib/app-builder/depth";
import { useChatModel } from "@/lib/new-jarvis/useChatModel";
import { specFromProject } from "@/lib/mockup/spec";
import { approve, canApprove, checkFlows, draftFlows, HOME_ID, type FlowPlan } from "@/lib/website-studio/flows";
import type { StageFacts } from "@/lib/website-studio/pipeline";
import { FeatureTable } from "../app-builder/FeatureTable";
import { MoveIntoHub } from "../app-builder/MoveIntoHub";
import { MockupBakeOff } from "../mockup/MockupBakeOff";
import "../app-builder/app-builder.css";
import { ModelPicker } from "../new-jarvis/ModelPicker";
import { FlowStudio } from "./FlowStudio";
import { PipelineRail } from "./PipelineRail";
import { DesignSlash } from "./DesignSlash";
import { SkillsMenu } from "./SkillsMenu";
import { WorkShell, type StageDevice } from "./WorkShell";
import "../client-review/client-review.css";

interface Props {
  draftId: string;
  onBack: () => void;
  onChanged?: () => void;
}

type Stage = "ask" | "look" | "pages" | "build" | "live";
const ORDER: Stage[] = ["ask", "look", "pages", "build", "live"];

export function DraftWorkspace({ draftId, onBack, onChanged }: Props) {
  const ab = useAppBuilder();
  const { model: harnessModel, setModel: setHarnessModel } = useChatModel();
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<FlowPlan | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [screenAt, setScreenAt] = useState(HOME_ID);
  /** Finished cards the owner reopened. */
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const nowRef = useRef<HTMLElement | null>(null);

  const p = ab.current;

  // The hub's voice (components/voice): talk to this draft's agent.
  useChatVoice({
    id: `website-draft`,
    label: `Website Studio · ${p?.understanding?.name ?? "draft"}`,
    active: true,
    say: (said) => ab.say(said),
    answers: (p?.chat ?? []).filter((m) => m.role === "agent").map((m) => m.text),
  });

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

  const stage: Stage = built?.url
    ? "live"
    : p?.handoff?.thread
      ? "build"
      : !p?.understanding || !accepted.length
        ? "ask"
        : !p.look
          ? "look"
          : "pages";
  const reached = (s: Stage) => ORDER.indexOf(stage) >= ORDER.indexOf(s);

  // The step waiting on the owner scrolls into view when it arrives — the
  // conversation follows the work, there is nothing to go and find.
  useEffect(() => {
    nowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [stage, p?.features.length, p?.questions.length, plan?.screens.length]);

  const approvePages = useCallback(() => {
    if (!plan) return;
    savePlan(approve(plan));
    void ab.build();
    onChanged?.();
  }, [plan, savePlan, ab, onChanged]);

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
  const { depth, why: depthWhy } = depthOf(p);
  /** Once the build has the brief, its depth is set. */
  const inFlight = Boolean(p.handoff?.thread || p.handoff?.queueId);
  const busy = Boolean(ab.busy);
  const problems = plan ? checkFlows(plan) : [];
  const fatal = problems.filter((x) => x.fatal).length;
  const pagesReady = plan ? canApprove(plan) : false;

  const send = () => {
    if (!text.trim()) return;
    void ab.say(text.trim());
    setText("");
  };

  /** A finished step: one line, reopened on demand. */
  const isOpen = (id: string, current: boolean) => current || Boolean(opened[id]);
  const toggle = (id: string) => setOpened((o) => ({ ...o, [id]: !o[id] }));

  const answered = p.questions
    .map((q) => {
      const v = p.answers[q.id];
      return Array.isArray(v) ? v.join(", ") : v ? String(v) : "";
    })
    .filter(Boolean);

  // ----- the steps, as cards in the conversation ---------------------------

  const questionsCard =
    p.questions.length > 0 ? (
      p.features.length === 0 ? (
        <Step key="ask" id="ask" title="Felix's questions" tag="Waiting on you" current nowRef={nowRef}>
          <p className="ws-step-lead">Answer what you care about — Felix takes his best guess at the rest.</p>
          <div className="ws-asks">
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
          </div>
        </Step>
      ) : (
        <Step
          key="ask"
          id="ask"
          title="Your answers"
          tag="Done"
          done
          open={isOpen("ask", false)}
          onToggle={() => toggle("ask")}
          summary={answered.length ? answered.join(" · ") : "Felix's best guess"}
        >
          <div className="ws-step-chips">
            {answered.length ? answered.map((a) => <span key={a}>{a}</span>) : <em>Nothing answered — Felix guessed.</em>}
          </div>
        </Step>
      )
    ) : null;

  const featuresCurrent = stage === "ask" || stage === "look";
  const featuresCard =
    p.features.length > 0 ? (
      <Step
        key="features"
        id="features"
        title="Features"
        tag={`${accepted.length} accepted`}
        done={!featuresCurrent}
        current={stage === "ask"}
        nowRef={stage === "ask" ? nowRef : undefined}
        open={isOpen("features", featuresCurrent)}
        onToggle={featuresCurrent ? undefined : () => toggle("features")}
        summary={accepted
          .slice(0, 4)
          .map((f) => f.title)
          .join(", ") + (accepted.length > 4 ? ` +${accepted.length - 4}` : "")}
      >
        <div className="ws-plan">
          <FeatureTable
            features={p.features}
            selectedId={picked}
            hoverId={null}
            onSelect={setPicked}
            onHover={() => {}}
            onOps={(ops) => ab.apply(ops)}
          />
        </div>
        {/* Add-ons: how far the build goes, and the board. Depth is App
            Builder's own setting on the same project, so the brief reads
            exactly what is ticked here. */}
        <section className="ws-addons" aria-labelledby="ws-addons-h">
          <h3 id="ws-addons-h">Add-ons</h3>
          <label className="ws-addon" aria-disabled={inFlight}>
            <input
              type="checkbox"
              checked={depth !== "plain"}
              disabled={inFlight}
              onChange={(e) => ab.setDepth(e.target.checked ? "commercial" : "plain")}
            />
            <b>Commercial foundation</b>
            <span>{DEPTH_BLURB.commercial}</span>
          </label>
          <label className="ws-addon sub" aria-disabled={inFlight || depth === "plain"}>
            <input
              type="checkbox"
              checked={depth === "commercial-2x"}
              disabled={inFlight || depth === "plain"}
              onChange={(e) => ab.setDepth(e.target.checked ? "commercial-2x" : "commercial")}
            />
            <b>Charge for it (2x)</b>
            <span>Pricing, paywalls and upgrade moments, and a critic panel to 9/10.</span>
          </label>
          <p className="ws-hint">
            {inFlight
              ? "Set — the build is already running at this depth."
              : p.depth
                ? "Your choice."
                : `Picked for you because ${depthWhy}. Untick it for a one-screen tool that saves in the browser.`}
          </p>
          <button className="ws-btn ghost small" disabled={!accepted.length || busy} onClick={() => void ab.sendCards()}>
            {ab.busy === "board" ? "Filing cards…" : `Send ${accepted.length} feature${accepted.length === 1 ? "" : "s"} to the board`}
          </button>
          {p.handoff?.cards?.length ? (
            <p className="ws-cards">
              On the board:{" "}
              {p.handoff.cards.map((c, i) => (
                <span key={c.number}>
                  {i > 0 && ", "}
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noopener noreferrer">
                      #{c.number}
                    </a>
                  ) : (
                    `#${c.number}`
                  )}
                </span>
              ))}
            </p>
          ) : (
            <p className="ws-hint">One Software Factory card per accepted feature, in Backlog. You approve every merge.</p>
          )}
        </section>
      </Step>
    ) : null;

  const lookCard = reached("look") ? (
    p.look ? (
      <Step key="look" id="look" title={`Look: ${p.look.skill}`} tag="Picked" done summary="The rest of the site is drawn in it." />
    ) : (
      <Step key="look" id="look" title="Pick the look" tag="Waiting on you" current nowRef={nowRef}>
        <p className="ws-step-lead">
          Three directions are on the right, drawn from your own words. Pick one and every other page is drawn in it.
        </p>
      </Step>
    )
  ) : null;

  const pagesCard =
    reached("pages") && plan ? (
      <Step
        key="pages"
        id="pages"
        title={`${plan.screens.length} pages`}
        tag={plan.approvedAt ? "Approved" : "Waiting on you"}
        done={Boolean(plan.approvedAt)}
        current={!plan.approvedAt}
        nowRef={stage === "pages" ? nowRef : undefined}
        open={isOpen("pages", !plan.approvedAt)}
        onToggle={plan.approvedAt ? () => toggle("pages") : undefined}
        summary={plan.screens.map((s) => s.name).join(", ")}
      >
        {!plan.approvedAt && (
          <p className="ws-step-lead">
            Every page is drawn in {plan.look} — click one to walk it on the right. <b>Approve them and the build starts.</b>
          </p>
        )}
        <ol className="ws-step-pages">
          {plan.screens.map((s, i) => (
            <li key={s.id}>
              <button type="button" className={s.id === screenAt ? "on" : ""} onClick={() => setScreenAt(s.id)} title={s.purpose}>
                <span className="ws-step-num">{i + 1}</span>
                <b>{s.name}</b>
                <code>{s.route}</code>
                {s.note && <span className="ws-flow-noted" title={s.note} aria-label="You asked for a change" />}
              </button>
            </li>
          ))}
        </ol>
        <p className={`ws-step-check${fatal ? " bad" : ""}`}>
          {fatal
            ? `${fatal} thing${fatal === 1 ? "" : "s"} to fix first — see the list under the page on the right.`
            : problems.length
              ? `Every page is reachable · ${problems.length} note${problems.length === 1 ? "" : "s"} on the right`
              : "Every page is reachable · no dead links"}
        </p>
      </Step>
    ) : null;

  const buildCard = reached("build") ? (
    <Step key="build" id="build" title={stage === "live" ? "Live" : "Building"} tag={stage === "live" ? "Live" : "Running"} current={stage === "build"} live={stage === "build"}>
      <PipelineRail facts={facts} compact />
      {p.handoff?.thread && (
        <p className="ws-hint">
          {stage === "live" ? "Built on your PC." : "The build is running on your PC. The site appears on the right the moment it has an address."}{" "}
          <a href={`/apps/app-builder?p=${encodeURIComponent(p.id)}&classic=1`}>Open its full build log</a>
        </p>
      )}
      {/* Built on its own folder and repo: bring it into the hub as /apps/<slug>. */}
      <MoveIntoHub project={p} busy={ab.busy} moving={ab.moving} onMove={() => void ab.absorb()} onRetire={() => void ab.retire()} />
    </Step>
  ) : null;

  // ----- the one thing to press, pinned above the composer -----------------

  const action =
    stage === "ask" && p.questions.length > 0 && p.features.length === 0 ? (
      <ActionBar
        label={ab.busy === "features" ? "Designing the features…" : "Design the features"}
        sub="Felix writes the feature list from your answers."
        onPress={() => void ab.design(true)}
        disabled={busy}
      />
    ) : stage === "look" ? (
      <ActionBar
        info
        label={`${accepted.length} feature${accepted.length === 1 ? "" : "s"} in — now pick a look on the right`}
        sub="Accept or skip features above at any time before the build."
      />
    ) : stage === "pages" && plan && !plan.approvedAt ? (
      <ActionBar
        label={ab.busy === "build" || ab.busy === "queue" ? "Starting the build…" : `Approve ${plan.screens.length} pages & start the build`}
        sub={pagesReady ? "The first working site goes live, then Software Factory deepens it." : "Fix what the check found on the right, then approve."}
        onPress={approvePages}
        disabled={!pagesReady || busy}
      />
    ) : stage === "build" ? (
      <ActionBar info live label="Building on your PC" sub="It appears on the right the moment it has an address." />
    ) : stage === "live" && built?.url ? (
      <ActionBar label="Open the live site" sub={built.url.replace(/^https?:\/\//, "")} href={built.url} />
    ) : null;

  return (
    <WorkShell
      title={name}
      subtitle={p.redesign ? `redesign of ${p.redesign.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : p.understanding?.oneLiner}
      url={built?.url}
      onBack={onBack}
      actions={
        <div className="ws-actions-row">
          <SkillsMenu picks={p.skills ?? (look ? [look] : [])} onChange={(picks) => ab.setSkills(picks)} compact />
          <button
            className="ws-btn ghost small"
            title="Delete this draft"
            onClick={() => {
              if (!window.confirm(`Delete the draft “${name}”? Its features, mockups and pages go with it. This can't be undone.`)) return;
              ab.remove(p.id);
              onChanged?.();
              onBack();
            }}
          >
            Delete
          </button>
        </div>
      }
      stage={(device: StageDevice) =>
        stage === "live" && built?.url ? (
          <iframe className="ws-site" src={frameAddress(built.url)} title={name} sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" style={device === "phone" ? { width: 390 } : undefined} />
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
            at={screenAt}
            onAt={setScreenAt}
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
              <h2>{!p.understanding ? "Reading your idea…" : p.features.length ? "Choose the features" : p.questions.length ? "A few questions first" : "Writing the feature list…"}</h2>
              <p>
                {!p.understanding
                  ? "Felix is working out the end goal and what this has to be. It takes a moment."
                  : p.features.length
                    ? "Accept or skip them in the chat and the main design is drawn next."
                    : p.questions.length
                      ? "Answer what you care about in the chat — Felix guesses the rest."
                      : "Felix is turning your idea into a list of features to accept or skip."}
              </p>
            </div>
          </div>
        )
      }
      panel={
        <div className="cr-list ws-chat ws-stream">
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
          {questionsCard}
          {featuresCard}
          {lookCard}
          {pagesCard}
          {buildCard}
          {stage === "ask" && !p.features.length && !p.questions.length && (
            <div className="ws-step-wait" ref={nowRef as Ref<HTMLDivElement>}>
              <span className="ws-spin small" aria-hidden />
              {p.understanding ? "Writing the feature list…" : "Reading your idea…"}
            </div>
          )}
          {busy && stage !== "ask" && <p className="ws-hint ws-stream-hint">Working…</p>}
        </div>
      }
      panelFoot={
        <>
          {/* A failure sits next to the button that retries it, never at the
              far end of a long chat. */}
          {ab.error && !busy && (
            <p className="ws-error ws-go-err" role="alert">
              {ab.error}
            </p>
          )}
          {action}
          <div className="ws-compose">
            <div className="ws-compose-box">
              <DesignSlash
                text={text}
                onText={setText}
                onPick={(skill) => {
                  const now = p.skills ?? (look ? [look] : []);
                  if (!now.includes(skill)) ab.setSkills([...now, skill]);
                }}
              />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                placeholder={
                  p.understanding
                    ? action
                      ? "Or ask for a change — “accept 1 and 3”, “add a gallery”. Press / for a skill."
                      : "Change the plan — “accept 1 and 3”, “add a gallery”. Press / for a skill."
                    : "One moment…"
                }
                aria-label="Talk to the agent"
                disabled={busy}
              />
            </div>
            <div className="ws-compose-bar">
              {/* The model that builds it, in the panel you talk to it from. */}
              <ModelPicker value={harnessModel} onChange={setHarnessModel} up />
              <span className="ws-note faint">{accepted.length} accepted</span>
              {/* The one voice button: Jarvis's avatar, talking to this draft's agent. */}
              <ChatVoiceAvatar size="sm" busy={busy} />
              <button className="ws-btn small" onClick={send} disabled={busy || !text.trim()}>
                Send
              </button>
            </div>
          </div>
        </>
      }
    />
  );
}

/** One step of the work, as a card in the conversation. */
function Step({
  id,
  title,
  tag,
  done,
  current,
  live,
  open = true,
  onToggle,
  summary,
  nowRef,
  children,
}: {
  id: string;
  title: string;
  tag: string;
  done?: boolean;
  current?: boolean;
  live?: boolean;
  open?: boolean;
  onToggle?: () => void;
  summary?: string;
  nowRef?: Ref<HTMLElement>;
  children?: ReactNode;
}) {
  const showBody = open && Boolean(children);
  return (
    <section
      ref={nowRef}
      className={`ws-step${current ? " current" : ""}${done ? " done" : ""}`}
      aria-labelledby={`ws-step-${id}`}
    >
      <header className="ws-step-h">
        {onToggle ? (
          <button type="button" className="ws-step-toggle" onClick={onToggle} aria-expanded={open}>
            <h4 id={`ws-step-${id}`}>{title}</h4>
            <Chevron open={open} />
          </button>
        ) : (
          <h4 id={`ws-step-${id}`}>{title}</h4>
        )}
        <span className={`ws-step-tag${current ? " now" : ""}`}>
          {live && <span className="ws-pip" aria-hidden />}
          {tag}
        </span>
      </header>
      {showBody ? <div className="ws-step-body">{children}</div> : summary ? <p className="ws-step-sum">{summary}</p> : null}
    </section>
  );
}

/** The one thing waiting on the owner, full width above the composer. */
function ActionBar({
  label,
  sub,
  onPress,
  href,
  disabled,
  info,
  live,
}: {
  label: string;
  sub?: string;
  onPress?: () => void;
  href?: string;
  disabled?: boolean;
  /** Nothing to press here — it says where the next step is. */
  info?: boolean;
  live?: boolean;
}) {
  return (
    <div className="ws-go-wrap">
      {info ? (
        <div className="ws-go info" role="status">
          {live && <span className="ws-pip" aria-hidden />}
          <span>{label}</span>
          {!live && <Arrow />}
        </div>
      ) : href ? (
        <a className="ws-go" href={href} target="_blank" rel="noopener noreferrer">
          <span>{label}</span>
          <Arrow />
        </a>
      ) : (
        <button type="button" className="ws-go" onClick={onPress} disabled={disabled}>
          <span>{label}</span>
          <Arrow />
        </button>
      )}
      {sub && <p className="ws-go-sub">{sub}</p>}
    </div>
  );
}

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: open ? "rotate(180deg)" : undefined }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
