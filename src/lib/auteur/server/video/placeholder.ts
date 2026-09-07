// ---------------------------------------------------------------------------
// No backend configured.
//
// Not an error state. The studio is meant to be fully explorable before
// anyone has paid for anything: the plan, the board, the prompts, the retakes
// and the cut all work, and each shot shows an animatic instead of footage.
// The short wait exists so the "rendering" state is visible rather than
// flashing past.
// ---------------------------------------------------------------------------

import "server-only";

import type { StartResult, VideoBackend } from "./types";

export function placeholderBackend(): VideoBackend {
  return {
    id: "placeholder",
    label: "Animatic (no render backend configured)",
    async start(): Promise<StartResult> {
      await new Promise((r) => setTimeout(r, 1400));
      return { mode: "done" };
    },
  };
}
