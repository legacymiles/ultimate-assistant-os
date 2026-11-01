// The persona board is one blob: localStorage for instant reads, app_state for
// cross-device sync (see src/lib/sync/appState.ts). Ships empty.
//
// The key keeps its Social Personas name on purpose: Personas Studio is the
// same app grown up, and renaming the key would strand every saved persona.

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { aboutMeTemplate, suggestUsername } from "./logic";
import { seedPersona } from "./seed";
import { DEFAULT_LEARN, type Board, type Persona } from "./types";

export const KEY = "social-personas:v1";

const EMPTY: Board = { version: 1, personas: [], nicknameOrder: [] };

/** Fill in fields added since a persona was saved, so old data never crashes new screens. */
export function normalizePersona(p: Persona): Persona {
  const base: Persona = {
    ...p,
    overview: typeof p.overview === "string" ? p.overview : "",
    // A persona saved before nicknames existed is filed under its own niche —
    // that is what the owner already wrote to describe the job. Inferring a
    // nickname from it would be a guess wearing the owner's label.
    nickname: (typeof p.nickname === "string" && p.nickname.trim()) || p.niche?.trim() || "Unfiled",
    username: (typeof p.username === "string" && p.username.trim()) || suggestUsername(p.name ?? ""),
    avatar: typeof p.avatar === "string" ? p.avatar : null,
    aboutMe: typeof p.aboutMe === "string" ? p.aboutMe : "",
    aboutMeVersion: Number(p.aboutMeVersion) || 1,
    aboutMeHistory: Array.isArray(p.aboutMeHistory) ? p.aboutMeHistory : [],
    lessonLog: Array.isArray(p.lessonLog) ? p.lessonLog : [],
    learn: { ...DEFAULT_LEARN, ...(p.learn ?? {}) },
    contentTypes: Array.isArray(p.contentTypes) ? p.contentTypes : [],
    accounts: Array.isArray(p.accounts) ? p.accounts : [],
    posts: Array.isArray(p.posts) ? p.posts : [],
    ideaDays: Array.isArray(p.ideaDays) ? p.ideaDays : [],
    chat: Array.isArray(p.chat) ? p.chat : [],
    drafts: Array.isArray(p.drafts) ? p.drafts.map((d) => ({ ...d, results: Array.isArray(d.results) ? d.results : [], hashtags: d.hashtags ?? [], outline: d.outline ?? [], accountIds: d.accountIds ?? [] })) : [],
  };
  // Never leave the character document empty: an empty about-me means the
  // agent has no voice to hold, and a blank box is the setup list the house
  // rule forbids.
  const aboutMe = base.aboutMe.trim() || aboutMeTemplate(base);
  return {
    ...base,
    aboutMe,
    aboutMeHistory: base.aboutMeHistory.length
      ? base.aboutMeHistory
      : [{ version: base.aboutMeVersion, at: base.createdAt, markdown: aboutMe }],
  };
}

/** Record a character-document edit as a new version, keeping the old one. */
export function saveAboutMe(p: Persona, markdown: string): Persona {
  const text = markdown.trimEnd();
  if (text === p.aboutMe.trimEnd()) return p;
  const version = p.aboutMeVersion + 1;
  return {
    ...p,
    aboutMe: text,
    aboutMeVersion: version,
    // Newest first, and capped — the history answers "what did it sound like
    // when that post worked", it is not an archive.
    aboutMeHistory: [{ version, at: new Date().toISOString(), markdown: text }, ...p.aboutMeHistory].slice(0, 30),
  };
}

export interface NicknameGroup {
  nickname: string;
  personas: Persona[];
}

/**
 * The home screen's groups: one per nickname, with the personas under it.
 *
 * Derived from the personas rather than stored as their own records — one
 * source of truth, so renaming a persona's nickname cannot leave an orphan.
 */
export function nicknameGroups(personas: Persona[], order: string[] = []): NicknameGroup[] {
  const by = new Map<string, Persona[]>();
  for (const p of personas) {
    const key = p.nickname?.trim() || "Unfiled";
    const list = by.get(key);
    if (list) list.push(p);
    else by.set(key, [p]);
  }
  const seen = new Set<string>();
  const out: NicknameGroup[] = [];
  for (const nickname of [...order, ...by.keys()]) {
    if (seen.has(nickname) || !by.has(nickname)) continue;
    seen.add(nickname);
    out.push({ nickname, personas: by.get(nickname)! });
  }
  return out;
}

export function normalizeBoard(raw: unknown): Board {
  const b = raw as Board | null;
  const personas = Array.isArray(b?.personas)
    ? b!.personas.filter((p) => p && typeof p.id === "string").map(normalizePersona)
    : [];
  const present = [...new Set(personas.map((p) => p.nickname))];
  const kept = (b?.nicknameOrder ?? []).filter((n) => present.includes(n));
  return { version: 1, personas, nicknameOrder: [...kept, ...present.filter((n) => !kept.includes(n))] };
}

/**
 * The board as the app sees it, with the shipped agent folded in.
 *
 * The seed lives here rather than in `normalizeBoard` on purpose:
 * normalizeBoard is the pure migration — given an old blob it returns that
 * blob brought up to date and nothing else — and quietly adding a persona to
 * it would make every caller's "what was saved" answer untrue.
 *
 * An empty first screen is still the main reason a finished app reads as a
 * demo, and a learning loop with nothing to learn from cannot show the one
 * thing it is for, so the agent is added on the way to the UI.
 */
export function loadBoard(): Board {
  const b = normalizeBoard(loadLocal<Board>(KEY, EMPTY));
  if (b.personas.some((p) => p.id === "p_barry" || p.nickname?.toLowerCase() === "trolling agent")) return b;
  const personas = [seedPersona(), ...b.personas];
  return { ...b, personas, nicknameOrder: [...new Set(personas.map((p) => p.nickname))] };
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
