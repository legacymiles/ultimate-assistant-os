// ---------------------------------------------------------------------------
// What to read back after telling a harness thread something by voice.
//
// A harness turn is not a request/response: `say` returns at once and the
// answer arrives over the next seconds or minutes through the thread's event
// poll. So the voice waits for a NEW turn to finish (or for the thread to stop
// at a gate, which needs the owner's tap) and reads that — never the previous
// answer, and never a long silence: past the limit it says the work is still
// going and the answer will be on screen.
// ---------------------------------------------------------------------------

export interface TurnLike {
  status: string;
  text: string;
  error?: string;
}

export interface GateLike {
  title?: string;
}

export interface Watch {
  turns: () => TurnLike[];
  gate: () => GateLike | null;
}

/** Pure: given what the thread looks like now, is there something to say yet? */
export function replyFrom(turns: TurnLike[], before: number, gate: GateLike | null): string | null {
  if (gate) return `It's waiting for your OK: ${gate.title || "a step that needs approval"}. Tap Allow or Deny on screen.`;
  if (turns.length <= before) return null;
  const last = turns[turns.length - 1];
  if (last.status === "done") return last.text.trim() || "Done.";
  if (last.status === "failed") return `That stopped: ${last.error || "the harness reported an error"}.`;
  return null;
}

/** Wait for the turn this message started, and return what to say about it. */
export async function waitForReply(watch: Watch, before: number, limitMs = 150_000): Promise<string> {
  const started = Date.now();
  for (;;) {
    const r = replyFrom(watch.turns(), before, watch.gate());
    if (r) return r;
    if (Date.now() - started > limitMs) return "It's still working on that. The answer will be on screen.";
    await new Promise((res) => setTimeout(res, 600));
  }
}
