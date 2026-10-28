"use client";

// ---------------------------------------------------------------------------
// The owner's Client view home: every app and client website as a card whose
// face is the site itself — its hero, live, in miniature.
//
// The trick that makes opening one feel like a single motion: each card's
// preview is the real site rendered at the exact size of the Client view's
// stage, then scaled down to the card. Opening it lifts that same preview out
// of the grid and grows it to the stage (box from card → stage, scale from
// card/stage → 1), so the page you land on is pixel-for-pixel the page you
// clicked. The grid parts around it, nearest cards first. The Client view
// mounts underneath while it grows and the gallery fades away once the real
// frame has loaded (ClientReviewApp holds both for that moment).
//
// Cost control: a preview loads only near the screen, at most three at once,
// and is let go a while after it scrolls away. Thumbnails are sandboxed — no
// sound, camera, location or pop-ups, and they can't navigate this page.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { matches, useRows, type Row, type Target } from "./SitePicker";

/** The Client view's header height, so a preview is sized to the stage it grows into. */
export const PORTAL_TOP_H = 68;
/** Narrowest a card gets: three across on a laptop, two on a phone. */
const MIN_CARD = 360;
const MIN_CARD_PHONE = 150;
const GAP = 16;
const MAX_LOADING = 3;
const LET_GO_MS = 12_000;
const OPEN_MS = 680;
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export type GalleryPhase = "idle" | "opening" | "leaving";

interface Stage {
  w: number;
  h: number;
}

