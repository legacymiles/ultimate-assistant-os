"use client";

// ---------------------------------------------------------------------------
// Voice for a chat whose answer lands in a message list (App Builder, Website
// Studio drafts, the Dashboard agent): send the sentence the way the Send
// button would, wait for the NEXT agent message to appear, read it back.
// ---------------------------------------------------------------------------

import { useRef } from "react";
import { waitForReply } from "@/lib/voice/harnessReply";
import { useVoiceTarget } from "./VoiceProvider";

export function useChatVoice(opts: {
  id: string;
  label: string;
  priority?: number;
  active?: boolean;
  /** Send it exactly as the Send button does. */
  say: (text: string) => Promise<unknown> | unknown;
  /** Every agent answer so far, oldest first. */
  answers: string[];
}): { touch: () => void } {
  const answersRef = useRef(opts.answers);
  answersRef.current = opts.answers;
  return useVoiceTarget({
    id: opts.id,
    label: opts.label,
    kind: "chat",
    priority: opts.priority ?? 10,
    active: opts.active ?? true,
    send: async (text) => {
      const before = answersRef.current.length;
      await opts.say(text);
      return waitForReply({ turns: () => answersRef.current.map((t) => ({ status: "done", text: t })), gate: () => null }, before, 60_000);
    },
  });
}
