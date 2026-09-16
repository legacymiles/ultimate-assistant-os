"use client";

// ---------------------------------------------------------------------------
// Music Creator — preparing a reference clip in the browser.
//
// AuK is zero-shot: the "voice profile" is a short clip of somebody speaking,
// and the quality of everything downstream is decided by that clip. So the
// trimming happens here, in front of the user, rather than on the GPU box:
// picking the five good seconds out of thirty is a listening decision, and
// sending thirty seconds of music-plus-vocal and hoping is how you get a clone
// of a snare drum.
//
// Everything is WAV. It is larger than the alternatives and that does not
// matter for ten seconds of audio, whereas guessing whether the far end can
// decode m4a does matter.
// ---------------------------------------------------------------------------

/** A decoded clip plus the numbers the UI needs to draw and cut it. */
export interface Clip {
  buffer: AudioBuffer;
  durationS: number;
  /** Peak per pixel-column, already normalised to 0–1, for the waveform. */
  peaks: number[];
}

const PEAK_COLUMNS = 480;

let ctx: AudioContext | null = null;

function audioContext(): AudioContext {
  // Reused: browsers cap how many contexts a page may create, and a clip picker
  // that stops working after the sixth file is a bug nobody reports clearly.
  ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  return ctx;
}

export async function decodeClip(data: ArrayBuffer): Promise<Clip> {
  const buffer = await audioContext().decodeAudioData(data.slice(0));
  return { buffer, durationS: buffer.duration, peaks: peaksOf(buffer) };
}

export async function fileToClip(file: File | Blob): Promise<Clip> {
  return decodeClip(await file.arrayBuffer());
}

function peaksOf(buffer: AudioBuffer): number[] {
  const channel = buffer.getChannelData(0);
  const per = Math.max(1, Math.floor(channel.length / PEAK_COLUMNS));
  const peaks: number[] = [];
  let ceiling = 0.0001;
  for (let i = 0; i < PEAK_COLUMNS; i++) {
    let peak = 0;
    const start = i * per;
    for (let j = start; j < start + per && j < channel.length; j++) {
      const v = Math.abs(channel[j]);
      if (v > peak) peak = v;
    }
    if (peak > ceiling) ceiling = peak;
    peaks.push(peak);
  }
  return peaks.map((p) => p / ceiling);
}

/**
 * Cut a section out and encode it as a mono 16-bit WAV data URL.
 *
 * Mono because a reference clip is one person and the stereo image is noise to
 * a voice model; downmixing rather than taking the left channel keeps a voice
 * that was panned from being quietly halved.
 */
export function cutToWavDataUrl(buffer: AudioBuffer, startS: number, endS: number): string {
  const rate = buffer.sampleRate;
  const from = Math.max(0, Math.floor(startS * rate));
  const to = Math.min(buffer.length, Math.floor(endS * rate));
  const length = Math.max(1, to - from);

  const mono = new Float32Array(length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[from + i] / buffer.numberOfChannels;
  }

  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, length * 2, true);

  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return `data:audio/wav;base64,${base64(new Uint8Array(bytes))}`;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000; // btoa on the whole array blows the argument limit
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** How long a reference clip should be, and why the UI says so. */
export const CLIP = {
  minS: 3,
  maxS: 15,
  idealS: 8,
  advice:
    "Five to ten seconds of clean, solo speech works best: one person, no music under it, no other voices, " +
    "no reverb tail. A longer clip is not a better one.",
};
