"use client";

import { Icon } from "../icons";
import { methodName, DIRECTOR_ID } from "@/lib/video-studio/registry";
import { formatTime, sceneRange, tidyPlan } from "@/lib/video-studio/plan";
import type { PlanScene, ProductionPlan } from "@/lib/video-studio/types";
import type { Studio } from "./studio";
import { Empty, Panel } from "./ui";

// Step 3. The plan, in the user's language, before anything renders.
//
// Every field is editable: the point of showing a plan is that the user can
// fix it, and a wrong scene caught here costs nothing while the same scene
// caught after an Unreal render costs twenty minutes.

export function Plan({ s }: { s: Studio }) {
  const plan = s.plan;
  if (!plan) {
    return (
      <div className="vsa-screen">
        <Empty title="No plan yet">
          <button type="button" className="vsa-btn is-primary" onClick={() => s.setView("method")}>
            Choose a method
          </button>
        </Empty>
      </div>
    );
  }

  const update = (patch: Partial<ProductionPlan>) => s.setPlan({ ...plan, ...patch });

  const updateScene = (index: number, patch: Partial<PlanScene>) =>
    s.setPlan(
      tidyPlan(
        {
          ...plan,
          scenes: plan.scenes.map((scene) => (scene.index === index ? { ...scene, ...patch } : scene)),
        },
        plan.methodId === DIRECTOR_ID ? "remotion" : plan.methodId,
      ),
    );

  const removeScene = (index: number) =>
    s.setPlan(
      tidyPlan(
        { ...plan, scenes: plan.scenes.filter((scene) => scene.index !== index) },
        plan.methodId === DIRECTOR_ID ? "remotion" : plan.methodId,
      ),
    );

  const addScene = () => {
    const last = plan.scenes[plan.scenes.length - 1];
    const start = last ? last.endSec : 0;
    const next: PlanScene = {
      id: `s${plan.scenes.length + 1}`,
      index: plan.scenes.length + 1,
      title: "New beat",
      startSec: start,
      endSec: start + 5,
      description: "",
      methodId: plan.methodId === DIRECTOR_ID ? "remotion" : plan.methodId,
    };
    s.setPlan(tidyPlan({ ...plan, scenes: [...plan.scenes, next] }, next.methodId));
  };

  const engines = [...new Set(plan.scenes.map((scene) => scene.methodId))];

  return (
    <div className="vsa-screen">
      <Panel
        title="Step 3 · Production plan"
        hint="Read it, fix anything that is wrong, then create the video. Nothing renders until you say so."
        actions={
          <button type="button" className="vsa-btn" onClick={() => s.setView("method")}>
            <Icon.ArrowLeft width={13} height={13} /> Change method
          </button>
        }
      >
        {plan.note && <p className="vsa-notice">{plan.note}</p>}

        <div className="vsa-plan-head">
          <input
            className="vsa-title-input"
            value={plan.title}
            onChange={(e) => update({ title: e.target.value })}
            aria-label="Project title"
          />
          <div className="vsa-plan-facts">
            <span>{formatTime(plan.durationSec)}</span>
            <span>{plan.aspectRatio}</span>
            <span>
              {plan.scenes.length} scene{plan.scenes.length === 1 ? "" : "s"}
            </span>
            <span className="vsa-plan-source">{plan.source === "ai" ? "written by the planner" : "written offline"}</span>
          </div>
        </div>

        <textarea
          className="vsa-logline"
          value={plan.logline}
          onChange={(e) => update({ logline: e.target.value })}
          rows={2}
          aria-label="Logline"
        />

        <ol className="vsa-scenes">
          {plan.scenes.map((scene) => (
            <li key={scene.id} className="vsa-scene">
              <div className="vsa-scene-bar">
                <span className="vsa-scene-no">Scene {scene.index}</span>
                <input
                  className="vsa-scene-title"
                  value={scene.title}
                  onChange={(e) => updateScene(scene.index, { title: e.target.value })}
                  aria-label={`Scene ${scene.index} title`}
                />
                <span className="vsa-scene-tools">
                  <span className="vsa-scene-time">{sceneRange(scene)}</span>
                  <span className="vsa-scene-ends">
                    ends
                    <input
                      type="number"
                      className="vsa-scene-end"
                      min={scene.startSec + 1}
                      value={scene.endSec}
                      onChange={(e) => updateScene(scene.index, { endSec: Number(e.target.value) })}
                      aria-label={`Scene ${scene.index} end second`}
                    />
                    s
                  </span>
                  {plan.methodId === DIRECTOR_ID && (
                    <select
                      className="vsa-scene-method"
                      value={scene.methodId}
                      onChange={(e) => updateScene(scene.index, { methodId: e.target.value, directive: undefined })}
                      aria-label={`Scene ${scene.index} engine`}
                    >
                      {s.methods
                        .filter((m) => !m.hidden)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className="vsa-icon-btn"
                    onClick={() => removeScene(scene.index)}
                    aria-label={`Remove scene ${scene.index}`}
                  >
                    <Icon.Trash width={13} height={13} />
                  </button>
                </span>
              </div>

              <textarea
                value={scene.description}
                onChange={(e) => updateScene(scene.index, { description: e.target.value, directive: undefined })}
                rows={2}
                placeholder="What is on screen?"
                aria-label={`Scene ${scene.index} description`}
              />

              {scene.narration !== undefined && (
                <input
                  className="vsa-narration"
                  value={scene.narration}
                  onChange={(e) => updateScene(scene.index, { narration: e.target.value })}
                  placeholder="Narration for this scene"
                  aria-label={`Scene ${scene.index} narration`}
                />
              )}

              {scene.directive && (
                <details className="vsa-directive">
                  <summary>Engine directive · {methodName(scene.methodId)}</summary>
                  <pre>{scene.directive}</pre>
                </details>
              )}
            </li>
          ))}
        </ol>

        <button type="button" className="vsa-btn is-ghost vsa-add-scene" onClick={addScene}>
          <Icon.Plus width={13} height={13} /> Add a scene
        </button>
      </Panel>

      <Panel title="How it will be made">
        <div className="vsa-chosen">
          <div>
            <dt>Selected method</dt>
            <dd>{methodName(plan.methodId)}</dd>
          </div>
          <div>
            <dt>Skill</dt>
            <dd>
              <code>{plan.skill}</code>
            </dd>
          </div>
          {plan.methodId === DIRECTOR_ID && (
            <div>
              <dt>Engines in this plan</dt>
              <dd>{engines.map(methodName).join(" · ")}</dd>
            </div>
          )}
        </div>
        <p className="vsa-hint">
          Your words are not sent to the engine as written. When you create the video, each scene is
          rewritten in that engine&apos;s own terms first.
        </p>
      </Panel>

      <div className="vsa-actions">
        <button type="button" className="vsa-btn" disabled={Boolean(s.busy)} onClick={() => void s.savePlanOnly()}>
          Save without rendering
        </button>
        <button type="button" className="vsa-btn is-primary" disabled={Boolean(s.busy)} onClick={() => void s.generate()}>
          {s.busy ?? "Create Video"}
        </button>
      </div>
    </div>
  );
}
