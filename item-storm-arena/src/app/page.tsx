"use client";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { SmoothScrollProvider } from "@/components/providers/SmoothScrollProvider";
import { Hud } from "@/components/dom/Hud";
import { Hero } from "@/components/dom/Hero";
import { Sections } from "@/components/dom/Sections";
import { LoadingVeil, StaticFallback, CanvasErrorBoundary } from "@/components/dom/Overlays";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useArena } from "@/lib/store";

// WebGL never renders on the server — and never blocks first paint.
const Experience = dynamic(() => import("@/components/three/Experience"), {
  ssr: false,
  loading: () => null,
});

export default function Home() {
  const reduced = useReducedMotion();

  // Reduced motion → no canvas will mount, lift the veil immediately.
  useEffect(() => {
    if (reduced) useArena.getState().setReady();
  }, [reduced]);

  return (
    <SmoothScrollProvider>
      <LoadingVeil />

      {/* the world behind the words */}
      {reduced === false && (
        <CanvasErrorBoundary>
          <Experience />
        </CanvasErrorBoundary>
      )}
      {reduced === true && <StaticFallback reducedMotion />}

      {/* HUD floats above everything, steals no clicks */}
      {reduced === false && <Hud />}

      {/* the journey — pointer-events pass through to the arena */}
      <main className="pointer-events-none relative z-10">
        <Hero />
        <Sections />
      </main>
    </SmoothScrollProvider>
  );
}
