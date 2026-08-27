"use client";
// Top-level orchestrator: sets up the Canvas + lighting + post FX, owns the shared
// player/opponent state refs, manages pointer lock, and wires the HUD buttons.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { Arena } from "./Arena";
import { Opponent } from "./Opponent";
import { Simulation } from "./Simulation";
import { HUD } from "./HUD";
import { createPlayer } from "@/lib/slippery/movement";
import { createOpponent } from "@/lib/slippery/ai";
import { ARENA } from "@/lib/slippery/config";
import { useGame } from "@/lib/slippery/store";

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function SlipperyGame() {
  const playerRef = useRef(createPlayer());
  const oppRef = useRef(createOpponent());
  const canvasEl = useRef<HTMLCanvasElement | null>(null);

  const [webgl, setWebgl] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [locked, setLocked] = useState(false); // is the mouse captured for look?

  const start = useGame((s) => s.start);
  const retry = useGame((s) => s.retry);
  const nextRound = useGame((s) => s.nextRound);

  useEffect(() => {
    setWebgl(hasWebGL());
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __slip?: unknown }).__slip = { store: useGame };
    }
  }, []);

  // track mouse-capture state (drives the "click to capture mouse" hint)
  useEffect(() => {
    const onChange = () => setLocked(!!document.pointerLockElement);
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);

  const requestLock = useCallback(() => {
    // requestPointerLock returns a promise in newer browsers and can reject during
    // the browser's post-exit cooldown — swallow it so it doesn't surface as an error.
    const r = canvasEl.current?.requestPointerLock?.() as unknown as Promise<void> | undefined;
    if (r && typeof r.catch === "function") r.catch(() => {});
  }, []);

  // clicking the play area (re)captures the mouse for look — the game already runs.
  const onCanvasClick = useCallback(() => {
    if (useGame.getState().phase === "playing" && !document.pointerLockElement) requestLock();
  }, [requestLock]);

  const onPlay = useCallback(() => {
    start();
    requestLock();
  }, [start, requestLock]);
  const onNext = useCallback(() => {
    nextRound();
    requestLock();
  }, [nextRound, requestLock]);
  const onRetry = useCallback(() => {
    retry();
    requestLock();
  }, [retry, requestLock]);

  // keyboard shortcuts for the end screens
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const phase = useGame.getState().phase;
      if (e.code === "KeyR" && phase === "lost") onRetry();
      if ((e.code === "Enter" || e.code === "Space") && phase === "won") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRetry, onNext]);

  if (!webgl) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "grid",
          placeItems: "center",
          background: "#06080c",
          color: "#9fb2c4",
          fontFamily: "ui-monospace, monospace",
          textAlign: "center",
          padding: 24,
        }}
      >
        WebGL isn&apos;t available in this browser, so Slippery Escape can&apos;t run here.
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#06080c" }} onClick={onCanvasClick}>
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 76, near: 0.05, far: 120, position: [ARENA.playerSpawn.x, ARENA.eyeHeight, ARENA.playerSpawn.z] }}
        onCreated={({ gl }) => {
          canvasEl.current = gl.domElement as HTMLCanvasElement;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <color attach="background" args={["#0a0d12"]} />
        <fog attach="fog" args={["#0a0d12", 18, 55]} />

        <ambientLight intensity={0.4} />
        <hemisphereLight args={["#dfeaff", "#141820", 0.6]} />
        <directionalLight position={[6, 12, 6]} intensity={0.7} color="#f4f7ff" />

        <Arena />
        <Suspense fallback={null}>
          <Opponent stateRef={oppRef} />
        </Suspense>
        <Simulation playerRef={playerRef} oppRef={oppRef} reduced={reduced} />

        {!reduced && (
          <EffectComposer>
            <Bloom intensity={0.7} luminanceThreshold={0.6} luminanceSmoothing={0.25} mipmapBlur />
            <Vignette eskil={false} offset={0.2} darkness={0.75} />
          </EffectComposer>
        )}
      </Canvas>

      <HUD onPlay={onPlay} onNext={onNext} onRetry={onRetry} locked={locked} />
    </div>
  );
}
