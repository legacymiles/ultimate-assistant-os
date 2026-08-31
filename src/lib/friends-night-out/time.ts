// ---------------------------------------------------------------------------
// Wall-clock times, resolved in the right zone.
//
// This file exists because of the single highest-frequency data bug in US
// community calendars. WordPress and iCal feeds routinely publish a "floating"
// local time — `DTSTART:20260904T190000` with no TZID, or Tribe's
// `"2026-09-04 19:00:00"` — meaning seven in the evening where the venue is.
//
// Parsing that with `new Date(y, m, d, h, ...)` resolves it in the SERVER's
// zone. In local development that is usually right by accident. Deployed to any
// UTC host it is wrong by four to eight hours for every event from every
// WordPress feed in the country, which is worse than a display glitch:
//
//   - the event lands in the wrong day bucket, so "this weekend" is wrong
//   - it falls outside the 3-hour dedupe window against the same event from a
//     source that DID state a zone, so the duplicate survives and both copies
//     look single-sourced, which inflates both their obscurity scores
//
// The zone to use is the viewer's own, passed in from the browser. For an app
// whose entire premise is "events near me", the user's zone and the venue's
// zone are the same zone.
// ---------------------------------------------------------------------------

/**
 * Milliseconds to add to a UTC instant to get the wall-clock reading in `zone`.
 *
 * Derived by formatting the instant in that zone and diffing, which is the only
 * way to get a historically-correct offset without shipping a timezone
 * database — and it handles DST, because it asks about a specific instant
 * rather than about the zone in general.
 */
function zoneOffsetMs(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // `hour` comes back as 24 rather than 0 at midnight under hour12:false.
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asIfUtc - instant.getTime();
}

/**
 * A wall-clock reading in `zone` to a real instant.
 *
 * Two passes: guess that the reading is UTC, measure how far off that guess is
 * in the target zone, correct, then re-measure. The second pass matters only
 * near a DST boundary, where the first correction can land on the other side of
 * the transition and pick up the wrong offset.
 *
 * Falls back to server-local parsing when no zone is supplied or the zone name
 * is not one Intl recognises — wrong-but-working beats throwing.
 */
export function wallTimeToIso(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  zone?: string,
): string {
  if (!zone) {
    return new Date(year, month - 1, day, hour, minute, second).toISOString();
  }
  try {
    const guess = Date.UTC(year, month - 1, day, hour, minute, second);
    let instant = new Date(guess - zoneOffsetMs(new Date(guess), zone));
    instant = new Date(guess - zoneOffsetMs(instant, zone));
    return instant.toISOString();
  } catch {
    return new Date(year, month - 1, day, hour, minute, second).toISOString();
  }
}

/** `2026-09-04 19:00:00` / `2026-09-04T19:00` with no offset — a wall time. */
export function parseWallTimestamp(value: string, zone?: string): string | null {
  const m = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return wallTimeToIso(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0), zone);
}

/**
 * The viewer's IANA zone, read in the browser and sent with each search.
 *
 * Returns undefined rather than a guess when the environment cannot say, so
 * callers fall back explicitly instead of silently trusting a wrong zone.
 */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
