"use client";

import { Canvas } from "@react-three/fiber";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  DEFAULT_PARAMS,
  MODES,
  PARAM_META,
  type RevealMode,
  type RevealParams,
} from "@/shaders/trailReveal";
import { RevealPlane } from "./RevealPlane";

const DEMO_BASE = "/reveal/demo-base.png";
const DEMO_REVEAL = "/reveal/demo-reveal.png";

type Src = string | File;

function hasWebGL(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function makePlaceholder(kind: "base" | "reveal"): THREE.Texture {
  const s = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 40, s / 2, s / 2, s * 0.75);
  if (kind === "base") {
    g.addColorStop(0, "#5b6577");
    g.addColorStop(1, "#20252f");
  } else {
    g.addColorStop(0, "#fff2c0");
    g.addColorStop(0.4, "#ff7a1a");
    g.addColorStop(1, "#4a0a02");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 3200; i++) {
    const a = Math.random() * (kind === "base" ? 0.16 : 0.2);
    ctx.fillStyle = kind === "base" ? `rgba(150,170,200,${a})` : `rgba(255,220,150,${a})`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
  ctx.fillStyle = kind === "base" ? "rgba(230,236,245,0.55)" : "rgba(60,10,4,0.6)";
  ctx.font = "700 30px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(kind === "base" ? "BASE" : "HIDDEN", s / 2, s / 2 + 10);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function useLoadedTexture(src: Src | null): { tex: THREE.Texture | null; failed: boolean } {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) {
      setTex(null);
      setFailed(false);
      return;
    }
    let disposed = false;
    let objectUrl: string | null = null;
    const url = typeof src === "string" ? src : (objectUrl = URL.createObjectURL(src));

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (disposed) return;
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      setFailed(false);
      setTex(t);
    };
    img.onerror = () => {
      if (!disposed) setFailed(true);
    };
    img.src = url;

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return { tex, failed };
}

