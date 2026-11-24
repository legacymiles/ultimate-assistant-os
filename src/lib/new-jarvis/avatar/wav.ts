// How long a WAV lasts, from its header — so the lip-synced face knows when
// it has finished speaking without trusting a status poll alone (LiveTalking
// processes a whole clip before answering the upload, so a short line can be
// over by the time the poll starts). Pure; reads bytes, not the clock.

/** Duration in ms of a PCM WAV, or null when the bytes aren't one. */
export function wavDurationMs(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let byteRate = 0;
  // Walk the chunks: "fmt " carries the byte rate, "data" the length.
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt " && at + 16 <= bytes.length) byteRate = view.getUint32(at + 16, true);
    if (id === "data") {
      if (!byteRate) return null;
      // A streamed WAV may say 0 or 0xFFFFFFFF; then the rest of the file is the data.
      const dataLen = size === 0 || size === 0xffffffff ? bytes.length - (at + 8) : Math.min(size, bytes.length - (at + 8));
      return Math.round((dataLen / byteRate) * 1000);
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/** A rough length for text a voice will read (~14 characters a second), for when there's no audio to measure. */
export function speechMsForText(text: string): number {
  return Math.max(800, Math.round((text.length / 14) * 1000));
}
