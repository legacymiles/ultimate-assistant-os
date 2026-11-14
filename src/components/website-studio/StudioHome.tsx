"use client";

// ---------------------------------------------------------------------------
// The Studio's home — one question, three ways to answer it, and everything
// you have already made underneath.
//
// The three apps this replaces each had their own front door: App Builder's
// composer, the Redesigner's URL box, Client Review's site picker. Three
// doors into one job is the thing that made it feel like three products, so
// there is one slab here and the mode chips change what it asks for.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import type { PreparedMedia } from "@/lib/app-builder/media";
import { filterCounts, type SiteCard } from "@/lib/website-studio/library";
import type { Studio } from "@/lib/website-studio/useStudio";
import type { StageFacts } from "@/lib/website-studio/pipeline";
import { Library } from "./Library";
import { PipelineRail } from "./PipelineRail";
import { StartPanel } from "./StartPanel";

/**
 * The rail on the home is the shape of a build, not a live one: the first site
 * is live and the deep work is still to come, which is the moment that makes
 * the point. A real project's rail is drawn from its own facts.
 */
const DEMO: StageFacts = {
  understood: true,
  planned: true,
  lookPicked: true,
  flowsApproved: true,
  buildStarted: true,
  live: true,
  factoryStarted: true,
  factoryDone: false,
};

interface Props {
  studio: Studio;
  busy: boolean;
  onPrompt: (idea: string, media: PreparedMedia[], skills: string[]) => Promise<void> | void;
  onRedesign: (draftId: string, warning?: string) => void;
  onOpen: (c: SiteCard) => void;
  notice?: string;
}

export function StudioHome({ studio, busy, onPrompt, onRedesign, onOpen, notice }: Props) {
  const counts = useMemo(() => filterCounts(studio.all), [studio.all]);

  return (
    <div className="ws-home">
      <div className="ws-sky" aria-hidden />
      <header className="ws-top">
        <a className="ws-top-back" href="/apps/jarvis" title="Jarvis">
          <BackIcon />
          <span>Jarvis</span>
        </a>
        <span className="ws-top-brand">
          <span className="ws-mark" aria-hidden />
          Website Studio
        </span>
        <span className="ws-top-who" title={studio.me?.email ?? undefined}>
          {studio.me?.email ?? ""}
        </span>
      </header>

      <section className="ws-hero">
        <p className="ws-eyebrow">Build · Redesign · Edit</p>
        <h1>What are we putting online?</h1>
        <p className="ws-lede">
          Describe it, or paste a site to redesign. The same super harness builds it, and the same workspace is where you
          change it afterwards.
        </p>
        <StartPanel onPrompt={onPrompt} onRedesign={onRedesign} busy={busy} />
        {notice && <p className="ws-notice" role="status">{notice}</p>}
        {studio.error && <p className="ws-error" role="alert">{studio.error}</p>}
      </section>

      {/*
        The one thing worth remembering about this Studio, drawn rather than
        claimed: the build has a GATE in it, and the site is on an address the
        moment it passes through. Everything left of the gate is the first
        website; the two stages right of it are the deep backend work that only
        starts once there is something to open. It is the same rail the
        workspace draws against a real build, so what is promised here is what
        is watched there.
      */}
      <section className="ws-promise" data-standout="the ship-first pipeline rail, with the live gate">
        <PipelineRail facts={DEMO} />
      </section>

      <Library
        cards={studio.cards}
        counts={counts}
        query={studio.query}
        onQuery={studio.setQuery}
        filter={studio.filter}
        onFilter={studio.setFilter}
        onOpen={onOpen}
        loading={studio.loading}
      />
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}
