"use client";

// Sound effects synthesised with the Web Audio API, so the app ships no audio
// files. Everything is wrapped: a browser that blocks audio until a gesture, or
// refuses an AudioContext entirely, just stays quiet.

const MUTE_KEY = "cook_connect_muted_v1";

class SoundManager {
  private ctx: AudioContext | null = null;
  private _muted = false;
  private _volume = 0.5;

  constructor() {
    if (typeof window !== "undefined") {
      try { this._muted = localStorage.getItem(MUTE_KEY) === "1"; } catch { /* private mode */ }
    }
  }

  get muted() { return this._muted; }
  set muted(v: boolean) {
    this._muted = v;
    try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); } catch { /* private mode */ }
  }

  private getCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!this.ctx) this.ctx = new Ctor();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private play(fn: (ctx: AudioContext, gain: GainNode) => void) {
    if (this._muted) return;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      const gain = ctx.createGain();
      gain.gain.value = this._volume;
      gain.connect(ctx.destination);
      fn(ctx, gain);
    } catch { /* audio is a nicety, never an error */ }
  }

  private tone(freq: number, duration: number, type: OscillatorType = "sine", startTime = 0) {
    this.play((ctx, gain) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(this._volume * 0.3, ctx.currentTime + startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
      osc.connect(gain);
      osc.start(ctx.currentTime + startTime);
      osc.stop(ctx.currentTime + startTime + duration);
    });
  }

  /** A short filtered noise burst — the snap of a card hitting the table. */
  private noise(seconds: number, decay: number, volume: number, highpass?: number) {
    this.play((ctx, gain) => {
      const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * decay));
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      gain.gain.value = this._volume * volume;
      if (highpass) {
        const filter = ctx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = highpass;
        src.connect(filter).connect(gain);
      } else {
        src.connect(gain);
      }
      src.start();
    });
  }

  cardPlay() { this.noise(0.08, 0.015, 0.4, 2000); }
  cardDeal() { this.noise(0.05, 0.01, 0.2); }
  pieceMove() { this.noise(0.06, 0.012, 0.35, 1200); }

  yourTurn() {
    [523, 659, 784].forEach((f, i) => this.tone(f, i === 2 ? 0.2 : 0.15, "sine", i * 0.12));
  }

  trickWon() {
    [440, 554, 659].forEach((f, i) => this.tone(f, 0.12, "triangle", i * 0.08));
    this.tone(880, 0.3, "triangle", 0.24);
  }

  gameWin() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, "square", i * 0.15));
    this.tone(1047, 0.6, "sine", 0.6);
  }

  gameLose() {
    [440, 349, 294, 220].forEach((f, i) => this.tone(f, 0.3, "sawtooth", i * 0.2));
  }

  chatMessage() {
    this.tone(880, 0.08, "sine", 0);
    this.tone(1100, 0.1, "sine", 0.06);
  }

  bidSubmit() {
    this.tone(600, 0.1, "sine", 0);
    this.tone(800, 0.15, "sine", 0.08);
  }

  playerJoin() {
    this.tone(440, 0.1, "sine", 0);
    this.tone(660, 0.15, "sine", 0.1);
  }

  playerQuit() {
    this.tone(440, 0.15, "sawtooth", 0);
    this.tone(330, 0.2, "sawtooth", 0.12);
  }

  roundEnd() {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.15, "triangle", i * 0.15));
    this.tone(523, 0.3, "triangle", 0.45);
  }
}

export const sounds = new SoundManager();
