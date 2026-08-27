// Discrete game state only (phase, round, score, run stats). Twitch-rate values
// live in signals.ts. `attemptId` bumps on every fresh attempt so the sim resets
// spawn positions.

import { create } from "zustand";
import { scoreRun, type RunStats } from "./config";

export type Phase = "menu" | "playing" | "won" | "lost";

type WinResult = {
  score: number;
  stats: RunStats;
  newBestTime: boolean;
};

type State = {
  phase: Phase;
  round: number;
  score: number; // running total across the session
  attemptId: number;
  bestTime: number | null;
  lastRun: WinResult | null;
  lastStats: RunStats | null; // for the loss screen

  start: () => void; // from menu → round 1
  retry: () => void; // after a loss → same round
  nextRound: () => void; // after a win → round + 1
  win: (stats: RunStats) => void;
  lose: (stats: RunStats) => void;
  toMenu: () => void;
};

export const useGame = create<State>((set, get) => ({
  phase: "menu",
  round: 1,
  score: 0,
  attemptId: 0,
  bestTime: null,
  lastRun: null,
  lastStats: null,

  start: () =>
    set((s) => ({
      phase: "playing",
      round: 1,
      score: 0,
      attemptId: s.attemptId + 1,
      lastRun: null,
      lastStats: null,
    })),

  retry: () =>
    set((s) => ({ phase: "playing", attemptId: s.attemptId + 1, lastStats: null })),

  nextRound: () =>
    set((s) => ({
      phase: "playing",
      round: s.round + 1,
      attemptId: s.attemptId + 1,
      lastRun: null,
    })),

  win: (stats) => {
    const { round, score, bestTime } = get();
    const gained = scoreRun(stats, round);
    const newBestTime = bestTime === null || stats.time < bestTime;
    set({
      phase: "won",
      score: score + gained,
      bestTime: newBestTime ? stats.time : bestTime,
      lastRun: { score: gained, stats, newBestTime },
    });
  },

  lose: (stats) => set({ phase: "lost", lastStats: stats }),

  toMenu: () => set({ phase: "menu" }),
}));
