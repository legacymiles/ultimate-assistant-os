// ---------------------------------------------------------------------------
// The playroom's instruments, synthesised. Six voices built from oscillators,
// noise and one precomputed plucked string — no sample files, so nothing to
// download and nothing to host, and the playroom still works on a plane.
//
// Two rules hold for every voice in here:
//
//   1. Every pitch comes from scaleFreq(), which is the C major pentatonic of
//      audio.ts stretched across octaves. A baby mashing two palms on the harp
//      plays a chord, never a clash — the instrument is tuned so that random is
//      musical. The drums are tuned to it too, so a drum under a bell is in key.
//
//   2. Many hits at once must not crack the speaker. A glissando across ten
//      keys is ten voices inside a fifth of a second, which is exactly what a
//      baby does first. densityGain() turns each new voice down a little when
//      the last quarter-second was already busy, and the limiter after the
//      master catches whatever is left.
//
// Each voice is shaped to read as its instrument from the very first
// millisecond, because a baby decides "that is a drum" from the attack, not
// the tail: hammer noise on the piano, a mallet click on the xylophone, a
// plucked noise burst ringing through a delay on the harp, inharmonic partials
// on the bells, a pitch-swept membrane on every drum.
// ---------------------------------------------------------------------------

import { SCALE, audio, type AudioBus } from "./audio";

export type InstrumentId = "piano" | "xylophone" | "drums" | "harp" | "bells" | "bongos";

/** Shelf order, left to right. */
export const INSTRUMENTS: readonly InstrumentId[] = ["piano", "xylophone", "drums", "harp", "bells", "bongos"];

export const DEFAULT_INSTRUMENT: InstrumentId = "piano";

/** Where the playroom remembers the last instrument, so it reopens on it. */
export const INSTRUMENT_KEY = "baby-no-scroll:instrument";

export function isInstrumentId(v: unknown): v is InstrumentId {
  return typeof v === "string" && (INSTRUMENTS as readonly string[]).includes(v);
}

/** Each instrument's home colour: its shelf button and the tint of the room. */
export const INSTRUMENT_HUE: Record<InstrumentId, number> = {
  piano: 265,
  xylophone: 195,
  drums: 350,
  harp: 300,
  bells: 46,
  bongos: 135,
};

// --- pitch -----------------------------------------------------------------

/** The five notes of the pentatonic, one octave of audio.ts's SCALE. */
const PENTA = SCALE.slice(0, 5);

/**
 * A pentatonic note by step: 0 is middle C, 5 the C above, -5 the C below.
 * Any integer is valid, so an instrument just counts its keys from wherever
 * it wants its range to start.
 */
export function scaleFreq(step: number): number {
  const n = Math.round(step);
  const degree = ((n % 5) + 5) % 5;
  const octave = Math.floor(n / 5);
  return PENTA[degree] * Math.pow(2, octave);
}

/** A rainbow across `count` keys, red-pink at the bottom to violet at the top. */
export function noteHue(i: number, count: number): number {
  const k = count <= 1 ? 0 : i / (count - 1);
  return Math.round((350 + k * 290) % 360);
}

/**
 * How loud a new voice may be given how many started in the last quarter
 * second. Three at once is a chord and stays full; past that each extra voice
 * shaves a little off, down to a floor so a glissando never goes quiet.
 */
export function densityGain(recent: number): number {
  if (recent <= 3) return 1;
  return Math.max(0.38, 1 / (1 + 0.14 * (recent - 3)));
}

// --- the plucked string ----------------------------------------------------

/**
 * Karplus–Strong needs a whole number of samples per period, which detunes the
 * high strings. The fix is to round the delay down and play the buffer back a
 * touch slower: `n` is the period in samples, `rate` the playbackRate that
 * lands the pitch exactly on `freq`.
 */
export function ksPeriod(sampleRate: number, freq: number): { n: number; rate: number } {
  const n = Math.max(2, Math.floor(sampleRate / freq - 0.5));
  // The two-point average in the loop adds half a sample of delay.
  const played = sampleRate / (n + 0.5);
  return { n, rate: freq / played };
}

