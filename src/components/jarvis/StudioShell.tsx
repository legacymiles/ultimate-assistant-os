"use client";

// ---------------------------------------------------------------------------
// One studio, with its apps as sections.
//
// This shell owns exactly one thing: which section is mounted. Everything a
// section draws — its own tabs, its own search, its own GPU readout — stays
// where it was, one step down from this switcher. Nothing about how any of
// these apps works is reimplemented here, which is why gathering seven studios
// cost none of them a feature. It is the bargain JarvisAudioStudio made with
// its three, applied to the whole wall.
//
// Every section is a dynamic import. Game Creator alone pulls in the Unreal
// bridge and Slippery Escape a physics sim; somebody who came to cut a video
// should not be made to download either.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { Profile } from "@/lib/new-dashboard/types";
import type { JarvisStore } from "@/lib/jarvis/types";
import { sectionFor, type MountKey, type Studio } from "@/lib/studio/studios";
import { Icon } from "../icons";
import "./studio-hub.css";

/** What every section is handed. Most ignore most of it. */
export interface SectionProps {
  store: JarvisStore;
  commit: (s: JarvisStore) => void;
  profile: Profile | null;
  onDashboardChanged?: () => void;
}

function Waiting({ label }: { label: string }) {
  return (
    <div className="sshell-wait">
      {label}
      <span aria-hidden />
    </div>
  );
}

// Each dynamic() below writes its options out in full rather than calling a
// helper that returns them. next/dynamic's compiler plugin reads that argument
// STATICALLY, so a shared builder typechecks perfectly and then fails the
// build with "next/dynamic options must be an object literal".

/**
 * The map from a section's `mount` key to the thing it mounts.
 *
 * Typed as a complete record of `MountKey`, so a studio that names a section
 * this map has no entry for fails to compile. An empty pane at runtime was the
 * alternative, and that is the kind of bug nobody notices until the owner
 * clicks the one tab nobody tested.
 */
const MOUNTS: Record<MountKey, React.ComponentType<SectionProps>> = {
  "video-workflows": dynamic(
    () => import("./StudioTab").then((m) => {
      const Wall = m.StudioTab;
      const Locked = (p: SectionProps) => <Wall {...p} lockMedium="video" />;
      Locked.displayName = "VideoWorkflows";
      return Locked;
    }),
    { ssr: false, loading: () => <Waiting label="Loading the wall" /> },
  ),
  "image-workflows": dynamic(
    () => import("./StudioTab").then((m) => {
      const Wall = m.StudioTab;
      const Locked = (p: SectionProps) => <Wall {...p} lockMedium="image" />;
      Locked.displayName = "ImageWorkflows";
      return Locked;
    }),
    { ssr: false, loading: () => <Waiting label="Loading the wall" /> },
  ),
  "smart-shot": dynamic(
    () => import("../smart-shot/SmartShot").then((m) => m.SmartShot),
    { ssr: false, loading: () => <Waiting label="Loading Smart Shot" /> },
  ),
  "video-arena": dynamic(
    () => import("../video-studio/VideoStudio").then((m) => m.VideoStudio),
    { ssr: false, loading: () => <Waiting label="Loading the Arena" /> },
  ),
  studio3d: dynamic(
    () => import("../studio3d/Studio3D").then((m) => m.Studio3D),
    { ssr: false, loading: () => <Waiting label="Loading the 3D director" /> },
  ),
  // The gallery takes a reuse callback rather than the section props, and
  // wiring it to the wall's composer across a studio boundary would mean this
  // shell knowing what a prompt is. Reuse stays inside the Workflows section,
  // where the composer it would hand a prompt to actually lives.
  gallery: dynamic(
    () => import("./StudioGallery").then((m) => {
      const Shown = () => <m.StudioGallery />;
      Shown.displayName = "StudioGallerySection";
      return Shown;
    }),
    { ssr: false, loading: () => <Waiting label="Loading the gallery" /> },
  ),
  "image-agents": dynamic(
    () => import("../image-studio/ImageStudio").then((m) => m.ImageStudio),
    { ssr: false, loading: () => <Waiting label="Loading the image agents" /> },
  ),
  "audio-find": dynamic(
    () => import("../mp3-download/Mp3Download").then((m) => {
      const Embedded = () => <m.Mp3Download embedded />;
      Embedded.displayName = "AudioFind";
      return Embedded;
    }),
    { ssr: false, loading: () => <Waiting label="Loading Find" /> },
  ),
  "audio-classify": dynamic(
    () => import("../music-classified/MusicClassified").then((m) => {
      const Embedded = () => <m.MusicClassified embedded />;
      Embedded.displayName = "AudioClassify";
      return Embedded;
    }),
    { ssr: false, loading: () => <Waiting label="Loading Classify" /> },
  ),
  "audio-create": dynamic(
    () => import("../music-creator/MusicCreator").then((m) => {
      const Embedded = () => <m.MusicCreator embedded />;
      Embedded.displayName = "AudioCreate";
      return Embedded;
    }),
    { ssr: false, loading: () => <Waiting label="Loading Create" /> },
  ),
  "music-video": dynamic(
    () => import("../seedance/SeedanceStudio").then((m) => m.SeedanceStudio),
    { ssr: false, loading: () => <Waiting label="Loading the music video engine" /> },
  ),
  "game-creator": dynamic(
    () => import("../game-creator/GameCreator").then((m) => m.GameCreator),
    { ssr: false, loading: () => <Waiting label="Loading Game Creator" /> },
  ),
  kart: dynamic(
    () => import("../kart/KartShowcase").then((m) => m.KartShowcase),
    { ssr: false, loading: () => <Waiting label="Loading the teardown" /> },
  ),
  slippery: dynamic(
    () => import("../slippery/SlipperyGame").then((m) => m.SlipperyGame),
    { ssr: false, loading: () => <Waiting label="Loading the arena" /> },
  ),
  personas: dynamic(
    () => import("../social-personas/SocialPersonas").then((m) => m.SocialPersonas),
    { ssr: false, loading: () => <Waiting label="Loading your personas" /> },
  ),
  "dance-vault": dynamic(
    () => import("../dances/DanceVault").then((m) => m.DanceVault),
    { ssr: false, loading: () => <Waiting label="Loading the vault" /> },
  ),
  "realtime-lucy": dynamic(
    () => import("../realtime-lucy/RealtimeLucy").then((m) => m.RealtimeLucy),
    { ssr: false, loading: () => <Waiting label="Loading Lucy" /> },
  ),
  "trading-agent": dynamic(
    () => import("../money-agent/TradingAgent").then((m) => m.TradingAgent),
    { ssr: false, loading: () => <Waiting label="Loading the trading agent" /> },
  ),
  "ea-lab": dynamic(
    () => import("../ea-lab/EaLab").then((m) => m.EaLab),
    { ssr: false, loading: () => <Waiting label="Loading EA Lab" /> },
  ),
  calculator: dynamic(
    () => import("../calculator/Calculator").then((m) => m.Calculator),
    { ssr: false, loading: () => <Waiting label="Loading the calculator" /> },
  ),
};

