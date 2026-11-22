"use client";

// ---------------------------------------------------------------------------
// The Avatar Controller — one per tab, shared by every page that shows the
// avatar (Jarvis chat, Website Studio, App Builder, Client Review, harness
// threads, Profiles, the Dashboard agent).
//
// Anything can drive it: the voice (a spoken "become a robot"), Jarvis chat
// (typed, or the agent's `avatar` tool), or an answer being read aloud (its
// tone becomes a passing emotion). The renderer reads it every frame without
// React re-rendering; panels that show its settings subscribe through
// `useAvatar()`.
//
// The look is a preference, saved per account and synced across devices under
// `jarvis-avatar:v1`. Emotions and gestures are moments and are never saved.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";
import { loadLocal, reconcile, saveSynced } from "@/lib/sync/appState";
import { emotionFromText, parseAvatarCommand, type AvatarAction, type AvatarCommand } from "./commands";
import type { AvatarLook } from "./looks";
import { INITIAL_STATE, applyActions, clampPrefs, type AvatarState } from "./state";

export const AVATAR_KEY = "jarvis-avatar:v1";

let state: AvatarState = INITIAL_STATE;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  state = { ...state, prefs: clampPrefs(loadLocal(AVATAR_KEY, null)) };
  // Another device may have changed it since; take the newer copy.
  void reconcile(AVATAR_KEY)
    .then(() => {
      state = { ...state, prefs: clampPrefs(loadLocal(AVATAR_KEY, null)) };
      emit();
    })
    .catch(() => {});
}

function set(next: AvatarState, persist: boolean) {
  const prefsChanged = next.prefs !== state.prefs;
  state = next;
  if (persist && prefsChanged) saveSynced(AVATAR_KEY, state.prefs);
  emit();
}

export const avatarStore = {
  get(): AvatarState {
    ensureLoaded();
    return state;
  },
  subscribe(fn: () => void): () => void {
    ensureLoaded();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  apply(actions: AvatarAction[]): void {
    ensureLoaded();
    if (actions.length) set(applyActions(state, actions, Date.now()), true);
  },
  /** Run a sentence if it is an avatar command. Returns what was done, or null. */
  command(text: string): AvatarCommand | null {
    const cmd = parseAvatarCommand(text);
    if (cmd) this.apply(cmd.actions);
    return cmd;
  },
  /** Match the face to what is being said: an apology looks sorry, good news pleased. */
  react(text: string): void {
    const { emotion, gesture } = emotionFromText(text);
    const actions: AvatarAction[] = [];
    if (emotion !== "neutral") actions.push({ type: "emotion", emotion, seconds: 6 });
    if (gesture) actions.push({ type: "gesture", gesture });
    if (actions.length) set(applyActions(state, actions, Date.now()), false);
  },
  /** The renderer reports what is on screen, so commands build on it and panels can name it. Not saved. */
  setShowing(look: AvatarLook): void {
    if (state.showing === look) return;
    state = { ...state, showing: look };
    // Once per transformation (every few seconds), so a panel naming the
    // current form keeps up. Never per frame.
    emit();
  },
  /** Drop gestures the renderer has played. */
  consumeGestures(beforeId: number): void {
    if (!state.gestures.some((g) => g.id <= beforeId)) return;
    state = { ...state, gestures: state.gestures.filter((g) => g.id > beforeId) };
  },
};

const serverState = () => INITIAL_STATE;

/** The controller's state, for panels (re-renders on change, not every frame). */
export function useAvatar(): AvatarState {
  return useSyncExternalStore(avatarStore.subscribe, avatarStore.get, serverState);
}
