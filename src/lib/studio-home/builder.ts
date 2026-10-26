// ---------------------------------------------------------------------------
// App Builder as the one home for building: Build (App Builder itself) and
// Website Redesigner, whose Showcase holds app ideas worth building again.
//
// Pure and server-safe.
// ---------------------------------------------------------------------------

import { getProject } from "@/lib/catalog";
import type { HomeSection } from "./sections";

export type BuilderSection = "build" | "redesign";

export const BUILDER_SECTIONS: readonly HomeSection<BuilderSection>[] = [
  { id: "build", label: "Build", hint: "a new app from an idea", icon: "Sparkles", hue: 239 },
  { id: "redesign", label: "Website Redesigner", hint: "a new look, same site", icon: "Brush", hue: 12 },
];

export const BUILDER_DEFAULT: BuilderSection = "build";
export const BUILDER_REMEMBER = "app-builder:section";

/** The query parameter App Builder's Build section reads to prefill its idea box. */
export const IDEA_PARAM = "idea";

export interface ShowcasePiece {
  slug: string;
  title: string;
  tag: string;
  overview: string;
  route: string;
  hue: number;
}

function piece(slug: string, hue: number): ShowcasePiece {
  const p = getProject(slug);
  return {
    slug,
    title: p?.title ?? slug,
    tag: p?.tag ?? "",
    overview: p?.overview ?? "",
    route: p?.appUrl ?? `/apps/${slug}`,
    hue,
  };
}

/** App ideas shown in Website Redesigner › Showcase. Their routes stay alive to be played in place. */
export const SHOWCASE: ShowcasePiece[] = [piece("fire-reveal", 22), piece("kart-showcase", 16)];

/** The idea "Use this idea" hands App Builder. */
export function showcaseIdea(p: Pick<ShowcasePiece, "title" | "tag">): string {
  return `Build an app like ${p.title}: ${p.tag}`.trim();
}
