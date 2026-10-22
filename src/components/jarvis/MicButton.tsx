"use client";

import { Icon } from "../icons";
import type { Dictation } from "@/lib/new-jarvis/useDictation";

/** Talk-to-type mic for Studio's boxes. Named, so it is easy to find on a phone. */
export function MicButton({ dictation }: { dictation: Dictation }) {
  const { on, supported, toggle } = dictation;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Stop talking" : "Talk to type"}
      title={supported ? (on ? "Tap to stop" : "Say what you want built; the words land in the box") : "This browser can't listen. Chrome, Edge or Safari can."}
      className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] transition ${
        on
          ? "animate-pulse border-red-400/70 bg-red-500/15 text-red-200"
          : "border-line text-ink-muted hover:border-ink-faint hover:text-ink"
      }`}
    >
      <Icon.Mic width={14} height={14} />
      {on ? "Listening… tap to stop" : "Talk"}
    </button>
  );
}
