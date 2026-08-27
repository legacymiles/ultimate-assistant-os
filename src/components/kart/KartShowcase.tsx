"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import Lenis from "lenis";
import { useKart } from "@/lib/kart/store";
import { PARTS, REGIONS } from "@/lib/kart/parts";
import { Scene } from "./Scene";
import {
  CornerHUD, RegionReadout, SpeedHUD, RideTitle,
  HeroIntro, MissionSection, QuoteSection, OutroSection,
} from "./Hud";
import { useEngineSound } from "./useEngineSound";
import styles from "./kart.module.css";

const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"] });

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function KartShowcase() {
  const [webgl, setWebgl] = useState(true);
  const [reduced, setReduced] = useState(false);
  const ready = useKart((s) => s.ready);
  const setReducedMotion = useKart((s) => s.setReducedMotion);
  const setProgress = useKart((s) => s.setProgress);
  const { on: soundOn, toggle: toggleSound } = useEngineSound();

  const fontVars = useMemo(
    () =>
      ({
        ["--kart-display"]: display.style.fontFamily,
        ["--kart-mono"]: mono.style.fontFamily,
      }) as React.CSSProperties,
    [],
  );

  useEffect(() => {
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(rm);
    setReducedMotion(rm);
    setWebgl(hasWebGL());
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __kartStore?: typeof useKart }).__kartStore = useKart;
    }
  }, [setReducedMotion]);

  useEffect(() => {
    if (!webgl) return;
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (rm) {
      let last = window.scrollY;
      const onScroll = () => {
        const limit = document.documentElement.scrollHeight - window.innerHeight;
        const p = limit > 0 ? window.scrollY / limit : 0;
        setProgress(p, window.scrollY - last);
        last = window.scrollY;
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return () => window.removeEventListener("scroll", onScroll);
    }

    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    lenis.on("scroll", (e: { scroll: number; limit: number; velocity: number }) => {
      const p = e.limit > 0 ? e.scroll / e.limit : 0;
      setProgress(p, e.velocity);
    });
    let raf = 0;
    const loop = (t: number) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, [webgl, setProgress]);

  if (!webgl) return <Fallback fontVars={fontVars} />;

  return (
    <div className={styles.root} style={fontVars}>
      <div className={styles.canvasWrap}>
        <Scene />
      </div>

      {/* Luxury content overlays */}
      <HeroIntro />
      <MissionSection />
      <QuoteSection />
      <OutroSection />

      {/* HUD elements */}
      <CornerHUD soundOn={soundOn} onToggleSound={toggleSound} />
      <RegionReadout />
      <SpeedHUD />
      <RideTitle />

      {/* scroll length — 800vh for the luxury layout */}
      <div className={styles.scroll} aria-hidden />

      <AccessibleParts />

      {!ready && (
        <div className={styles.loader}>
          <div className={styles.loaderInner}>
            <div className={styles.loaderLabel}>Assembling kart</div>
            <div className={styles.loaderBar}>
              <div className={styles.loaderFill} />
            </div>
          </div>
        </div>
      )}

      {reduced && (
        <p
          style={{
            position: "fixed",
            bottom: 8,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 10,
            letterSpacing: "0.2em",
            color: "#5f7183",
            zIndex: 25,
            textTransform: "uppercase",
          }}
        >
          Reduced-motion mode · calm build
        </p>
      )}
    </div>
  );
}

function AccessibleParts() {
  const setHovered = useKart((s) => s.setHovered);
  const toggleIsolated = useKart((s) => s.toggleIsolated);
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: 1,
        height: 1,
        overflow: "hidden",
        clipPath: "inset(50%)",
        zIndex: 40,
      }}
    >
      {REGIONS.map((r) => (
        <button
          key={r.id}
          onFocus={() => setHovered(r.id)}
          onBlur={() => setHovered(null)}
        >
          Inspect {r.label}
        </button>
      ))}
      {PARTS.map((p) => (
        <button key={p.id} onClick={() => toggleIsolated(p.id)}>
          Isolate {p.name}: {p.spec}
        </button>
      ))}
    </div>
  );
}

function Fallback({ fontVars }: { fontVars: React.CSSProperties }) {
  return (
    <div className={styles.root} style={fontVars}>
      <div className={styles.fallback}>
        <h1 className={styles.mark} style={{ fontSize: 40 }}>
          APEX/01
        </h1>
        <p className={styles.markSub}>// KART DIVISION · Est. 2026</p>
        <p style={{ marginTop: 24, color: "#9fb4c7", lineHeight: 1.6, fontSize: 13 }}>
          Your device can&apos;t run the 3D showcase, so here&apos;s the full
          teardown as a spec sheet.
        </p>
        <div className={styles.fallbackList}>
          {PARTS.map((p) => (
            <div key={p.id} className={styles.fallbackItem}>
              <div className={styles.fallbackName}>{p.name}</div>
              <div className={styles.fallbackSpec}>{p.spec}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
