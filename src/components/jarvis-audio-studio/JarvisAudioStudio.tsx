"use client";

// ---------------------------------------------------------------------------
// Jarvis Audio Studio — three studios, one front door.
//
// Find (MP3 Download), Classify (Music Classified) and Create (Music Creator)
// were three apps in the hub. They do three halves of the same job — get the
// recording, understand it, make the next one — and going between them meant
// going back to the hub and in again.
//
// This shell owns exactly one thing: which studio is mounted. Each studio is
// handed `embedded` and drops its own hub link and wordmark; everything else
// it draws — its tabs, its search, its GPU readout — stays where it was, one
// step down from the switcher. Nothing about how a studio works is reimplemented
// here, which is why merging them did not cost any of them a feature.
//
// The three original routes still resolve; they redirect here with their
// section already chosen, so old links and Jarvis's own pointers keep landing
// in the right place.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DEFAULT_SECTION, SECTIONS, type Section, isSection } from "@/lib/jarvis-audio-studio/sections";
import { Icon } from "../icons";
import "./jarvis-audio-studio.css";

// One studio's worth of JavaScript at a time. Create alone pulls in five
// instrument bundles, and someone who came to look up a song should not be
// made to download a renderer to do it.
const STUDIOS: Record<Section, React.ComponentType<{ embedded?: boolean }>> = {
  find: dynamic(() => import("../mp3-download/Mp3Download").then((m) => m.Mp3Download), {
    ssr: false,
    loading: () => <StudioSkeleton kind="find" />,
  }),
  classify: dynamic(() => import("../music-classified/MusicClassified").then((m) => m.MusicClassified), {
    ssr: false,
    loading: () => <StudioSkeleton kind="classify" />,
  }),
  create: dynamic(() => import("../music-creator/MusicCreator").then((m) => m.MusicCreator), {
    ssr: false,
    loading: () => <StudioSkeleton kind="create" />,
  }),
};

const REMEMBERED = "jarvis-audio-studio:section";

/**
 * @param initialSection The studio the URL asked for, or null when it asked for
 *   none. It has to be nullable: "the URL said Find" and "the URL said nothing"
 *   lead to different behaviour, and a plain default cannot tell them apart —
 *   collapsing them means a link to Find lands wherever you last were instead.
 */
export function JarvisAudioStudio({ initialSection }: { initialSection: Section | null }) {
  const [section, setSection] = useState<Section>(initialSection ?? DEFAULT_SECTION);

  // A route that named its studio means it. Landing on the app's own address
  // resumes wherever the owner left off.
  useEffect(() => {
    try {
      // Arriving by a link that named a studio counts as being there, so the
      // next bare visit resumes it rather than the studio before it.
      if (initialSection) {
        window.localStorage.setItem(REMEMBERED, initialSection);
        return;
      }
      const saved = window.localStorage.getItem(REMEMBERED);
      if (isSection(saved)) setSection(saved);
    } catch {
      /* private browsing, or storage refused — the default stands. */
    }
  }, [initialSection]);

  const go = useCallback((next: Section) => {
    setSection(next);
    try {
      window.localStorage.setItem(REMEMBERED, next);
    } catch {
      /* Remembering is a convenience, never a requirement. */
    }
    // The address should name what is on screen, without a navigation: each
    // studio holds unsaved work, and re-mounting it to change a query string
    // would throw that away.
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.replaceState(null, "", url);
  }, []);

  const Studio = STUDIOS[section];

  return (
    <div className="jas">
      <a href="#jas-stage" className="jas-skip">
        Skip to the studio
      </a>

      <header className="jas-bar">
        {/* This app is an entry in PLUGIN_SLUGS, so it is reached from Jarvis's
            App plugins panel rather than the hub grid — and that is where back
            has to land. */}
        <Link href="/apps/jarvis#plugins" className="jas-back">
          <Icon.ArrowLeft width={14} height={14} aria-hidden />
          <span>App plugins</span>
        </Link>

        <div className="jas-brand">
          <span className="jas-mark" aria-hidden>
            <Icon.Waveform width={15} height={15} />
          </span>
          <span className="jas-brand-t">
            <span className="jas-brand-n">
              Jarvis Audio <em>Studio</em>
            </span>
            <span className="jas-brand-s">Find it, file it, make it</span>
          </span>
        </div>

        <Switcher section={section} onGo={go} />
      </header>

      <main id="jas-stage" className="jas-stage" key={section}>
        <Studio embedded />
      </main>
    </div>
  );
}

/**
 * The segmented switcher.
 *
 * The lit pane is one element that slides between the buttons rather than a
 * background that blinks on and off, so the move itself reads as one control
 * changing state instead of two controls swapping.
 */
function Switcher({ section, onGo }: { section: Section; onGo: (s: Section) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  // Measured rather than computed: the labels differ in length, and at the
  // widest breakpoint each also carries a hint.
  useLayoutEffect(() => {
    const place = () => {
      const host = row.current;
      const active = host?.querySelector<HTMLElement>(`[data-seg="${section}"]`);
      if (!host || !active) return;
      setThumb({ left: active.offsetLeft, width: active.offsetWidth });
    };
    place();

    const host = row.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(host);
    return () => ro.disconnect();
  }, [section]);

  return (
    <div className="jas-switch" role="tablist" aria-label="Studio" ref={row}>
      {thumb && <span className="jas-thumb" style={{ left: thumb.left, width: thumb.width }} aria-hidden />}
      {SECTIONS.map((s) => {
        const Glyph = Icon[s.icon];
        const on = s.id === section;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            data-seg={s.id}
            aria-selected={on}
            aria-current={on}
            className="jas-seg"
            onClick={() => onGo(s.id)}
          >
            <Glyph width={14} height={14} aria-hidden />
            <span className="jas-seg-l">{s.label}</span>
            <span className="jas-seg-h">{s.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * What stands in while a studio's bundle arrives.
 *
 * Shaped like the studio it is replacing rather than a spinner, so the page
 * does not jump when the real thing lands.
 */
function StudioSkeleton({ kind }: { kind: Section }) {
  const rows = kind === "create" ? 6 : 9;
  return (
    <div style={{ padding: "18px 16px" }} aria-busy="true" aria-label="Loading the studio">
      <div
        style={{
          height: 40,
          borderRadius: "var(--jas-r)",
          background: "var(--jas-panel)",
          border: "1px solid var(--jas-line)",
        }}
      />
      <div
        style={{
          marginTop: 14,
          display: "grid",
          gap: 8,
          gridTemplateColumns: kind === "create" ? "repeat(auto-fill,minmax(230px,1fr))" : "1fr",
        }}
      >
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            style={{
              height: kind === "create" ? 112 : 44,
              borderRadius: "var(--jas-r)",
              background: "var(--jas-panel)",
              // The stagger keeps a wall of identical blocks from reading as a
              // frozen page.
              opacity: 1 - i * 0.07,
            }}
          />
        ))}
      </div>
    </div>
  );
}