/**
 * A plucked string, rendered once into an array: a burst of filtered noise one
 * period long, fed round a loop that averages neighbouring samples. The
 * averaging is a lowpass, so the bright attack mellows into a round tone just
 * as a real string does — that slow darkening is what makes it a harp and not
 * a beep. Computed in JS rather than with a DelayNode loop because WebAudio
 * clamps a feedback delay to 128 samples, which would cap the harp below E4.
 */
export function karplus(
  sampleRate: number,
  freq: number,
  seconds: number,
  rnd: () => number = Math.random,
): Float32Array {
  const { n } = ksPeriod(sampleRate, freq);
  const len = Math.max(n + 2, Math.floor(sampleRate * seconds));
  const out = new Float32Array(len);

  // Excitation: noise through a one-pole lowpass (a finger, not a pick), with
  // its DC removed so the string does not thump.
  const bright = 0.55;
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    lp += (rnd() * 2 - 1 - lp) * bright;
    out[i] = lp;
    mean += lp;
  }
  mean /= n;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    out[i] -= mean;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  if (peak > 0) for (let i = 0; i < n; i++) out[i] /= peak;

  // Loss per trip round the loop, chosen so the string rings for about
  // `seconds` (to -60dB). Low strings ring longer, as they should.
  const loss = Math.pow(0.001, 1 / Math.max(1, freq * seconds));
  for (let i = n; i < len; i++) {
    const a = out[i - n];
    const b = i - n - 1 >= 0 ? out[i - n - 1] : a;
    out[i] = loss * 0.5 * (a + b);
  }

  // A short fade at the end so the buffer never stops on a click.
  const fade = Math.min(len - n, Math.floor(sampleRate * 0.03));
  for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
  return out;
}

// --- plumbing ----------------------------------------------------------------

/** Start times of recent voices, for densityGain. */
const recent: number[] = [];

interface Hit {
  a: AudioBus;
  c: AudioContext;
  /** When the note starts, in context time. */
  t: number;
  /** Velocity after the density trim. */
  g: number;
}

/** Every voice starts here: wake the context, note the hit, trim for a crowd. */
function begin(vel: number, delay: number): Hit | null {
  const a = audio();
  if (!a) return null;
  const now = a.ctx.currentTime;
  while (recent.length && recent[0] < now - 0.25) recent.shift();
  recent.push(now + delay);
  return { a, c: a.ctx, t: now + delay, g: Math.max(0, Math.min(1.2, vel)) * densityGain(recent.length) };
}

/** A gain node shaped as attack-then-exponential-decay. */
function env(c: AudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function osc(c: AudioContext, type: OscillatorType, freq: number, t: number, stop: number): OscillatorNode {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.start(t);
  o.stop(stop);
  return o;
}

/** Route a voice to the dry out and, a little, into the shared room. */
function route(h: Hit, node: AudioNode, wet: number): void {
  node.connect(h.a.out);
  if (wet > 0) {
    const s = h.c.createGain();
    s.gain.value = wet;
    node.connect(s).connect(h.a.room);
  }
}

let noiseBuf: AudioBuffer | null = null;

/** One second of white noise, made once and reused by every hit. */
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf = b;
  return b;
}

/** A filtered noise burst starting at a random point of the shared buffer. */
function burst(
  h: Hit,
  dest: AudioNode,
  type: BiquadFilterType,
  freq: number,
  q: number,
  peak: number,
  decay: number,
  attack = 0.001,
): void {
  const src = h.c.createBufferSource();
  src.buffer = noiseBuffer(h.c);
  const f = h.c.createBiquadFilter();
  f.type = type;
  f.frequency.value = Math.min(freq, h.c.sampleRate * 0.45);
  f.Q.value = q;
  const e = env(h.c, h.t, peak, attack, decay);
  src.connect(f).connect(e).connect(dest);
  const offset = Math.random() * Math.max(0, 1 - decay - attack - 0.05);
  src.start(h.t, offset, attack + decay + 0.02);
}

const nyquistSafe = (h: Hit, f: number) => f < h.c.sampleRate * 0.45;

// --- the voices ----------------------------------------------------------------

