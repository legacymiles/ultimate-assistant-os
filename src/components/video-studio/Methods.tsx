"use client";

import { Icon } from "../icons";
import { WORKFLOW_LABEL } from "@/lib/video-studio/types";
import { DIRECTOR_ID } from "@/lib/video-studio/registry";
import type { Studio } from "./studio";
import { CapabilityBadge, MethodMark, Panel } from "./ui";

// Step 2. Five cards, no ranking, no "recommended" badge — the engines do
// different jobs and the user is the one who knows which job this is.
//
// The card is where a missing dependency surfaces: the badge is the REAL state
// of that engine on this machine, and "Use this method" stays clickable so the
// plan can still be written and read before anything is installed.

export function Methods({ s }: { s: Studio }) {
  const visible = s.methods.filter((m) => !m.hidden);

  return (
    <div className="vsa-screen">
      <Panel
        title="Step 2 · Choose creation method"
        hint="Each engine is good at a different kind of video. None of them is better than the others."
        actions={
          <button type="button" className="vsa-btn" onClick={() => s.setView("brief")}>
            <Icon.ArrowLeft width={13} height={13} /> Edit the brief
          </button>
        }
      >
        <div className="vsa-methods">
          {visible.map((method) => (
            <article key={method.id} className={`vsa-method ${s.methodId === method.id ? "is-on" : ""}`}>
              <header>
                <MethodMark hue={method.hue} />
                <div>
                  <h3>{method.name}</h3>
                  <p className="vsa-method-best">
                    <strong>Best for:</strong> {method.tagline}
                  </p>
                </div>
                <CapabilityBadge capability={method.capability} />
              </header>

              <p className="vsa-method-desc">{method.description}</p>

              <ul className="vsa-strengths">
                {method.strengths.map((strength) => (
                  <li key={strength}>{strength}</li>
                ))}
              </ul>

              <dl className="vsa-method-meta">
                <div>
                  <dt>Workflow</dt>
                  <dd>{WORKFLOW_LABEL[method.workflowType]}</dd>
                </div>
                <div>
                  <dt>Runs</dt>
                  <dd>{method.transport === "server" ? "On the server" : "On your PC"}</dd>
                </div>
                <div>
                  <dt>Skill</dt>
                  <dd>
                    <code>{method.skill}</code>
                  </dd>
                </div>
                <div>
                  <dt>Output</dt>
                  <dd>
                    {method.output.format.toUpperCase()} · {method.output.resolution}
                  </dd>
                </div>
              </dl>

              {method.capability?.state !== "ready" && (
                <p className="vsa-method-block">{method.capability?.summary}</p>
              )}

              <footer>
                <button
                  type="button"
                  className="vsa-btn is-primary"
                  disabled={Boolean(s.busy)}
                  onClick={() => void s.chooseMethod(method.id, "manual")}
                >
                  Use this method
                </button>
                <button type="button" className="vsa-btn is-ghost" onClick={() => s.setView("integrations")}>
                  Requirements
                </button>
              </footer>
            </article>
          ))}

          <article className="vsa-method is-director">
            <header>
              <MethodMark hue={[150, 205]} />
              <div>
                <h3>AI Director</h3>
                <p className="vsa-method-best">
                  <strong>Best for:</strong> videos where different scenes want different engines
                </p>
              </div>
              <span className="vsa-cap is-ready">
                <i aria-hidden />
                Ready to plan
              </span>
            </header>
            <p className="vsa-method-desc">
              Instead of picking one engine, let the director read the request and route every scene to
              whichever engine suits it — a photoreal establishing shot to H3, an infographic to Remotion, a
              3D set to Unreal — then assemble them into one video. Each scene still has to have its engine
              ready before that scene will render.
            </p>
            <ul className="vsa-strengths">
              <li>One plan, several engines</li>
              <li>Per-scene routing you can override</li>
              <li>Assembled into a single file</li>
            </ul>
            <footer>
              <button
                type="button"
                className="vsa-btn is-primary"
                disabled={Boolean(s.busy)}
                onClick={() => void s.chooseMethod(DIRECTOR_ID, "director")}
              >
                Let the director choose
              </button>
            </footer>
          </article>
        </div>
      </Panel>
    </div>
  );
}
