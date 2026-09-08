import type { Destination } from "./types";
import { aiRankingsDestination } from "./aiRankings";

// ---------------------------------------------------------------------------
// Every place a photo can be filed that is NOT one of the three the photo
// pipeline already owns (people folders, knowledge base, calendar).
//
// Adding an app here is the whole job: the prompt, the review queue grouping
// and the commit path all read from this list. There is nowhere else to update,
// which is what makes "file into any hub app" affordable rather than a fourth
// copy of the same logic each time.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DESTINATIONS: Destination<any>[] = [aiRankingsDestination];

export function destinationById(id: string): Destination | undefined {
  return DESTINATIONS.find((d) => d.id === id);
}

export const DESTINATION_ROUTES = DESTINATIONS.map((d) => d.id);

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
