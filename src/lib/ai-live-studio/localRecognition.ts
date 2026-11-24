// Speech recognition on this PC, through LiveTalking's own recognizer
// (SenseVoiceSmall at ws://127.0.0.1:8010/api/asr, enabled once `funasr` is
// installed in LiveTalking's environment) — instead of the browser's, which
// sends the audio to Google or Microsoft to transcribe.
//
// Shared by Jarvis's real face and AI Live Studio's director mic. It behaves
// like the browser's SpeechRecognition (start/stop/abort, onresult/onend/
// onerror/onstart, `continuous`), so the code that already drives that one
// drives this one unchanged.
//
// LiveTalking's endpoint works per utterance: {"is_speaking":true}, 16 kHz
// PCM16 chunks, {"is_speaking":false} → {"text":…}. Deciding where an
// utterance starts and ends is ours: a small energy voice-activity detector
// with an adaptive noise floor (vadStep). The pure parts are tested.

export const ASR_URL = "ws://127.0.0.1:8010/api/asr";
const TARGET_RATE = 16_000;

/**
 * An interim "still hearing you" result. LiveTalking transcribes a whole
 * utterance at its end, so there are no partial words; but listeners (Jarvis)
 * end a turn when words stop arriving. This keeps the turn open while the
 * owner speaks and while the text is being made — it is never words, and
 * listeners must not treat it as any.
 */
export const HEARING_MARK = "…";
const MARK_EVERY_MS = 250;

// ---- Pure helpers (tested) ------------------------------------------------------

/** Mic audio at any rate → 16 kHz signed 16-bit, by averaging (a cheap low-pass). */
export function downsampleTo16k(input: Float32Array, rate: number): Int16Array {
  const ratio = rate / TARGET_RATE;
  const n = Math.floor(input.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i += 1) {
    const from = Math.floor(i * ratio);
    const to = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += input[j];
    const v = to > from ? sum / (to - from) : input[from] ?? 0;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return out;
}

/** Root-mean-square level of a block, 0–1. */
export function rmsOf(block: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < block.length; i += 1) sum += block[i] * block[i];
  return block.length ? Math.sqrt(sum / block.length) : 0;
}

/**
 * SenseVoice's text, made plain: its rich post-processing can add emotion and
 * event emoji ("hello 😊"), and stray tags may survive.
 */
export function cleanTranscript(text: string): string {
  return text
    .replace(/<\|[^|]*\|>/g, " ")
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}‍️]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface VadState {
  speaking: boolean;
  /** Voiced time while waiting for speech to be confirmed. */
  voicedMs: number;
  /** Quiet time inside an utterance. */
  silentMs: number;
  /** Length of the current utterance. */
  utterMs: number;
  /** The room's background level, learned while nobody speaks. */
  floor: number;
}

export const VAD_INITIAL: VadState = { speaking: false, voicedMs: 0, silentMs: 0, utterMs: 0, floor: 0.004 };

/** Speech must last this long to count — a cough or a click doesn't. */
export const VAD_START_MS = 120;
/** This much quiet ends an utterance. */
export const VAD_END_MS = 700;
/** One utterance never runs longer than this. */
export const VAD_MAX_MS = 15_000;

/** The level that counts as voice, above the room's own noise. */
export function vadThreshold(floor: number): number {
  return Math.max(0.012, floor * 3.5);
}

/** One block of audio through the detector: the next state, and whether speech just started or ended. */
export function vadStep(s: VadState, rms: number, blockMs: number): { state: VadState; event: "start" | "end" | null } {
  const threshold = vadThreshold(s.floor);
  if (!s.speaking) {
    // Learn the room while nobody is talking (slowly, and never from speech).
    const floor = rms < threshold ? Math.max(0.002, s.floor * 0.95 + rms * 0.05) : s.floor;
    if (rms >= threshold) {
      const voicedMs = s.voicedMs + blockMs;
      if (voicedMs >= VAD_START_MS) return { state: { ...s, floor, speaking: true, voicedMs: 0, silentMs: 0, utterMs: voicedMs }, event: "start" };
      return { state: { ...s, floor, voicedMs }, event: null };
    }
    return { state: { ...s, floor, voicedMs: 0 }, event: null };
  }
  const utterMs = s.utterMs + blockMs;
  const silentMs = rms < threshold * 0.7 ? s.silentMs + blockMs : 0;
  if (silentMs >= VAD_END_MS || utterMs >= VAD_MAX_MS) {
    return { state: { ...s, speaking: false, voicedMs: 0, silentMs: 0, utterMs: 0 }, event: "end" };
  }
  return { state: { ...s, silentMs, utterMs }, event: null };
}

// ---- Is it running? ---------------------------------------------------------------

let available: boolean | null = null;
let probing: Promise<boolean> | null = null;

/** LiveTalking's recognizer answers on this PC (cached; `fresh` re-checks). */
export function localAsrAvailable(fresh = false): Promise<boolean> {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") return Promise.resolve(false);
  if (!fresh && available !== null) return Promise.resolve(available);
  if (probing) return probing;
  probing = new Promise<boolean>((done) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      available = ok;
      probing = null;
      done(ok);
    };
    try {
      const ws = new WebSocket(ASR_URL);
      const t = setTimeout(() => {
        ws.close();
        finish(false);
      }, 2000);
      ws.onopen = () => {
        clearTimeout(t);
        ws.close();
        finish(true);
      };
      ws.onerror = () => {
        clearTimeout(t);
        finish(false);
      };
    } catch {
      finish(false);
    }
  });
  return probing;
}

