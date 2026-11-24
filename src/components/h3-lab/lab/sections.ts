// The lab's sections — the owner's 15 plus Repository Research. Order and
// grouping are the navigation; every section file default-exports a
// component taking SectionProps.

import type { LabHook } from "./useLab";

export type SectionId =
  | "overview"
  | "guide"
  | "reverse"
  | "characters"
  | "environments"
  | "productions"
  | "inspector"
  | "lab"
  | "compare"
  | "genres"
  | "evolution"
  | "skill"
  | "connection"
  | "activity"
  | "repos"
  | "settings";

export interface SectionProps {
  lab: LabHook & { state: NonNullable<LabHook["state"]> };
  /** Navigate to another section, optionally focusing one record by id. */
  go: (section: SectionId, focus?: string) => void;
  /** The record id the URL asked this section to open, if any. */
  focus: string | null;
}

export const NAV: { group: string; items: { id: SectionId; label: string }[] }[] = [
  { group: "Guide", items: [
    { id: "overview", label: "Overview" },
    { id: "guide", label: "Master Prompt Guide" },
    { id: "evolution", label: "Prompt Evolution" },
    { id: "genres", label: "Genre Research" },
  ] },
  { group: "Research", items: [
    { id: "lab", label: "Experiment Lab" },
    { id: "compare", label: "Experiment Comparisons" },
    { id: "inspector", label: "Continuity Inspector" },
    { id: "reverse", label: "Video Reverse Engineering" },
  ] },
  { group: "Library", items: [
    { id: "characters", label: "Character Bible" },
    { id: "environments", label: "Environment Bible" },
    { id: "productions", label: "Production Library" },
    { id: "repos", label: "Repository Research" },
  ] },
  { group: "System", items: [
    { id: "activity", label: "Agent Activity" },
    { id: "connection", label: "H3 Connection" },
    { id: "skill", label: "Jarvis Skill Integration" },
    { id: "settings", label: "Settings" },
  ] },
];

export const SECTION_IDS: SectionId[] = NAV.flatMap((g) => g.items.map((i) => i.id));
