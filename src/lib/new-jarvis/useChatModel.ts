"use client";

// ---------------------------------------------------------------------------
// The one model pick, shared by every surface that runs a harness.
//
// Chat has always had this list; Client Review, App Builder and the Website
// Redesigner need the same pick because the same PC agent does the work behind
// all of them. The value is the same stored key the Chat uses, so changing it
// in one place changes it everywhere — which is what "one harness" means.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { CHAT_MODEL_KEY } from "./chatModels";
import { loadLocal, saveSynced } from "@/lib/sync/appState";

/**
 * Fired on this page whenever any chat changes the pick, so the others follow
 * at once instead of on the next reload (the synced key alone only reaches
 * other devices).
 */
export const CHAT_MODEL_EVENT = "jarvis:chat-model";

export function announceChatModel(id: string): void {
  try {
    window.dispatchEvent(new CustomEvent<string>(CHAT_MODEL_EVENT, { detail: id }));
  } catch {
    /* no window (tests, server) */
  }
}

export function useChatModel() {
  const [model, setModelState] = useState("");

  useEffect(() => {
    setModelState(loadLocal<string>(CHAT_MODEL_KEY, ""));
    const follow = (e: Event) => setModelState(String((e as CustomEvent<string>).detail ?? ""));
    window.addEventListener(CHAT_MODEL_EVENT, follow);
    return () => window.removeEventListener(CHAT_MODEL_EVENT, follow);
  }, []);

  const setModel = useCallback((id: string) => {
    setModelState(id);
    saveSynced(CHAT_MODEL_KEY, id);
    announceChatModel(id);
  }, []);

  return { model, setModel };
}

/** The pick, for a build running outside React (the harness start call). */
export function readChatModel(): string {
  try {
    return loadLocal<string>(CHAT_MODEL_KEY, "");
  } catch {
    return "";
  }
}
