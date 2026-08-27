// Pure opponent-steering math. The opponent intercepts (aims ahead of the player)
// and biases toward guarding the player→door lane. He runs the same slippery
// integration as the player in the sim, so hard cuts make HIM overshoot too —
// which is what makes jukes land.

import { ARENA, TUNING as T, type Vec2 } from "./config";

export type OpponentState = {
  pos: Vec2;
  vel: Vec2;
  speed: number;
  facing: number; // yaw for the model to face
  overshoot: number; // 0..1, how badly he's currently sliding past his target (visual lean)
};

const len2 = (v: Vec2) => Math.hypot(v.x, v.z);
function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.z);
  if (l < 1e-6) return { x: 0, z: 0 };
  return { x: v.x / l, z: v.z / l };
}

export function createOpponent(): OpponentState {
  return {
    pos: { ...ARENA.opponentSpawn },
    vel: { x: 0, z: 0 },
    speed: 0,
    facing: 0,
    overshoot: 0,
  };
}

// Returns the unit direction the opponent WANTS to move this frame.
export function steer(
  o: OpponentState,
  playerPos: Vec2,
  playerVel: Vec2,
  guard: number,
): Vec2 {
  // 1) intercept: predict where the player will be.
  const lead = T.opponentPredict;
  const predicted: Vec2 = {
    x: playerPos.x + playerVel.x * lead,
    z: playerPos.z + playerVel.z * lead,
  };

  // 2) door-guard: a point on the player→door line, so he cuts off the exit
  //    rather than purely tailing.
  const door = ARENA.door;
  const guardPoint: Vec2 = {
    x: playerPos.x + (door.x - playerPos.x) * 0.4,
    z: playerPos.z + (door.z - playerPos.z) * 0.4,
  };

  const aim: Vec2 = {
    x: predicted.x * (1 - guard) + guardPoint.x * guard,
    z: predicted.z * (1 - guard) + guardPoint.z * guard,
  };

  return norm({ x: aim.x - o.pos.x, z: aim.z - o.pos.z });
}

// Blend velocity toward the desired direction with the opponent's (low) grip,
// integrate, and record facing + overshoot for the visual. Collision is applied
// by the caller (shares resolveCollisions with the player).
export function stepOpponent(
  o: OpponentState,
  desiredDir: Vec2,
  speed: number,
  dt: number,
) {
  const target: Vec2 = { x: desiredDir.x * speed, z: desiredDir.z * speed };
  const a = Math.min(1, T.opponentGrip * dt);
  o.vel.x += (target.x - o.vel.x) * a;
  o.vel.z += (target.z - o.vel.z) * a;

  o.pos.x += o.vel.x * dt;
  o.pos.z += o.vel.z * dt;
  o.speed = len2(o.vel);

  const vdir = norm(o.vel);
  if (o.speed > 0.3) o.facing = Math.atan2(vdir.x, vdir.z);
  // overshoot = how far his heading is from where he wants to go (he's sliding past)
  o.overshoot = Math.max(0, 1 - (vdir.x * desiredDir.x + vdir.z * desiredDir.z));
}

export function opponentCaught(o: OpponentState, playerPos: Vec2): boolean {
  return Math.hypot(o.pos.x - playerPos.x, o.pos.z - playerPos.z) < T.opponentCatchRadius;
}

export function opponentDistance(o: OpponentState, playerPos: Vec2): number {
  return Math.hypot(o.pos.x - playerPos.x, o.pos.z - playerPos.z);
}
