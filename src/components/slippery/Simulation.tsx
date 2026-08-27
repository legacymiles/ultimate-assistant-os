"use client";
// The brain. Owns the single useFrame loop: reads input, steps the player and the
// opponent, resolves collisions, drives the first-person camera (bob / roll / shake /
// fall spin / FOV), tracks run stats, and fires win/lose. Nothing here re-renders
// React during play — twitch data goes through signals.ts.

import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  stepPlayer,
  reachedDoor,
  yawBasis,
  resolveCollisions,
  createPlayer,
  type PlayerState,
  type Input,
} from "@/lib/slippery/movement";
import {
  steer,
  stepOpponent,
  opponentCaught,
  opponentDistance,
  createOpponent,
  type OpponentState,
} from "@/lib/slippery/ai";
import { ARENA, TUNING as T, difficulty } from "@/lib/slippery/config";
import { useGame } from "@/lib/slippery/store";
import { hud, resetHud, flash } from "@/lib/slippery/signals";

type Props = {
  playerRef: MutableRefObject<PlayerState>;
  oppRef: MutableRefObject<OpponentState>;
  reduced: boolean;
};

const BASE_FOV = 76;

export function Simulation({ playerRef, oppRef, reduced }: Props) {
  const { camera } = useThree();
  const attemptId = useGame((s) => s.attemptId);

  const keys = useRef<Record<string, boolean>>({});
  const bob = useRef(0);
  const shakeSeed = useRef(0);
  const prevHeading = useRef({ x: 0, z: -1 });
  const cutTimer = useRef(0);
  const cutConsumed = useRef(false);
  const stats = useRef({ falls: 0, closest: 99, jukes: 0, elapsed: 0 });

  // keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (e.code === "Space") e.preventDefault();
    };
    const up = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // mouse look (only while pointer-locked)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;
      const p = playerRef.current;
      p.yaw -= e.movementX * T.mouseSensitivity;
      p.pitch -= e.movementY * T.mouseSensitivity;
      p.pitch = Math.max(-T.pitchClamp, Math.min(T.pitchClamp, p.pitch));
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, [playerRef]);

  // reset everything for a fresh attempt (start / retry / next round)
  useEffect(() => {
    Object.assign(playerRef.current, createPlayer());
    Object.assign(oppRef.current, createOpponent());
    stats.current = { falls: 0, closest: 99, jukes: 0, elapsed: 0 };
    cutTimer.current = 0;
    cutConsumed.current = false;
    prevHeading.current = { x: 0, z: -1 };
    resetHud();
  }, [attemptId, playerRef, oppRef]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const p = playerRef.current;
    const o = oppRef.current;
    const g = useGame.getState();

    // menu: hold a gentle first-person spawn view. won/lost/paused: freeze the
    // final framing so the end screen sits over it. Either way, don't simulate.
    if (g.phase === "menu") {
      bob.current += dt;
      const sway = reduced ? 0 : Math.sin(bob.current * 0.5) * 0.015;
      camera.position.set(p.pos.x, ARENA.eyeHeight + Math.sin(bob.current) * 0.01, p.pos.z);
      camera.quaternion.setFromEuler(new THREE.Euler(p.pitch + sway, p.yaw, 0, "YXZ"));
      return;
    }
    // won/lost: freeze the final framing under the end screen.
    if (g.phase !== "playing") return;
    // NOTE: we intentionally simulate even without pointer lock — WASD still works;
    // only mouse-look is gated on lock (in the mousemove handler). This avoids a
    // frozen, unexplained screen if the browser doesn't grant lock on the first click.

    // ---- input ----
    const k = keys.current;
    const input: Input = {
      fwd: (k["KeyW"] || k["ArrowUp"] ? 1 : 0) - (k["KeyS"] || k["ArrowDown"] ? 1 : 0),
      strafe: (k["KeyD"] || k["ArrowRight"] ? 1 : 0) - (k["KeyA"] || k["ArrowLeft"] ? 1 : 0),
      sprint: !!(k["ShiftLeft"] || k["ShiftRight"]),
      slide: !!(k["Space"] || k["ControlLeft"] || k["KeyC"]),
    };

    const diff = difficulty(g.round);

    // ---- step player ----
    stepPlayer(p, input, dt, diff.oilDampMul, diff.heavyOilBoost);

    // fall bookkeeping (count real falls, toast the moment)
    if (p.justFell) {
      if (p.justFell === "slip") flash("SLIP!", 600);
      else if (p.justFell === "medium") {
        stats.current.falls++;
        flash("STUMBLE!", 800);
      } else if (p.justFell === "full") {
        stats.current.falls++;
        flash("WIPEOUT!", 1000);
      }
    }

    // ---- juke tracking: sharp cut at speed sets a window ----
    if (p.speed > T.sprintSpeed * 0.55) {
      const vd = p.speed > 0.1 ? { x: p.vel.x / p.speed, z: p.vel.z / p.speed } : prevHeading.current;
      const dot = vd.x * prevHeading.current.x + vd.z * prevHeading.current.z;
      if (dot < 0.6) {
        cutTimer.current = T.jukeWindow;
        cutConsumed.current = false;
      }
      prevHeading.current = vd;
    }

    // ---- step opponent ----
    const dir = steer(o, p.pos, p.vel, diff.guard);
    stepOpponent(o, dir, diff.opponentSpeed, dt);
    resolveCollisions(o.pos, o.vel, ARENA.agentRadius);

    const oppDist = opponentDistance(o, p.pos);
    stats.current.closest = Math.min(stats.current.closest, oppDist);

    // reward a juke: he overshoots, fast + close, right after your cut
    if (cutTimer.current > 0) {
      cutTimer.current -= dt;
      if (!cutConsumed.current && o.overshoot > 0.5 && oppDist < 4 && o.speed > T.jukeOppMinSpeed) {
        stats.current.jukes++;
        cutConsumed.current = true;
        flash("JUKE! +250", 900);
      }
    }

    // ---- timers / signals ----
    stats.current.elapsed += dt;
    hud.timer = stats.current.elapsed;
    hud.speed = p.speed;
    hud.balance = Math.min(1, p.balance);
    hud.oppDist = oppDist;
    hud.tension = Math.max(0, Math.min(1, 1 - (oppDist - T.opponentCatchRadius) / 7));
    hud.fall = p.fall;

    // ---- camera physics ----
    const { right } = yawBasis(p.yaw);
    const speedN = Math.min(1, p.speed / T.sprintSpeed);

    // head bob
    bob.current += dt * (4 + p.speed * 1.1);
    const bobAmp = reduced ? 0 : speedN * (input.sprint ? 0.09 : 0.055);
    const bobY = Math.sin(bob.current) * bobAmp;

    // roll: lean into the slide + wobble as balance climbs
    let roll = THREE.MathUtils.clamp(-p.lateral * 0.03, -0.32, 0.32);
    const wobble = reduced ? 0 : Math.sin(bob.current * 1.7) * p.balance * 0.05;
    roll += wobble;

    // shake grows with balance and during falls
    shakeSeed.current += dt * 60;
    let shakeMag = p.balance > T.slipThreshold * 0.7 ? (p.balance - 0.3) * 0.03 : 0;
    let fallPitch = 0;
    if (p.fall === "slip") fallPitch = 0.12;
    if (p.fall === "medium") {
      shakeMag += 0.05;
      roll += p.fallSpin;
      fallPitch = 0.35;
    }
    if (p.fall === "full") {
      shakeMag += 0.03;
      roll += p.fallSpin;
      fallPitch = 0.9 + Math.min(0.4, p.fallSpin * 0.1);
    }
    if (reduced) shakeMag = 0;
    const sx = Math.sin(shakeSeed.current * 1.1) * shakeMag;
    const sy = Math.cos(shakeSeed.current * 1.7) * shakeMag;

    // drop the eye toward the floor during a full fall
    const fallDrop =
      p.fall === "full"
        ? -Math.min(1.0, (T.fullTime - p.fallTimer) / T.fullTime) * 1.0
        : p.fall === "medium"
        ? -0.25
        : 0;

    camera.position.set(
      p.pos.x + right.x * sx,
      ARENA.eyeHeight + bobY + fallDrop + sy,
      p.pos.z + right.z * sx,
    );
    const euler = new THREE.Euler(p.pitch + fallPitch + sy * 0.5, p.yaw, roll, "YXZ");
    camera.quaternion.setFromEuler(euler);

    // FOV kick
    const targetFov = BASE_FOV + (input.sprint ? 8 : 0) + (p.slideTimer > 0 ? 6 : 0);
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 6);
    cam.updateProjectionMatrix();

    // ---- outcomes ----
    if (reachedDoor(p.pos)) {
      g.win({
        time: stats.current.elapsed,
        falls: stats.current.falls,
        distance: p.distance,
        closest: stats.current.closest,
        jukes: stats.current.jukes,
        nearMiss: stats.current.closest < T.nearMissDist,
      });
      document.exitPointerLock?.();
      return;
    }
    if (opponentCaught(o, p.pos)) {
      g.lose({
        time: stats.current.elapsed,
        falls: stats.current.falls,
        distance: p.distance,
        closest: stats.current.closest,
        jukes: stats.current.jukes,
        nearMiss: false,
      });
      document.exitPointerLock?.();
    }
  });

  return null;
}
