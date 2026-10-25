// The board lives on this device and syncs to the owner's account (app_state),
// the same way every hub app keeps its data — see src/lib/sync/appState.ts.

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { EMPTY_BOARD, normalizeBoard } from "./logic";
import type { Board } from "./types";

export const KEY = "money-agents:v1";

export function loadBoard(): Board {
  return normalizeBoard(loadLocal<Board>(KEY, EMPTY_BOARD));
}

export function saveBoard(b: Board): void {
  saveSynced(KEY, b);
}
