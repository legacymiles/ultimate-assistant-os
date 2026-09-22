// First-guess section for a place found by the OpenStreetMap activity search.
// The AI rater may move it; this only has to be a sensible default for when no
// AI is configured.
import type { SectionId } from "../sections";

const KIDS_LABELS = new Set([
  "Zoo",
  "Aquarium",
  "Amusement park",
  "Water park",
  "Trampoline park",
  "Mini golf",
  "Carousel",
  "Miniature railway",
  "Planetarium",
]);

const PARKS_LABELS = new Set(["Crag", "Via ferrata", "Beach", "Swimming hole", "Sledding hill"]);

const BY_CATEGORY: Record<string, SectionId> = {
  Nature: "parks",
  Water: "parks",
  Oddities: "gems",
  Culture: "gems",
  "Food & Drink": "food",
};

export function defaultSection(category: string, label: string | undefined): SectionId {
  if (label && KIDS_LABELS.has(label)) return "kids";
  if (label && PARKS_LABELS.has(label)) return "parks";
  return BY_CATEGORY[category] ?? "fun";
}
