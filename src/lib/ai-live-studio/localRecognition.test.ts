import { describe, expect, it } from "vitest";
import { VAD_END_MS, VAD_INITIAL, VAD_MAX_MS, VAD_START_MS, cleanTranscript, downsampleTo16k, rmsOf, vadStep, vadThreshold, type VadState } from "./localRecognition";

const run = (levels: number[], blockMs = 40, s: VadState = VAD_INITIAL) => {
  const events: (string | null)[] = [];
  let state = s;
  for (const l of levels) {
    const r = vadStep(state, l, blockMs);
    state = r.state;
    events.push(r.event);
  }
  return { state, events: events.filter(Boolean) };
};
const quiet = (ms: number, level = 0.003) => Array(Math.round(ms / 40)).fill(level);
const voice = (ms: number, level = 0.08) => Array(Math.round(ms / 40)).fill(level);

describe("where an utterance starts and ends", () => {
  it("starts on speech that lasts, ends after a pause", () => {
    const { events } = run([...quiet(800), ...voice(1200), ...quiet(VAD_END_MS + 80)]);
    expect(events).toEqual(["start", "end"]);
  });
  it("ignores a click or a cough shorter than the start window", () => {
    expect(run([...quiet(400), ...voice(VAD_START_MS - 40), ...quiet(800)]).events).toEqual([]);
  });
  it("keeps one utterance through a short breath", () => {
    expect(run([...voice(600), ...quiet(300), ...voice(600), ...quiet(900)]).events).toEqual(["start", "end"]);
  });
  it("never lets one utterance run past the ceiling", () => {
    expect(run(voice(VAD_MAX_MS + 400)).events).toEqual(["start", "end", "start"]);
  });
  it("learns a noisy room and doesn't take its hum for speech", () => {
    const hum = 0.02; // above the default threshold
    const { state, events } = run(quiet(6000, hum * 0.5));
    expect(events).toEqual([]);
    expect(vadThreshold(state.floor)).toBeGreaterThan(0.012);
    // Speech well above the room still counts.
    expect(run(voice(400, 0.2), 40, state).events).toEqual(["start"]);
  });
});

describe("audio and text", () => {
  it("downsamples 48 kHz to 16 kHz, a third the samples, in 16-bit range", () => {
    const input = new Float32Array(4800).fill(0.5);
    const out = downsampleTo16k(input, 48_000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBe(16384);
    expect(downsampleTo16k(new Float32Array([2, -2, 2]), 16_000)).toEqual(new Int16Array([32767, -32768, 32767]));
  });
  it("measures a block's level", () => {
    expect(rmsOf(new Float32Array([0.5, -0.5]))).toBe(0.5);
    expect(rmsOf(new Float32Array())).toBe(0);
  });
  it("cleans SenseVoice's emoji and tags", () => {
    expect(cleanTranscript("Make yourself look happier 😊")).toBe("Make yourself look happier");
    expect(cleanTranscript("<|en|><|NEUTRAL|>hello  there 🎼")).toBe("hello there");
    expect(cleanTranscript("  ")).toBe("");
  });
});
