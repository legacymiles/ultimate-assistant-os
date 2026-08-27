"use client";

import { useKart, PHASE } from "@/lib/kart/store";
import { REGIONS, REGION_INDEX } from "@/lib/kart/parts";
import styles from "./kart.module.css";

export function CornerHUD({ soundOn, onToggleSound }: { soundOn: boolean; onToggleSound: () => void }) {
  const inRide = useKart((s) => s.progress > PHASE.diveEnd);
  const inOutro = useKart((s) => s.progress > PHASE.outroStart);
  return (
    <div className={styles.hud} data-hidden={inOutro}>
      <div className={styles.tl}>
        <h1 className={styles.mark}>APEX/01</h1>
        <p className={styles.markSub}>// KART DIVISION · Est. 2026</p>
      </div>
      <p className={styles.tr} data-ride={inRide}>
        A racing kart, taken apart. Hover a section to open it. Scroll to drive.
      </p>
      <div className={styles.bl}>
        <p className={styles.hint}>
          <span className={styles.hintArrow}>{inRide ? "▲" : "▼"}</span>
          {inRide ? "Scroll up to rebuild" : "Scroll down to drive"}
        </p>
        <button className={styles.sound} onClick={onToggleSound}>
          {soundOn ? "◀)) Sound: On" : "◀× Sound: Off"}
        </button>
      </div>
      <p className={styles.br}>PROC · GEN · 3D</p>
    </div>
  );
}

export function RegionReadout() {
  const hoveredRegion = useKart((s) => s.hoveredRegion);
  const isolated = useKart((s) => s.isolated);
  const inShowcase = useKart((s) => s.progress > PHASE.heroEnd && s.progress < PHASE.showcaseEnd);
  const region = hoveredRegion;
  const on = !!region && !isolated && inShowcase;
  const meta = region ? REGIONS.find((r) => r.id === region) : null;
  return (
    <div className={styles.hud}>
      <div className={styles.region} data-on={on}>
        <span className={styles.regionIdx}>{region ? REGION_INDEX[region] : "00"}</span>
        <span className={styles.regionName}>{meta ? meta.label.toUpperCase() : ""}</span>
      </div>
    </div>
  );
}

export function SpeedHUD() {
  const kph = useKart((s) => s.kph);
  const gear = useKart((s) => s.gear);
  const on = useKart((s) => s.progress > PHASE.diveEnd && s.progress < PHASE.outroStart);
  return (
    <div className={styles.speed} data-on={on}>
      <div className={styles.kph}>
        {kph}
        <span className={styles.kphUnit}> KM/H</span>
      </div>
      <div className={styles.gear}>
        GEAR <span className={styles.gearNum}>{gear}</span>
      </div>
    </div>
  );
}

export function RideTitle() {
  const on = useKart((s) => s.progress > PHASE.diveEnd + 0.02 && s.progress < PHASE.outroStart);
  return (
    <div className={styles.rideTitle} data-on={on}>
      <div className={styles.rideTitleMain}>
        Terminal
        <br />
        Velocity
      </div>
      <div className={styles.rideTitleSub}>First-person · scroll-driven</div>
    </div>
  );
}

// --- Luxury content overlays ---

export function HeroIntro() {
  const visible = useKart((s) => s.progress < PHASE.heroEnd - 0.005);
  return (
    <div className={styles.heroIntro} data-on={visible}>
      <div className={styles.heroBadge}>
        <p className={styles.heroEyebrow}>EST. 2026</p>
        <h2 className={styles.heroTitle}>
          APEX<span className={styles.heroSlash}>/</span>01
        </h2>
      </div>
      <div className={styles.heroBottom}>
        <p className={styles.heroTag}>RACE-GRADE KART ENGINEERING</p>
        <div className={styles.heroScrollCue}>
          <span className={styles.hintArrow}>▼</span>
        </div>
      </div>
    </div>
  );
}

export function MissionSection() {
  const visible = useKart((s) => s.progress > 0.17 && s.progress < 0.245);
  return (
    <div className={styles.storySection} data-on={visible}>
      <div className={styles.storyInner}>
        <p className={styles.storyEyebrow}>OUR PHILOSOPHY</p>
        <h3 className={styles.storyHeadline}>
          Every curve is calculated.
          <br />
          Every gram is justified.
        </h3>
        <p className={styles.storyBody}>
          We don&apos;t build karts — we engineer moments of perfection.
          From the carbon-composite floor tray to the magnesium rims,
          every component exists for one reason: to shave another tenth
          off the lap. No compromises. No shortcuts. Just velocity, distilled.
        </p>
      </div>
    </div>
  );
}

export function QuoteSection() {
  const visible = useKart((s) => s.progress > 0.255 && s.progress < 0.33);
  return (
    <div className={styles.storySection} data-on={visible}>
      <div className={styles.storyInner}>
        <blockquote className={styles.quote}>
          &ldquo;The kart doesn&apos;t lie. Every imperfection in the build, you feel
          through the wheel at 140. That honesty is what makes this craft
          worth a lifetime.&rdquo;
        </blockquote>
        <p className={styles.quoteAttr}>
          — MARCUS VELD, FOUNDER & CHIEF ENGINEER
        </p>
        <p className={styles.storyScrollHint}>
          <span className={styles.hintArrow}>▼</span> SCROLL TO DRIVE
        </p>
      </div>
    </div>
  );
}

export function OutroSection() {
  const visible = useKart((s) => s.progress > PHASE.outroStart);
  return (
    <div className={styles.outro} data-on={visible}>
      <div className={styles.outroInner}>
        <p className={styles.outroEyebrow}>YOU JUST DID 180 KM/H</p>
        <h2 className={styles.outroTitle}>
          NOW IMAGINE
          <br />
          <span className={styles.outroTitleAccent}>BUILDING IT.</span>
        </h2>

        <div className={styles.outroCta}>
          <a className={styles.outroButton} href="#configure">
            START YOUR BUILD
          </a>
          <p className={styles.outroCtaSub}>
            48 configurations · 12 liveries · one obsession
          </p>
        </div>

        <div className={styles.outroDivider} />

        <div className={styles.outroClose}>
          <p className={styles.outroCloseLine}>
            Every APEX/01 leaves our workshop dialled to the tenth.
            <br />
            Yours is waiting.
          </p>
        </div>

        <div className={styles.outroFooter}>
          <div className={styles.outroMeta}>
            <span>APEX/01</span>
            <span>·</span>
            <span>HAND-BUILT</span>
            <span>·</span>
            <span>RACE-PROVEN</span>
          </div>
        </div>
      </div>
    </div>
  );
}
