"use client";

// ---------------------------------------------------------------------------
// Mockups, stage two — the supporting pages, as a prototype you can walk.
//
// Stage one picked ONE look from three. This is the rest of the site drawn in
// that look: every screen, the links between them, and the states each screen
// has. The point is that it is CONNECTED — pressing "Book a slot" on the home
// screen opens the booking screen, which has a way back. A gallery of
// unrelated pictures is exactly what this replaces.
//
// Each screen is drawn by the renderer that already draws the bake-off
// (src/lib/mockup/render.ts) in the approved direction, so the pages are the
// same design system rather than three different ones. The navigation is drawn
// by this component rather than inside the document, because a mockup document
// is sandboxed with no scripts and will stay that way — the prototype's
// behaviour belongs to the page it is embedded in, not to the drawing.
//
// What leaves here is a plan, not pictures: the approved routes, links and
// states go into the build brief, and the real navigation and state are built
// by the harness (flows.ts `flowsBrief` says so in as many words).
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { directionFor } from "@/lib/mockup/directions";
import { FRAME_HEIGHT, FRAME_WIDTH, renderMockup } from "@/lib/mockup/render";
import type { Device, MockupSpec } from "@/lib/mockup/types";
import {
  canApprove,
  checkFlows,
  HOME_ID,
  noteScreen,
  STATE_LABEL,
  type FlowPlan,
  type FlowScreen,
  type ScreenState,
} from "@/lib/website-studio/flows";

interface Props {
  plan: FlowPlan;
  onPlan: (next: FlowPlan) => void;
  /** The spec the main design was drawn from — the site's own words. */
  base: MockupSpec;
  device: Device;
  /** Approve the whole set and send it to the build. */
  onApprove: () => void;
  busy?: boolean;
}

/**
 * One screen as something the renderer can draw: the site's own spec, with
 * this screen's heading, sections and buttons swapped in — and bent into the
 * state being shown, because an empty state that is drawn full is not a
 * design of an empty state.
 */
function screenSpec(base: MockupSpec, plan: FlowPlan, screen: FlowScreen, state: ScreenState): MockupSpec {
  const nav = plan.screens.slice(0, 5).map((s) => s.name);
  const ctas = screen.links.filter((l) => l.primary).map((l) => l.label);
  const body = screen.content.filter(Boolean);
  const sections =
    state === "empty"
      ? [{ title: "Nothing here yet", body: `When there is something to show, it appears here. ${screen.purpose}` }]
      : state === "error"
        ? [{ title: "That didn't work", body: "What went wrong, in plain words, and the one button that fixes it." }]
        : state === "success"
          ? [{ title: "All done", body: `${screen.name} finished. What happens next, and where to go from here.` }]
          : state === "loading"
            ? [{ title: "Loading…", body: "The shape of the page while it arrives — never a blank screen." }]
            : body.slice(1).map((line, i) => ({ title: line.split(/[.:]/)[0].slice(0, 40), body: body[i + 2] ?? screen.purpose }));

  return {
    ...base,
    nav,
    rows: state === "empty" || state === "loading" ? [] : base.rows,
    site: base.site
      ? {
          ...base.site,
          headline: state === "ready" ? body[0] ?? screen.name : STATE_LABEL[state],
          sub: screen.purpose,
          ctas: ctas.length ? ctas : base.site.ctas,
          sections: sections.length ? sections : base.site.sections,
        }
      : undefined,
  };
}

export function FlowStudio({ plan, onPlan, base, device, onApprove, busy }: Props) {
  const [at, setAt] = useState(HOME_ID);
  const [state, setState] = useState<ScreenState>("ready");
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");

  const screen = plan.screens.find((s) => s.id === at) ?? plan.screens[0];
  const problems = checkFlows(plan);
  const ready = canApprove(plan);
  const direction = useMemo(() => directionFor(plan.look), [plan.look]);
  const html = useMemo(
    () => (screen ? renderMockup(screenSpec(base, plan, screen, state), direction, { device }) : ""),
    [base, plan, screen, state, direction, device],
  );

  if (!screen) return <p className="ws-hint">No screens yet.</p>;

  const go = (id: string) => {
    setAt(id);
    setState("ready");
    setNoting(false);
  };

  return (
    <div className="ws-flow">
      <nav className="ws-flow-rail" aria-label="Screens">
        {plan.screens.map((s) => (
          <button key={s.id} className={s.id === at ? "on" : ""} onClick={() => go(s.id)} title={s.purpose}>
            <b>{s.name}</b>
            <code>{s.route}</code>
            {s.note && <span className="ws-flow-noted" title={s.note} aria-label="You asked for a change" />}
          </button>
        ))}
      </nav>

      <div className="ws-flow-main">
        <div className="ws-flow-states" role="group" aria-label="Screen state">
          {screen.states.map((s) => (
            <button key={s} className={s === state ? "on" : ""} aria-pressed={s === state} onClick={() => setState(s)}>
              {STATE_LABEL[s]}
            </button>
          ))}
        </div>

        <div className="ws-flow-screen" style={{ aspectRatio: `${FRAME_WIDTH[device]} / ${FRAME_HEIGHT[device]}` }}>
          <iframe
            title={`${screen.name} — ${STATE_LABEL[state]}`}
            srcDoc={html}
            sandbox="allow-same-origin"
            style={{ width: FRAME_WIDTH[device], height: FRAME_HEIGHT[device] }}
          />
        </div>

        <div className="ws-flow-links">
          <span className="ws-flow-from">On this screen you can:</span>
          {screen.links.length ? (
            screen.links.map((l) => (
              <button key={`${l.to}-${l.label}`} className={l.primary ? "primary" : ""} onClick={() => go(l.to)}>
                {l.label}
                <ArrowIcon />
              </button>
            ))
          ) : (
            <em>nothing yet — this screen is a dead end</em>
          )}
        </div>

        <div className="ws-flow-bar">
          {noting ? (
            <form
              className="ws-flow-note"
              onSubmit={(e) => {
                e.preventDefault();
                onPlan(noteScreen(plan, screen.id, note));
                setNote("");
                setNoting(false);
              }}
            >
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={`What should change about ${screen.name}?`}
                aria-label={`What should change about ${screen.name}`}
                autoFocus
              />
              <button className="ws-btn small" type="submit">
                Save
              </button>
              <button className="ws-btn ghost small" type="button" onClick={() => setNoting(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <>
              <button className="ws-btn ghost small" onClick={() => { setNote(screen.note ?? ""); setNoting(true); }}>
                Revise this screen
              </button>
              <span className="ws-flow-count">
                {plan.screens.length} screens · {plan.journeys.length} journeys · drawn in {plan.look}
              </span>
              <button className="ws-btn small" onClick={onApprove} disabled={!ready || busy}>
                {busy ? "Starting…" : plan.approvedAt ? "Approved — build it" : "Approve these pages"}
              </button>
            </>
          )}
        </div>

        {problems.length > 0 && (
          <ul className="ws-flow-problems">
            {problems.slice(0, 6).map((p, i) => (
              <li key={i} className={p.fatal ? "fatal" : ""}>
                <b>{p.where}</b> {p.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}
