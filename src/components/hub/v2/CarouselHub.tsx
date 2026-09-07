"use client";

// ---------------------------------------------------------------------------
// Hub v2 — the rotating panel stand.
//
// A ring of project panels on a vertical axis, turned by drag, wheel, keys or
// the arrows. Packed tight while it spins, opening around whatever you land
// on. See useCarousel.ts for the motion model — this file is layout, input
// routing and the one performance decision that makes it possible:
//
// The physics publishes React state only when the FOCUS or the SETTLED flag
// changes. Every frame's transforms are written straight onto the panel nodes
// through refs, so twenty-seven panels animate at 60fps inside a component
// that re-renders a handful of times a second.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PROJECTS, type CatalogProject } from "@/lib/catalog";
import { Icon } from "../../icons";
import { PanelFace } from "./PanelFace";
import { panelAngle, useCarousel } from "./useCarousel";

/**
 * Panels past this angle are edge-on or behind the stand. Backface culling
 * removes everything past 90 on its own; this just stops the rest being laid
 * out at all.
 */
const CULL_DEGREES = 120;
/** The angle by which a page has faded into the stack. Drives dim and blur. */
const FADE_DEGREES = 85;
/** Must match the `perspective` on .hubv2__stage — the sizing maths needs it. */
const PERSPECTIVE = 1500;

