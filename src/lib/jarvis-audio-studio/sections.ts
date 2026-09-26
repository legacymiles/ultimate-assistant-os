// ---------------------------------------------------------------------------
// Jarvis Audio Studio — the three studios, named once.
//
// Deliberately not inside the shell component: the page is a server component
// and has to validate `?section=` before it renders anything, and a "use client"
// module's plain functions cannot be called from the server. This module has no
// client marker, so both sides can read the same list.
// ---------------------------------------------------------------------------

export type Section = "find" | "classify" | "create";

export interface SectionDef {
  id: Section;
  /** What the switcher says. */
  label: string;
  /** What the studio is for, shown beside the label where there is room. */
  hint: string;
  /** Key in the shared icon set. */
  icon: "Search" | "Waveform" | "Mic";
}

export const SECTIONS: SectionDef[] = [
  { id: "find", label: "Find", hint: "get the recording", icon: "Search" },
  { id: "classify", label: "Classify", hint: "know what it is", icon: "Waveform" },
  { id: "create", label: "Create", hint: "make the next one", icon: "Mic" },
];

/** The studio a visitor lands in when nothing says otherwise. */
export const DEFAULT_SECTION: Section = "find";

export function isSection(value: unknown): value is Section {
  return SECTIONS.some((s) => s.id === value);
}
