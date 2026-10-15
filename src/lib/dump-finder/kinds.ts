// ---------------------------------------------------------------------------
// The six kinds of place a load can go.
//
// A site can be more than one of these at once — a transfer station that also
// takes concrete rubble, a recycling yard that buys scrap — so a site carries a
// list of kinds and the filter matches any of them. The first kind in that list
// is the one its pin is drawn as.
// ---------------------------------------------------------------------------

export type SiteKind = "millings" | "concrete" | "landfill" | "transfer" | "recycling" | "scrap";

export interface KindInfo {
  id: SiteKind;
  /** What the filter chip says. */
  label: string;
  /** One letter, drawn inside the pin. */
  glyph: string;
  /** What a driver would bring here. */
  takes: string;
  color: string;
  /** Text colour that reads on `color`. */
  ink: string;
}

export const KINDS: KindInfo[] = [
  {
    id: "millings",
    label: "Asphalt & millings",
    glyph: "A",
    takes: "Hot-mix plants and paving yards. Millings (RAP) in or out, broken asphalt.",
    color: "#f5b72b",
    ink: "#1a1204",
  },
  {
    id: "concrete",
    label: "Concrete & C&D",
    glyph: "C",
    takes: "Concrete plants, aggregate yards and rubble recyclers. Broken concrete, block, clean fill.",
    color: "#38bdf8",
    ink: "#04141c",
  },
  {
    id: "landfill",
    label: "Landfills",
    glyph: "L",
    takes: "Municipal and C&D landfills. Mixed waste and construction debris, by the ton.",
    color: "#e0703a",
    ink: "#1c0a02",
  },
  {
    id: "transfer",
    label: "Transfer stations",
    glyph: "T",
    takes: "Trash and bulk drop-off that gets reloaded and hauled on. Usually the closest place to tip.",
    color: "#a78bfa",
    ink: "#120a24",
  },
  {
    id: "recycling",
    label: "Recycling centers",
    glyph: "R",
    takes: "Drop-off centers for metal, cardboard, yard waste, appliances, tires and more.",
    color: "#22c55e",
    ink: "#03160a",
  },
  {
    id: "scrap",
    label: "Scrap yards",
    glyph: "S",
    takes: "Scrap metal buyers. Steel, copper, aluminum, cars and appliances.",
    color: "#b4bccb",
    ink: "#0d1017",
  },
];

export const KIND_BY_ID: Record<SiteKind, KindInfo> = Object.fromEntries(
  KINDS.map((k) => [k.id, k]),
) as Record<SiteKind, KindInfo>;

export const ALL_KINDS: SiteKind[] = KINDS.map((k) => k.id);

export function isSiteKind(value: unknown): value is SiteKind {
  return typeof value === "string" && (ALL_KINDS as string[]).includes(value);
}
