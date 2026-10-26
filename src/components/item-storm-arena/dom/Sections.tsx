"use client";
/**
 * The scroll journey. Four biome chapters — each one a screen of confident
 * typography that reveals as the arena migrates beneath it. The words hint
 * at mechanics without ever explaining the combos.
 */
import { ReactNode, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

function Chapter({
  kicker,
  title,
  children,
  align = "center",
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  align?: "left" | "center" | "right";
}) {
  const root = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const host = root.current;
    if (!host) return;
    // matchMedia owns its own context: leaving reduced motion on reverts the
    // reveal (text stays put), and unmount reverts it and its ScrollTrigger.
    const mm = gsap.matchMedia();
    mm.add(
      "(prefers-reduced-motion: no-preference)",
      () => {
        gsap.from(host.querySelectorAll(".rv"), {
          y: 56,
          opacity: 0,
          duration: 1,
          ease: "power3.out",
          stagger: 0.12,
          scrollTrigger: { trigger: host, start: "top 72%" },
        });
      },
      host,
    );
    return () => mm.revert();
  }, []);

  const alignCls =
    align === "left" ? "items-start text-left" : align === "right" ? "items-end text-right" : "items-center text-center";

  return (
    <section ref={root} className={`relative flex min-h-dvh flex-col justify-center px-6 sm:px-16 ${alignCls}`}>
      <p className="rv mb-4 text-[11px] tracking-[0.45em] uppercase opacity-60">{kicker}</p>
      <h2 className="rv font-display max-w-3xl text-[clamp(2rem,6vw,4.5rem)] font-bold leading-[1.02] tracking-tight">
        {title}
      </h2>
      <div className="rv mt-6 max-w-md text-sm leading-relaxed opacity-70">{children}</div>
    </section>
  );
}

export function Sections() {
  return (
    <>
      <Chapter kicker="01 · sky arena" title="Every object in the storm has a personality." align="left">
        <p>
          Capsules are eager. Coins catch the wind of a fast cursor. Crystals resist you — then commit. Orbs refuse to
          come straight in. Move slowly and the storm leans toward you.
        </p>
      </Chapter>

      <Chapter kicker="02 · crystal caverns" title="Some objects remember the order they arrive in." align="right">
        <p>
          Launch volleys land one by one, in the order you collected them. Most sequences are just fireworks.
          Three of them… are not. The arena keeps count of what you&apos;ve found.
        </p>
      </Chapter>

      <Chapter kicker="03 · neon city" title="The arena was alive before you got here." align="left">
        <p>
          Drones run cargo whether you watch or not. Flags argue with the wind. The kart fidgets, corrects its
          steering, breathes through its engine. Stay perfectly still for a while — the sky has visitors.
        </p>
      </Chapter>

      <Chapter kicker="04 · deep space" title="Scroll back down. The world rewinds with you." align="center">
        <p className="mb-10">
          The whole journey is one continuous timeline — biomes, camera, sky. Nothing here is a page. It&apos;s a place.
        </p>
        <footer className="border-t border-white/10 pt-6 text-[11px] tracking-[0.25em] uppercase opacity-50">
          <p>Item Storm Arena — an original interactive experience</p>
          <p className="mt-1">built with react three fiber · gsap · lenis · zero borrowed assets</p>
        </footer>
      </Chapter>
    </>
  );
}
