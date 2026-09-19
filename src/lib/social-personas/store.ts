// The persona board is one blob: localStorage for instant reads, app_state for
// cross-device sync (see src/lib/sync/appState.ts). Ships empty.

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import type { Board, Persona } from "./types";

export const KEY = "social-personas:v1";

const EMPTY: Board = { version: 1, personas: [] };

export function loadBoard(): Board {
  const b = loadLocal<Board>(KEY, EMPTY);
  return b && Array.isArray(b.personas) ? b : EMPTY;
}

export function saveBoard(b: Board): void {
  saveSynced(KEY, b);
}

export function upsertPersona(b: Board, p: Persona): Board {
  const next = { ...p, updatedAt: new Date().toISOString() };
  const i = b.personas.findIndex((x) => x.id === p.id);
  const personas = i >= 0 ? b.personas.map((x) => (x.id === p.id ? next : x)) : [next, ...b.personas];
  return { ...b, personas };
}

export function removePersona(b: Board, id: string): Board {
  return { ...b, personas: b.personas.filter((x) => x.id !== id) };
}
