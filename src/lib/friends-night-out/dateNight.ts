// ---------------------------------------------------------------------------
// Date Night — composing a whole evening.
//
// The obvious version of this feature is an anti-recommendation engine wearing
// a recommendation engine's UI: pick a nearby activity, a nearby event and a
// nearby restaurant, sum the prices, call it a plan. Run against real data that
// produces "trampoline chain, then a chain restaurant, $unknown total" — three
// algorithmically valid evenings, none of which anyone wants.
//
// So this module refuses more than it emits:
//
//   The anchor activity must clear a rarity bar AND have a hook line. If the
//   app cannot say why a place is interesting, it has no business building an
//   evening around it.
//
//   Chains are excluded outright rather than demoted. A generated plan is a
//   recommendation in a way a search result is not.
//
//   Costs are a range with an explicit "and some unknowns" marker, never a
//   false total. Price data is missing on most places, and a confident wrong
//   number is worse than an honest range.
//
// Better to return one good evening — or none, with a reason — than three
// plausible ones.
// ---------------------------------------------------------------------------

import { uid } from "../utils";
import { distanceMi } from "./geo";
import { inSeason } from "./categories";
import type {
  Coords,
  DateNightPlan,
  FnoEvent,
  FnoPlace,
} from "./types";

/** An anchor below this is not a discovery, and the plan is not worth making. */
const MIN_ANCHOR_OBSCURITY = 55;
/** Nobody wants an evening that starts with a forty-minute drive between stops. */
const MAX_HOP_MI = 12;

export interface DateNightInput {
  origin: Coords;
  places: FnoPlace[];
  events: FnoEvent[];
  /** Slots the user pinned; a re-roll leaves these alone. */
  locked?: Partial<Pick<DateNightPlan, "activity" | "event" | "food">>;
  /** Excluded so a re-roll returns something genuinely different. */
  excludeIds?: Set<string>;
  when?: Date;
}

export interface DateNightResult {
  plans: DateNightPlan[];
  /** Why fewer than three came back, in words the UI can show verbatim. */
  note?: string;
}

export function generateDateNights(input: DateNightInput): DateNightResult {
  const when = input.when ?? new Date();
  const exclude = input.excludeIds ?? new Set<string>();

  const anchors = input.places
    .filter((p) => !p.chain)
    .filter((p) => !p.dismissedAt)
    .filter((p) => p.obscurity >= MIN_ANCHOR_OBSCURITY)
    // A place with no sentence explaining it cannot carry an evening.
    .filter((p) => Boolean(p.hook))
    .filter((p) => inSeason(p.season, when))
    .filter((p) => !exclude.has(p.id))
    .filter((p) => p.category !== "Food & Drink");

  if (!anchors.length) {
    return {
      plans: [],
      note:
        "No anchor worth building an evening around yet — nothing nearby is both unusual enough and described well enough. Widen the radius, or run Find calendars near me to deepen the pool.",
    };
  }

  const food = input.places
    .filter((p) => p.category === "Food & Drink")
    .filter((p) => !p.chain && !p.dismissedAt);

  const plans: DateNightPlan[] = [];
  const usedAnchors = new Set<string>();

  for (const anchor of anchors) {
    if (plans.length >= 3) break;
    if (usedAnchors.has(anchor.id)) continue;

    const activity = input.locked?.activity ?? anchor;
    usedAnchors.add(activity.id);

    // Food and event are chosen relative to the ANCHOR, not the origin — an
    // evening is a route, and the second stop should be near the first.
    const nearbyFood =
      input.locked?.food ??
      food
        .filter((f) => distanceMi(activity, f) <= MAX_HOP_MI)
        .sort((a, b) => distanceMi(activity, a) - distanceMi(activity, b))[0];

    const nearbyEvent =
      input.locked?.event ??
      input.events
        .filter((e) => e.venue.lat !== undefined && e.venue.lon !== undefined)
        .filter(
          (e) =>
            distanceMi(activity, {
              lat: e.venue.lat!,
              lon: e.venue.lon!,
            }) <= MAX_HOP_MI,
        )
        // Prefer something that is itself a find, and that we believe in.
        .sort((a, b) => b.obscurity * b.confidence - a.obscurity * a.confidence)[0];

    plans.push({
      id: uid("plan"),
      title: titleFor(activity, nearbyEvent, nearbyFood),
      activity,
      event: nearbyEvent,
      food: nearbyFood,
      locked: [],
      estimatedCost: estimateCost(activity, nearbyEvent, nearbyFood),
      travelMi: travelDistance(input.origin, activity, nearbyEvent, nearbyFood),
    });
  }

  const note =
    plans.length < 3
      ? `Only ${plans.length === 1 ? "one evening" : `${plans.length} evenings`} met the bar — an anchor has to be genuinely unusual and have something written about it.`
      : undefined;

  return { plans, note };
}

