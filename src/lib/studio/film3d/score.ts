// ---------------------------------------------------------------------------
// The score, composed in code from the beats.
//
// `scoreEvents` is pure: it reads the beat roles and writes a list of notes
// and hits — thin at the start, fuller through the journey, everything in the
// rush, a HARD STOP for the silence, the loudest hit on the payoff (chord stab
// + sub drop + crash), a soft resolved chord to end. His motif is a rising
// fifth. `renderScore` plays that list into an AudioBuffer with an
// OfflineAudioContext (browser only); `wavBytes` writes it as a WAV for the PC.
// ---------------------------------------------------------------------------

import type { BeatRole, Film3D } from "./plan";
import { durationOf, rand } from "./director";

export type Voice = "pad" | "bass" | "pluck" | "lead" | "kick" | "snare" | "hat" | "crash" | "sub" | "stab";

export interface NoteEvent {
  t: number;
  dur: number;
  voice: Voice;
  /** MIDI note (pitched voices only). */
  note?: number;
  gain: number;
  pan?: number;
}

export const BPM = 120;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

/** I–V–vi–IV in C, voiced around middle C; the problem beat turns to vi–IV. */
const CHORDS: Record<string, { root: number; tones: number[] }> = {
  I: { root: 36, tones: [60, 64, 67] },
  V: { root: 43, tones: [59, 62, 67] },
  vi: { root: 45, tones: [60, 64, 69] },
  IV: { root: 41, tones: [60, 65, 69] },
};
const BRIGHT = ["I", "V", "vi", "IV"];
const DARK = ["vi", "IV", "vi", "V"];

const LAYERS: Record<BeatRole, { pad: number; bass: number; pluck: number; drums: number; hats16: boolean }> = {
  hook: { pad: 0.5, bass: 0, pluck: 0.5, drums: 0, hats16: false },
  problem: { pad: 0.55, bass: 0.5, pluck: 0.35, drums: 0, hats16: false },
  journey: { pad: 0.5, bass: 0.7, pluck: 0.6, drums: 0.7, hats16: false },
  rush: { pad: 0.55, bass: 0.9, pluck: 0.75, drums: 1, hats16: true },
  silence: { pad: 0, bass: 0, pluck: 0, drums: 0, hats16: false },
  payoff: { pad: 0.7, bass: 0.9, pluck: 0.7, drums: 0.8, hats16: false },
  return: { pad: 0.55, bass: 0.35, pluck: 0.35, drums: 0, hats16: false },
};

