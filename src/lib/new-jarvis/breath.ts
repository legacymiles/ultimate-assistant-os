/**
 * The galaxy's breath: 0 → 1 → 0 over one cycle — a swell (40%), a short
 * hold (8%), a longer release (52%). Any phase is accepted and wrapped, so a
 * stray negative or overflowing step can never push it outside 0..1.
 */
export function breathCurve(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const phase = ((raw % 1) + 1) % 1;
  const ease = (x: number) => x * x * (3 - 2 * x);
  if (phase < 0.4) return ease(phase / 0.4);
  if (phase < 0.48) return 1;
  return 1 - ease((phase - 0.48) / 0.52);
}
