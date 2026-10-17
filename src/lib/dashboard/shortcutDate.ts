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