/** The last known answer, without waiting. */
export function localAsrKnown(): boolean {
  return available === true;
}

// ---- The recognizer -----------------------------------------------------------------

type Result = { transcript: string; confidence: number }[] & { isFinal: boolean };
type ResultEvent = { resultIndex: number; results: ArrayLike<Result> };

/** How much audio before the detected start is kept, so the first word isn't clipped. */
const PREROLL_MS = 350;
const BLOCK = 2048;

export class LocalRecognition extends EventTarget {
  continuous = false;
  interimResults = false;
  lang = "en-US";
  onresult: ((e: ResultEvent) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;

  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private vad: VadState = VAD_INITIAL;
  private preroll: Int16Array[] = [];
  private results: Result[] = [];
  private waiting = 0;
  private stopping = false;
  private ended = false;
  private lastMark = 0;

  /** Speaking, or the text is on its way: tell listeners the turn is still going. */
  private mark() {
    if (!this.interimResults || !this.onresult) return;
    const now = Date.now();
    if (now - this.lastMark < MARK_EVERY_MS) return;
    this.lastMark = now;
    const r = [{ transcript: HEARING_MARK, confidence: 0 }] as Result;
    r.isFinal = false;
    this.onresult({ resultIndex: this.results.length, results: [...this.results, r] });
  }

  start(): void {
    void this.open();
  }

  private async open() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.onerror?.({ error: "not-allowed" });
      return this.finish();
    }
    try {
      this.ws = await new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(ASR_URL);
        ws.binaryType = "arraybuffer";
        const t = setTimeout(() => reject(new Error("timeout")), 4000);
        ws.onopen = () => {
          clearTimeout(t);
          resolve(ws);
        };
        ws.onerror = () => {
          clearTimeout(t);
          reject(new Error("ws"));
        };
      });
    } catch {
      this.onerror?.({ error: "network" });
      return this.finish();
    }
    this.ws.onmessage = (m) => this.heard(m.data);
    this.ws.onclose = () => {
      if (!this.ended) {
        this.onerror?.({ error: "network" });
        this.finish();
      }
    };

    const ctx = new AudioContext();
    this.ctx = ctx;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    const src = ctx.createMediaStreamSource(this.stream);
    const node = ctx.createScriptProcessor(BLOCK, 1, 1);
    this.node = node;
    const blockMs = (BLOCK / ctx.sampleRate) * 1000;
    const keep = Math.ceil(PREROLL_MS / blockMs);
    node.onaudioprocess = (e) => {
      if (this.ended) return;
      const input = e.inputBuffer.getChannelData(0);
      const pcm = downsampleTo16k(input, ctx.sampleRate);
      const { state, event } = vadStep(this.vad, rmsOf(input), blockMs);
      this.vad = state;
      if (state.speaking || this.waiting > 0) this.mark();
      if (event === "start") {
        this.send(JSON.stringify({ is_speaking: true, mode: "offline", wav_name: "jarvis", itn: true, chunk_size: [5, 10, 5] }));
        for (const p of this.preroll) this.send(p.buffer as ArrayBuffer);
        this.preroll = [];
        this.send(pcm.buffer as ArrayBuffer);
      } else if (state.speaking) {
        this.send(pcm.buffer as ArrayBuffer);
      } else if (event === "end") {
        this.endUtterance();
      } else {
        this.preroll.push(pcm);
        if (this.preroll.length > keep) this.preroll.shift();
      }
    };
    src.connect(node);
    // A ScriptProcessor only runs while connected; through a muted gain so nothing is heard.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
    this.onstart?.();
  }

  private send(data: string | ArrayBuffer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  private endUtterance() {
    this.waiting += 1;
    this.send(JSON.stringify({ is_speaking: false }));
  }

  private heard(data: unknown) {
    if (typeof data !== "string") return;
    let text = "";
    try {
      text = cleanTranscript(String((JSON.parse(data) as { text?: unknown }).text ?? ""));
    } catch {
      return;
    }
    this.waiting = Math.max(0, this.waiting - 1);
    if (text) {
      const r = [{ transcript: text, confidence: 0.9 }] as Result;
      r.isFinal = true;
      this.results.push(r);
      this.onresult?.({ resultIndex: this.results.length - 1, results: this.results });
      if (!this.continuous) return this.finish();
    }
    if (this.stopping && this.waiting === 0) this.finish();
  }

  /** Stop listening; an utterance in progress is still transcribed. */
  stop(): void {
    if (this.ended) return;
    this.stopping = true;
    if (this.vad.speaking) {
      this.vad = VAD_INITIAL;
      this.endUtterance();
    }
    if (this.waiting === 0) this.finish();
    // Don't wait for ever on a result that won't come.
    else setTimeout(() => this.finish(), 6000);
  }

  /** Stop at once, dropping anything unsaid. */
  abort(): void {
    this.finish();
  }

  private finish() {
    if (this.ended) return;
    this.ended = true;
    if (this.node) this.node.onaudioprocess = null;
    try {
      this.node?.disconnect();
    } catch {
      /* already */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    try {
      this.ws?.close();
    } catch {
      /* already */
    }
    this.onend?.();
  }
}
