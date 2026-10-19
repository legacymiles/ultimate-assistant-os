// The persona board is one blob: localStorage for instant reads, app_state for
// cross-device sync (see src/lib/sync/appState.ts). Ships empty.
//
// The key keeps its Social Personas name on purpose: Personas Studio is the
// same app grown up, and renaming the key would strand every saved persona.

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import type { Board, Persona } from "./types";

export const KEY = "social-personas:v1";

const EMPTY: Board = { version: 1, personas: [] };

/** Fill in fields added since a persona was saved, so old data never crashes new screens. */
export function normalizePersona(p: Persona): Persona {
  return {
    ...p,
    overview: typeof p.overview === "string" ? p.overview : "",
    contentTypes: Array.isArray(p.contentTypes) ? p.contentTypes : [],
    accounts: Array.isArray(p.accounts) ? p.accounts : [],
    posts: Array.isArray(p.posts) ? p.posts : [],
    ideaDays: Array.isArray(p.ideaDays) ? p.ideaDays : [],
    chat: Array.isArray(p.chat) ? p.chat : [],
    drafts: Array.isArray(p.drafts) ? p.drafts.map((d) => ({ ...d, results: Array.isArray(d.results) ? d.results : [], hashtags: d.hashtags ?? [], outline: d.outline ?? [], accountIds: d.accountIds ?? [] })) : [],
  };
}

export function normalizeBoard(raw: unknown): Board {
  const b = raw as Board | null;
  if (!b || !Array.isArray(b.personas)) return EMPTY;
  return { version: 1, personas: b.personas.filter((p) => p && typeof p.id === "string").map(normalizePersona) };
}

export function loadBoard(): Board {
  return normalizeBoard(loadLocal<Board>(KEY, EMPTY));
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