/**
 * Piano: pairs of slightly detuned partials (the chorus of three strings per
 * note), each higher partial dying faster than the one below, a lowpass that
 * closes as the note fades so it darkens like a real string, and a felt-hammer
 * thud on top. Partials are stretched a hair sharp, as real piano strings are.
 */
export function piano(freq: number, vel = 1, delay = 0): void {
  const h = begin(vel, delay);
  if (!h) return;
  const { c, t, g } = h;
  const dur = Math.max(0.9, Math.min(3.2, 2.6 * Math.sqrt(261.63 / freq)));

  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(Math.min(15000, freq * 16), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(500, freq * 3), t + dur * 0.7);
  route(h, lp, 0.22);

  // [harmonic, amplitude, decay fraction, detune cents]
  const parts: [number, number, number, number][] = [
    [1, 0.3, 1, -3],
    [1, 0.26, 1, 3.5],
    [2, 0.2, 0.62, 1.5],
    [3, 0.1, 0.42, -1],
    [4, 0.055, 0.3, 2],
    [5, 0.03, 0.22, 0],
  ];
  const B = 0.00035; // stiffness: partial n sits at n·sqrt(1 + B·n²)
  for (const [n, amp, frac, cents] of parts) {
    const f = freq * n * Math.sqrt(1 + B * n * n) * Math.pow(2, cents / 1200);
    if (!nyquistSafe(h, f)) continue;
    const decay = dur * frac;
    const o = osc(c, n === 1 ? "triangle" : "sine", f, t, t + decay + 0.05);
    o.connect(env(c, t, amp * g, 0.004, decay)).connect(lp);
  }
  burst(h, lp, "bandpass", Math.min(3200, freq * 6), 1.1, 0.16 * g, 0.035);
}

/**
 * Xylophone: a pure sine for the wooden bar, a quieter partial two octaves up
 * (the bar's tuned overtone) that dies almost at once, and a tick of bright
 * noise for the mallet. Short — a xylophone note is over in under a second,
 * which is why a glissando on it sounds like a waterfall and not a smear.
 */
export function xylophone(freq: number, vel = 1, delay = 0): void {
  const h = begin(vel, delay);
  if (!h) return;
  const { c, t, g } = h;
  const dur = Math.max(0.35, Math.min(1.1, 0.95 * Math.sqrt(523.25 / freq)));
  const bus = c.createGain();
  route(h, bus, 0.28);

  osc(c, "sine", freq, t, t + dur + 0.05).connect(env(c, t, 0.5 * g, 0.002, dur)).connect(bus);
  if (nyquistSafe(h, freq * 4)) {
    osc(c, "sine", freq * 4, t, t + dur * 0.3).connect(env(c, t, 0.16 * g, 0.001, dur * 0.22)).connect(bus);
  }
  if (nyquistSafe(h, freq * 9.9)) {
    osc(c, "sine", freq * 9.9, t, t + 0.08).connect(env(c, t, 0.05 * g, 0.001, 0.05)).connect(bus);
  }
  burst(h, bus, "highpass", 3000, 0.7, 0.2 * g, 0.018);
}

const ksCache = new Map<string, AudioBuffer>();

