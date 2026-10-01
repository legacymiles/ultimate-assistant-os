// ---------------------------------------------------------------------------
// Personal Finance — money comparison.
//
// Amounts arrive as decimal numbers and must be compared exactly: the duplicate
// detector asks "are these two charges the same amount", and 0.1 + 0.2 === 0.3
// is false. Everything here converts to integer cents first. Nothing in this
// feature compares two amounts with === on floats.
//
// Note this is NOT the place for formatting. `money()` in src/lib/jarvis/
// updates.ts formats dollars only, and Finance holds accounts in several
// currencies, so display formatting belongs with the component that knows the
// row's currency.
// ---------------------------------------------------------------------------

/**
 * A decimal amount as an integer number of cents.
 *
 * `n * 100` is not exact: 9.995 becomes 999.4999999999999, so a bare
 * Math.round sends a half-cent DOWN while 9.985 → 998.5 goes up. Trimming to
 * 12 significant digits first restores the decimal the amount was written as,
 * and rounding away from zero keeps refunds symmetric with charges.
 */
export function cents(n: number): number {
  const scaled = Number((n * 100).toPrecision(12));
  return Math.sign(scaled) * Math.round(Math.abs(scaled));
}

export function fromCents(c: number): number {
  return c / 100;
}

export function sameAmount(a: number, b: number): boolean {
  return cents(a) === cents(b);
}

/** Sums in cents, so a long list of amounts does not drift. */
export function sum(amounts: number[]): number {
  return fromCents(amounts.reduce((total, n) => total + cents(n), 0));
}

/**
 * Is `actual` close enough to `expected`? The tolerance is the LARGER of the
 * absolute allowance and the percentage one, so a small bill gets a sensible
 * floor and a large one scales.
 */
export function withinTolerance(
  actual: number,
  expected: number,
  absolute: number,
  pct: number,
): boolean {
  const allowed = Math.max(cents(absolute), Math.round(cents(expected) * (pct / 100)));
  return Math.abs(cents(actual) - cents(expected)) <= allowed;
}
