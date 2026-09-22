// Discovery and its gate.
//
// The web-search model finds the places OpenStreetMap's activity tags cannot —
// restaurants, cat cafes, speakeasies. It can also invent them. Every candidate
// must therefore match a real named OSM element inside the radius before it is
// shown; the unmatched are dropped and counted, never displayed.
import { distanceMi } from "../geo";
import { isSectionId, type SectionId } from "../sections";
import type { Coords } from "../types";
import type { OverpassElement } from "../sources/overpass";

export interface Candidate {
  name: string;
  section: SectionId;
  address?: string;
  why?: string;
}

export function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the /, "")
    .trim()
    .replace(/\s+/g, " ");
}

function jsonFrom(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
}

const clip = (s: unknown, n: number) =>
  typeof s === "string" && s.trim() ? s.trim().slice(0, n) : undefined;

/** Reads `{"places":[{name,address,why,section?}]}`. */
export function parseDiscovery(content: string, section: SectionId, max = 25): Candidate[] {
  const data = jsonFrom(content) as { places?: unknown } | null;
  if (!data || !Array.isArray(data.places)) return [];
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const p of data.places as Record<string, unknown>[]) {
    const name = clip(p?.name, 120);
    if (!name) continue;
    const key = normName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      section: isSectionId(p.section) ? p.section : section,
      address: clip(p.address, 200),
      why: clip(p.why, 240),
    });
    if (out.length >= max) break;
  }
  return out;
}

// Quotes would end the Overpass string literal, so they are dropped, not escaped.
const escapeRe = (s: string) => s.replace(/"/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");

/**
 * Overpass queries finding any element whose name contains one of the names.
 *
 * One alternation regex per batch, not one clause per name: each clause is a
 * full scan of the box, so 12 separate clauses took 45 s against 5.6 s for the
 * same 12 names in one pattern — and under a full build's load the slow form
 * timed out, silently dropping most web finds.
 */
export function buildNameQueries(names: string[], bbox: string, batchSize = 40): string[] {
  const out: string[] = [];
  for (let i = 0; i < names.length; i += batchSize) {
    const pattern = names
      .slice(i, i + batchSize)
      .map((n) => escapeRe(n.trim()))
      .filter(Boolean)
      .join("|");
    out.push(`[out:json][timeout:60];nwr["name"~"${pattern}",i](${bbox});out tags center 600;`);
  }
  return out;
}

function namesAgree(a: string, b: string): boolean {
  if (a === b) return true;
  // Containment ("kitty lounge" vs "kitty lounge cat cafe") only for names long
  // enough that it cannot be a coincidence.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 6 && long.includes(short);
}

export interface Match {
  candidate: Candidate;
  element: OverpassElement;
  lat: number;
  lon: number;
  distanceMi: number;
}

export function matchByName(
  candidates: Candidate[],
  elements: OverpassElement[],
  center: Coords,
  radiusMi: number,
): { matched: Match[]; unmatched: Candidate[] } {
  const located = elements.flatMap((el) => {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (lat === undefined || lon === undefined || !name) return [];
    const d = distanceMi(center, { lat, lon });
    return d <= radiusMi ? [{ el, lat, lon, d, key: normName(name) }] : [];
  });

  const matched: Match[] = [];
  const unmatched: Candidate[] = [];
  for (const c of candidates) {
    const key = normName(c.name);
    // An exact name beats a containment hit ("Castle Rock State Park" the park,
    // not "…Kirkwood Entrance"); nearest wins within each group.
    const hits = located
      .filter((l) => namesAgree(key, l.key))
      .sort((a, b) => Number(b.key === key) - Number(a.key === key) || a.d - b.d);
    if (!hits.length) {
      unmatched.push(c);
      continue;
    }
    const h = hits[0];
    matched.push({ candidate: c, element: h.el, lat: h.lat, lon: h.lon, distanceMi: h.d });
  }
  return { matched, unmatched };
}

/** Keep the first of any two places with agreeing names within ~100 m. */
export function dedupeByNameAndPlace<T extends { name: string; lat: number; lon: number }>(items: T[]): T[] {
  const kept: (T & { _k: string })[] = [];
  for (const it of items) {
    const k = normName(it.name);
    const dup = kept.some((p) => namesAgree(p._k, k) && distanceMi(p, it) <= 0.062);
    if (!dup) kept.push({ ...it, _k: k });
  }
  return kept.map(({ _k, ...rest }) => rest as unknown as T);
}
