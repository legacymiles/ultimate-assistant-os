// ---------------------------------------------------------------------------
// EA World › Replay — New York time, done the same way the EA does it.
//
// The .mq4 cannot use a timezone database, so it applies the US DST rule by
// hand (second Sunday of March 07:00 UTC → first Sunday of November 06:00
// UTC). This file applies the SAME rule rather than Intl, so the replay and the
// EA can never disagree about whether 08:00 New York has started.
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** UTC ms of 00:00 UTC on the nth Sunday of a month (month 1–12). */
function nthSundayUtc(year: number, month: number, nth: number): number {
  const first = Date.UTC(year, month - 1, 1);
  const dow = new Date(first).getUTCDay();
  const firstSunday = 1 + ((7 - dow) % 7);
  return Date.UTC(year, month - 1, firstSunday + 7 * (nth - 1));
}

export function usDstAt(utcMs: number): boolean {
  const y = new Date(utcMs).getUTCFullYear();
  const start = nthSundayUtc(y, 3, 2) + 7 * HOUR;
  const end = nthSundayUtc(y, 11, 1) + 6 * HOUR;
  return utcMs >= start && utcMs < end;
}

/** New York offset from UTC in hours at this instant (-4 in summer, -5 in winter). */
export function nyOffsetHours(utcMs: number): number {
  return usDstAt(utcMs) ? -4 : -5;
}

export interface NyClock {
  /** HHMM as a number, e.g. 930 for 09:30. */
  hhmm: number;
  /** 0 = Sunday … 6 = Saturday, in New York. */
  dow: number;
  /** YYYY-MM-DD in New York. */
  date: string;
}

export function nyClock(utcMs: number): NyClock {
  const d = new Date(utcMs + nyOffsetHours(utcMs) * HOUR);
  return {
    hhmm: d.getUTCHours() * 100 + d.getUTCMinutes(),
    dow: d.getUTCDay(),
    date: d.toISOString().slice(0, 10),
  };
}

/** UTC ms for a New York wall-clock time on a New York date ("2026-10-16", 800). */
export function nyToUtc(date: string, hhmm: number): number {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, Math.floor(hhmm / 100), hhmm % 100);
  // Guess with the offset at the wall time read as UTC, then correct once —
  // enough everywhere except the hour that does not exist on spring-forward day.
  let utc = wall - nyOffsetHours(wall) * HOUR;
  utc = wall - nyOffsetHours(utc) * HOUR;
  return utc;
}

/** True when this instant is inside [start, end) New York time on a weekday. */
export function inNySession(utcMs: number, startHHMM: number, endHHMM: number, weekends = false): boolean {
  const c = nyClock(utcMs);
  if (!weekends && (c.dow === 0 || c.dow === 6)) return false;
  if (startHHMM <= endHHMM) return c.hhmm >= startHHMM && c.hhmm < endHHMM;
  return c.hhmm >= startHHMM || c.hhmm < endHHMM;
}

export interface SessionPreset {
  id: string;
  label: string;
  start: number;
  end: number;
  hint: string;
}

/** Windows in New York time. "Peak" is where an HFT EA earns or loses its keep. */
export const SESSION_PRESETS: SessionPreset[] = [
  { id: "ny-peak", label: "NY peak 08:00–11:00", start: 800, end: 1100, hint: "US data at 08:30, stock open at 09:30, London still open" },
  { id: "ny-open", label: "NY open 09:30–11:30", start: 930, end: 1130, hint: "cash equity open — indices move hardest here" },
  { id: "overlap", label: "London/NY overlap 08:00–12:00", start: 800, end: 1200, hint: "the deepest liquidity of the day in FX" },
  { id: "data", label: "Data drop 08:25–09:00", start: 825, end: 900, hint: "just the 08:30 release and its aftermath" },
  { id: "ny-full", label: "NY full 08:00–17:00", start: 800, end: 1700, hint: "the whole New York day" },
];

/**
 * The most recent New York dates whose window has fully finished by `nowMs`,
 * newest first. Weekends are skipped unless the market trades them.
 */
export function recentSessionDates(nowMs: number, count: number, endHHMM: number, weekends = false): string[] {
  const out: string[] = [];
  let probe = nowMs;
  for (let guard = 0; out.length < count && guard < count * 3 + 7; guard++) {
    const c = nyClock(probe);
    const finished = nyToUtc(c.date, endHHMM) + HOUR <= nowMs; // data lands ~1h after the hour
    const weekday = c.dow !== 0 && c.dow !== 6;
    if (finished && (weekends || weekday) && !out.includes(c.date)) out.push(c.date);
    probe -= DAY;
  }
  return out;
}

export function formatNy(utcMs: number, withSeconds = true): string {
  const d = new Date(utcMs + nyOffsetHours(utcMs) * HOUR);
  const s = d.toISOString();
  return withSeconds ? s.slice(11, 23) : s.slice(11, 16);
}
