"use client";

// ---------------------------------------------------------------------------
// Studio home — several apps that do one kind of job, behind one front door.
//
// The generalised Jarvis Audio Studio shell. It owns exactly one thing: which
// section is mounted. Each section is the app's own existing component, handed
// `embedded` so it drops its own hub link and wordmark; nothing about how a
// section works is reimplemented here, which is why merging apps into a home
// costs none of them a feature. Old routes redirect in with `?section=`.
//
// Design skill driving the look: interactive-web-studio — dark, dense,
// restrained. The switcher is the one signature moment: a lit pane that slides
// between the sections while the whole home's accent hue glides to the
// section's own, and a hairline under the bar that is brightest under the pane.
// The background never moves, so it can never cost a line of text its contrast.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { stepSection, type HomeSection, type PendingPanel } from "@/lib/studio-home/sections";
import { fileRequest } from "@/lib/studio-home/fileRequest";
import { Icon } from "../icons";
import { GO_EVENT, type GoDetail } from "./go";
import "./studio-home.css";

export type SectionComponent = React.ComponentType<{ embedded?: boolean }>;

export interface StudioHomeProps<Id extends string> {
  /** Wordmark: `name` in full weight, `em` after it in the quiet weight. */
  brand: { name: string; em?: string; tagline: string; icon: keyof typeof Icon };
  sections: readonly HomeSection<Id>[];
  /** Section id → its lazily loaded component. A pending section needs none. */
  components: Partial<Record<Id, SectionComponent>>;
  /** localStorage key for the last section opened on this device. */
  rememberKey: string;
  /** What the URL asked for, validated on the server; null = resume. */
  initialSection: Id | null;
  defaultSection: Id;
  back?: { href: string; label: string };
  /**
   * The bar scrolls away with the page instead of sticking. For a home whose
   * sections already have a sticky toolbar of their own — two stacked sticky
   * bars on a phone leave too little room for the work.
   */
  scrollingBar?: boolean;
  /**
   * When this home is opened inside a frame (Jarvis pulls App Builder up over
   * itself), show only this section, exactly as it renders on its own: no
   * bar, no switcher, nothing remembered.
   */
  framedSection?: Id;
}

const BAR_VAR = "--sh-top";