/**
 * A name for the evening.
 *
 * Built from the two most concrete nouns available rather than a template, so
 * it reads like something a person would say: "The Rink and the Record Shop".
 */
function titleFor(
  activity: FnoPlace,
  event: FnoEvent | undefined,
  food: FnoPlace | undefined,
): string {
  const first = shortName(activity.name);
  const second = event ? shortName(event.title) : food ? shortName(food.name) : null;
  return second ? `${first} & ${second}` : first;
}

function shortName(name: string): string {
  const clean = name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  // Drop a trailing descriptor so two names fit in a card title.
  const trimmed = clean.split(/\s+[–—-]\s+/)[0];
  return trimmed.length > 30 ? `${trimmed.slice(0, 28)}…` : trimmed;
}

/**
 * A range, plus an honest flag when part of it is unknown.
 *
 * `fee` is present on a small minority of OSM elements, so most evenings will
 * carry at least one unknown. The UI renders that as "from $X, plus 2 unknowns"
 * rather than pretending the total is complete.
 */
function estimateCost(
  activity: FnoPlace,
  event: FnoEvent | undefined,
  food: FnoPlace | undefined,
): DateNightPlan["estimatedCost"] {
  let min = 0;
  let max = 0;
  let hasUnknown = false;

  const add = (price: { tier: string; min?: number; max?: number }) => {
    if (price.tier === "free") return;
    if (price.tier === "unknown") {
      hasUnknown = true;
      return;
    }
    if (price.tier === "donation") {
      max += 15; // A donation box is not free, but it is not a ticket price either.
      return;
    }
    if (price.min === undefined && price.max === undefined) {
      hasUnknown = true;
      return;
    }
    min += price.min ?? 0;
    max += price.max ?? price.min ?? 0;
  };

  add(activity.price);
  if (event) add(event.price);
  if (food) {
    // OSM never carries a meal price. Rather than mark the whole evening
    // unknown, use a conservative per-head band and say so in the UI.
    min += 20;
    max += 45;
  }

  return { min, max, hasUnknown };
}

function travelDistance(
  origin: Coords,
  activity: FnoPlace,
  event: FnoEvent | undefined,
  food: FnoPlace | undefined,
): number {
  const stops: Coords[] = [origin, activity];
  if (event?.venue.lat !== undefined && event.venue.lon !== undefined) {
    stops.push({ lat: event.venue.lat, lon: event.venue.lon });
  }
  if (food) stops.push(food);
  stops.push(origin);

  let total = 0;
  for (let i = 1; i < stops.length; i++) total += distanceMi(stops[i - 1], stops[i]);
  return Math.round(total * 10) / 10;
}

/**
 * One high-rarity, in-season place, ignoring every filter.
 *
 * Filtering is a narrowing gesture; surprise needs a widening one. Someone who
 * already knows the six categories they like will never filter their way into
 * something new — they have to be handed it.
 */
export function surpriseMe(
  places: FnoPlace[],
  when = new Date(),
  exclude = new Set<string>(),
): FnoPlace | null {
  const pool = places
    .filter((p) => !p.chain && !p.dismissedAt && !exclude.has(p.id))
    .filter((p) => inSeason(p.season, when))
    .filter((p) => p.obscurity >= 60);
  if (!pool.length) return null;

  // Weighted by obscurity so the strangest things come up most, without the
  // button becoming deterministic — a "Surprise me" that always returns the
  // same place is not a surprise.
  const weights = pool.map((p) => (p.obscurity - 55) ** 2);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return pool[0];

  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
