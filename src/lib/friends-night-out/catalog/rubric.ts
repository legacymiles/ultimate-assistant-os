// The owner's star rubric, and the strict reader for the AI's reply.
//
// The examples are the owner's own words from the design session; they are the
// calibration, so keep them. Add new examples here as the owner gives them.
import { SECTIONS, isSectionId, type SectionId } from "../sections";

export const RUBRIC = `You rate places for a going-out app, 1 to 5 stars, and file each in ONE section.

Sections: ${SECTIONS.map((s) => `${s.id} = ${s.label}`).join("; ")}.

Stars mean "how worth a special trip is this, compared with the alternatives in the area":
5 = the best of its kind around here; people drive for it.
4 = genuinely cool or unusual; a great pick.
3 = good, solid, worth it if you're nearby.
2 = ordinary; fine but forgettable.
1 = not worth recommending.

Calibration examples from the owner:
- The best parks with waterfalls or standout scenery = 5 (parks).
- A park with rock climbing = at least 4 (parks).
- An ordinary neighbourhood park = 2 or 3 (parks).
- The biggest amusement park in the area = 5 (kids).
- Unique gems are unusual and varied: a cat cafe lounge, a hidden speakeasy behind a soda machine
  in an ice cream shop, an arcade with free games on top of a food market = 4 to 5 (gems).
- Chains are 2 or less unless genuinely notable.

Kids = places a family would take children (zoos, amusement parks, water parks, play centres).
Food = restaurants, cafes, bakeries, breweries, markets. A food place with a hidden or bizarre
twist (secret bar, themed dining) belongs in gems.`;

export interface Rating {
  section: SectionId;
  stars: number;
  reason?: string;
  hook?: string;
}

const clip = (s: unknown, n: number) =>
  typeof s === "string" && s.trim() ? s.trim().slice(0, n) : undefined;

function jsonFrom(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : content;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Reads `{"ratings":[{key,section,stars,reason,hook}]}`; anything malformed is dropped. */
export function parseRatings(content: string, validKeys: ReadonlySet<string>): Map<string, Rating> {
  const out = new Map<string, Rating>();
  const data = jsonFrom(content) as { ratings?: unknown } | null;
  if (!data || !Array.isArray(data.ratings)) return out;
  for (const r of data.ratings as Record<string, unknown>[]) {
    const key = typeof r?.key === "string" ? r.key : "";
    if (!validKeys.has(key) || !isSectionId(r.section)) continue;
    const stars = Math.round(Number(r.stars));
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) continue;
    out.set(key, {
      section: r.section,
      stars,
      reason: clip(r.reason, 200),
      hook: clip(r.hook, 240),
    });
  }
  return out;
}

/** Fallback when no AI is configured: the OSM rarity score onto 2–5 stars. */
export function heuristicStars(obscurity: number): number {
  if (obscurity >= 80) return 5;
  if (obscurity >= 60) return 4;
  if (obscurity >= 30) return 3;
  return 2;
}