/** Where each studio was left, so coming back lands where you were. */
const REMEMBERED = "jarvis-studio:section";

export function StudioShell({
  studio,
  initialSection,
  onBack,
  ...section
}: {
  studio: Studio;
  /** The section the wall or the URL asked for, or null when neither did. */
  initialSection: string | null;
  onBack: () => void;
} & SectionProps) {
  const [current, setCurrent] = useState(() => sectionFor(studio, initialSection).id);

  // Asking for a section by name means it. Arriving with no section named
  // resumes where this studio was left — which is per studio, so Video Studio
  // reopening on Arena does not drag Image Studio onto its third tab too.
  useEffect(() => {
    if (initialSection) {
      setCurrent(sectionFor(studio, initialSection).id);
      return;
    }
    try {
      const saved = window.localStorage.getItem(`${REMEMBERED}:${studio.id}`);
      if (saved && studio.sections.some((s) => s.id === saved)) setCurrent(saved);
    } catch {
      /* private browsing, or storage refused — the first section stands. */
    }
  }, [studio, initialSection]);

  const go = useCallback(
    (id: string) => {
      setCurrent(id);
      try {
        window.localStorage.setItem(`${REMEMBERED}:${studio.id}`, id);
      } catch {
        /* Remembering is a convenience, never a requirement. */
      }
    },
    [studio.id],
  );

  // Escape goes back to the wall, the way it closes everything else in Jarvis.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Not while something inside the studio is holding the keyboard.
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.closest("input, textarea, [contenteditable='true']")) return;
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const active = sectionFor(studio, current);
  const Mounted = MOUNTS[active.mount];

  return (
    <div className="sshell" style={{ ["--h"]: studio.hue } as React.CSSProperties}>
      <div className="sshell-bar" style={{ ["--h"]: studio.hue } as React.CSSProperties}>
        <button type="button" className="sshell-back" onClick={onBack} title="Back to the studios (Esc)">
          <Icon.ArrowLeft />
          Studios
        </button>
        <div className="sshell-name">
          {studio.name}
          <span>{studio.tagline}</span>
        </div>
        <nav className="sshell-rail" aria-label={`${studio.name} sections`}>
          {studio.sections.map((s) => {
            const Glyph = Icon[s.icon as keyof typeof Icon] ?? Icon.Square;
            return (
              <button
                key={s.id}
                type="button"
                className={`sshell-tab${s.id === active.id ? " is-on" : ""}`}
                aria-current={s.id === active.id ? "page" : undefined}
                onClick={() => go(s.id)}
                title={s.blurb}
              >
                <Glyph aria-hidden />
                {s.label}
              </button>
            );
          })}
        </nav>
        <div className="sshell-blurb">{active.blurb}</div>
      </div>
      <div className="sshell-stage">
        <Mounted {...section} />
      </div>
    </div>
  );
}
