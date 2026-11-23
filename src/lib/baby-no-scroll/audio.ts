// ---------------------------------------------------------------------------
// Every sound in the games, synthesised. No files, so nothing to download, no
// bucket to configure, and the whole thing still works on a plane.
//
// The one real design decision is in SCALE. The games are played by babies
// hitting things at random, and a random note out of a major scale sounds
// WRONG about a third of the time. A pentatonic scale has no semitone pairs in
// it, so there is no interval a baby can hit that sounds like a mistake. The
// instrument is tuned so that mashing is musical.
// ---------------------------------------------------------------------------

/** C major pentatonic across two octaves: nothing in here can clash. */
export const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** A shared room: a send every voice can use so notes ring instead of stopping dead. */
let room: GainNode | null = null;

type Ctor = typeof AudioContext;

/**
 * The shared context, created on the first sound rather than on mount — a
 * context made before a user gesture starts suspended and stays silent.
 * Returns null where WebAudio does not exist, and the games simply go quiet
 * rather than breaking.
 */
export interface AudioBus {
  ctx: AudioContext;
  /** Dry output, already headroomed. */
  out: GainNode;
  /** Reverb send. Connect a voice here as well as to `out` to give it a room. */
  room: GainNode;
}

export function audio(): AudioBus | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor: Ctor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    master = ctx.createGain();
    // Headroom: ten balloons popping at once must not clip or startle.
    master.gain.value = 0.32;
    // A gentle limiter after the master, so a palm on the drum kit is loud
    // but never a crack in the speaker.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    master.connect(limiter).connect(ctx.destination);

    // The room: a generated impulse (decaying stereo noise) through a
    // convolver. No file to fetch, and one convolver serves every game.
    room = ctx.createGain();
    room.gain.value = 0.5;
    try {
      const len = Math.floor(ctx.sampleRate * 1.9);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      const verb = ctx.createConvolver();
      verb.buffer = ir;
      room.connect(verb).connect(master);
    } catch {
      room.connect(master);
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return master && room ? { ctx, out: master, room } : null;
}

/** Called from the first tap on a locked screen so the first note is not late. */
export function wakeAudio(): void {
  audio();
}

export interface ToneOptions {
  type?: OscillatorType;
  /** Seconds. */
  duration?: number;
  gain?: number;
  /** Seconds of attack — a soft one stops a note sounding like a click. */
  attack?: number;
  /** 0–1 of the note sent to the shared room as well. */
  reverb?: number;
  /** Seconds from now to start, for scheduled melodies. */
  delay?: number;
}

/** One note, enveloped. Overlapping calls layer, which is the point. */
export function tone(freq: number, opts: ToneOptions = {}): void {
  const a = audio();
  if (!a) return;
  const { type = "triangle", duration = 0.7, gain = 0.5, attack = 0.012, reverb = 0.25, delay = 0 } = opts;
  const t = a.ctx.currentTime + delay;

  const osc = a.ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;

  const env = a.ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  osc.connect(env).connect(a.out);
  if (reverb > 0) {
    const send = a.ctx.createGain();
    send.gain.value = reverb;
    env.connect(send).connect(a.room);
  }
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

/** A note of the scale by index, wrapping into higher octaves past the end. */
export function note(i: number, opts?: ToneOptions): void {
  const n = ((i % SCALE.length) + SCALE.length) % SCALE.length;
  const octave = Math.floor(i / SCALE.length);
  tone(SCALE[n] * Math.pow(2, Math.max(0, octave)), opts);
}

/** Balloon: a short pitched blip with a noise burst under it. */
export function pop(pitch = 1): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime;

  const osc = a.ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(900 * pitch, t);
  osc.frequency.exponentialRampToValueAtTime(180 * pitch, t + 0.12);
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(0.6, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  osc.connect(env).connect(a.out);
  osc.start(t);
  osc.stop(t + 0.2);

  noise(0.06, 2400, 0.35);
}

/** Egg: a dry crack, which is filtered noise and nothing else. */
export function crack(): void {
  noise(0.09, 1400, 0.5);
  tone(160, { type: "sine", duration: 0.18, gain: 0.35 });
}

/** The reward: three notes of the scale, arpeggiated upward. */
export function cheer(root = 0): void {
  [0, 2, 4].forEach((step, i) => {
    window.setTimeout(() => note(root + step, { duration: 0.9, gain: 0.4 }), i * 110);
  });
}

/** A soft mark for a finger moving across the screen. */
export function sparkle(x: number): void {
  note(Math.floor(x * 8), { type: "sine", duration: 0.5, gain: 0.22 });
}

/** The lock opening: a mechanical thunk, then relief. */
export function unlatch(): void {
  noise(0.05, 900, 0.4);
  tone(130.81, { type: "sawtooth", duration: 0.25, gain: 0.3 });
  window.setTimeout(() => tone(392, { type: "triangle", duration: 0.6, gain: 0.25 }), 90);
}

/** The lock refusing: two low knocks. */
export function refuse(): void {
  tone(98, { type: "square", duration: 0.09, gain: 0.22 });
  window.setTimeout(() => tone(87, { type: "square", duration: 0.12, gain: 0.2 }), 110);
}

/** Filtered white noise, the percussive half of everything above. */
export function noise(
  duration: number,
  cutoff: number,
  gain: number,
  type: BiquadFilterType = "lowpass",
): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime;
  const frames = Math.max(1, Math.floor(a.ctx.sampleRate * duration));
  const buffer = a.ctx.createBuffer(1, frames, a.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Decaying noise: a flat burst reads as static, a decaying one as an impact.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = a.ctx.createBufferSource();
  src.buffer = buffer;

  const filter = a.ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = cutoff;

  const env = a.ctx.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  src.connect(filter).connect(env).connect(a.out);
  src.start(t);
}
