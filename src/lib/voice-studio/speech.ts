"use client";

// ---------------------------------------------------------------------------
// Voice Studio — browser speechSynthesis fallback.
//
// When no fish.audio key is configured the app still speaks, using the OS's
// built-in voices. Playback only: the Web Speech API doesn't hand back an audio
// buffer, so fallback clips can be replayed but not downloaded (the UI says so).
// ---------------------------------------------------------------------------

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Enumerate the OS voices, waiting for the async `voiceschanged` load if needed. */
export function getBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!isSpeechSupported()) return resolve([]);
    const now = window.speechSynthesis.getVoices();
    if (now.length) return resolve(now);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
    // Safety timeout in case the event never fires.
    setTimeout(finish, 800);
  });
}

export interface SpeakHandle {
  cancel: () => void;
}

/**
 * Pick the least-robotic available voice: prefer OS "natural/neural/online"
 * voices, then a few known-nicer names, optionally matching a language prefix.
 */
export function pickDefaultVoice(
  voices: SpeechSynthesisVoice[],
  lang?: string,
): SpeechSynthesisVoice | undefined {
  if (!voices.length) return undefined;
  const byLang = lang
    ? voices.filter((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()))
    : voices;
  const pool = byLang.length ? byLang : voices;
  const natural = pool.find((v) => /natural|neural|online|premium|enhanced/i.test(v.name));
  if (natural) return natural;
  const nicer = pool.find((v) => /aria|jenny|libby|zira|sonia|guy|ryan|emma|ava|samantha/i.test(v.name));
  if (nicer) return nicer;
  return pool.find((v) => v.default) ?? pool[0];
}

/** Speak text with the OS voice picker. `rate` maps to our 0.5–2.0 speed slider. */
export function speakBrowser(
  text: string,
  opts: { voiceURI?: string; rate?: number; onend?: () => void; onerror?: () => void },
): SpeakHandle {
  if (!isSpeechSupported()) {
    opts.onerror?.();
    return { cancel: () => {} };
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = Math.min(2, Math.max(0.5, opts.rate ?? 1));
  const voices = window.speechSynthesis.getVoices();
  const chosen = opts.voiceURI
    ? voices.find((x) => x.voiceURI === opts.voiceURI)
    : pickDefaultVoice(voices);
  if (chosen) u.voice = chosen;
  u.onend = () => opts.onend?.();
  u.onerror = () => opts.onerror?.();
  window.speechSynthesis.speak(u);
  return { cancel: () => window.speechSynthesis.cancel() };
}

/** Pause the current browser utterance (no-op if not speaking). */
export function pauseBrowser(): void {
  if (isSpeechSupported()) window.speechSynthesis.pause();
}

/** Resume a paused browser utterance. */
export function resumeBrowser(): void {
  if (isSpeechSupported()) window.speechSynthesis.resume();
}

/** Stop browser speech entirely. */
export function stopBrowser(): void {
  if (isSpeechSupported()) window.speechSynthesis.cancel();
}
