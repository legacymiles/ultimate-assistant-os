// Where Jarvis's spoken answers go, when not straight to the speakers.
//
// Normally useWakeVoice plays each answer itself. While the real-looking face
// is lip-synced by LiveTalking on this PC, the answer is handed here instead:
// LiveTalking speaks it with Alex's mouth moving, and the sound comes back in
// his video stream — so it is heard once, in sync with his lips.
//
// One sink at a time; null means "play it yourself". Browser-only state.

export interface VoiceSink {
  /** Speak this audio (WAV). Resolves true once it has been said, false if it couldn't be (play it yourself). */
  speak(audio: Blob): Promise<boolean>;
  /** No audio to give (the voice server is down): say the TEXT in the sink's own voice. */
  speakText(text: string): Promise<boolean>;
  /** Stop mid-sentence (the owner said stop, or talked over him). */
  interrupt(): void;
  /** The level of what is being said, for the face's light. */
  analyser(): AnalyserNode | null;
}

let current: VoiceSink | null = null;

export const voiceSink = {
  get(): VoiceSink | null {
    return current;
  },
  set(sink: VoiceSink | null): void {
    current = sink;
  },
};
