"use client";

// The stored Game Play Design Styling doc, synced across the owner's devices,
// plus each player's own "how much of the show" setting (local only).

import { useCallback, useMemo, useState } from "react";
import { loadLocal, saveLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import {
  activeTheme, cleanStyleDoc, defaultStyleDoc, scheduledFor,
  type FxLevel, type GameStyleDoc,
} from "../gameStyle";

export const GAME_STYLE_KEY = "game-play-design-styling:v1";
const FX_LEVEL_KEY = "cook-connect:fx-level:v1";

const read = (): GameStyleDoc => cleanStyleDoc(loadLocal<unknown>(GAME_STYLE_KEY, defaultStyleDoc()));

export function useGameStyle() {
  const [doc, setDoc] = useState<GameStyleDoc>(read);
  useRemotePull(GAME_STYLE_KEY, () => setDoc(read()));

  const save = useCallback((next: GameStyleDoc) => {
    const clean = cleanStyleDoc(next);
    setDoc(clean);
    saveSynced(GAME_STYLE_KEY, clean);
  }, []);

  const today = new Date();
  const theme = useMemo(() => activeTheme(doc, today), [doc, today.toDateString()]); // eslint-disable-line react-hooks/exhaustive-deps
  const scheduled = scheduledFor(doc, today);

  return { doc, save, theme, scheduled };
}

export function useFxLevel(): [FxLevel, (level: FxLevel) => void] {
  const [level, setLevel] = useState<FxLevel>(() => loadLocal<FxLevel>(FX_LEVEL_KEY, "full"));
  const set = useCallback((next: FxLevel) => {
    setLevel(next);
    saveLocal(FX_LEVEL_KEY, next);
  }, []);
  return [level, set];
}
