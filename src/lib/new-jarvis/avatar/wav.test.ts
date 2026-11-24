import { describe, expect, it } from "vitest";
import { speechMsForText, wavDurationMs } from "./wav";

/** A minimal PCM WAV: `samples` 16-bit mono frames at `rate`, with optional extra chunks before "data". */
function wav(rate: number, samples: number, opts: { extra?: boolean; dataSize?: number } = {}): Uint8Array {
  const dataLen = samples * 2;
  const extra = opts.extra ? 8 + 4 : 0;
  const buf = new ArrayBuffer(44 + extra + dataLen);
  const v = new DataView(buf);
  const put = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + extra + dataLen, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  let at = 36;
  if (opts.extra) {
    put(at, "LIST");
    v.setUint32(at + 4, 4, true);
    at += 12;
  }
  put(at, "data");
  v.setUint32(at + 4, opts.dataSize ?? dataLen, true);
  return new Uint8Array(buf);
}

describe("how long a WAV lasts", () => {
  it("reads it from the header", () => {
    expect(wavDurationMs(wav(24_000, 36_000))).toBe(1500);
    expect(wavDurationMs(wav(16_000, 8_000))).toBe(500);
  });
  it("skips chunks before the data", () => {
    expect(wavDurationMs(wav(24_000, 24_000, { extra: true }))).toBe(1000);
  });
  it("handles a streamed WAV that doesn't know its size", () => {
    expect(wavDurationMs(wav(24_000, 12_000, { dataSize: 0xffffffff }))).toBe(500);
  });
  it("says null for anything that isn't a WAV", () => {
    expect(wavDurationMs(new Uint8Array(10))).toBeNull();
    expect(wavDurationMs(new TextEncoder().encode("ID3".padEnd(60, "x")))).toBeNull();
  });
  it("guesses a reading time for text, never zero", () => {
    expect(speechMsForText("Done — feeling happy.")).toBe(1500);
    expect(speechMsForText("")).toBe(800);
  });
});