export function FireRevealStudio() {
  const [reduced, setReduced] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const [modeId, setModeId] = useState(MODES[0].id);
  const [params, setParams] = useState<RevealParams>({ ...DEFAULT_PARAMS });
  const [intro, setIntro] = useState(true);

  const [baseSrc, setBaseSrc] = useState<Src | null>(DEMO_BASE);
  const [revealSrc, setRevealSrc] = useState<Src | null>(DEMO_REVEAL);

  const mode: RevealMode = useMemo(() => MODES.find((m) => m.id === modeId) ?? MODES[0], [modeId]);

  const mouseTarget = useRef({ x: 0.5, y: 0.5 });
  const burstRequest = useRef(0);

  useEffect(() => {
    setWebgl(hasWebGL());
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const { tex: baseLoaded, failed: baseFailed } = useLoadedTexture(baseSrc);
  const { tex: revealLoaded, failed: revealFailed } = useLoadedTexture(revealSrc);

  const placeholders = useRef<{ base: THREE.Texture; reveal: THREE.Texture } | null>(null);
  if (typeof window !== "undefined" && !placeholders.current) {
    placeholders.current = { base: makePlaceholder("base"), reveal: makePlaceholder("reveal") };
  }
  const effBase = (baseFailed ? placeholders.current?.base : baseLoaded) ?? placeholders.current?.base ?? null;
  const effReveal = (revealFailed ? placeholders.current?.reveal : revealLoaded) ?? placeholders.current?.reveal ?? null;

  const setParam = useCallback((key: keyof RevealParams, value: number) => {
    setParams((p) => ({ ...p, [key]: value }));
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    mouseTarget.current = {
      x: (e.clientX - r.left) / r.width,
      y: 1 - (e.clientY - r.top) / r.height,
    };
    setIntro((v) => (v ? false : v));
  }, []);

  const flash = useCallback(() => {
    burstRequest.current += 1;
    setIntro((v) => (v ? false : v));
  }, []);

  const onFile = (setter: (s: Src) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setter(f);
  };

  const showFlat = reduced || !webgl;
  const flatBase = typeof baseSrc === "string" ? baseSrc : baseSrc ? URL.createObjectURL(baseSrc) : DEMO_BASE;
  const flatReveal = typeof revealSrc === "string" ? revealSrc : revealSrc ? URL.createObjectURL(revealSrc) : DEMO_REVEAL;

  return (
    <div style={S.root}>
      {/* stage (canvas + reveal interaction) --------------------------- */}
      <div
        style={S.stage}
        onPointerMove={showFlat ? undefined : onPointerMove}
        onClick={showFlat ? undefined : flash}
      >
        {showFlat ? (
          <FlatFallback base={flatBase} reveal={flatReveal} reduced={reduced} noWebgl={!webgl} />
        ) : effBase && effReveal ? (
          <Canvas
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: false }}
            camera={{ position: [0, 0, 5], fov: 75 }}
            style={{ position: "absolute", inset: 0 }}
            onCreated={({ gl }) => gl.setClearColor("#05060a", 1)}
          >
            <RevealPlane
              base={effBase}
              reveal={effReveal}
              mode={mode}
              params={params}
              mouseTarget={mouseTarget}
              burstRequest={burstRequest}
            />
          </Canvas>
        ) : null}

        <div style={S.vignette} />
        <div style={S.grain} />

        {/* intro / hero */}
        {!showFlat && (
          <div style={{ ...S.intro, ...(intro ? S.introIn : S.introOut) }}>
            <div style={S.introInner}>
              <div style={S.eyebrow}>Unicorn-style WebGL · Mouse-trail masks</div>
              <h1 style={S.hero}>
                Tear one image
                <br />
                open to reveal
                <br />
                <span style={{ color: mode.accent }}>what hides beneath.</span>
              </h1>
              <p style={S.lede}>
                Drag your cursor to scan the top image away and expose the one underneath.
                Tune the brush like a pro — radius, strength, tail, fluidity, momentum — then
                drop in your own two images and craft the mask.
              </p>
              <button style={{ ...S.beginBtn, borderColor: mode.accent }} onClick={() => setIntro(false)}>
                <span style={{ color: mode.accent }}>◆</span> Start creating
              </button>
              <div style={S.introHint}>or just move your cursor onto the image</div>
            </div>
          </div>
        )}

        {!showFlat && !intro && (
          <div style={S.hint}>move to reveal · click to flash · drag to carve</div>
        )}
      </div>

      {/* top bar */}
      <header style={S.header}>
        <Link href="/" style={S.back}>
          ← Hub
        </Link>
        <div>
          <div style={S.brand}>
            EMBER<span style={{ color: mode.accent }}>/</span>MASK
          </div>
          <div style={S.brandSub}>WebGL Reveal Studio</div>
        </div>
      </header>

      {/* control panel (right) ----------------------------------------- */}
      {!showFlat && !intro && (
        <ControlPanel
          mode={mode}
          onMode={setModeId}
          params={params}
          onParam={setParam}
          onReset={() => setParams({ ...DEFAULT_PARAMS })}
          onFlash={flash}
        />
      )}

      {/* image toolbar (bottom-left) ----------------------------------- */}
      {!intro && (
        <div style={S.toolbar}>
          <span style={S.toolbarLabel}>Layers</span>
          <UploadButton label="Base" accent={mode.accent} onChange={onFile(setBaseSrc)} />
          <UploadButton label="Hidden" accent={mode.accent} onChange={onFile(setRevealSrc)} />
          <button
            style={S.ghostBtn}
            onClick={() => {
              setBaseSrc(DEMO_BASE);
              setRevealSrc(DEMO_REVEAL);
            }}
          >
            Demo wolf
          </button>
        </div>
      )}

      {showFlat && (
        <div style={S.flatNote}>
          {reduced
            ? "Reduced-motion is on — showing a drag-to-reveal crossfade instead of the live trail."
            : "WebGL is unavailable — showing a static crossfade fallback."}
        </div>
      )}
    </div>
  );
}

// --- control panel ----------------------------------------------------------
function ControlPanel({
  mode,
  onMode,
  params,
  onParam,
  onReset,
  onFlash,
}: {
  mode: RevealMode;
  onMode: (id: string) => void;
  params: RevealParams;
  onParam: (k: keyof RevealParams, v: number) => void;
  onReset: () => void;
  onFlash: () => void;
}) {
  return (
    <aside style={S.panel}>
      <div style={S.panelHead}>
        <span style={{ ...S.panelDot, background: mode.accent }} />
        <span style={S.panelTitle}>Reveal</span>
        <button style={S.resetBtn} onClick={onReset}>
          Reset
        </button>
      </div>

      <div style={S.panelSection}>
        <div style={S.panelRowLabel}>Type</div>
        <div style={S.typeGrid}>
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => onMode(m.id)}
              style={{
                ...S.typeChip,
                borderColor: m.id === mode.id ? m.accent : "var(--color-line)",
                color: m.id === mode.id ? "#fff" : "var(--color-ink-muted)",
                background: m.id === mode.id ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
              }}
            >
              <span style={{ ...S.panelDot, background: m.accent }} />
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div style={S.divider} />

      <div style={S.panelSection}>
        {PARAM_META.map((p) => (
          <ParamSlider
            key={p.key}
            label={p.label}
            hint={p.hint}
            accent={mode.accent}
            value={params[p.key]}
            onChange={(v) => onParam(p.key, v)}
          />
        ))}
      </div>

      <button style={{ ...S.flashBtn, borderColor: mode.accent }} onClick={onFlash}>
        ⚡ Flash reveal
      </button>
    </aside>
  );
}

