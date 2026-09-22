// The Explore places sections. Add or rename here AND in the fno_places
// check constraint (supabase/migrations/*_fno_social.sql) — a test keeps the
// two in step.
export const SECTIONS = [
  { id: "parks", label: "Parks and outside" },
  { id: "fun", label: "Fun" },
  { id: "gems", label: "Unique gems" },
  { id: "kids", label: "Kids" },
  { id: "food", label: "Food" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export function isSectionId(x: unknown): x is SectionId {
  return typeof x === "string" && SECTIONS.some((s) => s.id === x);
}

export function sectionLabel(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)!.label;
}
