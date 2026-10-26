"use client";

// ---------------------------------------------------------------------------
// App Builder — the one home for building.
//
// Build is App Builder itself, unchanged. Website Redesigner moved in beside it
// (with its Showcase of app ideas — EMBER Reveal, the Kart Teardown).
//
// Framed inside Jarvis (AppBuilderSheet pulls App Builder up over the chat),
// the home renders Build alone with no bar and no switcher — exactly what the
// sheet showed before the merge.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { HomeSkeleton, StudioHome, type SectionComponent } from "../studio-home/StudioHome";
import { BUILDER_DEFAULT, BUILDER_REMEMBER, BUILDER_SECTIONS, type BuilderSection } from "@/lib/studio-home/builder";
import { AppBuilder } from "./AppBuilder";
import "./app-builder-home.css";

const COMPONENTS: Record<BuilderSection, SectionComponent> = {
  // Build is imported directly, not lazily: it is the section the Jarvis sheet
  // frames, and it should paint as fast as it did when it was the whole page.
  build: AppBuilder,
  redesign: dynamic(() => import("../redesigner/WebsiteRedesigner").then((m) => m.WebsiteRedesigner), {
    ssr: false,
    loading: () => <HomeSkeleton />,
  }),
};

export function AppBuilderHome({ initialSection }: { initialSection: BuilderSection | null }) {
  return (
    <StudioHome
      brand={{ name: "App", em: "Builder", tagline: "Build it new, or give a site a new look", icon: "Sparkles" }}
      sections={BUILDER_SECTIONS}
      components={COMPONENTS}
      rememberKey={BUILDER_REMEMBER}
      initialSection={initialSection}
      defaultSection={BUILDER_DEFAULT}
      framedSection="build"
    />
  );
}
