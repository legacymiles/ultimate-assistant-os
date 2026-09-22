"use client";

// The lounge: one room everybody shares, parked in the feed's rail so there is
// always somewhere to ask "anyone up for a game?".

import { rooms } from "@/lib/cook-connect/types";
import { ChatPanel } from "./ChatPanel";

export function LoungeDock() {
  return (
    <ChatPanel
      room={rooms.lounge()}
      title="Lounge"
      height="h-[220px]"
      placeholder="Anyone up for a game?"
    />
  );
}