export function StudioHome<Id extends string>({
  brand,
  sections,
  components,
  rememberKey,
  initialSection,
  defaultSection,
  back = { href: "/apps/jarvis#plugins", label: "App plugins" },
  scrollingBar = false,
  framedSection,
}: StudioHomeProps<Id>) {
  const [section, setSection] = useState<Id>(initialSection ?? defaultSection);
  const [framed, setFramed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);

  // Framed: lock to the one section the frame is for, and remember nothing —
  // the framing page decides what is in the frame, not this device's history.
  // Otherwise a route that named its section means it, and a bare visit
  // resumes wherever the owner left off.
  useEffect(() => {
    let inFrame = false;
    try {
      inFrame = window.self !== window.top;
    } catch {
      inFrame = true;
    }
    if (framedSection && inFrame) {
      setFramed(true);
      setSection(framedSection);
      return;
    }
    try {
      if (initialSection) {
        // A link to another section of this same home (a client navigation
        // re-renders the page with a new initialSection) switches in place.
        setSection(initialSection);
        window.localStorage.setItem(rememberKey, initialSection);
        return;
      }
      const saved = window.localStorage.getItem(rememberKey);
      if (saved && sections.some((s) => s.id === saved)) setSection(saved as Id);
    } catch {
      /* private browsing, or storage refused — the default stands. */
    }
  }, [initialSection, rememberKey, sections, framedSection]);

  const go = useCallback(
    (next: Id, params: Record<string, string> = {}) => {
      setSection(next);
      try {
        window.localStorage.setItem(rememberKey, next);
      } catch {
        /* Remembering is a convenience, never a requirement. */
      }
      // The address names what is on screen, without a navigation: each
      // section may hold unsaved work, and a reload to change a query string
      // would throw it away. Parameters meant for one section do not follow
      // the owner into the next.
      const url = new URL(window.location.href);
      for (const k of [...url.searchParams.keys()]) if (k !== "section" && k !== "p") url.searchParams.delete(k);
      url.searchParams.set("section", next);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      window.history.replaceState(window.history.state, "", url);
    },
    [rememberKey],
  );

  // A section asking to hand over to another one (see go.ts).
  useEffect(() => {
    const onGo = (e: Event) => {
      const d = (e as CustomEvent<GoDetail>).detail;
      if (!d || !sections.some((s) => s.id === d.section)) return;
      e.preventDefault();
      go(d.section as Id, d.params ?? {});
      window.scrollTo({ top: 0 });
    };
    window.addEventListener(GO_EVENT, onGo);
    return () => window.removeEventListener(GO_EVENT, onGo);
  }, [go, sections]);

  // Fixed and sticky pieces inside a section were written for a page with no
  // bar above them; they read the bar's height from here.
  useLayoutEffect(() => {
    const host = root.current;
    const b = bar.current;
    if (!host) return;
    const set = () => host.style.setProperty(BAR_VAR, `${framed || !b ? 0 : b.offsetHeight}px`);
    set();
    if (!b || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(b);
    return () => ro.disconnect();
  }, [framed]);

  const current = sections.find((s) => s.id === section) ?? sections[0];
  const Section: SectionComponent | undefined = (components as Partial<Record<string, SectionComponent>>)[current.id];

  return (
    <div
      ref={root}
      className={`sh${scrollingBar ? " sh--scrolling" : ""}${framed ? " sh--framed" : ""}`}
      style={{ "--sh-hue": current.hue } as React.CSSProperties}
      data-section={current.id}
    >
      {/* Before hydration, so a framed home never flashes its bar. */}
      {framedSection && (
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(window.self!==window.top)document.documentElement.setAttribute('data-sh-framed','1')}catch(e){document.documentElement.setAttribute('data-sh-framed','1')}",
          }}
        />
      )}

      {!framed && (
        <>
          <a href="#sh-stage" className="sh-skip">
            Skip to {current.label}
          </a>

          <header className="sh-bar" ref={bar}>
            <Link href={back.href} className="sh-back">
              <Icon.ArrowLeft width={14} height={14} aria-hidden />
              <span>{back.label}</span>
            </Link>

            <Brand brand={brand} />

            <Switcher sections={sections} section={current.id} onGo={go} />
          </header>
        </>
      )}

      <main
        id="sh-stage"
        className="sh-stage"
        key={current.id}
        role={framed ? undefined : "tabpanel"}
        aria-labelledby={framed ? undefined : `sh-tab-${current.id}`}
      >
        {current.pending ? (
          <PendingSection panel={current.pending} icon={current.icon} />
        ) : Section ? (
          <Section embedded />
        ) : (
          <PendingSection
            icon={current.icon}
            panel={{ title: `${current.label} is not wired in yet`, body: ["This section has a name but no screen yet."] }}
          />
        )}
      </main>
    </div>
  );
}

function Brand({ brand }: { brand: StudioHomeProps<string>["brand"] }) {
  const Glyph = Icon[brand.icon];
  return (
    <div className="sh-brand">
      <span className="sh-mark" aria-hidden>
        <Glyph width={15} height={15} />
      </span>
      <span className="sh-brand-t">
        <span className="sh-brand-n">
          {brand.name}
          {brand.em && <em> {brand.em}</em>}
        </span>
        <span className="sh-brand-s">{brand.tagline}</span>
      </span>
    </div>
  );
}

/**
 * The segmented switcher.
 *
 * One lit pane slides between the buttons rather than a background blinking
 * on and off, so the move reads as one control changing state. On a phone the
 * row scrolls sideways inside itself — the page never does — and the open
 * section is kept in view.
 */
