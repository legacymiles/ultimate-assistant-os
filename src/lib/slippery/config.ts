// Slippery Escape — all tunables + arena layout live here so the "feel" and the
// level geometry have a single source of truth (shared by the sim and the visuals).

export type Vec2 = { x: number; z: number };

export type Obstacle = { x: number; z: number; r: number; kind: ObstacleKind };
export type ObstacleKind = "bench" | "island" | "tub" | "locker";
export type OilPatch = { x: number; z: number; r: number };

export const ARENA = {
  // X = left/right (width), Z = length. Player starts at +Z, door at -Z.
  minX: -8,
  maxX: 8,
  minZ: -15,
  maxZ: 15,
  eyeHeight: 1.62,
  agentRadius: 0.42,
  playerSpawn: { x: 0, z: 13 } as Vec2,
  playerSpawnYaw: 0, // yaw 0 == looking toward -Z (toward the door)
  opponentSpawn: { x: 0, z: -3 } as Vec2,
  door: { x: 0, z: -14.6, radius: 2.0 } as Vec2 & { radius: number },
};

// Collidable obstacles — placed to create real routing / juke decisions.
export const OBSTACLES: Obstacle[] = [
  { x: 0, z: 8, r: 1.4, kind: "island" }, // early split near spawn
  { x: -3.2, z: 2, r: 1.15, kind: "bench" }, // mid chokepoint (left)
  { x: 3.2, z: 2, r: 1.15, kind: "bench" }, // mid chokepoint (right)
  { x: -5.6, z: -7, r: 1.3, kind: "tub" }, // near door (left)
  { x: 5.6, z: -7, r: 1.3, kind: "tub" }, // near door (right)
];

// Extra-slippery patches (lower friction + faster balance loss). Sit on the
// tense final approach to the door.
export const OIL_PATCHES: OilPatch[] = [
  { x: -2.2, z: -2.5, r: 2.6 },
  { x: 3.4, z: -9, r: 2.3 },
];

// Decorative (non-colliding) prop anchors, purely visual.
export const DECOR = {
  lockers: [-7.4, -7.4, -7.4, -7.4].map((x, i) => ({ x, z: 11 - i * 2.2 })),
  trash: [
    { x: 6.8, z: 4 },
    { x: -6.7, z: -1 },
    { x: 6.6, z: -11 },
  ],
  bottles: [
    { x: -2.9, z: 2, c: "#e9f4ff" },
    { x: 3.5, z: 2, c: "#ffe0b0" },
    { x: 5.9, z: -7, c: "#c8f0d8" },
    { x: -5.2, z: -7, c: "#ffd0e0" },
  ],
};

export const TUNING = {
  // --- speeds (m/s) ---
  walkSpeed: 4.2,
  sprintSpeed: 8.4,
  slideSpeedMul: 1.08,

  // --- grip: rate (per second) that velocity chases the intended direction.
  // high = responsive/grippy, low = slidey momentum. ---
  gripWalk: 7.5,
  gripSprint: 2.3,
  gripSlide: 0.9,
  oilDamp: 0.85, // idle velocity decay (low == long glide)
  heavyOilDampMul: 0.55, // even less friction on oil patches

  // --- balance / falling ---
  balanceGain: 3.6, // how fast fighting momentum destabilizes you
  balanceHeavyOil: 0.7, // extra fill per second while on an oil patch at speed
  balanceRecover: 1.1, // how fast balance settles when moving cleanly
  slipThreshold: 0.55,
  mediumThreshold: 0.82,
  fullThreshold: 1.0,
  slipTime: 0.3,
  mediumTime: 0.75,
  fullTime: 1.25,
  recoverTime: 0.45,
  slipSpeedCut: 0.62,

  // --- slide ability ---
  slideDuration: 0.7,
  slideCooldown: 0.5,
  slideBalanceRelief: 0.6, // slide stabilizes (lower balance gain) but you can't steer

  // --- mouse ---
  mouseSensitivity: 0.0022,
  pitchClamp: 1.15,

  // --- opponent ---
  opponentBaseSpeed: 6.7,
  opponentGrip: 2.6, // he's on the oil too → overshoots on hard cuts
  opponentCatchRadius: 1.15,
  opponentPredict: 0.55, // seconds of intercept lead
  opponentDoorGuard: 0.28, // 0..1 bias toward guarding the player→door lane

  // --- outcomes ---
  jukeWindow: 0.55, // seconds after a cut to reward an overshoot as a "juke"
  jukeOppMinSpeed: 3.5,
  nearMissDist: 2.4,
};

export type Difficulty = {
  opponentSpeed: number;
  oilDampMul: number; // <1 = more slippery
  heavyOilBoost: number;
  guard: number;
};

// Each successful escape ramps difficulty; growth caps so it stays fair.
export function difficulty(round: number): Difficulty {
  const t = Math.min(round - 1, 12);
  return {
    opponentSpeed: TUNING.opponentBaseSpeed + t * 0.16,
    oilDampMul: Math.max(0.7, 1 - t * 0.02),
    heavyOilBoost: t * 0.05,
    guard: Math.min(0.55, TUNING.opponentDoorGuard + t * 0.02),
  };
}

export type RunStats = {
  time: number;
  falls: number;
  distance: number;
  closest: number; // closest the opponent ever got
  jukes: number;
  nearMiss: boolean;
};

// Pure score calc for a completed escape.
export function scoreRun(stats: RunStats, round: number): number {
  let score = 1000;
  score += Math.round(round * 120); // deeper rounds are worth more
  if (stats.falls === 0) score = Math.round(score * 1.75); // clean-run multiplier
  score += stats.jukes * 250;
  if (stats.nearMiss) score += 100;
  const fast = Math.max(0, 20 - stats.time); // sub-20s escapes earn a bonus
  score += Math.round(fast * 40);
  return score;
}