function ParamSlider({
  label,
  hint,
  accent,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  accent: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={S.paramRow} title={hint}>
      <span style={S.paramLabel}>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ ...S.paramSlider, accentColor: accent }}
        aria-label={label}
      />
      <span style={S.paramValue}>{Math.round(value * 100)}%</span>
    </div>
  );
}

function UploadButton({
  label,
  accent,
  onChange,
}: {
  label: string;
  accent: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label style={{ ...S.ghostBtn, cursor: "pointer" }}>
      <span style={{ color: accent, marginRight: 6 }}>↑</span>
      {label}
      <input type="file" accept="image/*" onChange={onChange} style={{ display: "none" }} />
    </label>
  );
}

function FlatFallback({
  base,
  reveal,
  reduced,
  noWebgl,
}: {
  base: string;
  reveal: string;
  reduced: boolean;
  noWebgl: boolean;
}) {
  const [x, setX] = useState(0.5);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#05060a" }}>
      <img src={base} alt="" style={S.flatImg} />
      <img src={reveal} alt="" style={{ ...S.flatImg, clipPath: `inset(0 ${(1 - x) * 100}% 0 0)` }} />
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={x}
        onChange={(e) => setX(parseFloat(e.target.value))}
        aria-label="Reveal amount"
        style={S.flatSlider}
      />
      <div style={{ ...S.hint, bottom: 76, opacity: 0.7 }}>
        {reduced ? "reduced motion" : noWebgl ? "no webgl" : ""} · drag to reveal
      </div>
    </div>
  );
}

