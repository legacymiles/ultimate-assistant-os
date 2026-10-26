export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Frame-rate independent exponential damping (Freya Holmér style). */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/**
 * The one wall clock for gameplay timing (event expiry, effect "until"s,
 * idle detection). Everything that compares timestamps uses this; R3F's
 * clock.elapsedTime is reserved for animation waves only. Mixing the two
 * is a bug — they have different epochs.
 */
export const wallNow = () => performance.now() / 1000;

/** Deterministic pseudo-random from a seed — items keep their personality across renders. */
export const seededRand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
