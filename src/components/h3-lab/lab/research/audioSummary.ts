"use client";

// A measured, one-line description of a reference's soundtrack — loudness
// over time from the decoded audio, never a guess at what the sound is.

export async function audioSummary(file: File): Promise<string | undefined> {
  if (file.size > 200 * 1024 * 1024) return undefined;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    void ctx.close();
    const rate = decoded.sampleRate;
    const ch = decoded.getChannelData(0);
    const secs = Math.floor(ch.length / rate);
    if (!secs) return undefined;
    const db: number[] = [];
    for (let s = 0; s < secs; s++) {
      let sum = 0;
      for (let i = s * rate; i < (s + 1) * rate; i++) sum += ch[i] * ch[i];
      const rms = Math.sqrt(sum / rate);
      db.push(rms > 0 ? 20 * Math.log10(rms) : -120);
    }
    const silent = db.filter((d) => d < -50).length;
    if (silent === db.length) return "Soundtrack present but silent throughout (below −50 dBFS).";
    const loud = db.filter((d) => d >= -50);
    const mean = loud.reduce((s, v) => s + v, 0) / loud.length;
    const peakAt = db.indexOf(Math.max(...db));
    const sd = Math.sqrt(loud.reduce((s, v) => s + (v - mean) ** 2, 0) / loud.length);
    return `Soundtrack measured in the browser: ${decoded.numberOfChannels} channel${decoded.numberOfChannels === 1 ? "" : "s"}, mean level ${mean.toFixed(0)} dBFS, loudest second at ${peakAt}s, level spread ${sd.toFixed(1)} dB (${sd > 6 ? "dynamic" : "steady"}), ${silent} near-silent second${silent === 1 ? "" : "s"} of ${secs}.`;
  } catch {
    return undefined;
  }
}
