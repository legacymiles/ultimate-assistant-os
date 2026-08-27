"use client";
import { ReactNode, useEffect } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useArena } from "@/lib/store";

gsap.registerPlugin(ScrollTrigger);

/**
 * Lenis smooth scroll synced to GSAP's ticker + ScrollTrigger, reporting
 * global progress (0..1) into the arena store — that single number drives
 * biome blending, camera vantage and sky. Reduced motion → native scroll,
 * with a plain listener still feeding progress.
 */
export function SmoothScrollProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const report = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      useArena.getState().setProgress(max > 0 ? window.scrollY / max : 0);
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.addEventListener("scroll", report, { passive: true });
      report();
      return () => window.removeEventListener("scroll", report);
    }

    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });

    lenis.on("scroll", () => {
      ScrollTrigger.update();
      report();
    });
    const onRaf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(onRaf);
    gsap.ticker.lagSmoothing(0);
    report();

    return () => {
      gsap.ticker.remove(onRaf);
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
