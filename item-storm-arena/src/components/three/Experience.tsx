"use client";
/**
 * The full 3D experience. Dynamically imported with ssr:false — this file
 * and everything under it may touch window/document freely.
 *
 * Quality tiers: software/weak GPUs skip post-processing, run a sparser
 * storm at lower DPR. A runtime FPS watchdog demotes devices that
 * underperform their probe.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Atmosphere } from "./Atmosphere";
import { Sky } from "./Sky";
import { Arena } from "./Arena";
import { Kart } from "./Kart";
import { ItemStorm } from "./ItemStorm";
import { LaunchFX } from "./LaunchFX";
import { CameraRig } from "./CameraRig";
import { useArena, arenaFx } from "@/lib/store";
import { detectGpuTier, type GpuTier } from "@/lib/quality";
import { wallNow } from "@/lib/math";

/** Bloom that swells during neon events and orb hits. */
function PostFX() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bloom = useRef<any>(null);
  useFrame((state, dt) => {
    if (!bloom.current) return;
    const now = wallNow();
    const store = useArena.getState();
    const neon = store.event === "neon" && now < store.eventUntil;
    const pulse = now < arenaFx.bloomPulseUntil;
    const target = 0.85 + (neon ? 1.1 : 0) + (pulse ? 1.4 : 0);
    bloom.current.intensity += (target - bloom.current.intensity) * Math.min(1, dt * 5);
  });
  return (
    <EffectComposer>
      <Bloom ref={bloom} intensity={0.85} luminanceThreshold={0.32} luminanceSmoothing={0.9} mipmapBlur />
      <Vignette eskil={false} offset={0.18} darkness={0.72} />
    </EffectComposer>
  );
}

/** Demote to the low tier if real-world FPS can't hold ~24 for a few seconds. */
function FpsWatchdog({ onDegrade }: { onDegrade: () => void }) {
  const frames = useRef(0);
  const windowStart = useRef(0);
  const slowWindows = useRef(0);
  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (windowStart.current === 0) windowStart.current = now;
    frames.current++;
    if (now - windowStart.current >= 1) {
      const fps = frames.current / (now - windowStart.current);
      frames.current = 0;
      windowStart.current = now;
      slowWindows.current = fps < 24 ? slowWindows.current + 1 : 0;
      if (slowWindows.current >= 3) onDegrade();
    }
  });
  return null;
}

export default function Experience() {
  const setReady = useArena((s) => s.setReady);
  const [tier, setTier] = useState<GpuTier>(() => detectGpuTier());
  const degrade = useCallback(() => setTier("low"), []);

  const quality = tier === "high" ? 1 : 0.4;

  // Click anywhere (that isn't UI) launches the volley. Any activity resets idle.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      arenaFx.lastActive = performance.now() / 1000;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("a, button, [data-ui]")) return;
      useArena.getState().requestLaunch();
    };
    const onMove = () => {
      arenaFx.lastActive = performance.now() / 1000;
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  // Expire events so the store doesn't hold stale state.
  useEffect(() => {
    const iv = setInterval(() => {
      const s = useArena.getState();
      if (s.event && performance.now() / 1000 > s.eventUntil + 2) s.clearEvent();
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <Canvas
      key={tier} // rebuild the scene graph when the tier changes
      dpr={tier === "high" ? [1, 1.8] : [0.7, 1]}
      camera={{ position: [0, 3.4, 11.5], fov: 42, near: 0.1, far: 200 }}
      gl={{ antialias: tier === "high", powerPreference: "high-performance" }}
      onCreated={() => {
        arenaFx.lastActive = wallNow();
        setReady();
      }}
      style={{ position: "fixed", inset: 0 }}
      aria-hidden
    >
      <Suspense fallback={null}>
        <Atmosphere />
        <Sky />
        <Arena />
        <Kart />
        <ItemStorm quality={quality} />
        <LaunchFX />
        <CameraRig />
        {tier === "high" && <PostFX />}
        {tier === "high" && <FpsWatchdog onDegrade={degrade} />}
      </Suspense>
    </Canvas>
  );
}
