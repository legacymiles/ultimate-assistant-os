// ---------------------------------------------------------------------------
// The avatar's state, and what each action does to it. Pure; the store
// (store.ts) holds one of these and persists the `prefs` half.
//
//   prefs     kept across visits and devices (`jarvis-avatar:v1`): the chosen
//             look, and whether it transforms on its own.
//   emotion   a moment: it expires by itself.
//   gestures  one-shot moves, played once by the renderer and dropped.
// ---------------------------------------------------------------------------

import type { AvatarAction } from "./commands";
import { DEFAULT_LOOK, clampLook, type AvatarLook, type Emotion, type Gesture } from "./looks";

export interface AvatarPrefs {
  look: AvatarLook;
  /** True once the owner has picked a look (it is then what shows). */
  custom: boolean;
  /** Transform into a new form every `seconds` on its own. */
  cycle: boolean;
  seconds: number;
}

export const DEFAULT_PREFS: AvatarPrefs = { look: DEFAULT_LOOK, custom: false, cycle: true, seconds: 5 };

export interface AvatarState {
  prefs: AvatarPrefs;
  emotion: { name: Emotion; until: number } | null;
  gestures: { gesture: Gesture; at: number; id: number }[];
  /** What is on screen right now (a preset while cycling) — commands build on this. */
  showing: AvatarLook | null;
}

export const INITIAL_STATE: AvatarState = { prefs: DEFAULT_PREFS, emotion: null, gestures: [], showing: null };

/** Saved prefs, made safe: anything missing or broken falls back. */
export function clampPrefs(raw: unknown): AvatarPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AvatarPrefs>;
  const seconds = Number(r.seconds);
  return {
    look: clampLook(r.look as Partial<AvatarLook> | undefined),
    custom: r.custom === true,
    cycle: r.cycle !== false,
    seconds: Number.isFinite(seconds) ? Math.min(60, Math.max(3, seconds)) : 5,
  };
}

let gestureId = 0;

export function applyActions(state: AvatarState, actions: AvatarAction[], now: number): AvatarState {
  let next = state;
  for (const a of actions) {
    if (a.type === "reset") {
      next = { ...next, prefs: { ...DEFAULT_PREFS }, emotion: null };
    } else if (a.type === "cycle") {
      next = { ...next, prefs: { ...next.prefs, cycle: a.on, ...(a.on ? { custom: false } : next.showing && !next.prefs.custom ? { look: next.showing, custom: true } : {}) } };
    } else if (a.type === "look") {
      // Build on what is on screen, so "make your eyes red" mid-cycle changes
      // the dragon you are looking at, not a look that is not showing.
      const base = next.prefs.cycle && next.showing ? next.showing : next.prefs.look;
      const scale = a.relative?.scale ? base.scale * a.relative.scale : (a.patch.scale ?? base.scale);
      const look = clampLook({ ...base, ...a.patch, scale }, base);
      const cycleSaid = actions.some((x) => x.type === "cycle" && x.on);
      next = { ...next, prefs: { ...next.prefs, look, custom: true, cycle: cycleSaid }, showing: look };
    } else if (a.type === "emotion") {
      next = { ...next, emotion: { name: a.emotion, until: now + a.seconds * 1000 } };
    } else if (a.type === "gesture") {
      gestureId += 1;
      next = { ...next, gestures: [...next.gestures.filter((g) => now - g.at < 4000), { gesture: a.gesture, at: now, id: gestureId }] };
    }
  }
  return next;
}

/** The emotion showing at `now`, or neutral once it has expired. */
export function emotionAt(state: AvatarState, now: number): Emotion {
  return state.emotion && state.emotion.until > now ? state.emotion.name : "neutral";
}

/** Face settings for an emotion: smile −1…1, brow angle, eye openness, energy. */
export function expressionOf(e: Emotion): { smile: number; brow: number; eyeOpen: number; energy: number; warmth: number } {
  switch (e) {
    case "happy":
      return { smile: 0.8, brow: 0.15, eyeOpen: 0.85, energy: 0.6, warmth: 0.25 };
    case "excited":
      return { smile: 1, brow: 0.3, eyeOpen: 1.15, energy: 1, warmth: 0.35 };
    case "sad":
      return { smile: -0.6, brow: -0.45, eyeOpen: 0.7, energy: 0.15, warmth: -0.3 };
    case "angry":
      return { smile: -0.4, brow: 0.6, eyeOpen: 0.65, energy: 0.8, warmth: 0.6 };
    case "surprised":
      return { smile: 0, brow: 0.5, eyeOpen: 1.35, energy: 0.9, warmth: 0 };
    case "thinking":
      return { smile: -0.1, brow: 0.25, eyeOpen: 0.85, energy: 0.35, warmth: -0.1 };
    case "calm":
      return { smile: 0.3, brow: 0, eyeOpen: 0.75, energy: 0.1, warmth: 0 };
    default:
      return { smile: 0.15, brow: 0, eyeOpen: 1, energy: 0.35, warmth: 0 };
  }
}
