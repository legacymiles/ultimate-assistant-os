"use client";
/**
 * The hero headline. Split into characters so an energy-shell hit can
 * physically shatter it — fragments scatter with spin, then spring back
 * into place. Typography is the interface.
 */
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useArena } from "@/lib/store";

gsap.registerPlugin(useGSAP);

const LINE_1 = "ITEM STORM";
const LINE_2 = "ARENA";

function SplitLine({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`block ${className ?? ""}`} aria-hidden>
      {text.split("").map((ch, i) => (
        <span key={i} className="hero-char inline-block will-change-transform">
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const shatterSignal = useArena((s) => s.shatterSignal);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        // entrance: chars rise out of nothing, staggered
        gsap.from(".hero-char", {
          yPercent: 120,
          opacity: 0,
          rotateX: -50,
          duration: 1.1,
          ease: "back.out(1.6)",
          stagger: 0.035,
          delay: 0.3,
        });
        gsap.from(".hero-sub", { opacity: 0, y: 24, duration: 1, ease: "power3.out", delay: 1.1 });
      });
    },
    { scope: root }
  );

  // Energy shell impact → the headline physically shatters, then reassembles.
  useGSAP(
    () => {
      if (shatterSignal === 0) return;
      const chars = gsap.utils.toArray<HTMLElement>(".hero-char");
      gsap.to(chars, {
        x: () => gsap.utils.random(-260, 260),
        y: () => gsap.utils.random(-180, 220),
        rotation: () => gsap.utils.random(-160, 160),
        opacity: 0.75,
        duration: 0.55,
        ease: "power3.out",
        stagger: { each: 0.008, from: "random" },
        onComplete: () => {
          gsap.to(chars, {
            x: 0,
            y: 0,
            rotation: 0,
            opacity: 1,
            duration: 1.3,
            ease: "elastic.out(1, 0.55)",
            stagger: { each: 0.012, from: "random" },
          });
        },
      });
    },
    { dependencies: [shatterSignal], scope: root }
  );

  return (
    <section ref={root} className="relative flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="hero-sub mb-5 text-xs tracking-[0.45em] uppercase opacity-70">
        an interactive gravity playground
      </p>
      <h1 className="font-display text-[clamp(3rem,11vw,10rem)] font-bold leading-[0.92] tracking-tight [perspective:600px]">
        <span className="sr-only">
          {LINE_1} {LINE_2}
        </span>
        <SplitLine text={LINE_1} />
        <SplitLine text={LINE_2} className="text-transparent [-webkit-text-stroke:2px_rgba(255,255,255,0.85)]" />
      </h1>
      <p className="hero-sub mt-7 max-w-md text-sm leading-relaxed opacity-70">
        The storm above this arena is not decoration. Get close to it. Collect it.
        Then click — and see what each object does to the kart.
      </p>
      <div className="hero-sub absolute bottom-10 left-1/2 -translate-x-1/2">
        <div className="scroll-cue" aria-hidden />
        <p className="mt-2 text-[10px] tracking-[0.35em] uppercase opacity-50">scroll — the arena migrates</p>
      </div>
    </section>
  );
}