/** Harp: a Karplus–Strong string (see karplus above), cached per pitch. */
export function harp(freq: number, vel = 1, delay = 0): void {
  const h = begin(vel, delay);
  if (!h) return;
  const { c, t, g } = h;
  const seconds = Math.max(1.4, Math.min(3.2, 2.8 * Math.sqrt(196 / freq)));
  const key = `${c.sampleRate}:${freq.toFixed(2)}`;
  let buf = ksCache.get(key);
  if (!buf) {
    const data = karplus(c.sampleRate, freq, seconds);
    buf = c.createBuffer(1, data.length, c.sampleRate);
    buf.getChannelData(0).set(data);
    ksCache.set(key, buf);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = ksPeriod(c.sampleRate, freq).rate;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = Math.min(9000, freq * 14);
  const gain = c.createGain();
  gain.gain.value = 0.42 * g;
  src.connect(lp).connect(gain);
  route(h, gain, 0.38);
  // A breath of warmth under the string — the soundboard answering.
  osc(c, "sine", freq, t, t + 0.7).connect(env(c, t, 0.08 * g, 0.006, 0.6)).connect(gain);
  src.start(t);
}

/**
 * Bells: inharmonic partials — the 1 : 2.76 : 5.40 : 8.93 of a struck
 * free-free bar — plus a hum an octave down, each with its own long decay,
 * and an FM shimmer on the strike that fades in a moment. Sent heavily into
 * the room, because a bell is mostly its ring.
 */
export function bell(freq: number, vel = 1, delay = 0): void {
  const h = begin(vel, delay);
  if (!h) return;
  const { c, t, g } = h;
  const dur = Math.max(2, Math.min(5, 4.4 * Math.sqrt(523.25 / freq)));
  const bus = c.createGain();
  route(h, bus, 0.6);

  // [ratio, amplitude, decay fraction]
  const parts: [number, number, number][] = [
    [0.5, 0.08, 1.1],
    [1, 0.3, 1],
    [2.76, 0.13, 0.55],
    [5.4, 0.07, 0.3],
    [8.93, 0.035, 0.16],
  ];
  for (const [r, amp, frac] of parts) {
    const f = freq * r;
    if (!nyquistSafe(h, f)) continue;
    const decay = dur * frac;
    osc(c, "sine", f, t, t + decay + 0.05).connect(env(c, t, amp * g, 0.002, decay)).connect(bus);
  }

  // The strike: a carrier whose pitch is wobbled by a modulator at an
  // inharmonic ratio, the wobble dying in a third of a second.
  const carrier = osc(c, "sine", freq, t, t + 0.9);
  const mod = osc(c, "sine", freq * 3.5, t, t + 0.9);
  const depth = c.createGain();
  depth.gain.setValueAtTime(freq * 2.2, t);
  depth.gain.exponentialRampToValueAtTime(1, t + 0.35);
  mod.connect(depth).connect(carrier.frequency);
  carrier.connect(env(c, t, 0.12 * g, 0.002, 0.8)).connect(bus);
}

export type DrumKind = "kick" | "snare" | "tomHi" | "tomLo" | "cymbal";

/** The drum kit. Toms are tuned to G3 and C3 so they sit in the scale. */
export function drum(kind: DrumKind, vel = 1, delay = 0): void {
  const h = begin(vel, delay);
  if (!h) return;
  const { c, t, g } = h;
  const bus = c.createGain();

  switch (kind) {
    case "kick": {
      // A sine that falls from a thump to a boom — the whole sound of a kick.
      route(h, bus, 0.06);
      const o = osc(c, "sine", 150, t, t + 0.6);
      o.frequency.exponentialRampToValueAtTime(46, t + 0.16);
      o.connect(env(c, t, 0.95 * g, 0.002, 0.5)).connect(bus);
      burst(h, bus, "lowpass", 2600, 0.7, 0.28 * g, 0.014);
      break;
    }
    case "snare": {
      // Rattling wires (bright noise) over a short body tone.
      route(h, bus, 0.18);
      burst(h, bus, "highpass", 1400, 0.6, 0.5 * g, 0.2);
      burst(h, bus, "bandpass", 4200, 0.8, 0.22 * g, 0.12);
      const o = osc(c, "triangle", 230, t, t + 0.2);
      o.frequency.exponentialRampToValueAtTime(175, t + 0.06);
      o.connect(env(c, t, 0.42 * g, 0.001, 0.13)).connect(bus);
      break;
    }
    case "tomHi":
    case "tomLo": {
      route(h, bus, 0.16);
      const f = kind === "tomHi" ? 196 : 130.81;
      const o = osc(c, "sine", f * 1.7, t, t + 0.7);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
      o.connect(env(c, t, 0.75 * g, 0.002, kind === "tomHi" ? 0.42 : 0.55)).connect(bus);
      osc(c, "triangle", f * 1.5, t, t + 0.2).connect(env(c, t, 0.12 * g, 0.001, 0.1)).connect(bus);
      burst(h, bus, "lowpass", 1800, 0.7, 0.18 * g, 0.03);
      break;
    }
    case "cymbal": {
      // Highpassed noise for the wash, and a cluster of square waves at
      // unrelated pitches for the metal — the trick every drum machine uses.
      route(h, bus, 0.32);
      burst(h, bus, "highpass", 6500, 0.5, 0.3 * g, 1.7, 0.002);
      burst(h, bus, "bandpass", 9500, 1.2, 0.16 * g, 0.9, 0.002);
      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 5200;
      const metal = env(c, t, 0.07 * g, 0.002, 1.2);
      hp.connect(metal).connect(bus);
      for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) osc(c, "square", f * 1.7, t, t + 1.3).connect(hp);
      break;
    }
  }
}

