"use client";

// ---------------------------------------------------------------------------
// The mockup bake-off — one surface, used by App Builder and Client Review.
//
// Three directions, drawn, side by side, pick one. Shared rather than written
// twice because the owner and their client must be looking at the SAME thing:
// a client approving a look the owner never saw rendered the same way is the
// bug this component exists to make impossible.
//
// Why iframes and not a React preview: a mockup has to be able to use its own
// type scale, its own corner radius and its own colour polarity without the
// hub's stylesheet leaking in and quietly making all three lanes look like the
// hub. An iframe is the only honest isolation boundary in a browser. They are
// `sandbox="allow-same-origin"` and never `allow-scripts` — same-origin so the
// hub's woff2 faces load, no scripts because a drawing has no business running
// anything (and `renderMockup` is tested to contain none).
//
// Each lane is drawn at a real device width and then SCALED to fit its column,
// so what the owner judges is a true 1280px app, not a 1280px app reflowed
// into 380px of panel and made to look broken. The phone toggle re-renders at
// 390px instead, because a phone layout is a different drawing, not a smaller
// one.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { directionsFor } from "@/lib/mockup/directions";
import { fluxPrompt } from "@/lib/mockup/flux";
import { FRAME_HEIGHT, FRAME_WIDTH, renderMockup } from "@/lib/mockup/render";
import type { Chrome, Device, LookChoice, MockupSpec } from "@/lib/mockup/types";
import { useMockupPictures, type PcState, type PictureState } from "@/lib/mockup/useMockupPictures";

import "./mockup.css";

interface Props {
  spec: MockupSpec;
  /** The design skill the spec recommends — lane 1. */
  recommended?: string | null;
  /** The direction already settled on, when there is one. */
  chosen?: LookChoice | null;
  /** Pick (or re-pick) a direction. Omit to make the bake-off read-only. */
  onChoose?: (skill: string) => void;
  /** Shown on the button. "Build this look" for the owner, "Approve" for a client. */
  chooseLabel?: string;
  /** Who is looking. A client is never shown the skill's internal name. */
  as?: "owner" | "client";
  /** A short line above the lanes, in the host app's voice. */
  caption?: string;
  /**
   * Paint each lane with Flux 2 on the owner's PC when its drawer is up.
   * On by default. The drawer only answers on the owner's own machine, so a
   * client's screen simply shows the layouts.
   */
  pictures?: boolean;
}

/** A lane that could not be drawn still holds its place, carrying why. */
interface Lane {
  skill: string;
  note: string;
  role: "recommended" | "contrast";
  chrome: Chrome;
  html: string;
  error: string;
  prompt: string;
}

