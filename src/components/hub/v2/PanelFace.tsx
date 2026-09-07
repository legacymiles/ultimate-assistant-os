"use client";

// ---------------------------------------------------------------------------
// Hub v2 — what is printed on the front of a panel.
//
// Three faces, and which one you get is decided by ONE rule: heavy content
// mounts only on the focused panel, and only once the ring has settled.
//
// That rule is doing two jobs at once, which is why it is the right rule.
// Twenty-seven live iframes would melt a laptop, so performance demands it.
// And "you only see the full page when you stop" is exactly the feel the
// carousel is meant to have — the page resolves as you come to rest, the way
// a flicked card file resolves into one readable card. The constraint and the
// design agree, so neither has to be fought.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { previewFor, previewUrl, type CatalogProject } from "@/lib/catalog";
import { AnimatedIcon } from "../AnimatedIcon";

interface Props {
  project: CatalogProject;
  /** True for the panel at the front of the ring. */
  focused: boolean;
  /** True when the ring has stopped moving. Gates the live content. */
  settled: boolean;
}

export function PanelFace({ project, focused, settled }: Props) {
  const preview = previewFor(project);
  const live = focused && settled && preview !== null;

  return (
    <>
      <div className="hubv2-face__art">
        {live && preview.kind === "video" ? (
          <VideoFace src={preview.src} poster={preview.poster} title={project.title} />
        ) : live ? (
          <FrameFace url={previewUrl(project, preview)} title={project.title} />
        ) : (
          <IconFace project={project} />
        )}
      </div>

      <div className="hubv2-face__plate">
        <div className="hubv2-face__cat">
          {project.category}
          {project.status !== "live" && <span className="hubv2-face__soon">Soon</span>}
        </div>
        <div className="hubv2-face__title">{project.title}</div>
        {project.tag && <div className="hubv2-face__tag">{project.tag}</div>}
        {/* The blurb is only readable on the settled panel, so it is only
            rendered there — off-focus panels stay a clean cover. */}
        {focused && settled && <p className="hubv2-face__blurb">{project.overview}</p>}
      </div>
    </>
  );
}

/** The resting cover: the same animated icon v1 uses, blown up. */
function IconFace({ project }: { project: CatalogProject }) {
  const [h1, h2] = project.hue;
  return (
    <div
      className="hubv2-cover"
      style={
        {
          ["--h1"]: h1,
          ["--h2"]: h2,
        } as React.CSSProperties
      }
    >
      <AnimatedIcon project={project} size={132} />
    </div>
  );
}

function VideoFace({ src, poster, title }: { src: string; poster?: string; title: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Autoplay is only permitted muted, and even then it can be refused.
    // A rejected promise here is ordinary, not an error worth logging.
    ref.current?.play().catch(() => {});
  }, []);

  if (failed) {
    return <div className="hubv2-frame__fallback">Clip unavailable</div>;
  }
  return (
    <video
      ref={ref}
      className="hubv2-media"
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      autoPlay
      preload="none"
      aria-label={`${title} preview`}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * The real app, running on the face of the panel.
 *
 * Scaled down rather than served a narrow viewport: an app rendered at 420px
 * would lay itself out as a phone, and the point is to show the thing as it
 * actually looks. So it is mounted at desktop width and CSS-scaled to fit,
 * which is a screenshot that happens to still be moving.
 */
function FrameFace({ url, title }: { url: string | null; title: string }) {
  const [ready, setReady] = useState(false);
  if (!url) return <div className="hubv2-frame__fallback">No preview</div>;

  // Our own routes are not sandboxed. `allow-scripts allow-same-origin`
  // together grants a same-origin frame enough to remove its own sandbox, so
  // on a first-party route the attribute buys nothing and only costs the app
  // the localStorage it needs to render anything real. A third-party site gets
  // a genuine sandbox, because there the restriction is doing actual work.
  const sameOrigin = url.startsWith("/");

  return (
    <div className="hubv2-frame">
      {!ready && <div className="hubv2-frame__loading">Loading {title}…</div>}
      <iframe
        src={url}
        title={`${title} preview`}
        className="hubv2-frame__iframe"
        loading="lazy"
        sandbox={sameOrigin ? undefined : "allow-scripts"}
        referrerPolicy={sameOrigin ? undefined : "no-referrer"}
        onLoad={() => setReady(true)}
      />
      {/* Swallows pointer events so a drag across the carousel does not get
          eaten by whatever is inside the frame. */}
      <span className="hubv2-frame__shield" aria-hidden />
    </div>
  );
}