function Switcher<Id extends string>({
  sections,
  section,
  onGo,
}: {
  sections: readonly HomeSection<Id>[];
  section: Id;
  onGo: (s: Id) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const host = row.current;
      const active = host?.querySelector<HTMLElement>(`[data-seg="${section}"]`);
      if (!host || !active) return;
      setThumb({ left: active.offsetLeft, width: active.offsetWidth });
      // The bar's hairline is brightest under the open section.
      const barEl = host.closest<HTMLElement>(".sh-bar");
      if (barEl) {
        const a = active.getBoundingClientRect();
        const b = barEl.getBoundingClientRect();
        barEl.style.setProperty("--sh-glow-x", `${Math.round(a.left - b.left + a.width / 2)}px`);
      }
      // Keep the open section visible in a row that scrolls, without moving the page.
      const from = active.offsetLeft - 12;
      const to = active.offsetLeft + active.offsetWidth + 12 - host.clientWidth;
      if (host.scrollLeft > from) host.scrollLeft = Math.max(0, from);
      else if (host.scrollLeft < to) host.scrollLeft = to;
    };
    place();
    const host = row.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(host);
    return () => ro.disconnect();
  }, [section]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = stepSection(sections, section, e.key);
    onGo(next);
    row.current?.querySelector<HTMLElement>(`[data-seg="${next}"]`)?.focus();
  };

  return (
    <div
      className="sh-switch"
      role="tablist"
      aria-label="Sections"
      ref={row}
      onKeyDown={onKey}
    >
      {thumb && <span className="sh-thumb" style={{ left: thumb.left, width: thumb.width }} aria-hidden />}
      {sections.map((s) => {
        const Glyph = Icon[s.icon];
        const on = s.id === section;
        return (
          <button
            key={s.id}
            id={`sh-tab-${s.id}`}
            type="button"
            role="tab"
            data-seg={s.id}
            aria-selected={on}
            aria-controls="sh-stage"
            tabIndex={on ? 0 : -1}
            className="sh-seg"
            style={{ "--seg-hue": s.hue } as React.CSSProperties}
            onClick={() => onGo(s.id)}
          >
            <Glyph width={14} height={14} aria-hidden />
            <span className="sh-seg-l">{s.label}</span>
            {s.pending && (
              <span className="sh-seg-pc" title="On your PC — not on the website yet">
                PC
              </span>
            )}
            <span className="sh-seg-h">{s.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A section whose app is not on the website yet. Says so in plain words,
 * says who brings it in, and — when the home gives one — files that request
 * in one press so the owner never has to write it.
 */
function PendingSection({ panel, icon }: { panel: PendingPanel; icon: keyof typeof Icon }) {
  const Glyph = Icon[icon];
  const [state, setState] = useState<"idle" | "busy" | "filed" | "already" | "error">("idle");
  const [problem, setProblem] = useState("");

  const ask = async () => {
    if (!panel.request) return;
    setState("busy");
    try {
      setState(await fileRequest(panel.request.folder, panel.request.text));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't file it.");
      setState("error");
    }
  };

  return (
    <section className="sh-pending" aria-labelledby="sh-pending-t">
      <span className="sh-pending-mark" aria-hidden>
        <Glyph width={20} height={20} />
      </span>
      <p className="sh-pending-k">On your PC · not on the website yet</p>
      <h2 id="sh-pending-t">{panel.title}</h2>
      {panel.body.map((p, i) => (
        <p key={i} className="sh-pending-p">
          {p}
        </p>
      ))}
      {panel.request && (
        <div className="sh-pending-act">
          <button
            type="button"
            className="sh-btn"
            onClick={ask}
            disabled={state === "busy" || state === "filed" || state === "already"}
          >
            {state === "busy" ? "Filing…" : state === "filed" || state === "already" ? "In your queue ✓" : panel.request.label}
          </button>
          <span className="sh-pending-note" role="status">
            {state === "filed" && "Filed in In Queue. Claude Code on the PC picks it up and clears it when it's done."}
            {state === "already" && "That request was already waiting in In Queue."}
            {state === "error" && problem}
          </span>
        </div>
      )}
    </section>
  );
}

/**
 * What stands in while a section's bundle arrives — shaped like the section,
 * not a spinner, so nothing jumps when the real thing lands.
 */
export function HomeSkeleton({ shape = "rows" }: { shape?: "rows" | "grid" | "canvas" }) {
  const n = shape === "grid" ? 6 : shape === "canvas" ? 1 : 9;
  return (
    <div className="sh-skel" data-shape={shape} aria-busy="true" aria-label="Loading">
      <div className="sh-skel-bar" />
      <div className="sh-skel-body">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="sh-skel-cell" style={{ opacity: 1 - i * 0.07 }} />
        ))}
      </div>
    </div>
  );
}
