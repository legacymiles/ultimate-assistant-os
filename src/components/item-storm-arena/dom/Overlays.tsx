"use client";
import { Component, type ReactNode } from "react";
import { useArena } from "@/lib/item-storm-arena/store";

/** Loading veil — fades out the moment the canvas draws its first frame. */
export function LoadingVeil() {
  const ready = useArena((s) => s.ready);
  return (
    <div
      className={`fixed inset-0 z-30 flex flex-col items-center justify-center bg-[#0a0c1e] transition-opacity duration-700 ${
        ready ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      aria-hidden={ready}
    >
      <div className="loader-orb" />
      <p className="mt-6 font-display text-sm tracking-[0.4em] uppercase opacity-70">entering arena</p>
    </div>
  );
}

/**
 * Static fallback — served when WebGL fails or reduced motion is on.
 * Same content, same typography, calm gradient instead of a storm.
 * The experience degrades; the message doesn't.
 */
export function StaticFallback({ reducedMotion = false, noWebgl = false }: { reducedMotion?: boolean; noWebgl?: boolean }) {
  const note = reducedMotion
    ? "calm mode — honoring your reduced-motion preference"
    : noWebgl
      ? "calm mode — this browser has no WebGL, so the storm stays still"
      : null;
  return (
    <div className="fallback-bg fixed inset-0 -z-10" aria-hidden>
      {note && (
        <p className="absolute bottom-4 right-4 max-w-[60vw] text-right text-[10px] tracking-[0.3em] uppercase opacity-60">
          {note}
        </p>
      )}
    </div>
  );
}

/** If anything inside the canvas throws, the site stays a site. */
export class CanvasErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    // Mark ready so the loading veil lifts even without a canvas.
    useArena.getState().setReady();
  }
  render() {
    if (this.state.failed) return <StaticFallback />;
    return this.props.children;
  }
}
