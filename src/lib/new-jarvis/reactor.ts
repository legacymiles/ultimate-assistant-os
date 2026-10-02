// ---------------------------------------------------------------------------
// What the Reactor is actually saying.
//
// A voice visualiser that only gets louder tells you something is making a
// noise. That is not information — you can already hear it. The idea here is
// that the ring encodes the DIRECTION of the conversation, so the shape tells
// you what is happening without reading a word:
//
//   waiting   a slow outward sweep, very faint. Listening into the room.
//   hearing   the spectrum collapses INWARD toward the core. Being taken in.
//   thinking  no spectrum at all, because there IS no audio — a tight
//             deterministic orbit instead. Silence should look like silence.
//   speaking  the spectrum radiates OUTWARD from the core. Being given back.
//
// All the geometry lives here, pure and tested, so the canvas component is
// only a renderer. That split is what lets "does the ring reverse when it
// starts speaking" be a unit test rather than something you squint at.
// ---------------------------------------------------------------------------

import { BAND_COUNT, loudness } from "./spectrum";
import type { VoiceState } from "./useWakeVoice";

export type ReactorMode = "ring" | "wave" | "core";

export const REACTOR_MODES: { id: ReactorMode; label: string }[] = [
  { id: "ring", label: "Ring" },
  { id: "wave", label: "Wave" },
  { id: "core", label: "Core" },
];

/** Which way energy is travelling. The whole idea, in one value. */
export type Flow = "in" | "out" | "still";

export function flowOf(state: VoiceState): Flow {
  switch (state) {
    case "hearing":
      return "in";
    case "speaking":
      return "out";
    default:
      // Waiting, thinking and off are all "nothing is crossing the boundary".
      return "still";
  }
}

/**
 * The token name for a state's colour.
 *
 * Returned as a CSS custom property rather than a hex value so the Reactor
 * cannot drift from the rest of the surface — these are the same four tokens
 * the command line and the rail already use for the same four meanings.
 */
export function colourVar(state: VoiceState): string {
  switch (state) {
    case "hearing":
      return "--color-core";
    case "speaking":
      return "--color-brand";
    case "thinking":
      return "--color-support";
    default:
      return "--color-ink-faint";
  }
}

/** The word under the ring. Short, because it is read at a glance and never read twice. */
export function badgeOf(state: VoiceState): string {
  switch (state) {
    case "off":
      return "OFFLINE";
    case "waiting":
      return "ONLINE";
    case "hearing":
      return "LISTENING";
    case "thinking":
      return "THINKING";
    case "speaking":
      return "SPEAKING";
  }
}

// --- the ring --------------------------------------------------------------

export interface RingSpec {
  /** Where the band's bar starts, as a fraction of the outer radius. */
  from: number;
  /** Where it ends. May be LESS than `from` — that is an inward bar. */
  to: number;
  /** Radians. */
  angle: number;
  /** 0..1, for alpha. */
  strength: number;
}

/** Radius of the still core, before any audio moves it. */
export const CORE_RADIUS = 0.26;

/** Where the band ring sits when nothing is happening. */
export const REST_RADIUS = 0.52;

/**
 * Lay the bands out around the ring.
 *
 * `flow` is what makes this more than a circular bar chart:
 *
 *   out    bars grow outward from the rest radius — the normal, obvious one
 *   in     bars grow INWARD from the rest radius, toward the core
 *   still  bars sit symmetric about the rest radius, going nowhere
 *
 * The bars are mirrored across the vertical axis, so the ring reads as one
 * object rather than a strip bent into a circle: a spectrum that starts at 3
 * o'clock and ends there looks like a seam, every frame.
 */
export function ringSpecs(bands: Float32Array, flow: Flow, reach = 0.34, out?: RingSpec[]): RingSpec[] {
  const n = bands.length;
  const specs = out && out.length === n * 2 ? out : new Array<RingSpec>(n * 2);

  for (let i = 0; i < n; i += 1) {
    const strength = Math.max(0, Math.min(1, bands[i]));
    const depth = strength * reach;

    let from = REST_RADIUS;
    let to = REST_RADIUS;
    if (flow === "out") {
      to = REST_RADIUS + depth;
    } else if (flow === "in") {
      // Clamped at the core: a bar that reaches through the middle and out the
      // other side reads as a glitch, not as intensity.
      to = Math.max(CORE_RADIUS, REST_RADIUS - depth);
    } else {
      from = REST_RADIUS - depth * 0.5;
      to = REST_RADIUS + depth * 0.5;
    }

    // Half a turn, mirrored, starting at the top.
    const step = Math.PI / n;
    const angle = -Math.PI / 2 + i * step + step / 2;

    const right = specs[i] ?? ({} as RingSpec);
    right.from = from;
    right.to = to;
    right.angle = angle;
    right.strength = strength;
    specs[i] = right;

    const left = specs[n * 2 - 1 - i] ?? ({} as RingSpec);
    left.from = from;
    left.to = to;
    left.angle = -angle - Math.PI;
    left.strength = strength;
    specs[n * 2 - 1 - i] = left;
  }

  return specs;
}

/**
 * How big the core is right now.
 *
 * Breathes slowly at rest so it is never a dead dot, swells with loudness, and
 * CONTRACTS while thinking — the one state where there is no sound at all, and
 * where a swelling core would be inventing activity that is not happening.
 */
export function coreRadius(state: VoiceState, level: number, t: number): number {
  const breath = 1 + Math.sin(t * 1.6) * 0.035;
  if (state === "thinking") {
    // Tight and pulsing quickly: concentration, not volume.
    return CORE_RADIUS * (0.72 + Math.sin(t * 5.2) * 0.05);
  }
  if (state === "off") return CORE_RADIUS * 0.55;
  return CORE_RADIUS * breath * (1 + level * 0.55);
}