export function MockupBakeOff({
  spec,
  recommended,
  chosen,
  onChoose,
  chooseLabel = "Build this look",
  as = "owner",
  caption,
  pictures: wantPictures = true,
}: Props) {
  const [device, setDevice] = useState<Device>("desktop");
  /** Show the Flux picture, or the coded layout, in each lane. */
  const [view, setView] = useState<"picture" | "layout">("picture");
  /** Which lane is open full-width. null = all three side by side. */
  const [solo, setSolo] = useState<string | null>(null);
  const headingId = useId();

  const directions = useMemo(() => directionsFor(recommended), [recommended]);

  // Drawing is pure string work and takes under a millisecond a lane, so it
  // happens in a memo rather than an effect — there is no loading state to
  // show and nothing to wait for, which is the point of not using a model.
  const lanes = useMemo<Lane[]>(
    () =>
      directions.map((d) => {
        try {
          return { ...d, html: renderMockup(spec, d, { device }), error: "", prompt: fluxPrompt(spec, d, device) };
        } catch {
          // A lane that fails keeps its place. "Why did this direction not
          // draw" is itself a result; a lane that vanishes destroys the
          // comparison the panel exists to make (checklist R1).
          return {
            ...d,
            html: "",
            prompt: "",
            error: "This direction didn't draw. The other two still work, and picking one of them is safe.",
          };
        }
      }),
    [directions, spec, device],
  );

  // Lane order IS draw order: the recommendation is painted first, so the
  // lane the owner reads first is never the one still waiting.
  const jobs = useMemo(() => lanes.filter((l) => l.prompt).map((l) => ({ id: l.skill, prompt: l.prompt })), [lanes]);
  const { pc, pictures, redraw } = useMockupPictures(jobs, device, wantPictures);
  const anyPicture = Object.values(pictures).some((p) => p.status === "done");

  const shown = solo ? lanes.filter((l) => l.skill === solo) : lanes;

  const choose = useCallback(
    (skill: string) => {
      // Picking the direction that is already picked is a no-op rather than a
      // second write (checklist D5) — double-tapping a card on a phone is the
      // normal way to hit this.
      if (!onChoose || chosen?.skill === skill) return;
      onChoose(skill);
    },
    [onChoose, chosen?.skill],
  );

  return (
    <section className="mk" aria-labelledby={headingId}>
      <header className="mk-top">
        <div>
          <h3 className="mk-h" id={headingId}>
            {solo ? "One direction" : "Three directions"}
          </h3>
          <p className="mk-sub">
            {caption ??
              (as === "client"
                ? "How your site could look. Pick the one you want and we build that."
                : "Drawn from the features you accepted. Pick one and the build is held to it.")}
          </p>
        </div>
        <div className="mk-controls">
          {wantPictures && (
            <div className="mk-seg" role="group" aria-label="What each lane shows">
              {(["picture", "layout"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`mk-seg-b${view === v ? " on" : ""}`}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {v === "picture" ? "Flux render" : "Live layout"}
                </button>
              ))}
            </div>
          )}
          <div className="mk-seg" role="group" aria-label="Mockup width">
            {(["desktop", "phone"] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={`mk-seg-b${device === d ? " on" : ""}`}
                aria-pressed={device === d}
                onClick={() => setDevice(d)}
              >
                {d === "desktop" ? "Desktop" : "Phone"}
              </button>
            ))}
          </div>
          {solo && (
            <button type="button" className="mk-ghost" onClick={() => setSolo(null)}>
              Compare all three
            </button>
          )}
        </div>
      </header>

      {wantPictures && <PcLine pc={pc} any={anyPicture} pictures={pictures} />}

      <div className={`mk-lanes${solo ? " mk-solo" : ""}`} data-count={shown.length}>
        {shown.map((lane) => {
          const picked = chosen?.skill === lane.skill;
          return (
            <article key={lane.skill} className={`mk-lane${picked ? " picked" : ""}`}>
              <div className="mk-lane-top">
                <span className="mk-name">
                  {as === "client" ? directionLabel(lane) : lane.skill}
                </span>
                {lane.role === "recommended" && <span className="mk-badge">Recommended</span>}
                {picked && <span className="mk-badge yes">Chosen</span>}
              </div>

              {lane.error ? (
                <div className="mk-fail" role="status">
                  <p>{lane.error}</p>
                </div>
              ) : wantPictures && view === "picture" && pictures[lane.skill]?.status === "done" ? (
                <Picture
                  pic={pictures[lane.skill]}
                  device={device}
                  title={`${spec.name} in the ${directionLabel(lane)} direction, drawn with Flux 2`}
                  onOpen={() => setSolo(solo ? null : lane.skill)}
                  onRedraw={pc === "off" ? undefined : () => redraw(lane.skill)}
                  expanded={Boolean(solo)}
                />
              ) : (
                <div className="mk-frame-wrap">
                  <Frame
                    html={lane.html}
                    device={device}
                    title={`${spec.name} in the ${directionLabel(lane)} direction`}
                    onOpen={() => setSolo(solo ? null : lane.skill)}
                    expanded={Boolean(solo)}
                  />
                  {wantPictures && view === "picture" && <PaintingBadge pic={pictures[lane.skill]} />}
                </div>
              )}

              <p className="mk-note">{lane.note}</p>

              {onChoose && !lane.error && (
                <button
                  type="button"
                  className={`mk-pick${picked ? " on" : ""}`}
                  onClick={() => choose(lane.skill)}
                  aria-pressed={picked}
                >
                  {picked ? "This is the look" : chooseLabel}
                </button>
              )}
            </article>
          );
        })}
      </div>

      <p className="mk-fine">
        A drawing, not the finished app — the numbers in it are illustrative. Everything else is
        your own spec.
      </p>
    </section>
  );
}

