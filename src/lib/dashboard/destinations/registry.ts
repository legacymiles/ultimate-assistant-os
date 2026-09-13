import type { Destination } from "./types";
import { aiRankingsDestination } from "./aiRankings";
import { cookbookDestination } from "./cookbook";
import { skillsLibraryDestination } from "./skillsLibrary";

// ---------------------------------------------------------------------------
// Every place a photo can be filed that is NOT one of the three the photo
// pipeline already owns (people folders, knowledge base, calendar).
//
// Adding an app here is the whole job: the prompt, the review queue grouping
// and the commit path all read from this list. There is nowhere else to update,
// which is what makes "file into any hub app" affordable rather than a fourth
// copy of the same logic each time.
//
// EA Feature List is deliberately absent. It is READ-ONLY: `EA_FEATURES` is a
// static array in src/lib/ea-features/features.ts with no store, no
// localStorage and no write path anywhere, by design — its features are
// dictated and appended to source. A destination for it would mean building
// persistence for that app first, which is a different job from adding a file
// here. Left out rather than faked.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DESTINATIONS: Destination<any>[] = [
  aiRankingsDestination,
  cookbookDestination,
  skillsLibraryDestination,
];

export function destinationById(id: string): Destination | undefined {
  return DESTINATIONS.find((d) => d.id === id);
}

export const DESTINATION_ROUTES = DESTINATIONS.map((d) => d.id);

/**
 * The places that already exist in each app, keyed by destination id.
 *
 * An app that cannot answer — signed out, offline — is left out rather than
 * failing the whole request: the agent simply does not know that app's places
 * and falls back to a new name, which the preview still shows before saving.
 */
export async function gatherKnownPlaces(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const d of DESTINATIONS) {
    if (!d.places) continue;
    try {
      const places = await d.places();
      if (places.length) out[d.id] = places.slice(0, 80);
    } catch {
      /* this app's places are unknown; the agent proposes a name instead */
    }
  }
  return out;
}

/**
 * The slice of the vision prompt these destinations own.
 *
 * Generated, never hand-written. A destination whose hint says one thing while
 * the prompt says another is the bug this exists to make impossible.
 */
export function destinationPromptBlock(): string {
  if (!DESTINATIONS.length) return "";

  const routes = DESTINATIONS.map((d) => `  ${d.hint}`).join("\n");

  const shapes = DESTINATIONS.map((d) => {
    const fields = d.fields.map((f) => `"${f.name}":${f.type}`).join(",");
    return `  When route is "${d.id}", also return "${d.id}":{${fields}}`;
  }).join("\n");

  const notes = DESTINATIONS.map((d) =>
    d.fields.map((f) => `  ${d.id}.${f.name} — ${f.describe}`).join("\n"),
  ).join("\n");

  return (
    `\nADDITIONAL ROUTES:\n${routes}\n\n` +
    `SHAPES:\n${shapes}\n\n` +
    `FIELD NOTES:\n${notes}\n`
  );
}
