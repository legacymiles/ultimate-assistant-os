// ---------------------------------------------------------------------------
// The board on this device and, when signed in, every device.
//
// A new key on purpose: the old Dance Vault board (`dances:v1`, its ~200
// seeded dances) is not carried over — the owner asked for all of them gone.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";

import { sanitize } from "./board";
import type { Board } from "./types";

/** Also the app_state sync key; the shell passes it to useRemotePull. */
export const KEY = "viral-studio:v1";

export function loadBoard(): Board {
  return sanitize(loadLocal<unknown>(KEY, { clips: [] }));
}

export function saveBoard(board: Board): Board {
  saveSynced(KEY, board);
  return board;
}