/** One line saying whether Flux is painting, and how to switch it on when it isn't. */
function PcLine({ pc, any, pictures }: { pc: PcState; any: boolean; pictures: Record<string, PictureState> }) {
  const left = Object.values(pictures).filter((p) => p.status === "drawing" || p.status === "waiting").length;
  let text: string;
  if (pc === "checking") text = "Looking for Flux 2 on your PC…";
  else if (pc === "off")
    text = any
      ? "Showing Flux 2 renders saved earlier. Your PC's drawer is off, so changes show as layouts until it's back."
      : "Flux 2 renders appear here when your PC's picture drawer is running (Pinokio + node tools/wangp-image/server.mjs). Until then each lane is the live layout.";
  else if (left)
    text = `Painting with Flux 2 on your PC, lane by lane — about 20 seconds each (the first after a restart takes ~2 minutes). ${left} to go.`;
  else text = "Painted with Flux 2 on your PC — free. Switch to Live layout to see the exact page structure.";
  return (
    <p className={`mk-pc is-${pc}${left ? " is-busy" : ""}`} role="status">
      <span className="mk-pc-dot" aria-hidden />
      {text}
    </p>
  );
}

function PaintingBadge({ pic }: { pic?: PictureState }) {
  if (!pic || pic.status === "done") return null;
  if (pic.status === "failed") {
    if (pic.error === "off") return null;
    return (
      <span className="mk-paint is-failed" title={pic.error}>
        Flux didn&apos;t draw this one — showing the layout
      </span>
    );
  }
  return (
    <span className="mk-paint" aria-live="polite">
      <span className="mk-paint-dot" aria-hidden />
      {pic.status === "drawing" ? "Painting with Flux 2…" : "Waiting its turn for Flux 2"}
    </span>
  );
}

/** A lane's Flux picture, at the lane's width. */
function Picture({
  pic,
  device,
  title,
  onOpen,
  onRedraw,
  expanded,
}: {
  pic: PictureState;
  device: Device;
  title: string;
  onOpen: () => void;
  onRedraw?: () => void;
  expanded: boolean;
}) {
  return (
    <div className={`mk-pic is-${device}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from the owner's PC; next/image adds nothing */}
      <img src={pic.image} alt={title} />
      <button type="button" className="mk-open" onClick={onOpen}>
        <span>{expanded ? "Close" : "Open full width"}</span>
      </button>
      {onRedraw && (
        <button type="button" className="mk-redraw" onClick={onRedraw} title="Paint this lane again with Flux 2">
          Redraw
        </button>
      )}
    </div>
  );
}

/** What a client is told a direction is, without the skill's internal name. */
function directionLabel(lane: { skill: string; role: string }): string {
  if (lane.role === "recommended") return "Our recommendation";
  const pretty = lane.skill
    .replace(/-skill$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return pretty;
}

/**
 * One drawn mockup, scaled to fit.
 *
 * The scale is measured from the column rather than guessed with a media
 * query, because this component is dropped into a full-width panel in one app
 * and a narrow side column in another, and the frame has to be right in both
 * without either host knowing about it.
 */
function Frame({
  html,
  device,
  title,
  onOpen,
  expanded,
}: {
  html: string;
  device: Device;
  title: string;
  onOpen: () => void;
  expanded: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.3);
  const w = FRAME_WIDTH[device];
  const h = FRAME_HEIGHT[device];

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fit = () => {
      const avail = host.clientWidth;
      if (avail > 0) setScale(Math.min(1, avail / w));
    };
    fit();
    // ResizeObserver rather than a window listener: the column changes width
    // when a lane goes solo, which no window event reports.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [w, device, expanded]);

  return (
    <div className="mk-frame" ref={hostRef} style={{ height: `${Math.round(h * scale)}px` }}>
      <iframe
        className="mk-iframe"
        title={title}
        srcDoc={html}
        sandbox="allow-same-origin"
        loading="lazy"
        tabIndex={-1}
        style={{
          width: `${w}px`,
          height: `${h}px`,
          transform: `scale(${scale})`,
        }}
      />
      {/*
        The overlay is what makes the lane tappable at all: a scaled iframe
        swallows pointer events and would trap a finger mid-swipe on a phone
        (checklist U1). It sits over the frame, so the page keeps scrolling and
        a tap opens the lane full width.
      */}
      <button type="button" className="mk-open" onClick={onOpen}>
        <span>{expanded ? "Close" : "Open full width"}</span>
      </button>
    </div>
  );
}
