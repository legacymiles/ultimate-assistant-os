import { create } from "zustand";
import type { Region } from "./parts";

interface KartState {
  hoveredRegion: Region | null;
  isolated: string | null;
  reducedMotion: boolean;
  ready: boolean;

  progress: number;
  velocity: number;

  kph: number;
  gear: number;

  setHovered: (r: Region | null) => void;
  setIsolated: (id: string | null) => void;
  toggleIsolated: (id: string) => void;
  setReducedMotion: (v: boolean) => void;
  setReady: (v: boolean) => void;
  setProgress: (p: number, v: number) => void;
  setDrive: (kph: number, gear: number) => void;
}

export const useKart = create<KartState>((set) => ({
  hoveredRegion: null,
  isolated: null,
  reducedMotion: false,
  ready: false,
  progress: 0,
  velocity: 0,
  kph: 0,
  gear: 1,
  setHovered: (r) => set({ hoveredRegion: r }),
  setIsolated: (id) => set({ isolated: id }),
  toggleIsolated: (id) => set((s) => ({ isolated: s.isolated === id ? null : id })),
  setReducedMotion: (v) => set({ reducedMotion: v }),
  setReady: (v) => set({ ready: v }),
  setProgress: (p, v) => set({ progress: p, velocity: v }),
  setDrive: (kph, gear) => set({ kph, gear }),
}));

// Luxury layout phases — scroll height is 800vh.
// Each constant marks the END of that phase (or the start of the next).
export const PHASE = {
  heroEnd: 0.07,
  showcaseEnd: 0.20,
  storyEnd: 0.30,
  diveStart: 0.30,
  diveEnd: 0.42,
  rideStart: 0.40,
  rideEnd: 0.84,
  outroStart: 0.84,
} as const;

export function isShowcaseVisible(p: number) {
  return p < PHASE.diveEnd + 0.06;
}
export function isRideVisible(p: number) {
  return p > PHASE.rideStart;
}
