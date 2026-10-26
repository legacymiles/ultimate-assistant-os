// ---------------------------------------------------------------------------
// Studio homes — "one home per kind of thing", named once.
//
// Jarvis Audio Studio proved the pattern: several apps that do halves of one
// job, behind one switcher, each still its own component. This module is the
// pure half of that pattern, generalised so every home is a list of sections
// rather than a copy of the Audio Studio shell.
//
// Deliberately free of "use client": a home's page is a server component and
// validates `?section=` before it renders, and a client module's functions
// cannot be called from the server. Only a type crosses over from the icon set.
// ---------------------------------------------------------------------------

import type { Icon } from "@/components/icons";

export type HomeIcon = keyof typeof Icon;

/**
 * A section that has a name but no code on the website yet — its app lives on
 * the owner's PC so far. The home shows this plain-English panel in its place
 * instead of a component, so the tab exists, says what it will be, and turns
 * into the app the moment its code is wired in.
 */
export interface PendingPanel {
  title: string;
  /** Plain English, one paragraph each. */
  body: string[];
  /**
   * Optional one-click request to Claude Code through In Queue, so the owner
   * never has to type the hand-off himself.
   */
  request?: { folder: string; text: string; label: string };
}

export interface HomeSection<Id extends string = string> {
  id: Id;
  /** What the switcher says. */
  label: string;
  /** What the section is for, shown beside the label where there is room. */
  hint: string;
  /** Key in the shared icon set. */
  icon: HomeIcon;
  /** 0–360. The home's accent glides to this hue while the section is open. */
  hue: number;
  /** Set when the section's app is not on the website yet. */
  pending?: PendingPanel;
}

/** The ids, in switcher order. */
export function sectionIds<Id extends string>(sections: readonly HomeSection<Id>[]): Id[] {
  return sections.map((s) => s.id);
}

export function isSectionOf<Id extends string>(sections: readonly HomeSection<Id>[], value: unknown): value is Id {
  return typeof value === "string" && sections.some((s) => s.id === value);
}

/**
 * What the URL asked for, or null when it asked for nothing a home has.
 *
 * Null is meaningful: "the URL named this section" and "the URL named none"
 * behave differently (the second resumes the last one opened), so a bad value
 * must not be collapsed into the default here.
 */
export function pickSection<Id extends string>(sections: readonly HomeSection<Id>[], value: unknown): Id | null {
  const v = Array.isArray(value) ? value[0] : value;
  return isSectionOf(sections, v) ? v : null;
}

export function sectionById<Id extends string>(sections: readonly HomeSection<Id>[], id: Id): HomeSection<Id> {
  const found = sections.find((s) => s.id === id);
  if (!found) throw new Error(`No section "${id}" in this home.`);
  return found;
}

/** The address of one section of a home, for links that should land in it. */
export function sectionHref(base: string, id: string, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ section: id, ...extra });
  return `${base}?${q.toString()}`;
}

/**
 * The next section for a keyboard move along the switcher. Arrow keys wrap,
 * Home and End jump — the WAI-ARIA tabs pattern.
 */
export function stepSection<Id extends string>(
  sections: readonly HomeSection<Id>[],
  current: Id,
  key: "ArrowLeft" | "ArrowRight" | "Home" | "End",
): Id {
  const ids = sectionIds(sections);
  if (!ids.length) return current;
  const i = Math.max(0, ids.indexOf(current));
  if (key === "Home") return ids[0];
  if (key === "End") return ids[ids.length - 1];
  const step = key === "ArrowRight" ? 1 : -1;
  return ids[(i + step + ids.length) % ids.length];
}

/** Sections a home can mount right now, i.e. not waiting on the PC. */
export function liveSections<Id extends string>(sections: readonly HomeSection<Id>[]): HomeSection<Id>[] {
  return sections.filter((s) => !s.pending);
}