/** At most MAX_LOADING previews loading at once; the rest wait their turn. */
function useLoadQueue() {
  const st = useRef({ running: new Set<string>(), queue: [] as { key: string; go: () => void }[] });
  const pump = useCallback(() => {
    const s = st.current;
    while (s.running.size < MAX_LOADING && s.queue.length) {
      const next = s.queue.shift()!;
      s.running.add(next.key);
      next.go();
    }
  }, []);
  return useMemo(
    () => ({
      request(key: string, go: () => void) {
        const s = st.current;
        if (s.running.has(key) || s.queue.some((q) => q.key === key)) return;
        s.queue.push({ key, go });
        pump();
      },
      release(key: string) {
        const s = st.current;
        s.running.delete(key);
        s.queue = s.queue.filter((q) => q.key !== key);
        pump();
      },
    }),
    [pump],
  );
}
type LoadQueue = ReturnType<typeof useLoadQueue>;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SiteGallery({
  phase,
  onOpen,
  onExpanded,
}: {
  phase: GalleryPhase;
  /** Called the moment a card is clicked, so the Client view can start loading underneath. */
  onOpen: (t: Target) => void;
  /** The preview has finished growing to the stage. */
  onExpanded: () => void;
}) {
  const [q, setQ] = useState("");
  const { rows, error } = useRows();
  const shown = rows.filter((r) => matches(r, q));
  const root = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [cols, setCols] = useState(3);
  const [cardW, setCardW] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const queue = useLoadQueue();

  // The stage a preview will grow into, and how wide each card is.
  useLayoutEffect(() => {
    const measure = () => {
      const r = root.current;
      const g = inner.current;
      if (!r || !g) return;
      setStage({ w: r.clientWidth, h: Math.max(200, r.clientHeight - PORTAL_TOP_H) });
      const cs = getComputedStyle(g);
      const W = g.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const min = W < 600 ? MIN_CARD_PHONE : MIN_CARD;
      const c = Math.max(1, Math.floor((W + GAP) / (min + GAP)));
      setCols(c);
      setCardW((W - GAP * (c - 1)) / c);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (root.current) ro.observe(root.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);

  const open = useCallback(
    (row: Row, shot: HTMLElement, scaler: HTMLElement) => {
      if (picked || !stage || !root.current) return;
      const from = shot.getBoundingClientRect();
      const box = root.current.getBoundingClientRect();
      const to = { left: box.left, top: box.top + PORTAL_TOP_H, width: stage.w, height: stage.h };

      // The rest of the grid parts around the card, nearest first.
      const cx = from.left + from.width / 2;
      const cy = from.top + from.height / 2;
      root.current.querySelectorAll<HTMLElement>(".crg-card").forEach((el) => {
        const r = el.getBoundingClientRect();
        const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
        el.style.setProperty("--part-delay", `${Math.min(260, d / 6)}ms`);
        el.style.setProperty("--part-x", `${Math.sign(r.left + r.width / 2 - cx) * 18}px`);
        el.style.setProperty("--part-y", `${Math.sign(r.top + r.height / 2 - cy) * 18}px`);
      });

      setPicked(row.key);
      onOpen(row.target);

      // Lift the preview out of the grid — same element, so the live site never reloads.
      Object.assign(shot.style, {
        position: "fixed",
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
        zIndex: "80",
        margin: "0",
      });
      if (prefersReducedMotion()) {
        Object.assign(shot.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: "0" });
        scaler.style.transform = "scale(1)";
        onExpanded();
        return;
      }
      const start = Number(scaler.dataset.scale) || from.width / stage.w;
      const grow = shot.animate(
        [
          { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, borderRadius: "14px" },
          { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: "0px" },
        ],
        { duration: OPEN_MS, easing: EASE, fill: "forwards" },
      );
      scaler.animate([{ transform: `scale(${start})` }, { transform: "scale(1)" }], { duration: OPEN_MS, easing: EASE, fill: "forwards" });
      grow.onfinish = () => onExpanded();
    },
    [picked, stage, onOpen, onExpanded],
  );

  const previewH = stage && cardW ? Math.round(cardW * Math.min(stage.h / stage.w, 1.2)) : 0;

  return (
    <div className={`cr-root is-embedded crg phase-${phase} ${picked ? "is-opening" : ""}`} ref={root}>
      <div className="crg-inner" ref={inner}>
        <header className="crg-head">
          <p className="cr-kicker">Client view</p>
          <h1>What do you want to work on?</h1>
          <p>Every app and client website, live. Open one, point at what you want changed, and Send &amp; build.</p>
          <div className="crp-search big">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an app or website…" aria-label="Find an app or website" />
          </div>
        </header>
        {error && <p className="crp-note">{error}</p>}
        {!error && rows.length > 0 && !shown.length && <p className="crp-note">Nothing called “{q}”.</p>}

        {(["Client websites", "My apps"] as const).map((group) => {
          const inGroup = shown.filter((r) => r.group === group);
          if (!inGroup.length && group === "Client websites") return null;
          return (
            <section key={group} className="crg-group" aria-label={group}>
              <p className="crp-group-name">
                {group} <span>{inGroup.length}</span>
              </p>
              <div
                className="crg-grid"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP }}
              >
                {inGroup.map((r, i) => (
                  <Card
                    key={r.key}
                    row={r}
                    index={i}
                    stage={stage}
                    cardW={cardW}
                    previewH={previewH}
                    queue={queue}
                    root={root}
                    picked={picked === r.key}
                    onOpen={open}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Card({
  row,
  index,
  stage,
  cardW,
  previewH,
  queue,
  root,
  picked,
  onOpen,
}: {
  row: Row;
  index: number;
  stage: Stage | null;
  cardW: number;
  previewH: number;
  queue: LoadQueue;
  root: React.RefObject<HTMLDivElement | null>;
  picked: boolean;
  onOpen: (row: Row, shot: HTMLElement, scaler: HTMLElement) => void;
}) {
  const el = useRef<HTMLButtonElement>(null);
  const shot = useRef<HTMLDivElement>(null);
  const scaler = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [granted, setGranted] = useState(false);
  const [ready, setReady] = useState(false);

  // Load only near the screen; let go a while after it scrolls away.
  useEffect(() => {
    const node = el.current;
    if (!node || !row.url) return;
    let letGo: number | undefined;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          window.clearTimeout(letGo);
          setNear(true);
        } else {
          letGo = window.setTimeout(() => setNear(false), LET_GO_MS);
        }
      },
      { root: root.current, rootMargin: "300px 0px" },
    );
    io.observe(node);
    return () => {
      io.disconnect();
      window.clearTimeout(letGo);
    };
  }, [row.url, root]);

  useEffect(() => {
    if (picked) return; // the opening card keeps its preview whatever the observer says
    if (!near) {
      queue.release(row.key);
      setGranted(false);
      setReady(false);
      return;
    }
    queue.request(row.key, () => setGranted(true));
  }, [near, picked, queue, row.key]);
  useEffect(() => () => queue.release(row.key), [queue, row.key]);

  // A preview that never says it loaded still frees its slot.
  useEffect(() => {
    if (!granted) return;
    const t = window.setTimeout(() => queue.release(row.key), 9000);
    return () => window.clearTimeout(t);
  }, [granted, queue, row.key]);

  const scale = stage && cardW ? cardW / stage.w : 0;
  const [h1, h2] = row.hue;

  return (
    <button
      ref={el}
      className={`crg-card ${picked ? "is-picked" : ""}`}
      style={{ "--i": index } as React.CSSProperties}
      onClick={() => shot.current && scaler.current && onOpen(row, shot.current, scaler.current)}
      aria-label={`Open ${row.title}`}
    >
      <div className="crg-shot-slot" style={{ height: previewH || undefined }}>
        <div
          className={`crg-shot ${ready ? "is-ready" : ""}`}
          ref={shot}
          style={
            {
              "--h1": h1,
              "--h2": h2,
            } as React.CSSProperties
          }
        >
          <div className="crg-placeholder" aria-hidden>
            <span>{row.title}</span>
          </div>
          {stage && scale > 0 && granted && row.url && (
            <div
              className="crg-scaler"
              ref={scaler}
              data-scale={scale}
              style={{ width: stage.w, height: stage.h, transform: `scale(${scale})` }}
            >
              <iframe
                src={row.url}
                title=""
                aria-hidden
                tabIndex={-1}
                loading="eager"
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-forms"
                allow="autoplay 'none'; camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; fullscreen 'none'"
                onLoad={() => {
                  queue.release(row.key);
                  // Let the app paint its first screen before it fades in.
                  window.setTimeout(() => setReady(true), 650);
                }}
              />
            </div>
          )}
          {!granted && <div className="crg-scaler" ref={scaler} data-scale={scale} />}
          <span className="crg-edge" aria-hidden />
        </div>
      </div>
      <span className="crg-info">
        <span className="crg-title">{row.title}</span>
        <span className="crg-sub">{row.sub}</span>
        {row.status && <span className={`crp-status tone-${row.tone}`}>{row.status}</span>}
        <span className="crg-go" aria-hidden>
          <span className="crg-go-word">Open</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 17 17 7M8 7h9v9" />
          </svg>
        </span>
      </span>
    </button>
  );
}