export function scoreEvents(film: Film3D): NoteEvent[] {
  const out: NoteEvent[] = [];
  const total = durationOf(film);
  const funny = film.moods.includes("funny");
  const gentle = film.moods.includes("gentle") || film.moods.includes("cozy");
  const seed = film.seed;
  const push = (e: NoteEvent, end: number) => {
    if (e.t >= end - 0.01) return;
    out.push({ ...e, dur: Math.max(0.03, Math.min(e.dur, end - e.t)) });
  };

  film.beats.forEach((b, bi) => {
    const L = LAYERS[b.role];
    // A hard stop before the silence: the beat before it ends clean.
    const end = b.end;
    const prog = b.role === "problem" ? DARK : BRIGHT;
    const drums = gentle ? L.drums * 0.6 : L.drums;

    for (let bar = Math.floor(b.start / BAR) * BAR; bar < end; bar += BAR) {
      const barIdx = Math.round(bar / BAR);
      const chord = CHORDS[prog[barIdx % prog.length]];
      const from = Math.max(bar, b.start);
      if (L.pad) for (const n of chord.tones) push({ t: from, dur: bar + BAR - from, voice: "pad", note: n, gain: L.pad * 0.16 }, end);
      for (let k = 0; k < 8; k++) {
        const t = bar + k * (BEAT / 2);
        if (t < b.start - 1e-6 || t >= end) continue;
        const onBeat = k % 2 === 0;
        const beatN = Math.floor(k / 2);
        if (L.bass && onBeat && (beatN === 0 || beatN === 2 || funny)) {
          push({ t, dur: funny ? BEAT * 0.35 : BEAT * 0.9, voice: "bass", note: chord.root + (funny && beatN % 2 ? 7 : 0), gain: L.bass * 0.5 }, end);
        }
        if (L.pluck) {
          const arp = [0, 1, 2, 1, 0, 2, 1, 2][k];
          push({ t, dur: funny ? 0.12 : 0.28, voice: "pluck", note: chord.tones[arp] + 12, gain: L.pluck * (onBeat ? 0.22 : 0.15), pan: k % 2 ? 0.35 : -0.35 }, end);
        }
        if (drums) {
          if (onBeat && (beatN === 0 || beatN === 2)) push({ t, dur: 0.3, voice: "kick", gain: drums * 0.9 }, end);
          if (onBeat && (beatN === 1 || beatN === 3)) push({ t, dur: 0.2, voice: "snare", gain: drums * 0.42 }, end);
          push({ t, dur: 0.05, voice: "hat", gain: drums * (onBeat ? 0.16 : 0.1), pan: 0.2 }, end);
          if (L.hats16) push({ t: t + BEAT / 4, dur: 0.04, voice: "hat", gain: drums * 0.08, pan: -0.2 }, end);
        }
      }
    }

    // The motif: a rising fifth at the start, resolved at the end.
    if (b.role === "hook") {
      push({ t: b.start + 0.5, dur: 0.45, voice: "lead", note: 72, gain: 0.28 }, end);
      push({ t: b.start + 1.0, dur: 0.9, voice: "lead", note: 79, gain: 0.3 }, end);
    }
    if (b.role === "problem") {
      push({ t: b.start + 0.25, dur: 0.35, voice: "lead", note: 79, gain: 0.26 }, end);
      push({ t: b.start + 0.6, dur: 0.8, voice: "lead", note: 75, gain: 0.26 }, end);
    }
    if (b.role === "journey" && bi % 2 === 0) {
      const base = 72 + Math.floor(rand(seed, bi) * 2) * 2;
      [0, 2, 4, 7].forEach((iv, k) => push({ t: b.start + 0.5 + k * BEAT, dur: BEAT * 0.8, voice: "lead", note: base + iv, gain: 0.2 }, end));
    }
    if (b.role === "payoff") {
      for (const n of [48, 60, 64, 67, 72, 76, 79]) push({ t: b.start, dur: 1.4, voice: "stab", note: n, gain: 0.2 }, end);
      push({ t: b.start, dur: 1.6, voice: "sub", gain: 1 }, end);
      push({ t: b.start, dur: 2.4, voice: "crash", gain: 0.55 }, end);
      push({ t: b.start + 0.9, dur: 0.45, voice: "lead", note: 79, gain: 0.3 }, end);
      push({ t: b.start + 1.4, dur: 1.2, voice: "lead", note: 84, gain: 0.32 }, end);
    }
    if (b.role === "return") {
      push({ t: b.start + 0.5, dur: 0.6, voice: "lead", note: 67, gain: 0.24 }, end);
      push({ t: b.start + 1.1, dur: 0.6, voice: "lead", note: 72, gain: 0.24 }, end);
      push({ t: b.start + 1.7, dur: Math.max(0.5, end - b.start - 1.7), voice: "lead", note: 79, gain: 0.22 }, end);
    }
  });

  // The last chord rings out to the very end, softly.
  const last = film.beats[film.beats.length - 1];
  if (last && last.role !== "silence") {
    for (const n of CHORDS.I.tones) out.push({ t: Math.max(last.start, total - 2.5), dur: 2.5, voice: "pad", note: n, gain: 0.12 });
  }
  return out.sort((a, b) => a.t - b.t);
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Render the score into an AudioBuffer (browser). */
export async function renderScore(film: Film3D, sampleRate = 48000): Promise<AudioBuffer> {
  const total = Math.max(1, durationOf(film));
  const Ctx = (globalThis as unknown as { OfflineAudioContext: typeof OfflineAudioContext }).OfflineAudioContext;
  const ctx = new Ctx(2, Math.ceil(total * sampleRate), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  master.connect(comp).connect(ctx.destination);
  // Fade the very end so the last frame is quiet.
  master.gain.setValueAtTime(0.85, Math.max(0, total - 1));
  master.gain.linearRampToValueAtTime(0.0001, total);

  const noise = ctx.createBuffer(1, sampleRate, sampleRate);
  {
    const d = noise.getChannelData(0);
    let s = film.seed || 1;
    for (let i = 0; i < d.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      d[i] = (s / 4294967296) * 2 - 1;
    }
  }

  const out = (pan: number | undefined) => {
    if (!pan) return master;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(master);
    return p;
  };
  const env = (g: GainNode, t: number, peak: number, attack: number, dur: number, release: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  };

  for (const e of scoreEvents(film)) {
    const t = e.t;
    const g = ctx.createGain();
    g.connect(out(e.pan));
    switch (e.voice) {
      case "pad": {
        for (const [type, det, k] of [["sine", 0, 1], ["triangle", 6, 0.5]] as const) {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = hz(e.note!);
          o.detune.value = det;
          const gg = ctx.createGain();
          gg.gain.value = k;
          o.connect(gg).connect(g);
          o.start(t);
          o.stop(t + e.dur + 0.05);
        }
        env(g, t, e.gain, 0.25, e.dur, Math.min(0.4, e.dur * 0.4));
        break;
      }
      case "bass": {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = hz(e.note!);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 600;
        o.connect(lp).connect(g);
        env(g, t, e.gain, 0.01, e.dur, Math.min(0.15, e.dur * 0.5));
        o.start(t);
        o.stop(t + e.dur + 0.02);
        break;
      }
      case "pluck":
      case "lead": {
        const o = ctx.createOscillator();
        o.type = e.voice === "lead" ? "square" : "triangle";
        o.frequency.value = hz(e.note!);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(e.voice === "lead" ? 2400 : 3200, t);
        lp.frequency.exponentialRampToValueAtTime(e.voice === "lead" ? 1200 : 700, t + e.dur);
        o.connect(lp).connect(g);
        if (e.voice === "lead") env(g, t, e.gain * 0.6, 0.02, e.dur, Math.min(0.2, e.dur * 0.5));
        else {
          g.gain.setValueAtTime(e.gain, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + e.dur);
        }
        o.start(t);
        o.stop(t + e.dur + 0.02);
        break;
      }
      case "stab": {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = hz(e.note!);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(5000, t);
        lp.frequency.exponentialRampToValueAtTime(900, t + e.dur);
        o.connect(lp).connect(g);
        g.gain.setValueAtTime(e.gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + e.dur);
        o.start(t);
        o.stop(t + e.dur + 0.02);
        break;
      }
      case "kick":
      case "sub": {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(e.voice === "sub" ? 90 : 140, t);
        o.frequency.exponentialRampToValueAtTime(e.voice === "sub" ? 32 : 45, t + (e.voice === "sub" ? 0.8 : 0.12));
        o.connect(g);
        g.gain.setValueAtTime(e.gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + e.dur);
        o.start(t);
        o.stop(t + e.dur + 0.02);
        break;
      }
      case "snare":
      case "hat":
      case "crash": {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        const f = ctx.createBiquadFilter();
        f.type = e.voice === "snare" ? "bandpass" : "highpass";
        f.frequency.value = e.voice === "snare" ? 1800 : e.voice === "hat" ? 7000 : 4500;
        src.connect(f).connect(g);
        g.gain.setValueAtTime(e.gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + e.dur);
        src.start(t, (e.t * 7.3) % 0.5);
        src.stop(t + e.dur + 0.02);
        break;
      }
    }
  }
  return ctx.startRendering();
}

/** 16-bit PCM WAV bytes from an AudioBuffer (for the PC's ffmpeg mux). */
export function wavBytes(buf: { numberOfChannels: number; sampleRate: number; length: number; getChannelData(c: number): Float32Array }): Uint8Array {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  out.setUint32(4, 36 + n * ch * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  w(36, "data");
  out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(out.buffer);
}