export function CarouselHub() {
  const projects = useMemo(() => PROJECTS, []);
  const count = projects.length;
  const { state, tuning, bind, nudge, goTo, wasDragged, attachStage } = useCarousel({ count });

  // The draw loop below needs the newest numbers without DEPENDING on them —
  // listing state as a dependency would tear the loop down and rebuild it on
  // every publish, which is exactly what the ref-based design avoids.
  const stateRef = useRef(state);
  stateRef.current = state;
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [metrics, setMetrics] = useState({ radius: 460, width: 300, height: 400 });
  const [reduced, setReduced] = useState(false);

  // Size the ring to the viewport. A radius that works on a 27" monitor puts
  // the whole stand off-screen on a phone, so both the panel and the ring
  // scale together and the geometry stays the same shape at every size.
  useEffect(() => {
    const measure = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Small enough to see a good stretch of the stack either side — the
      // point of the stand is the whole fan, not one big card.
      const width = Math.max(170, Math.min(250, w * 0.3));
      // Enough radius that the neighbours clear the focused panel once the
      // wedge is open, derived from the panel width rather than guessed.
      const radius = Math.max(280, width * 1.45);
      // A panel at +radius is magnified by the perspective divide, so sizing
      // it against the viewport directly would overflow by ~40%. Solve for the
      // size it ends up at on screen instead of the size it is authored at.
      const magnify = PERSPECTIVE / (PERSPECTIVE - radius);
      const height = Math.min(width * 1.5, (h * 0.62) / magnify);
      setMetrics({ radius, width, height });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /**
   * The render loop for the transforms.
   *
   * Deliberately outside React. It reads the same simulation the hook is
   * stepping and writes `style.transform` on each panel node — no virtual DOM
   * diff, no re-render, no allocation per frame.
   */
  useEffect(() => {
    let alive = true;
    let raf = 0;

    const draw = () => {
      if (!alive) return;
      const nodes = panelRefs.current;
      const { rotation, rest } = stateRef.current;
      const speed = Math.min(1, Math.abs(stateRef.current.velocity) / tuning.fullSpeed);

      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!el) continue;
        const angle = panelAngle(i, { rotation, rest }, tuning);
        const abs = Math.abs(angle);

        if (abs > CULL_DEGREES) {
          el.style.visibility = "hidden";
          continue;
        }
        el.style.visibility = "visible";

        // Pages away from the focus sit further back and a touch lower, so the
        // stack reads as depth rather than as a flat overlapping fan.
        const t = Math.min(1, abs / CULL_DEGREES);
        // Dim and blur ramp on the real ANGLE, not on the cull fraction, so a
        // page is buried in the stack by about 85 degrees however many panels
        // there are. This is what keeps the off-focus ones reading as the
        // edges of stacked pages instead of as smaller readable cards.
        const fade = Math.min(1, abs / FADE_DEGREES);
        const lift = -6 * (1 - t);
        const depth = metrics.radius - 40 * t;
        const scale = 1 - 0.12 * t;

        el.style.transform =
          `rotateY(${angle.toFixed(2)}deg) translateZ(${depth.toFixed(1)}px) ` +
          `translateY(${lift.toFixed(1)}px) scale(${scale.toFixed(3)})`;

        // Opacity and blur go on the INNER sheet, never on the panel itself.
        // Both properties flatten an element out of its parent's 3D rendering
        // context, and a flattened panel is composited in DOM order instead of
        // by depth — which is why the panels were showing through each other:
        // the front one had neither property, so every panel after it in the
        // DOM painted on top. Keeping .hubv2-panel a pure transform leaves all
        // twenty-seven sorting by their real z.
        const sheet = el.firstElementChild as HTMLElement | null;
        if (sheet) {
          sheet.style.opacity = String(Math.max(0.22, 1 - fade));
          // A touch of blur off-axis and while moving. This is what stops the
          // spinning fan reading as twenty-seven separately legible cards,
          // which was the thing that felt wrong.
          const blur = reducedRef.current ? 0 : fade * 2.6 + speed * 2.4;
          sheet.style.filter = blur > 0.25 ? `blur(${blur.toFixed(2)}px)` : "none";
        }
      }
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [tuning, metrics.radius]);

  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  const focused = projects[state.focus] ?? projects[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        nudge(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudge(-1);
      } else if (e.key === "Home") {
        e.preventDefault();
        goTo(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nudge, goTo]);

  const handlePanelClick = useCallback(
    (index: number) => {
      // A drag that ends over a panel must not also count as a tap on it.
      if (wasDragged()) return;
      if (index !== state.focus) goTo(index);
    },
    [goTo, state.focus, wasDragged],
  );

  return (
    <div className="hubv2">
      <div className="hubv2__glow" aria-hidden />

      <div
        // The hook binds its own non-passive wheel listener to this node.
        ref={attachStage}
        className={"hubv2__stage" + (state.dragging ? " is-dragging" : "")}
        {...bind}
        role="group"
        aria-roledescription="carousel"
        aria-label="Projects"
      >
        {/* Before the ring on purpose: the stand is flat and the ring is a 3D
            context, so they never depth-sort against each other and paint
            order is the only thing deciding what covers what. */}
        <div className="hubv2__spindle" aria-hidden>
          <span className="hubv2__hub" />
          <span className="hubv2__post" />
          <span className="hubv2__base" />
        </div>

        <div className="hubv2__ring">
          {projects.map((p, i) => (
            <Panel
              key={p.slug}
              ref={(el) => {
                panelRefs.current[i] = el;
              }}
              project={p}
              width={metrics.width}
              height={metrics.height}
              focused={i === state.focus}
              settled={state.settled}
              onClick={() => handlePanelClick(i)}
            />
          ))}
        </div>

      </div>

      <Controls
        project={focused}
        index={state.focus}
        count={count}
        settled={state.settled}
        touched={state.focus !== 0 || state.dragging}
        onPrev={() => nudge(-1)}
        onNext={() => nudge(1)}
      />
    </div>
  );
}

// ----- one panel -----------------------------------------------------------

interface PanelProps {
  project: CatalogProject;
  width: number;
  height: number;
  focused: boolean;
  settled: boolean;
  onClick: () => void;
}

const Panel = function Panel({
  ref,
  project,
  width,
  height,
  focused,
  settled,
  onClick,
}: PanelProps & { ref: (el: HTMLDivElement | null) => void }) {
  const live = project.status === "live";
  const href = live ? project.appUrl ?? project.externalUrl ?? `/p/${project.slug}` : `/p/${project.slug}`;
  const external = live && !project.appUrl && Boolean(project.externalUrl);

  return (
    <div
      ref={ref}
      className={"hubv2-panel" + (focused ? " is-focused" : "")}
      style={
        {
          width,
          height,
          marginLeft: -width / 2,
          marginTop: -height / 2,
          // Unitless on purpose: the iframe scale is calc(var(--panel-w)/1280),
          // and a px value there would evaluate to a length, not a ratio.
          "--panel-w": String(Math.round(width)),
        } as React.CSSProperties
      }
      onClick={onClick}
    >
      <div className="hubv2-panel__sheet">
        <PanelFace project={project} focused={focused} settled={settled} />

        {/* The tab down the spine, like the index tabs on the real thing. */}
        <span className="hubv2-panel__tab" aria-hidden />

        {/* Only the focused, settled panel is a link — otherwise a stray tab
            press could open a project the user cannot even see. */}
        {focused && settled && (
          external ? (
            <a href={href} target="_blank" rel="noreferrer" className="hubv2-panel__open">
              Open <Icon.Launch width={13} height={13} />
            </a>
          ) : (
            <Link href={href} prefetch={false} className="hubv2-panel__open">
              {live ? "Open" : "Details"} <Icon.ArrowRight width={13} height={13} />
            </Link>
          )
        )}
      </div>
    </div>
  );
};

// ----- chrome --------------------------------------------------------------

function Controls({
  project,
  index,
  count,
  settled,
  touched,
  onPrev,
  onNext,
}: {
  project: CatalogProject;
  index: number;
  count: number;
  settled: boolean;
  touched: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="hubv2__controls">
      <button onClick={onPrev} aria-label="Previous project" className="hubv2__arrow">
        <Icon.Chevron width={18} height={18} className="rotate-180" />
      </button>

      <div className="hubv2__readout">
        <span className={"hubv2__readout-title" + (settled ? "" : " is-spinning")}>
          {project.title}
        </span>
        <span className="hubv2__readout-count">
          {index + 1} / {count}
        </span>
        {/* Nothing on screen says the stand can be grabbed, so this does —
            and then gets out of the way the moment it has been. */}
        <span className={"hubv2__hint" + (touched ? " is-hidden" : "")}>
          move left or right to spin · drag · ← →
        </span>
      </div>

      <button onClick={onNext} aria-label="Next project" className="hubv2__arrow">
        <Icon.Chevron width={18} height={18} />
      </button>
    </div>
  );
}