/**
 * Bongos and conga: a membrane is a sine that starts sharp and drops onto its
 * pitch in a few milliseconds. Near the rim it is a slap — higher, shorter,
 * with a crack of mid noise; in the middle it is an open, round tone.
 */
export function bongo(freq: number, slap: boolean, vel = 1, delay = 0): void {
  const h = begin(vel, delay);
  if (!h) return;
  const { c, t, g } = h;
  const bus = c.createGain();
  route(h, bus, 0.14);
  const low = freq < 250;
  if (slap) {
    const o = osc(c, "sine", freq * 1.7, t, t + 0.2);
    o.frequency.exponentialRampToValueAtTime(freq * 1.25, t + 0.03);
    o.connect(env(c, t, 0.4 * g, 0.001, 0.09)).connect(bus);
    burst(h, bus, "bandpass", 3000, 1.4, 0.6 * g, 0.07);
    burst(h, bus, "highpass", 6000, 0.6, 0.15 * g, 0.03);
  } else {
    const o = osc(c, "sine", freq * 1.35, t, t + 0.6);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.03);
    o.connect(env(c, t, 0.72 * g, 0.002, low ? 0.48 : 0.3)).connect(bus);
    osc(c, "triangle", freq * 2.02, t, t + 0.12).connect(env(c, t, 0.08 * g, 0.001, 0.07)).connect(bus);
    burst(h, bus, "bandpass", freq * 5, 1, 0.12 * g, 0.02);
  }
}

/** The bongo set's three pitches: conga, big bongo, little bongo. */
export const BONGO_FREQ = [scaleFreq(-2), scaleFreq(2), scaleFreq(4)] as const;

/**
 * The few notes each instrument plays as it arrives on the shelf, so a baby
 * hears what the new toy is before touching it. Scheduled on the audio clock
 * (each voice's `delay`), so the rhythm is exact even on a busy frame.
 * Returns the hits as [delay, index] so the screen can light them in time.
 */
export function signature(id: InstrumentId): [number, number][] {
  const hits: [number, number][] = [];
  switch (id) {
    case "piano":
      [0, 2, 3, 5].forEach((k, j) => {
        piano(scaleFreq(k), 0.8, j * 0.1);
        hits.push([j * 0.1, k]);
      });
      break;
    case "xylophone":
      for (let k = 0; k < 8; k++) {
        xylophone(scaleFreq(k + 5), 0.7, k * 0.045);
        hits.push([k * 0.045, k]);
      }
      break;
    case "drums": {
      const seq: [number, DrumKind, number][] = [
        [0, "kick", 3],
        [0.15, "snare", 4],
        [0.26, "tomHi", 1],
        [0.35, "tomLo", 2],
        [0.48, "kick", 3],
        [0.48, "cymbal", 0],
      ];
      for (const [d, kind, idx] of seq) {
        drum(kind, 0.8, d);
        hits.push([d, idx]);
      }
      break;
    }
    case "harp":
      for (let k = 0; k < 9; k++) {
        harp(scaleFreq(k - 5), 0.7, k * 0.05);
        hits.push([k * 0.05, k]);
      }
      break;
    case "bells":
      [0, 2, 4].forEach((k, j) => {
        bell(scaleFreq(k + 5), 0.75, j * 0.2);
        hits.push([j * 0.2, k]);
      });
      break;
    case "bongos": {
      const seq: [number, number, boolean][] = [
        [0, 2, false],
        [0.11, 2, true],
        [0.22, 1, false],
        [0.36, 0, false],
      ];
      for (const [d, idx, slap] of seq) {
        bongo(BONGO_FREQ[idx], slap, 0.8, d);
        hits.push([d, idx]);
      }
      break;
    }
  }
  return hits;
}
