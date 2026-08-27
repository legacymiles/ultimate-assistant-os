// Pure, three.js-free movement + balance + fall math. Kept isolated so the whole
// "slippery feel" is tunable and testable in one place. All vectors are 2D (XZ);
// Y is handled by the camera. Everything is clamped/guarded against NaN.

import {
  ARENA,
  OBSTACLES,
  OIL_PATCHES,
  TUNING as T,
  type Vec2,
  type Obstacle,
} from "./config";

export type FallState = "ok" | "slip" | "medium" | "full" | "recover";

export type PlayerState = {
  pos: Vec2;
  vel: Vec2;
  yaw: number;
  pitch: number;
  speed: number;
  balance: number;
  fall: FallState;
  fallTimer: number;
  fallSpin: number; // radians of accumulated camera spin during a medium/full fall
  slideTimer: number;
  slideCd: number;
  distance: number; // total distance travelled (for scoring)
  // transient signals used by the camera each frame:
  lateral: number; // sideways slide speed relative to facing (for camera roll)
  justFell: FallState | null; // set for one frame when a NEW fall begins
};

export type Input = {
  fwd: number; // -1..1 (W/S)
  strafe: number; // -1..1 (D/A)
  sprint: boolean;
  slide: boolean;
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const len2 = (v: Vec2) => Math.hypot(v.x, v.z);

function safeNorm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.z);
  if (l < 1e-6) return { x: 0, z: 0 };
  return { x: v.x / l, z: v.z / l };
}

export function createPlayer(): PlayerState {
  return {
    pos: { ...ARENA.playerSpawn },
    vel: { x: 0, z: 0 },
    yaw: ARENA.playerSpawnYaw,
    pitch: 0,
    speed: 0,
    balance: 0,
    fall: "ok",
    fallTimer: 0,
    fallSpin: 0,
    slideTimer: 0,
    slideCd: 0,
    distance: 0,
    lateral: 0,
    justFell: null,
  };
}

// forward/right unit vectors on the ground from a yaw (yaw 0 → facing -Z).
export function yawBasis(yaw: number) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return {
    forward: { x: -s, z: -c } as Vec2,
    right: { x: c, z: -s } as Vec2,
  };
}

function isOnHeavyOil(pos: Vec2): boolean {
  for (const p of OIL_PATCHES) {
    if (Math.hypot(pos.x - p.x, pos.z - p.z) < p.r) return true;
  }
  return false;
}

// Push an agent out of obstacles + arena walls, killing the velocity component
// that points into the surface so it slides along instead of sticking.
export function resolveCollisions(
  pos: Vec2,
  vel: Vec2,
  radius: number,
  obstacles: Obstacle[] = OBSTACLES,
) {
  for (const o of obstacles) {
    const dx = pos.x - o.x;
    const dz = pos.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.r + radius;
    if (d < min && d > 1e-5) {
      const nx = dx / d;
      const nz = dz / d;
      pos.x = o.x + nx * min;
      pos.z = o.z + nz * min;
      const into = vel.x * nx + vel.z * nz;
      if (into < 0) {
        vel.x -= into * nx;
        vel.z -= into * nz;
      }
    }
  }
  // arena bounds
  const lo = radius;
  if (pos.x < ARENA.minX + lo) {
    pos.x = ARENA.minX + lo;
    if (vel.x < 0) vel.x = 0;
  } else if (pos.x > ARENA.maxX - lo) {
    pos.x = ARENA.maxX - lo;
    if (vel.x > 0) vel.x = 0;
  }
  if (pos.z < ARENA.minZ + lo) {
    pos.z = ARENA.minZ + lo;
    if (vel.z < 0) vel.z = 0;
  } else if (pos.z > ARENA.maxZ - lo) {
    pos.z = ARENA.maxZ - lo;
    if (vel.z > 0) vel.z = 0;
  }
}