// --- styles -----------------------------------------------------------------
const S: Record<string, React.CSSProperties> = {
  root: { position: "fixed", inset: 0, background: "#05060a", color: "var(--color-ink)", overflow: "hidden" },
  stage: { position: "absolute", inset: 0, cursor: "crosshair", touchAction: "none" },

  vignette: { position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3, background: "radial-gradient(120% 90% at 50% 40%, transparent 45%, rgba(0,0,0,0.55) 100%)" },
  grain: { position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3, opacity: 0.05, mixBlendMode: "overlay", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" },

  header: { position: "absolute", top: 22, left: 26, display: "flex", alignItems: "flex-start", gap: 16, zIndex: 12 },
  back: { fontFamily: "ui-monospace, monospace", fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--color-ink-muted)", textDecoration: "none", padding: "8px 12px", border: "1px solid var(--color-line)", borderRadius: 8, background: "rgba(10,11,15,0.5)", backdropFilter: "blur(6px)" },
  brand: { fontFamily: "ui-monospace, monospace", fontSize: 16, fontWeight: 700, letterSpacing: "0.14em", textShadow: "0 2px 16px rgba(0,0,0,0.7)" },
  brandSub: { fontFamily: "ui-monospace, monospace", fontSize: 10, letterSpacing: "0.34em", textTransform: "uppercase", color: "var(--color-ink-faint)", marginTop: 3 },

  intro: { position: "absolute", inset: 0, zIndex: 6, display: "flex", alignItems: "center", justifyContent: "flex-start", padding: "0 clamp(26px, 7vw, 120px)", background: "linear-gradient(90deg, rgba(5,6,10,0.82) 0%, rgba(5,6,10,0.5) 45%, rgba(5,6,10,0.05) 75%, transparent 100%)", transition: "opacity 0.9s ease, transform 0.9s cubic-bezier(0.22,1,0.36,1), filter 0.9s ease" },
  introIn: { opacity: 1, transform: "translateY(0)", filter: "blur(0px)", pointerEvents: "none" },
  introOut: { opacity: 0, transform: "translateY(-22px)", filter: "blur(10px)", pointerEvents: "none" },
  introInner: { maxWidth: 620, pointerEvents: "none" },
  eyebrow: { fontFamily: "ui-monospace, monospace", fontSize: 12, letterSpacing: "0.32em", textTransform: "uppercase", color: "var(--color-ink-faint)", marginBottom: 20 },
  hero: { margin: 0, fontSize: "clamp(34px, 5.4vw, 72px)", lineHeight: 1.04, fontWeight: 800, letterSpacing: "-0.03em", textShadow: "0 6px 40px rgba(0,0,0,0.75)" },
  lede: { margin: "24px 0 30px", maxWidth: 500, fontSize: 15.5, lineHeight: 1.65, color: "var(--color-ink-muted)", textShadow: "0 2px 16px rgba(0,0,0,0.6)" },
  beginBtn: { pointerEvents: "auto", display: "inline-flex", alignItems: "center", gap: 9, padding: "13px 24px", borderRadius: 10, border: "1px solid", background: "rgba(10,11,15,0.55)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", backdropFilter: "blur(6px)" },
  introHint: { marginTop: 16, fontFamily: "ui-monospace, monospace", fontSize: 11.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--color-ink-faint)" },

  hint: { position: "absolute", bottom: 26, left: "50%", transform: "translateX(-50%)", fontFamily: "ui-monospace, monospace", fontSize: 12, letterSpacing: "0.26em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", pointerEvents: "none", textShadow: "0 2px 12px rgba(0,0,0,0.85)", zIndex: 5, animation: "fadeIn 0.6s ease-out" },

  panel: { position: "absolute", top: 88, right: 18, bottom: 18, width: 280, display: "flex", flexDirection: "column", gap: 0, background: "rgba(12,14,20,0.86)", border: "1px solid var(--color-line)", borderRadius: 14, padding: 14, backdropFilter: "blur(16px)", zIndex: 11, overflowY: "auto", boxShadow: "0 24px 60px -20px rgba(0,0,0,0.7)" },
  panelHead: { display: "flex", alignItems: "center", gap: 9, paddingBottom: 12 },
  panelDot: { width: 9, height: 9, borderRadius: 999, display: "inline-block", flexShrink: 0 },
  panelTitle: { fontSize: 14, fontWeight: 700, letterSpacing: "0.02em" },
  resetBtn: { marginLeft: "auto", fontFamily: "ui-monospace, monospace", fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-ink-faint)", background: "transparent", border: "1px solid var(--color-line)", borderRadius: 6, padding: "4px 8px", cursor: "pointer" },
  panelSection: { display: "flex", flexDirection: "column", gap: 9, paddingBlock: 4 },
  panelRowLabel: { fontFamily: "ui-monospace, monospace", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--color-ink-faint)", marginBottom: 2 },
  typeGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  typeChip: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-line)", fontSize: 12, cursor: "pointer", transition: "all 0.15s ease", whiteSpace: "nowrap" },
  divider: { height: 1, background: "var(--color-line)", margin: "12px 0" },

  paramRow: { display: "flex", alignItems: "center", gap: 8 },
  paramLabel: { fontSize: 12, color: "var(--color-ink-muted)", width: 92, flexShrink: 0 },
  paramSlider: { flex: 1, minWidth: 0, height: 3 },
  paramValue: { fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--color-ink)", width: 38, textAlign: "right", flexShrink: 0 },

  flashBtn: { marginTop: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 14px", borderRadius: 9, border: "1px solid", background: "rgba(255,255,255,0.03)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 },

  toolbar: { position: "absolute", left: 18, bottom: 18, display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "rgba(12,14,20,0.86)", border: "1px solid var(--color-line)", borderRadius: 12, backdropFilter: "blur(14px)", zIndex: 11 },
  toolbarLabel: { fontFamily: "ui-monospace, monospace", fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--color-ink-faint)", marginRight: 2 },
  ghostBtn: { display: "inline-flex", alignItems: "center", padding: "8px 13px", borderRadius: 8, border: "1px solid var(--color-line)", background: "rgba(255,255,255,0.02)", color: "var(--color-ink-muted)", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" },

  flatNote: { position: "absolute", left: 18, bottom: 18, maxWidth: 420, fontSize: 12, color: "var(--color-ink-faint)", zIndex: 11 },
  flatImg: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", userSelect: "none" },
  flatSlider: { position: "absolute", bottom: 34, left: "50%", transform: "translateX(-50%)", width: "min(420px, 70%)", accentColor: "#ff6a1f" },
};
