import type { ItemKind } from "./items";

/** Arena-wide temporary events. Triggered by single items, volleys, or secret combos. */
export type ArenaEventKind = "neon" | "galaxy" | "lowgrav" | "stunt";

export interface ComboDef {
  name: string;
  sequence: [ItemKind, ItemKind, ItemKind];
  event: ArenaEventKind;
  /** flashed briefly when discovered — never explained in advance */
  reveal: string;
}

/**
 * The secret combo table. Matched against the last three items that HIT the kart,
 * in order. Never surfaced in the UI until discovered.
 */
export const COMBOS: ComboDef[] = [
  { name: "PRISM BREAK", sequence: ["crystal", "coin", "orb"], event: "galaxy", reveal: "PRISM BREAK — the sky remembers" },
  { name: "PAINTED VOID", sequence: ["paint", "magnet", "gravity"], event: "lowgrav", reveal: "PAINTED VOID — gravity took the day off" },
  { name: "OVERDRIVE", sequence: ["shell", "coin", "crystal"], event: "neon", reveal: "OVERDRIVE — the arena wakes up" },
];

export const EVENT_DURATION: Record<ArenaEventKind, number> = {
  neon: 8,
  galaxy: 10,
  lowgrav: 8,
  stunt: 2.6,
};

export function matchCombo(history: ItemKind[]): ComboDef | null {
  if (history.length < 3) return null;
  const tail = history.slice(-3);
  for (const combo of COMBOS) {
    if (combo.sequence.every((k, i) => tail[i] === k)) return combo;
  }
  return null;
}
