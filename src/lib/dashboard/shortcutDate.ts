// ---------------------------------------------------------------------------
// Dates as an iPhone Shortcut sends them.
//
// A Date variable dropped into a form field arrives as text in the phone's own
// format — "Oct 16, 2026 at 11:03 PM", "16 Oct 2026 at 23:03", sometimes ISO —
// with a narrow no-break space before AM/PM. These are only ever COMPARED with
// each other (to find the newest photo sent), and every one is parsed the same
// way, so the server's timezone cancels out. The phone gets back the exact
// text it sent, which it parses in its own timezone.
// ---------------------------------------------------------------------------

/** Milliseconds for ordering, or NaN when it is not a date. */
export function parseShortcutDate(raw: string | undefined | null): number {
  if (!raw) return NaN;
  const cleaned = raw
    .replace(/[  ]/g, " ")
    .replace(/\s+at\s+/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return NaN;
  const t = Date.parse(cleaned);
  if (Number.isFinite(t)) return t;
  // "16/10/2026, 23:03" — day-first numeric, which Date.parse reads month-first.
  const m = cleaned.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4}),?\s+(\d{1,2}):(\d{2})/);
  if (m) {
    const [, a, b, y, h, mi] = m.map(Number) as unknown as number[];
    const day = a > 12 ? a : b > 12 ? b : a;
    const month = a > 12 ? b : b > 12 ? a : b;
    return Date.UTC(y, month - 1, day, h, mi);
  }
  return NaN;
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/**
 * The same text read IN THIS BROWSER'S TIMEZONE, for the photo's real "taken"
 * time. Built by hand, not with Date.parse: Safari on the iPhone refuses
 * "Oct 21, 2026 11:34 PM", so every photo the phone brought in used to be
 * stamped with the moment it arrived — which is why the phone's queue didn't
 * show the newest photo at the top.
 */
export function shortcutDateLocal(raw: string | undefined | null): number {
  if (!raw) return NaN;
  const s = raw
    .replace(/[\u202f\u00a0]/g, " ")
    .replace(/\s+at\s+/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return NaN;
  // ISO, or anything with an explicit zone, is unambiguous.
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) || /(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    if (Number.isFinite(t)) return t;
  }
  const time = (h: string, mi: string, sec?: string, ampm?: string) => {
    let hour = Number(h);
    if (ampm) {
      const pm = /p/i.test(ampm);
      if (hour === 12) hour = pm ? 12 : 0;
      else if (pm) hour += 12;
    }
    return [hour, Number(mi), Number(sec ?? 0)] as const;
  };
  // "Oct 21, 2026 11:34 PM" / "October 21, 2026 11:34:05 PM"
  let m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})(?:,? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([AaPp]\.?[Mm]\.?)?)?$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon !== undefined) {
      const [h, mi, sec] = m[4] ? time(m[4], m[5], m[6], m[7]) : [0, 0, 0];
      return new Date(Number(m[3]), mon, Number(m[2]), h, mi, sec).getTime();
    }
  }
  // "21 Oct 2026 23:34"
  m = s.match(/^(\d{1,2}) ([A-Za-z]{3,9})\.? (\d{4})(?:,? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([AaPp]\.?[Mm]\.?)?)?$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon !== undefined) {
      const [h, mi, sec] = m[4] ? time(m[4], m[5], m[6], m[7]) : [0, 0, 0];
      return new Date(Number(m[3]), mon, Number(m[1]), h, mi, sec).getTime();
    }
  }
  // "10/21/2026, 11:34 PM" (US) or "21/10/2026, 23:34" (day first when it must be)
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([AaPp]\.?[Mm]\.?)?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const day = a > 12 ? a : b > 12 ? b : b;
    const month = a > 12 ? b : b > 12 ? a : a;
    const [h, mi, sec] = time(m[4], m[5], m[6], m[7]);
    return new Date(Number(m[3]), month - 1, day, h, mi, sec).getTime();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}
