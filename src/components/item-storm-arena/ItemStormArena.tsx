"use client";

// ---------------------------------------------------------------------------
// Item Storm Arena — an interactive gravity playground (unfinished game).
//
// Ported into the hub from the stand-alone Next app that sat at the repo root
// and was never on the site. The game itself is unchanged: a storm of living
// objects circles a floating arena, the cursor is a gravity well, a click
// launches what you collected at the kart, and three secret sequences set off
// arena-wide events. What changed is only how it lives here: three/r3f/drei
// at the hub's versions, GSAP through gsap.context in useLayoutEffect instead
// of @gsap/react, styles scoped under `.isa`, and a way back to Game Studio.
//
// Reduced motion or no WebGL → no canvas at all, the calm still backdrop and
// the same words. The experience degrades; the message doesn't.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { SmoothScrollProvider } from "./dom/SmoothScrollProvider";
import { Hud } from "./dom/Hud";
import { Hero } from "./dom/Hero";
import { Sections } from "./dom/Sections";
import { CanvasErrorBoundary, LoadingVeil, StaticFallback } from "./dom/Overlays";
import { useReducedMotion } from "@/lib/item-storm-arena/useReducedMotion";
import { useArena } from "@/lib/item-storm-arena/store";
import "./item-storm-arena.css";

// WebGL never renders on the server — and never blocks first paint.
const Experience = dynamic(() => import("./three/Experience"), { ssr: false, loading: () => null });

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    (gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

export function ItemStormArena() {
  const reduced = useReducedMotion();
  const [webgl, setWebgl] = useState<boolean | null>(null);

  useEffect(() => setWebgl(hasWebGL()), []);

  const live = reduced === false && webgl === true;
  const calm = reduced === true || webgl === false;

  // No canvas will mount → lift the veil at once.
  useEffect(() => {
    if (calm) useArena.getState().setReady();
  }, [calm]);

  return (
    <div className="isa">
      <SmoothScrollProvider>
        <LoadingVeil />

        {/* the world behind the words */}
        {live && (
          <CanvasErrorBoundary>
            <Experience />
          </CanvasErrorBoundary>
        )}
        {calm && <StaticFallback reducedMotion={reduced === true} noWebgl={webgl === false} />}

        {/* HUD floats above everything, steals no clicks */}
        {live && <Hud />}

        {/* the journey — pointer-events pass through to the arena */}
        <main className="pointer-events-none relative z-10">
          <Hero />
          <Sections />
        </main>

        <a href="/apps/game-studio?section=unfinished" className="isa-back" data-ui>
          <Icon.ArrowLeft width={13} height={13} aria-hidden />
          Game Studio
        </a>
      </SmoothScrollProvider>
    </div>
  );
}