/**
 * The sweep hand's angle.
 *
 * Constant velocity, because it is the machine half of the object — the
 * spectrum is the springy human half, and having the two move with different
 * personalities is what makes the whole thing read as an instrument reading a
 * person rather than as one animation.
 */
export function sweepAngle(state: VoiceState, t: number, idleFactor = 1): number {
  const speed = state === "thinking" ? 2.6 : state === "speaking" ? 0.9 : 0.55 * idleFactor;
  return (t * speed) % (Math.PI * 2);
}

/**
 * How awake the ring looks while nothing is happening.
 *
 * After a stretch of silence the sweep slows and everything dims to a
 * heartbeat, so a quiet room looks quiet. Returns 1 when something is
 * happening and eases toward `floor` as the silence runs on.
 */
export const IDLE_AFTER_MS = 12_000;

export function idleFactor(state: VoiceState, silentForMs: number, floor = 0.35): number {
  if (state !== "waiting") return 1;
  const over = Math.max(0, silentForMs - IDLE_AFTER_MS);
  // Reaches the floor about ten seconds after it starts easing.
  const t = Math.min(1, over / 10_000);
  return 1 - (1 - floor) * t;
}

// --- the ignition ----------------------------------------------------------

/**
 * The flash when it hears its name.
 *
 * This is the moment the surface currently gives no feedback for at all: the
 * wake word is detected a full second before anything is captured, and until
 * now nothing on screen moved. Returns 0..1, decaying over `ms`.
 */
export const IGNITION_MS = 520;

export function ignition(firedAt: number, now: number, ms = IGNITION_MS): number {
  if (!firedAt) return 0;
  const age = now - firedAt;
  if (age < 0 || age > ms) return 0;
  const t = age / ms;
  // Hard on, fast off — an ignition, not a fade in and out.
  return Math.pow(1 - t, 2.2);
}

// --- telemetry -------------------------------------------------------------

/**
 * A rolling frame rate.
 *
 * Shown because the video's reactor showed one, and kept because it is the
 * honest way to tell "the visual is smooth" from "the tab is struggling" at a
 * glance. Averaged over a window so it does not flicker between 59 and 61.
 */
export class Fps {
  private readonly times: number[] = [];
  private readonly window: number;

  constructor(window = 30) {
    this.window = window;
  }

  tick(now: number): void {
    this.times.push(now);
    while (this.times.length > this.window) this.times.shift();
  }

  get value(): number {
    if (this.times.length < 2) return 0;
    const span = this.times[this.times.length - 1] - this.times[0];
    if (span <= 0) return 0;
    return ((this.times.length - 1) / span) * 1000;
  }
}

/** `249 ms`, or an em dash when there is nothing to report. Never a lying zero. */
export function formatMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatFps(fps: number): string {
  return fps > 0 ? `${fps.toFixed(1)} fps` : "—";
}

// --- the wave mode ---------------------------------------------------------

/**
 * A ribbon through the bands, as y offsets in -1..1.
 *
 * Mirrored about the centre line so it reads as a waveform rather than as a
 * bar chart lying on its side, and eased at both ends so the ribbon does not
 * appear to be cut off by the edge of the canvas.
 */
export function ribbon(bands: Float32Array, out?: Float32Array): Float32Array {
  const n = bands.length;
  const ys = out && out.length >= n ? out : new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = i / Math.max(1, n - 1);
    // Taper: sin over the full width is 0 at both ends and 1 in the middle.
    const taper = Math.sin(Math.PI * x);
    ys[i] = bands[i] * taper;
  }
  return ys;
}

// --- the core mode ---------------------------------------------------------

export interface Mote {
  /** 0..1 along its orbit. */
  phase: number;
  /** Orbit radius at rest, as a fraction of the outer radius. */
  orbit: number;
  /** Radians per second. Signed, so motes counter-rotate. */
  speed: number;
  /** Which band drives this mote. */
  band: number;
}

/**
 * A deterministic field of motes for the core mode.
 *
 * Seeded rather than random so the field is the same every time the panel
 * mounts — a particle field that is different on every page load cannot be
 * recognised, and the point of this mode is that it is the owner's reactor.
 */
export function motes(count = 56, seed = 0x5eed): Mote[] {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };

  const out: Mote[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      phase: rand(),
      orbit: 0.3 + rand() * 0.45,
      speed: (0.12 + rand() * 0.3) * (rand() > 0.5 ? 1 : -1),
      band: Math.floor(rand() * BAND_COUNT),
    });
  }
  return out;
}

/**
 * Where a mote is, and how far the audio has pushed it.
 *
 * `flow` moves it the same way the ring's bars move: inward while hearing,
 * outward while speaking. One idea, expressed twice.
 */
export function motePosition(
  mote: Mote,
  bands: Float32Array,
  flow: Flow,
  t: number,
): { x: number; y: number; strength: number } {
  const strength = bands[mote.band % Math.max(1, bands.length)] ?? 0;
  const push = flow === "out" ? strength * 0.3 : flow === "in" ? -strength * 0.22 : 0;
  const radius = Math.max(0.08, mote.orbit + push);
  const angle = mote.phase * Math.PI * 2 + t * mote.speed;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, strength };
}

/** One number for "how much is going on", for the HUD's own level readout. */
export function activity(bands: Float32Array, state: VoiceState): number {
  if (state === "off") return 0;
  if (state === "thinking") return 0;
  return loudness(bands);
}
