// ---------------------------------------------------------------------------
// The money maths for the RunPod agent.
//
// Pure functions on purpose: the confirm gate, the running banner and the
// idle auto-stop all read from here, and every one of them is a number the
// owner will check against a real invoice.
//
// RunPod bills a running pod by the hour (`cost` on the pod object, USD/hr)
// and keeps charging a smaller amount for the volume while stopped. This file
// models the compute rate only — the part a confirm gate can prevent.
// ---------------------------------------------------------------------------

/** Stop the pod after this long with nobody talking to it. */
export const DEFAULT_IDLE_STOP_MINUTES = 15;

/** The idle timeouts the UI offers. "Never" is deliberately absent. */
export const IDLE_STOP_CHOICES = [5, 15, 30, 60] as const;

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

/** Hours a pod has been running. Never negative, even if clocks disagree. */
export function elapsedHours(startedAt: number, now: number): number {
  return Math.max(0, (now - startedAt) / MS_PER_HOUR);
}

/** USD spent on compute since the pod started. */
export function costSoFar(ratePerHour: number, startedAt: number, now: number): number {
  if (!Number.isFinite(ratePerHour) || ratePerHour <= 0) return 0;
  return ratePerHour * elapsedHours(startedAt, now);
}

/** USD this many minutes would cost — what the confirm gate quotes. */
export function projectedCost(ratePerHour: number, minutes: number): number {
  if (!Number.isFinite(ratePerHour) || ratePerHour <= 0) return 0;
  return ratePerHour * (Math.max(0, minutes) / 60);
}

/**
 * Under a cent reads as nothing, and the point of a live meter is that it
 * should feel like money, so say "<$0.01" rather than "$0.00".
 */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "$0.00";
  if (amount > 0 && amount < 0.01) return "<$0.01";
  return `$${amount.toFixed(2)}`;
}

export function formatRate(ratePerHour: number): string {
  if (!Number.isFinite(ratePerHour) || ratePerHour <= 0) return "rate unknown";
  return `$${ratePerHour.toFixed(2)}/hr`;
}

/** "1h 04m" — the other half of the meter. */
export function formatElapsed(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / MS_PER_MINUTE));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/**
 * Has it been quiet long enough to stop paying?
 *
 * A pure predicate rather than a browser timer, because the server re-checks
 * it on every poll — so a closed tab cannot leave a pod running.
 */
export function shouldAutoStop(
  lastActivityAt: number,
  now: number,
  idleMinutes: number = DEFAULT_IDLE_STOP_MINUTES,
): boolean {
  if (!Number.isFinite(idleMinutes) || idleMinutes <= 0) return false;
  return now - lastActivityAt >= idleMinutes * MS_PER_MINUTE;
}

/** Minutes left before the auto-stop fires, for the banner's countdown. */
export function minutesUntilAutoStop(
  lastActivityAt: number,
  now: number,
  idleMinutes: number = DEFAULT_IDLE_STOP_MINUTES,
): number {
  const left = idleMinutes * MS_PER_MINUTE - (now - lastActivityAt);
  return Math.max(0, Math.ceil(left / MS_PER_MINUTE));
}
