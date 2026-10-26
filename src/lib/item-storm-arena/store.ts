import { create } from "zustand";
import type { ItemKind } from "./items";
import { matchCombo, EVENT_DURATION, type ArenaEventKind } from "./combos";

export interface HitRecord {
  id: number;
  kind: ItemKind;
  at: number; // performance.now()/1000 timestamp
}

interface ArenaState {
  /** true once the WebGL canvas has produced its first frame */
  ready: boolean;
  /** items currently orbiting the cursor */
  collected: number;
  /** coins banked (coin hits) */
  score: number;
  /** total items ever launched into the kart */
  totalHits: number;
  /** ordered history of item kinds that hit the kart (combo matching) */
  hitHistory: ItemKind[];
  /** recent hits, consumed by the FX layer */
  hits: HitRecord[];
  /** active arena-wide event + when it ends (clock seconds) */
  event: ArenaEventKind | null;
  eventUntil: number;
  eventLabel: string | null;
  /** combo names the player has discovered */
  discovered: string[];
  /** monotonically increasing signal: fire the current orbit at the kart */
  launchSignal: number;
  /** signal: an energy shell hit — shatter the DOM headline */
  shatterSignal: number;
  /** scroll progress 0..1 across the whole experience */
  progress: number;

  setReady(): void;
  setCollected(n: number): void;
  setProgress(p: number): void;
  requestLaunch(): void;
  registerHit(kind: ItemKind, now: number): void;
  consumeHits(before: number): void;
  clearEvent(): void;
}

let hitId = 0;

export const useArena = create<ArenaState>((set, get) => ({
  ready: false,
  collected: 0,
  score: 0,
  totalHits: 0,
  hitHistory: [],
  hits: [],
  event: null,
  eventUntil: 0,
  eventLabel: null,
  discovered: [],
  launchSignal: 0,
  shatterSignal: 0,
  progress: 0,

  setReady: () => set({ ready: true }),
  setCollected: (n) => {
    if (get().collected !== n) set({ collected: n });
  },
  setProgress: (p) => {
    if (Math.abs(get().progress - p) > 0.0005) set({ progress: p });
  },

  requestLaunch: () => {
    const s = get();
    if (s.collected === 0) return;
    const patch: Partial<ArenaState> = { launchSignal: s.launchSignal + 1 };
    // A big volley is its own reward: 6+ items sends the kart into a stunt.
    if (s.collected >= 6) {
      const now = performance.now() / 1000;
      patch.event = "stunt";
      patch.eventUntil = now + EVENT_DURATION.stunt;
      patch.eventLabel = null;
    }
    set(patch);
  },

  registerHit: (kind, now) => {
    const s = get();
    const history = [...s.hitHistory, kind].slice(-8);
    const patch: Partial<ArenaState> = {
      totalHits: s.totalHits + 1,
      hitHistory: history,
      hits: [...s.hits, { id: hitId++, kind, at: now }].slice(-24),
    };
    if (kind === "coin") patch.score = s.score + 25;
    if (kind === "shell") patch.shatterSignal = s.shatterSignal + 1;

    const combo = matchCombo(history);
    if (combo) {
      patch.event = combo.event;
      patch.eventUntil = now + EVENT_DURATION[combo.event];
      patch.eventLabel = combo.reveal;
      if (!s.discovered.includes(combo.name)) {
        patch.discovered = [...s.discovered, combo.name];
      }
      // Break the sequence so the same combo doesn't re-fire on the next hit.
      patch.hitHistory = [];
    }
    set(patch);
  },

  consumeHits: (before) => {
    const s = get();
    const remaining = s.hits.filter((h) => h.at >= before);
    if (remaining.length !== s.hits.length) set({ hits: remaining });
  },

  clearEvent: () => set({ event: null, eventLabel: null }),
}));

/**
 * Cross-system per-frame flags that don't need React reactivity.
 * The 3D systems read/write this singleton inside useFrame — zero re-renders.
 */
// Dev-only: expose the store for automated verification and console tinkering.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as Record<string, unknown>).__arena = useArena;
}

export const arenaFx = {
  /** cursor world position (updated by ItemStorm each frame) */
  cursorX: 0,
  cursorY: 2,
  cursorZ: 0,
  cursorSpeed: 0,
  /** active until timestamps (clock seconds) */
  shieldUntil: 0,
  magnetUntil: 0,
  gravityUntil: 0,
  paintUntil: 0,
  bloomPulseUntil: 0,
  paintColor: { r: 1, g: 0.5, b: 0.2 },
  /** last user activity — idle secrets key off this */
  lastActive: 0,
  /** kart world position for launch targeting */
  kartX: 0,
  kartY: 0.7,
  kartZ: 0,
};