// One physics step. `dt` is already clamped by the caller.
export function stepPlayer(
  s: PlayerState,
  input: Input,
  dt: number,
  oilDampMul = 1,
  heavyOilBoost = 0,
) {
  s.justFell = null;
  const canSteer = s.fall === "ok" || s.fall === "slip" || s.fall === "recover";
  const heavy = isOnHeavyOil(s.pos);

  // --- desired direction in world space ---
  const { forward, right } = yawBasis(s.yaw);
  let wish: Vec2 = { x: 0, z: 0 };
  if (canSteer) {
    wish = {
      x: forward.x * input.fwd + right.x * input.strafe,
      z: forward.z * input.fwd + right.z * input.strafe,
    };
  }
  const hasInput = len2(wish) > 1e-4;
  const wishDir = safeNorm(wish);

  // --- slide ability bookkeeping ---
  s.slideCd = Math.max(0, s.slideCd - dt);
  if (s.slideTimer > 0) s.slideTimer = Math.max(0, s.slideTimer - dt);
  const canStartSlide =
    input.slide && s.slideTimer <= 0 && s.slideCd <= 0 && s.speed > T.walkSpeed && canSteer;
  if (canStartSlide) {
    s.slideTimer = T.slideDuration;
    s.slideCd = T.slideDuration + T.slideCooldown;
  }
  const sliding = s.slideTimer > 0 && s.fall === "ok";

  // --- target velocity + grip ---
  let targetSpeed = 0;
  let grip = T.gripWalk;
  if (sliding) {
    targetSpeed = Math.max(s.speed, T.sprintSpeed) * T.slideSpeedMul;
    grip = T.gripSlide; // committed glide, barely steerable
  } else if (hasInput) {
    targetSpeed = input.sprint ? T.sprintSpeed : T.walkSpeed;
    grip = input.sprint ? T.gripSprint : T.gripWalk;
  }
  if (s.fall === "slip") targetSpeed *= 0.75;
  if (s.fall === "recover") {
    targetSpeed = Math.min(targetSpeed, T.walkSpeed);
    grip *= 0.8;
  }

  const target: Vec2 = sliding
    ? { x: safeNorm(s.vel).x * targetSpeed, z: safeNorm(s.vel).z * targetSpeed }
    : { x: wishDir.x * targetSpeed, z: wishDir.z * targetSpeed };

  if (hasInput || sliding) {
    const a = clamp(grip * dt, 0, 1);
    s.vel.x += (target.x - s.vel.x) * a;
    s.vel.z += (target.z - s.vel.z) * a;
  } else {
    // no input: long, low-friction glide
    let damp = T.oilDamp * oilDampMul;
    if (heavy) damp *= T.heavyOilDampMul;
    const f = Math.max(0, 1 - damp * dt);
    s.vel.x *= f;
    s.vel.z *= f;
  }

  s.speed = len2(s.vel);

  // --- integrate position + collisions ---
  const prev = { ...s.pos };
  s.pos.x += s.vel.x * dt;
  s.pos.z += s.vel.z * dt;
  resolveCollisions(s.pos, s.vel, ARENA.agentRadius);
  s.speed = len2(s.vel);
  s.distance += Math.hypot(s.pos.x - prev.x, s.pos.z - prev.z);

  // lateral (sideways) component of velocity vs. where you're facing → camera roll
  s.lateral = s.vel.x * right.x + s.vel.z * right.z;

  // --- balance: fighting your momentum destabilizes you ---
  const velDir = safeNorm(s.vel);
  let misalign = 0;
  if (hasInput && s.speed > 0.5) {
    misalign = clamp(1 - (velDir.x * wishDir.x + velDir.z * wishDir.z), 0, 2);
  }
  const speedFactor = clamp(s.speed / T.sprintSpeed, 0, 1.3);
  let gain = T.balanceGain * misalign * speedFactor;
  if (heavy && s.speed > T.walkSpeed) gain += T.balanceHeavyOil + heavyOilBoost;
  if (sliding) gain *= T.slideBalanceRelief; // sliding is a stabilizing commit

  if (gain > 0) s.balance += gain * dt;
  else s.balance -= T.balanceRecover * dt;
  if (s.balance < 0) s.balance = 0;

  stepFall(s, dt, misalign);
}

function beginFall(s: PlayerState, state: FallState, time: number) {
  s.fall = state;
  s.fallTimer = time;
  s.justFell = state;
  s.balance = 0;
}

function stepFall(s: PlayerState, dt: number, misalign: number) {
  switch (s.fall) {
    case "ok":
    case "recover": {
      if (s.fall === "recover") {
        s.fallTimer -= dt;
        if (s.fallTimer <= 0) s.fall = "ok";
      }
      if (s.balance >= T.fullThreshold) {
        beginFall(s, "full", T.fullTime);
      } else if (s.balance >= T.mediumThreshold) {
        beginFall(s, "medium", T.mediumTime);
      } else if (s.balance >= T.slipThreshold) {
        beginFall(s, "slip", T.slipTime);
        s.vel.x *= T.slipSpeedCut;
        s.vel.z *= T.slipSpeedCut;
      }
      break;
    }
    case "slip": {
      s.fallTimer -= dt;
      // a slip can cascade into a real fall if you keep fighting it
      if (s.balance >= T.mediumThreshold) beginFall(s, "medium", T.mediumTime);
      else if (s.fallTimer <= 0) s.fall = "ok";
      break;
    }
    case "medium": {
      s.fallTimer -= dt;
      s.fallSpin += dt * (2.4 + misalign);
      // decays velocity while spinning
      s.vel.x *= Math.max(0, 1 - 2.2 * dt);
      s.vel.z *= Math.max(0, 1 - 2.2 * dt);
      if (s.fallTimer <= 0) {
        s.fall = "recover";
        s.fallTimer = T.recoverTime;
        s.fallSpin = 0;
      }
      break;
    }
    case "full": {
      s.fallTimer -= dt;
      s.fallSpin += dt * 3.0;
      s.vel.x *= Math.max(0, 1 - 4.0 * dt);
      s.vel.z *= Math.max(0, 1 - 4.0 * dt);
      if (s.fallTimer <= 0) {
        s.fall = "recover";
        s.fallTimer = T.recoverTime * 1.6;
        s.fallSpin = 0;
      }
      break;
    }
  }
}

export function distanceToDoor(pos: Vec2): number {
  return Math.hypot(pos.x - ARENA.door.x, pos.z - ARENA.door.z);
}

export function reachedDoor(pos: Vec2): boolean {
  return distanceToDoor(pos) < ARENA.door.radius;
}
