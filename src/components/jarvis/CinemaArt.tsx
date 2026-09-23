"use client";

// ---------------------------------------------------------------------------
// The picker's artwork: one scene, shot every way.
//
// Every tile in the camera deck draws the SAME test scene — a horizon, a light
// source, a figure, a post in the foreground — and then changes exactly one
// thing about it: the stock it was shot on, the glass in front of it, the light
// falling on it, the grade applied to it, or the path the camera takes through
// it. Comparing two lenses means comparing two pictures of the same field,
// which is how a DP actually chooses, and it is honest: nothing here pretends
// to be a frame the owner's model produced.
//
// Genre and era have a visual language even without a literal picture, so they
// render the scene the way that genre or decade would shoot it. Tempo is the
// exception that proves it: the only honest picture of pacing is the cut
// rhythm itself, drawn as one bar per shot.
// ---------------------------------------------------------------------------

import { useId } from "react";
import type { MoveGlyph } from "@/lib/studio/cinema";

interface Look {
  sky: string;
  horizon: string;
  ground: string;
  subject: string;
  sun: string;
}

const NEUTRAL: Look = {
  sky: "#6f8298",
  horizon: "#c3b18d",
  ground: "#464a52",
  subject: "#14161b",
  sun: "#fff1cf",
};

/** Grade id → the whole scene, regraded. */
const LOOKS: Record<string, Look> = {
  "grade-natural": { sky: "#93acc4", horizon: "#d6c4a6", ground: "#5f6055", subject: "#26262a", sun: "#fff3d0" },
  "grade-teal-orange": { sky: "#12454f", horizon: "#2b7d86", ground: "#0d2b31", subject: "#e08a4a", sun: "#ffb266" },
  "grade-bleach": { sky: "#adb2b7", horizon: "#d8dadc", ground: "#66696d", subject: "#141517", sun: "#ffffff" },
  "grade-kodachrome": { sky: "#23588a", horizon: "#c79c56", ground: "#653a26", subject: "#110d0b", sun: "#ffd98a" },
  "grade-golden": { sky: "#c3853a", horizon: "#f2c579", ground: "#613e1e", subject: "#26170a", sun: "#fff0c2" },
  "grade-mono": { sky: "#9a9a9a", horizon: "#d0d0d0", ground: "#4f4f4f", subject: "#161616", sun: "#ffffff" },
  "grade-high-con-mono": { sky: "#f2f2f2", horizon: "#ffffff", ground: "#1e1e1e", subject: "#000000", sun: "#ffffff" },
  "grade-sepia": { sky: "#b0946c", horizon: "#e2c99c", ground: "#67502f", subject: "#261b0f", sun: "#fff0cf" },
  "grade-neon-noir": { sky: "#120820", horizon: "#7a1f6a", ground: "#0a0614", subject: "#22d3ee", sun: "#ff2fb0" },
  "grade-pastel": { sky: "#cfe0f5", horizon: "#f7dbe6", ground: "#c2b6cf", subject: "#6b5a78", sun: "#fff6fb" },
  "grade-steel": { sky: "#63727f", horizon: "#95a4b1", ground: "#363f47", subject: "#12161a", sun: "#dfe8ef" },
  "grade-technicolor": { sky: "#1f5fd0", horizon: "#ffd23f", ground: "#0c7038", subject: "#c81e3a", sun: "#fff7a0" },
  "grade-faded": { sky: "#a3aba8", horizon: "#dad2c7", ground: "#847a70", subject: "#4e4944", sun: "#f3ece0" },
  "grade-infrared": { sky: "#180d2c", horizon: "#ff9ecf", ground: "#f0cbe2", subject: "#250d1e", sun: "#ffffff" },
  "grade-duotone": { sky: "#161140", horizon: "#4b3bd0", ground: "#0f0c2c", subject: "#ffd447", sun: "#ffd447" },
  "grade-moonlit": { sky: "#0d1932", horizon: "#27406b", ground: "#080f1e", subject: "#c3d4f0", sun: "#dbe7ff" },
  "grade-earth": { sky: "#ab946e", horizon: "#dbc28c", ground: "#71522e", subject: "#2a2016", sun: "#ffe9b8" },
  "grade-gasoline": { sky: "#12304d", horizon: "#ef8a20", ground: "#1c1610", subject: "#0a0806", sun: "#ffd68a" },
  "grade-tropic": { sky: "#17a2a2", horizon: "#6fd07f", ground: "#0b3b23", subject: "#ff4f9a", sun: "#fdf3d6" },
  "grade-industrial": { sky: "#9da39a", horizon: "#b7bcb2", ground: "#454d4a", subject: "#23282a", sun: "#e9ece4" },
  "grade-overtime": { sky: "#2f3c33", horizon: "#b08a3b", ground: "#1a1610", subject: "#100d07", sun: "#eed394" },
  "grade-circus": { sky: "#1487a0", horizon: "#3fd0e8", ground: "#2b0410", subject: "#ef2340", sun: "#fbe9e9" },
};

/** Where the light is, how big and soft, and what it does to the figure. */
interface Lamp {
  x: number;
  y: number;
  r: number;
  color: string;
  /** 0 = subject reads as a silhouette, 1 = fully filled. */
  fill: number;
  /** Extra darkness poured into the scene. */
  dim?: number;
}

const DEFAULT_LAMP: Lamp = { x: 30, y: 20, r: 9, color: "#fff1cf", fill: 0.35 };

const LAMPS: Record<string, Lamp> = {
  "light-window": { x: 16, y: 24, r: 16, color: "#dce9f7", fill: 0.55 },
  "light-golden-hour": { x: 10, y: 40, r: 11, color: "#ffc271", fill: 0.4 },
  "light-blue-hour": { x: 50, y: 42, r: 24, color: "#8fb0e8", fill: 0.35, dim: 0.35 },
  "light-overcast": { x: 50, y: 10, r: 46, color: "#cfd8e2", fill: 0.7 },
  "light-hard-noon": { x: 50, y: 4, r: 6, color: "#ffffff", fill: 0.2 },
  "light-neon": { x: 76, y: 34, r: 13, color: "#ff3dcd", fill: 0.4, dim: 0.45 },
  "light-firelight": { x: 34, y: 56, r: 10, color: "#ff8a3d", fill: 0.45, dim: 0.4 },
  "light-candlelight": { x: 44, y: 50, r: 5, color: "#ffc978", fill: 0.3, dim: 0.62 },
  "light-moonlight": { x: 80, y: 14, r: 7, color: "#cfe0ff", fill: 0.22, dim: 0.55 },
  "light-softbox": { x: 32, y: 18, r: 22, color: "#ffffff", fill: 0.85 },
  "light-rembrandt": { x: 24, y: 16, r: 7, color: "#ffeccd", fill: 0.3, dim: 0.28 },
  "light-silhouette": { x: 62, y: 30, r: 20, color: "#ffe9bd", fill: 0, dim: 0.1 },
  "light-toplight": { x: 62, y: 2, r: 8, color: "#eef4ff", fill: 0.25, dim: 0.35 },
  "light-underlight": { x: 62, y: 70, r: 8, color: "#bfe6c8", fill: 0.45, dim: 0.5 },
  "light-strobe": { x: 50, y: 30, r: 34, color: "#ffffff", fill: 0.95 },
  "light-caustics": { x: 46, y: 22, r: 18, color: "#79e8ff", fill: 0.5, dim: 0.28 },
  "light-bulb": { x: 40, y: 14, r: 4, color: "#ffd48a", fill: 0.4, dim: 0.42 },
  "light-headlights": { x: 20, y: 44, r: 8, color: "#ffffff", fill: 0.5, dim: 0.62 },
  "light-screen": { x: 62, y: 52, r: 9, color: "#7fd4ff", fill: 0.45, dim: 0.6 },
};

/** Camera body id → what the stock does to the picture. */
interface Stock {
  grain?: number;
  /** Video scanlines. */
  scan?: number;
  tint?: string;
  tintAlpha?: number;
  vignette?: number;
  /** 0 = greyscale, 1 = untouched, >1 = pushed. */
  sat?: number;
  contrast?: number;
  blur?: number;
  /** Corner timestamp, the way a camcorder burns one in. */
  stamp?: string;
  /** Heat-map or night-vision recolour of the whole frame. */
  falseColor?: "thermal" | "night";
}

const STOCKS: Record<string, Stock> = {
  "cam-modern": { sat: 1 },
  "cam-35mm": { grain: 0.18, vignette: 0.18, sat: 0.95 },
  "cam-super16": { grain: 0.4, vignette: 0.26, sat: 0.9, blur: 0.2 },
  "cam-8mm": { grain: 0.6, vignette: 0.45, tint: "#e8a24a", tintAlpha: 0.2, blur: 0.35, sat: 0.8 },
  "cam-imax": { sat: 1.05, contrast: 1.1 },
  "cam-vhs": { scan: 0.55, tint: "#4ad2ff", tintAlpha: 0.1, blur: 0.5, sat: 0.8, stamp: "0:00:12" },
  "cam-hi8": { scan: 0.35, tint: "#8fd89a", tintAlpha: 0.14, blur: 0.7, sat: 0.7 },
  "cam-dv": { scan: 0.25, blur: 0.35, sat: 0.85, contrast: 1.15 },
  "cam-dslr": { sat: 0.95, contrast: 1.08 },
  "cam-phone": { sat: 1.25, contrast: 1.15 },
  "cam-webcam": { blur: 0.8, sat: 0.7, contrast: 0.85, scan: 0.12 },
  "cam-cctv": { sat: 0.25, blur: 0.5, vignette: 0.4, stamp: "CAM 04" },
  "cam-bodycam": { sat: 0.8, vignette: 0.5, blur: 0.3, contrast: 1.2 },
  "cam-drone": { sat: 1.05, contrast: 1.05 },
  "cam-polaroid": { sat: 0.85, contrast: 0.8, tint: "#8fd9e0", tintAlpha: 0.12, vignette: 0.15 },
  "cam-bolex": { grain: 0.45, vignette: 0.5, sat: 0.6, blur: 0.25 },
  "cam-thermal": { falseColor: "thermal", blur: 0.4 },
  "cam-nightvision": { falseColor: "night", grain: 0.5, vignette: 0.55 },
};

/** Lens id → how the scene is bent, framed and thrown out of focus. */
interface Glass {
  /** <1 pulls the world wider, >1 compresses it. */
  zoom?: number;
  /** Barrel distortion on the reference grid: 0 none, 1 fisheye. */
  barrel?: number;
  /** Background blur, in viewBox units. */
  bokeh?: number;
  /** Foreground post blur. */
  foreBlur?: number;
  /** Oval bokeh balls, the anamorphic tell. */
  ovals?: boolean;
  /** Horizontal streak flare. */
  streak?: string;
  glow?: number;
  /** Blur everything except a horizontal band — the tilt-shift tell. */
  band?: boolean;
  swirl?: boolean;
  /** Both planes sharp with a hard seam down the middle. */
  seam?: boolean;
  /** Sharp centre, smeared periphery. */
  smear?: boolean;
  warm?: number;
}

const GLASSES: Record<string, Glass> = {
  "lens-anamorphic": { zoom: 0.95, bokeh: 1.1, ovals: true, streak: "#5aa8ff", glow: 0.15 },
  "lens-anamorphic-modern": { zoom: 0.95, bokeh: 0.8, ovals: true, streak: "#9ec9ff" },
  "lens-warm-vintage": { bokeh: 0.9, glow: 0.3, warm: 0.28 },
  "lens-halation": { bokeh: 0.8, glow: 0.45, warm: 0.2, streak: "#ff6a4a" },
  "lens-wide-24": { zoom: 0.72, barrel: 0.18, bokeh: 0.2 },
  "lens-ultrawide": { zoom: 0.5, barrel: 0.4, bokeh: 0.1 },
  "lens-fisheye": { zoom: 0.55, barrel: 1, bokeh: 0.1 },
  "lens-normal-50": { zoom: 1, bokeh: 0.5 },
  "lens-portrait-85": { zoom: 1.5, bokeh: 1.3 },
  "lens-tele-135": { zoom: 2.1, bokeh: 1.6 },
  "lens-long-300": { zoom: 3.2, bokeh: 2.2 },
  "lens-macro": { zoom: 4.5, bokeh: 3 },
  "lens-probe": { zoom: 2.4, barrel: 0.3, bokeh: 0.1 },
  "lens-tilt-shift": { zoom: 0.9, band: true, bokeh: 1.8 },
  "lens-petzval": { zoom: 1.4, bokeh: 1.2, swirl: true },
  "lens-diffusion": { zoom: 1.1, bokeh: 1, glow: 0.55 },
  "lens-split-diopter": { zoom: 1, seam: true, foreBlur: 0 },
  "lens-smeared": { zoom: 1.2, smear: true, bokeh: 0.6 },
};

/** f-number for the aperture rail, which drives the iris and the bokeh. */
const F_STOPS: Record<string, number> = {
  "ap-auto": 0,
  "ap-f14": 1.4,
  "ap-f2": 2,
  "ap-f28": 2.8,
  "ap-f56": 5.6,
  "ap-f11": 11,
  "ap-f22": 22,
};

/**
 * Gradient and filter ids have to be unique per instance AND identical between
 * the server render and the client one. A module counter is neither: it starts
 * at a different number on each, so every <defs> id mismatched on hydration.
 * useId is stable across both; the colons it contains are stripped because
 * these ids are also used inside url(#...).
 */
const useArtId = () => `ca${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

// ---------------------------------------------------------------------------
// The scene.
// ---------------------------------------------------------------------------

function Scene({
  look = NEUTRAL,
  lamp = DEFAULT_LAMP,
  stock,
  glass,
  /** Camera path drawn over the scene. */
  glyph,
  /** Anything drawn on top of the finished frame, in the same 100x75 space. */
  overlay,
}: {
  look?: Look;
  lamp?: Lamp;
  stock?: Stock;
  glass?: Glass;
  glyph?: MoveGlyph;
  overlay?: React.ReactNode;
}) {
  const uid = useArtId();
  const g = glass ?? {};
  const s = stock ?? {};
  const zoom = g.zoom ?? 1;
  const bokeh = g.bokeh ?? 0.35;
  const horizon = 44;

  const filters: string[] = [];
  if (s.sat !== undefined && s.sat !== 1) filters.push(`saturate(${s.sat})`);
  if (s.contrast) filters.push(`contrast(${s.contrast})`);
  if (s.blur) filters.push(`blur(${s.blur}px)`);
  if (s.falseColor === "night") filters.push("grayscale(1) sepia(1) hue-rotate(60deg) saturate(6) brightness(1.15)");
  if (s.falseColor === "thermal") filters.push("grayscale(1) sepia(1) hue-rotate(-30deg) saturate(7) contrast(1.4)");

  // Fisheye and friends bow the reference grid; the amount is the distortion.
  const bow = (g.barrel ?? 0) * 16;
  const grid = [18, 34, 50, 66, 82].map((x) => {
    const k = (x - 50) / 50;
    return `M${x + k * bow * 0.5} 0 Q${x + k * bow * 1.6} ${horizon / 2} ${x + k * bow * 0.5} ${horizon}`;
  });

  return (
    <svg viewBox="0 0 100 75" className="h-full w-full" aria-hidden preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`${uid}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={look.sky} />
          <stop offset="100%" stopColor={look.horizon} />
        </linearGradient>
        <linearGradient id={`${uid}gnd`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={look.horizon} stopOpacity="0.55" />
          <stop offset="35%" stopColor={look.ground} />
          <stop offset="100%" stopColor={look.ground} stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id={`${uid}lamp`}>
          <stop offset="0%" stopColor={lamp.color} stopOpacity="0.95" />
          <stop offset="55%" stopColor={lamp.color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={lamp.color} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}vig`}>
          <stop offset="55%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity={s.vignette ?? 0} />
        </radialGradient>
        <filter id={`${uid}bg`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation={bokeh} />
        </filter>
        <filter id={`${uid}soft`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={(g.glow ?? 0) * 4} />
        </filter>
        {g.band && (
          <linearGradient id={`${uid}band`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="1" />
            <stop offset="38%" stopColor="#fff" stopOpacity="0" />
            <stop offset="62%" stopColor="#fff" stopOpacity="0" />
            <stop offset="100%" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
        )}
        {g.band && (
          <mask id={`${uid}bandm`}>
            <rect width="100" height="75" fill={`url(#${uid}band)`} />
          </mask>
        )}
        {g.smear && (
          <radialGradient id={`${uid}smear`}>
            <stop offset="35%" stopColor="#fff" stopOpacity="0" />
            <stop offset="100%" stopColor="#fff" stopOpacity="1" />
          </radialGradient>
        )}
        {g.smear && (
          <mask id={`${uid}smearm`}>
            <rect width="100" height="75" fill={`url(#${uid}smear)`} />
          </mask>
        )}
      </defs>

      <g style={filters.length ? { filter: filters.join(" ") } : undefined}>
        {/* Sky and ground, blurred by however open the lens is. */}
        <g filter={bokeh > 0.4 ? `url(#${uid}bg)` : undefined}>
          <rect width="100" height={horizon} fill={`url(#${uid}sky)`} />
          <rect y={horizon} width="100" height={75 - horizon} fill={`url(#${uid}gnd)`} />
          {bow > 0.5 && (
            <g stroke={look.sky} strokeOpacity="0.35" strokeWidth="0.6" fill="none">
              {grid.map((d, i) => (
                <path key={i} d={d} />
              ))}
              <path d={`M0 ${horizon - 14} Q50 ${horizon - 14 - bow} 100 ${horizon - 14}`} />
            </g>
          )}
          <circle cx={lamp.x} cy={lamp.y} r={lamp.r} fill={`url(#${uid}lamp)`} />
          {g.ovals && (
            <g fill={lamp.color} opacity="0.3">
              <ellipse cx={lamp.x + 22} cy={lamp.y + 8} rx="5.5" ry="3" />
              <ellipse cx={lamp.x + 34} cy={lamp.y + 14} rx="3.5" ry="2" />
            </g>
          )}
          {g.swirl && (
            <g stroke={lamp.color} strokeOpacity="0.28" strokeWidth="1.4" fill="none">
              <path d="M6 10 Q2 38 14 62" />
              <path d="M94 10 Q98 38 86 62" />
            </g>
          )}
        </g>

        {/* The figure, and the shadow the light throws. */}
        <g transform={`translate(50 ${horizon + 2}) scale(${zoom}) translate(-50 -${horizon + 2})`}>
          <ellipse
            cx={62 + (62 - lamp.x) * 0.06}
            cy="66"
            rx={7 + Math.abs(62 - lamp.x) * 0.03}
            ry="1.8"
            fill="#000"
            opacity={0.25 + (1 - lamp.fill) * 0.2}
          />
          <g fill={look.subject}>
            <circle cx="62" cy="43" r="3.6" />
            <path d="M58 66V51a4 4 0 0 1 8 0v15Z" />
          </g>
          {lamp.fill > 0.05 && (
            <g fill={lamp.color} opacity={lamp.fill * 0.55} clipPath="none">
              <circle cx={62 - Math.sign(62 - lamp.x) * 1.2} cy="42.4" r="2.4" />
              <path d={`M${62 - Math.sign(62 - lamp.x) * 2.6} 65V52a2.4 2.4 0 0 1 4.8 0v13Z`} />
            </g>
          )}
        </g>

        {/* The foreground post — what a rack focus racks to. */}
        <g filter={g.foreBlur === 0 || g.seam ? undefined : `url(#${uid}bg)`} opacity="0.95">
          <rect x="9" y="30" width="6" height="45" rx="1" fill={look.subject} opacity="0.85" />
        </g>
        {g.seam && <line x1="50" y1="0" x2="50" y2="75" stroke={look.sky} strokeOpacity="0.4" strokeWidth="0.8" />}

        {g.warm && <rect width="100" height="75" fill="#ff9d4a" opacity={g.warm} />}
        {g.glow ? (
          <circle cx={lamp.x} cy={lamp.y} r={lamp.r * 1.6} fill={lamp.color} opacity={g.glow * 0.5} filter={`url(#${uid}soft)`} />
        ) : null}
        {g.streak && (
          <rect x="0" y={lamp.y - 0.8} width="100" height="1.6" fill={g.streak} opacity="0.5" filter={`url(#${uid}soft)`} />
        )}
        {lamp.dim ? <rect width="100" height="75" fill="#04060c" opacity={lamp.dim} /> : null}
        {s.tint && <rect width="100" height="75" fill={s.tint} opacity={s.tintAlpha ?? 0.12} />}
      </g>

      {/* The tells that sit on top of the image rather than in it. */}
      {g.band && <rect width="100" height="75" fill="#000" opacity="0.001" mask={`url(#${uid}bandm)`} />}
      {s.scan ? (
        <g fill="#000" opacity={s.scan}>
          {Array.from({ length: 25 }, (_, i) => (
            <rect key={i} y={i * 3} width="100" height="1.1" />
          ))}
        </g>
      ) : null}
      {s.grain ? (
        <g fill="#fff" opacity={s.grain * 0.5}>
          {Array.from({ length: 34 }, (_, i) => (
            <rect key={i} x={(i * 37) % 99} y={(i * 53) % 74} width="0.9" height="0.9" opacity={(i % 5) / 4} />
          ))}
        </g>
      ) : null}
      {s.vignette ? <rect width="100" height="75" fill={`url(#${uid}vig)`} /> : null}
      {s.stamp && (
        <text x="94" y="70" textAnchor="end" fontSize="5" fill="#fff" opacity="0.8" fontFamily="monospace">
          {s.stamp}
        </text>
      )}
      {glyph && <MovePath glyph={glyph} />}
      {overlay}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The camera path drawn over the scene. `.ca-move` in globals.css runs the dash
// along the path while the tile is hovered or focused.
// ---------------------------------------------------------------------------

/** glyph → [path, arrow rotation at the end, where the arrow lands]. */
const PATHS: Record<MoveGlyph, { d: string; head: [number, number, number] }> = {
  push: { d: "M50 70 L50 50", head: [50, 48, -90] },
  pull: { d: "M50 50 L50 70", head: [50, 72, 90] },
  "pan-l": { d: "M74 60 Q50 52 26 60", head: [24, 60, 200] },
  "pan-r": { d: "M26 60 Q50 52 74 60", head: [76, 60, -20] },
  "tilt-u": { d: "M50 68 Q44 50 50 32", head: [50, 30, -80] },
  "tilt-d": { d: "M50 32 Q44 50 50 68", head: [50, 70, 80] },
  "truck-l": { d: "M72 62 L28 62", head: [26, 62, 180] },
  "truck-r": { d: "M28 62 L72 62", head: [74, 62, 0] },
  "boom-u": { d: "M50 68 L50 24", head: [50, 22, -90] },
  "boom-d": { d: "M50 24 L50 68", head: [50, 70, 90] },
  "arc-l": { d: "M76 66 Q50 44 24 66", head: [22, 66, 210] },
  "arc-r": { d: "M24 66 Q50 44 76 66", head: [78, 66, -30] },
  orbit: { d: "M18 56 A32 13 0 1 0 82 56 A32 13 0 1 0 18 56", head: [18, 58, 100] },
  focus: { d: "M16 52 Q38 40 60 46", head: [62, 46, -12] },
  hold: { d: "M34 38 H66 M34 38 V62 M66 38 V62 M34 62 H66", head: [50, 50, 0] },
  shake: { d: "M30 60 l8 -5 l7 6 l8 -6 l7 5 l8 -4", head: [70, 56, -25] },
  top: { d: "M50 18 L50 58", head: [50, 60, 90] },
  pov: { d: "M50 70 Q42 52 50 40 Q58 52 50 70", head: [50, 38, -90] },
  roll: { d: "M24 52 Q50 36 76 60", head: [78, 61, 38] },
  snap: { d: "M50 72 L50 46", head: [50, 43, -90] },
};

function MovePath({ glyph }: { glyph: MoveGlyph }) {
  const p = PATHS[glyph];
  const [hx, hy, rot] = p.head;
  return (
    <g className="ca-move">
      <path d={p.d} className="ca-move-track" />
      <path d={p.d} className="ca-move-run" />
      {glyph !== "hold" && (
        <path d="M-3.4 -2.6 L0 0 L-3.4 2.6" className="ca-move-head" transform={`translate(${hx} ${hy}) rotate(${rot})`} />
      )}
      {glyph === "focus" && <circle cx="62" cy="46" r="4" className="ca-move-ring" />}
    </g>
  );
}

// ---------------------------------------------------------------------------
// The iris — the one tile that is a diagram rather than a photograph, because
// an aperture is a mechanism and drawing the mechanism is clearer than showing
// its effect twice.
// ---------------------------------------------------------------------------

function Iris({ f }: { f: number }) {
  // f/1.4 opens nearly to the rim; f/22 closes to a pinhole. `open` is how far
  // the blades are withdrawn, so it drives the hole's radius directly.
  const open = f === 0 ? 0.55 : Math.max(0.08, Math.min(0.92, 1 - Math.log2(f / 1.4) / 5.2));
  const R = 30;
  const r = R * (0.1 + open * 0.78);
  // Rounded, because Node and the browser do not agree on the last digit of a
  // trig result: unrounded, every blade path mismatched on hydration.
  const at = (angle: number, radius: number) =>
    `${(50 + Math.cos(angle) * radius).toFixed(3)} ${(50 + Math.sin(angle) * radius).toFixed(3)}`;
  const blades = Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3;
    const b = a + Math.PI / 3;
    return `M${at(a, R)} L${at(a, r)} L${at(b, r)} L${at(b, R)} Z`;
  });
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="ca-iris-in">
          <stop offset="0%" stopColor="#fff6dc" />
          <stop offset="100%" stopColor="#ffbe5c" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r={R + 4} fill="#0c0e14" />
      <circle cx="50" cy="50" r={r} fill="url(#ca-iris-in)" />
      <g fill="#1f2330" stroke="#2f3547" strokeWidth="0.8" strokeLinejoin="round">
        {blades.map((d, i) => (
          <path key={i} d={d} opacity={i % 2 ? 0.94 : 1} />
        ))}
      </g>
      <circle cx="50" cy="50" r={R + 4} fill="none" stroke="#394054" strokeWidth="1.4" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Genre and era have no literal picture, but they do have a visual language,
// and it is the same language the option's `prompt` describes. So each one
// renders the test scene the way that genre or decade would actually shoot it:
// noir gets the hard key and the crushed blacks it asks for, the 1980s get neon
// through smoke, the 1990s get the camcorder. Tile and prompt agree.
// ---------------------------------------------------------------------------

interface SceneSpec {
  look?: Look;
  lamp?: Lamp;
  stock?: Stock;
  glass?: Glass;
}

const SCENES: Record<string, SceneSpec> = {
  // Genre
  "genre-horror": { look: LOOKS["grade-moonlit"], lamp: { x: 78, y: 62, r: 6, color: "#9fd3c0", fill: 0.12, dim: 0.6 }, stock: { grain: 0.3, vignette: 0.5 } },
  "genre-noir": { look: LOOKS["grade-high-con-mono"], lamp: { x: 18, y: 14, r: 5, color: "#ffffff", fill: 0.2, dim: 0.3 }, stock: { contrast: 1.4, grain: 0.22, vignette: 0.4 } },
  "genre-thriller": { look: LOOKS["grade-steel"], lamp: { x: 22, y: 20, r: 8, color: "#dfe8ef", fill: 0.22, dim: 0.28 }, glass: { zoom: 1.9, bokeh: 1.4 } },
  "genre-scifi": { look: LOOKS["grade-duotone"], lamp: { x: 50, y: 18, r: 20, color: "#8fb6ff", fill: 0.35, dim: 0.2 }, glass: { zoom: 0.7, barrel: 0.12 } },
  "genre-fantasy": { look: LOOKS["grade-golden"], lamp: { x: 34, y: 12, r: 15, color: "#ffe6a8", fill: 0.45 }, glass: { glow: 0.4, bokeh: 0.9 } },
  "genre-action": { look: LOOKS["grade-teal-orange"], lamp: { x: 70, y: 26, r: 10, color: "#ffb266", fill: 0.4 }, stock: { contrast: 1.2, grain: 0.2 }, glass: { streak: "#ffb266", glow: 0.2 } },
  "genre-western": { look: LOOKS["grade-earth"], lamp: { x: 14, y: 36, r: 12, color: "#ffd98a", fill: 0.35 }, glass: { zoom: 0.75 }, stock: { grain: 0.2 } },
  "genre-romance": { look: LOOKS["grade-pastel"], lamp: { x: 22, y: 28, r: 18, color: "#ffe2ea", fill: 0.7 }, glass: { bokeh: 1.4, glow: 0.4, zoom: 1.5 } },
  "genre-comedy": { look: LOOKS["grade-natural"], lamp: { x: 50, y: 14, r: 34, color: "#ffffff", fill: 0.85 }, stock: { sat: 1.2 } },
  "genre-doc": { look: LOOKS["grade-faded"], lamp: { x: 40, y: 18, r: 24, color: "#e6e2d6", fill: 0.6 }, stock: { grain: 0.3, sat: 0.9 }, glass: { zoom: 0.85 } },
  "genre-music-video": { look: LOOKS["grade-circus"], lamp: { x: 62, y: 30, r: 16, color: "#ff3d6a", fill: 0.5, dim: 0.25 }, glass: { streak: "#3fd0e8", glow: 0.3 } },
  "genre-anime": { look: LOOKS["grade-technicolor"], lamp: { x: 28, y: 16, r: 12, color: "#fff7a0", fill: 0.6 }, stock: { sat: 1.3, contrast: 1.25 } },
  "genre-war": { look: LOOKS["grade-industrial"], lamp: { x: 56, y: 22, r: 22, color: "#cfd3c6", fill: 0.35, dim: 0.2 }, stock: { grain: 0.35, sat: 0.55, contrast: 1.15 } },
  "genre-heist": { look: LOOKS["grade-overtime"], lamp: { x: 30, y: 16, r: 9, color: "#eed394", fill: 0.35, dim: 0.3 }, glass: { zoom: 1.3 } },
  "genre-supernatural": { look: LOOKS["grade-infrared"], lamp: { x: 66, y: 56, r: 10, color: "#ff9ecf", fill: 0.3, dim: 0.45 }, stock: { grain: 0.25 } },
  "genre-sports": { look: LOOKS["grade-kodachrome"], lamp: { x: 74, y: 12, r: 8, color: "#ffffff", fill: 0.5 }, glass: { zoom: 2.4, bokeh: 1.8, streak: "#ffe9bd" } },

  // Era
  "era-1920s": { look: LOOKS["grade-mono"], stock: { grain: 0.55, vignette: 0.55, contrast: 1.3 }, glass: { zoom: 0.9 } },
  "era-1940s": { look: LOOKS["grade-high-con-mono"], lamp: { x: 26, y: 16, r: 6, color: "#ffffff", fill: 0.35, dim: 0.2 }, stock: { grain: 0.2, vignette: 0.25 } },
  "era-1950s": { look: LOOKS["grade-technicolor"], lamp: { x: 40, y: 16, r: 20, color: "#fff7a0", fill: 0.7 }, stock: { sat: 1.3 } },
  "era-1960s": { look: LOOKS["grade-faded"], stock: { grain: 0.35, sat: 0.85 }, glass: { zoom: 0.8 } },
  "era-1970s": { look: LOOKS["grade-golden"], stock: { grain: 0.4, vignette: 0.3, sat: 0.95 }, glass: { streak: "#ffb266", glow: 0.25, warm: 0.12 } },
  "era-retro-future": { look: LOOKS["grade-earth"], lamp: { x: 60, y: 20, r: 14, color: "#ffb347", fill: 0.45 }, stock: { grain: 0.3, sat: 1.1 }, glass: { barrel: 0.2, zoom: 0.8 } },
  "era-1980s": { look: LOOKS["grade-neon-noir"], lamp: { x: 74, y: 32, r: 14, color: "#ff3dcd", fill: 0.4, dim: 0.3 }, glass: { streak: "#5aa8ff", ovals: true, glow: 0.25 } },
  "era-1990s": { look: LOOKS["grade-natural"], stock: STOCKS["cam-vhs"] },
  "era-2000s": { look: LOOKS["grade-teal-orange"], stock: { scan: 0.15, contrast: 1.2, sat: 0.9 } },
  "era-2010s": { look: LOOKS["grade-faded"], glass: { zoom: 1.6, bokeh: 1.5 }, stock: { contrast: 0.9 } },
  "era-present": { look: LOOKS["grade-natural"], stock: { sat: 1.05 } },
  "era-near-future": { look: LOOKS["grade-steel"], lamp: { x: 50, y: 16, r: 22, color: "#cfe0ff", fill: 0.5 }, glass: { zoom: 0.85 } },
  "era-far-future": { look: LOOKS["grade-duotone"], lamp: { x: 50, y: 26, r: 26, color: "#7a6ae0", fill: 0.4, dim: 0.2 }, glass: { zoom: 0.6, barrel: 0.15 } },
};

/**
 * "Auto" on any rail: no picture is being claimed, so the tile shows a smear of
 * every look rather than pretending to one of them.
 */
function AutoArt() {
  return (
    <svg viewBox="0 0 100 75" className="h-full w-full" aria-hidden preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="ca-auto-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4a6fb5" />
          <stop offset="30%" stopColor="#e8a06a" />
          <stop offset="55%" stopColor="#f2e3cf" />
          <stop offset="78%" stopColor="#7a6ae0" />
          <stop offset="100%" stopColor="#e2704f" />
        </linearGradient>
        <linearGradient id="ca-auto-b" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#0d1424" stopOpacity="0.85" />
          <stop offset="45%" stopColor="#ffd6a8" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#12203a" stopOpacity="0.8" />
        </linearGradient>
      </defs>
      <rect width="100" height="75" fill="url(#ca-auto-a)" />
      <rect width="100" height="75" fill="url(#ca-auto-b)" />
      {/* The vertical smear that reads as "not decided yet". */}
      <g fill="#000" opacity="0.16">
        {Array.from({ length: 50 }, (_, i) => (
          <rect key={i} x={i * 2} y="0" width={0.5 + (i % 4) * 0.22} height="75" />
        ))}
      </g>
    </svg>
  );
}

/**
 * Tempo: the only honest picture of pacing is the pacing itself, so the tile
 * carries the cut rhythm — one bar per shot, at its real relative length.
 */
function CutRhythm({ cuts }: { cuts: number[] }) {
  let x = 0;
  const gap = cuts.length > 1 ? Math.min(1.4, 8 / cuts.length) : 0;
  const span = 96 - gap * (cuts.length - 1);
  const total = cuts.reduce((a, b) => a + b, 0) || 1;
  return (
    <g>
      <rect x="2" y="67.4" width="96" height="4" rx="2" fill="#000" opacity="0.45" />
      {cuts.map((c, i) => {
        const w = (c / total) * span;
        const bar = (
          <rect key={i} x={2 + x} y="68.4" width={Math.max(0.8, w)} height="2" rx="1" fill="var(--color-accent)" />
        );
        x += w + gap;
        return bar;
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Style is the one rail that cannot be shown by adjusting a photograph, because
// it replaces the medium. So the same composition — horizon, sun, figure, post —
// is REDRAWN in each technique: cut into paper, stepped into pixels, inked,
// faceted into polygons, painted. Seven ways of drawing one scene.
// ---------------------------------------------------------------------------

type Technique = "flat" | "paper" | "pixel" | "ink" | "poly" | "paint" | "glow" | "photo";

interface StyleSpec {
  t: Technique;
  look: Look;
  /** Ink and outline colour, where the technique uses one. */
  line?: string;
}

const L = LOOKS;

const STYLES: Record<string, StyleSpec> = {
  // Animation
  "style-cel-anime": { t: "flat", look: L["grade-technicolor"], line: "#1a1630" },
  "style-anime-film": { t: "paint", look: L["grade-natural"] },
  "style-saturday-cartoon": { t: "flat", look: L["grade-circus"], line: "#120a0a" },
  "style-cgi-family": { t: "photo", look: L["grade-pastel"] },
  "style-cutout-satire": { t: "paper", look: L["grade-earth"] },
  "style-rotoscope": { t: "flat", look: L["grade-faded"], line: "#2a2622" },
  "style-motion-comic": { t: "ink", look: L["grade-kodachrome"], line: "#0d0b0a" },

  // Game
  "style-papercraft": { t: "paper", look: L["grade-technicolor"] },
  "style-kart-racer": { t: "flat", look: L["grade-tropic"], line: "#07281a" },
  "style-pixel-16bit": { t: "pixel", look: L["grade-technicolor"] },
  "style-low-poly-ps1": { t: "poly", look: L["grade-faded"] },
  "style-voxel": { t: "pixel", look: L["grade-natural"] },
  "style-aaa-cinematic": { t: "photo", look: L["grade-teal-orange"] },
  "style-isometric-sim": { t: "flat", look: L["grade-pastel"], line: "#5b5068" },
  "style-fighting-game": { t: "flat", look: L["grade-neon-noir"], line: "#07030f" },

  // Craft
  "style-claymation": { t: "photo", look: L["grade-earth"] },
  "style-puppet-satire": { t: "photo", look: L["grade-overtime"] },
  "style-felt-stopmo": { t: "paint", look: L["grade-golden"] },
  "style-brick-built": { t: "pixel", look: L["grade-circus"] },
  "style-diorama": { t: "photo", look: L["grade-natural"] },
  "style-marionette": { t: "photo", look: L["grade-sepia"] },

  // Illustration
  "style-comic-inks": { t: "ink", look: L["grade-kodachrome"], line: "#090707" },
  "style-manga": { t: "ink", look: L["grade-mono"], line: "#000000" },
  "style-watercolour": { t: "paint", look: L["grade-pastel"] },
  "style-storybook": { t: "paint", look: L["grade-golden"] },
  "style-oil-painting": { t: "paint", look: L["grade-earth"] },
  "style-woodcut": { t: "ink", look: L["grade-sepia"], line: "#120b04" },
  "style-pencil-sketch": { t: "ink", look: L["grade-faded"], line: "#3a3733" },
  "style-collage": { t: "paper", look: L["grade-faded"] },

  // Film movements
  "style-folk-horror": { t: "photo", look: L["grade-earth"] },
  "style-giallo": { t: "photo", look: L["grade-circus"] },
  "style-mockumentary": { t: "photo", look: L["grade-industrial"] },
  "style-found-footage": { t: "photo", look: L["grade-moonlit"] },
  "style-silent-slapstick": { t: "photo", look: L["grade-high-con-mono"] },
  "style-wuxia": { t: "paint", look: L["grade-tropic"] },

  // Graphic
  "style-vaporwave": { t: "glow", look: L["grade-neon-noir"] },
  "style-blueprint": { t: "glow", look: L["grade-duotone"] },
  "style-xray": { t: "glow", look: L["grade-moonlit"] },
  "style-silhouette": { t: "flat", look: L["grade-golden"], line: "#000000" },
  "style-neon-outline": { t: "glow", look: L["grade-neon-noir"] },
};

/** The photographic fallbacks reuse the ordinary scene, graded. */
const STYLE_STOCK: Record<string, Stock> = {
  "style-claymation": { blur: 0.35, sat: 1.1, contrast: 0.95 },
  "style-puppet-satire": { contrast: 1.2, vignette: 0.3 },
  "style-diorama": { blur: 0.9, sat: 1.15 },
  "style-marionette": { grain: 0.3, vignette: 0.45 },
  "style-folk-horror": { grain: 0.45, vignette: 0.35, sat: 0.9 },
  "style-giallo": { sat: 1.35, contrast: 1.2 },
  "style-mockumentary": { sat: 0.85, contrast: 0.9 },
  "style-found-footage": { scan: 0.3, blur: 0.4, vignette: 0.55 },
  "style-silent-slapstick": { grain: 0.5, vignette: 0.5, contrast: 1.35 },
  "style-cgi-family": { sat: 1.15 },
  "style-aaa-cinematic": { contrast: 1.15, sat: 1.05 },
};

/** The scene, redrawn. One component, seven techniques. */
function StyleArt({ id }: { id: string }) {
  // Hoisted above every early return: it is a hook now, not a counter.
  const uid = useArtId();
  const spec = STYLES[id];
  if (!spec) return <Scene />;
  const { t, look, line } = spec;
  if (t === "photo") return <Scene look={look} stock={STYLE_STOCK[id]} />;

  const horizon = 44;

  // Pixel and voxel: the whole scene stepped onto a coarse grid.
  if (t === "pixel") {
    const cell = 5;
    const cols = Math.ceil(100 / cell);
    const rows = Math.ceil(75 / cell);
    const blocks: React.ReactNode[] = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = c * cell;
        const y = r * cell;
        const below = y >= horizon;
        // Sun, figure and post, snapped to whole cells.
        const inSun = Math.hypot(x + cell / 2 - 28, y + cell / 2 - 18) < 11;
        const inPost = x >= 10 && x < 20 && y >= 30;
        const inBody = x >= 55 && x < 70 && y >= 40 && y < 65;
        const fill = inPost
          ? look.subject
          : inBody
            ? look.subject
            : inSun && !below
              ? look.sun
              : below
                ? look.ground
                : look.sky;
        blocks.push(
          <rect
            key={`${r}-${c}`}
            x={x}
            y={y}
            width={cell}
            height={cell}
            fill={fill}
            opacity={below && !inPost && !inBody ? 0.75 + ((r + c) % 3) * 0.12 : 1}
          />,
        );
      }
    }
    return (
      <svg viewBox="0 0 100 75" className="h-full w-full" aria-hidden preserveAspectRatio="xMidYMid slice">
        {blocks}
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 100 75" className="h-full w-full" aria-hidden preserveAspectRatio="xMidYMid slice">
      <defs>
        {t === "paint" && (
          <filter id={`${uid}wet`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="3" seed="4" />
            <feDisplacementMap in="SourceGraphic" scale="6" />
            <feGaussianBlur stdDeviation="0.6" />
          </filter>
        )}
        {t === "glow" && (
          <filter id={`${uid}glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
        {t === "paper" && (
          <filter id={`${uid}drop`} x="-20%" y="-20%" width="150%" height="150%">
            <feDropShadow dx="0.8" dy="1.4" stdDeviation="0.7" floodOpacity="0.45" />
          </filter>
        )}
      </defs>

      {/* Ground and sky: flat bands, because none of these techniques blends. */}
      <rect width="100" height={horizon} fill={t === "glow" ? "#05040f" : look.sky} />
      <rect y={horizon} width="100" height={75 - horizon} fill={t === "glow" ? "#080617" : look.ground} />

      <g filter={t === "paint" ? `url(#${uid}wet)` : t === "glow" ? `url(#${uid}glow)` : undefined}>
        {t === "glow" ? (
          <g fill="none" stroke={look.sun} strokeWidth="1.3" strokeLinecap="round">
            {/* A horizon grid, the one thing every glowing technique draws. */}
            <path d={`M0 ${horizon}H100`} />
            {[16, 32, 50, 68, 84].map((x, i) => (
              <path key={i} d={`M${x} ${horizon}L${(x - 50) * 3 + 50} 75`} />
            ))}
            {[52, 60, 72].map((y, i) => (
              <path key={i} d={`M0 ${y}H100`} opacity={0.7 - i * 0.15} />
            ))}
            <circle cx="28" cy="20" r="10" stroke={look.horizon} />
            <rect x="10" y="30" width="6" height="45" />
            <circle cx="62" cy="43" r="3.6" />
            <path d="M58 66V51a4 4 0 0 1 8 0v15Z" />
          </g>
        ) : (
          <>
            {/* Sun */}
            <circle
              cx="28"
              cy="18"
              r={t === "paper" ? 9 : 10}
              fill={look.sun}
              filter={t === "paper" ? `url(#${uid}drop)` : undefined}
              stroke={t === "ink" ? line : undefined}
              strokeWidth={t === "ink" ? 0.9 : undefined}
            />
            {/* A hill, so paper and polygon have an edge to show off. */}
            {t === "poly" ? (
              <g>
                <path d={`M0 ${horizon}L26 ${horizon - 9}L54 ${horizon + 3}L78 ${horizon - 6}L100 ${horizon + 2}V75H0Z`} fill={look.ground} />
                <path d={`M26 ${horizon - 9}L54 ${horizon + 3}L40 75H8Z`} fill={look.horizon} opacity="0.35" />
                <path d={`M78 ${horizon - 6}L100 ${horizon + 2}V75H70Z`} fill={look.sky} opacity="0.2" />
              </g>
            ) : (
              <path
                d={`M0 ${horizon + 6}Q30 ${horizon - 6} 60 ${horizon + 4}T100 ${horizon}V75H0Z`}
                fill={look.horizon}
                opacity={t === "paint" ? 0.8 : 0.55}
                filter={t === "paper" ? `url(#${uid}drop)` : undefined}
                stroke={t === "ink" ? line : undefined}
                strokeWidth={t === "ink" ? 0.9 : undefined}
              />
            )}
            {/* Post */}
            <rect
              x="10"
              y="30"
              width="6"
              height="45"
              fill={look.subject}
              filter={t === "paper" ? `url(#${uid}drop)` : undefined}
              stroke={t === "ink" ? line : undefined}
              strokeWidth={t === "ink" ? 0.9 : undefined}
            />
            {/* Figure */}
            <g
              fill={look.subject}
              filter={t === "paper" ? `url(#${uid}drop)` : undefined}
              stroke={t === "ink" ? line : undefined}
              strokeWidth={t === "ink" ? 0.9 : undefined}
            >
              {t === "poly" ? (
                <>
                  <path d="M62 39l4 3-1.4 4h-5.2L58 42Z" />
                  <path d="M58 66l1.6-14L62 50l2.4 2L66 66Z" />
                </>
              ) : (
                <>
                  <circle cx="62" cy="43" r="3.6" />
                  <path d="M58 66V51a4 4 0 0 1 8 0v15Z" />
                </>
              )}
            </g>
            {/* The ink techniques hatch their shadows rather than shading them. */}
            {t === "ink" && (
              <g stroke={line} strokeWidth="0.55" opacity="0.65">
                {Array.from({ length: 13 }, (_, i) => (
                  <path key={i} d={`M${66 + i * 2.4} ${50 + i * 1.6}l6 -7`} />
                ))}
                {Array.from({ length: 9 }, (_, i) => (
                  <path key={`b${i}`} d={`M${2 + i * 3} ${68 + (i % 2) * 2}h7`} />
                ))}
              </g>
            )}
          </>
        )}
      </g>

      {/* Paper keeps its fold crease; nothing else does. */}
      {t === "paper" && (
        <g stroke="#000" strokeOpacity="0.16" strokeWidth="0.5">
          <path d="M34 0V75M72 0V75" />
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// One entry point: what should this option's tile show?
// ---------------------------------------------------------------------------

/**
 * Options with a rendered frame in `public/studio/cinema/<id>.webp` — the same
 * test scene below, photographed once per option with only that option changed,
 * by the preview-icon skill's `cinema-tiles.mjs`.
 *
 * A photograph of the scene beats a drawing of it for everything the deck is
 * actually asking you to compare — stock, glass, stop, grade, light, genre,
 * decade, medium. It cannot beat the drawing for the two rails that are not
 * pictures at all: Tempo is cut rhythm and Movement is a camera path, so those
 * stay drawn and are deliberately absent from this list.
 *
 * Listed rather than derived from the id, so a tile never points at a file that
 * is not there; anything unlisted keeps its SVG.
 */
export const TILE_PHOTOS = new Set<string>([
  "genre-horror", "genre-noir", "genre-thriller",
  "genre-scifi", "genre-fantasy", "genre-action",
  "genre-western", "genre-romance", "genre-comedy",
  "genre-doc", "genre-music-video", "genre-anime",
  "genre-war", "genre-heist", "genre-supernatural",
  "genre-sports", "era-1920s", "era-1940s",
  "era-1950s", "era-1960s", "era-1970s",
  "era-retro-future", "era-1980s", "era-1990s",
  "era-2000s", "era-2010s", "era-present",
  "era-near-future", "era-far-future", "cam-modern",
  "cam-35mm", "cam-super16", "cam-8mm",
  "cam-imax", "cam-vhs", "cam-hi8",
  "cam-dv", "cam-dslr", "cam-phone",
  "cam-webcam", "cam-cctv", "cam-bodycam",
  "cam-drone", "cam-polaroid", "cam-bolex",
  "cam-thermal", "cam-nightvision", "lens-anamorphic",
  "lens-anamorphic-modern", "lens-warm-vintage", "lens-halation",
  "lens-wide-24", "lens-ultrawide", "lens-fisheye",
  "lens-normal-50", "lens-portrait-85", "lens-tele-135",
  "lens-long-300", "lens-macro", "lens-probe",
  "lens-tilt-shift", "lens-petzval", "lens-diffusion",
  "lens-split-diopter", "lens-smeared", "ap-f14",
  "ap-f2", "ap-f28", "ap-f56",
  "ap-f11", "ap-f22", "style-cel-anime",
  "style-anime-film", "style-saturday-cartoon", "style-cgi-family",
  "style-cutout-satire", "style-rotoscope", "style-motion-comic",
  "style-papercraft", "style-kart-racer", "style-pixel-16bit",
  "style-low-poly-ps1", "style-voxel", "style-aaa-cinematic",
  "style-isometric-sim", "style-fighting-game", "style-claymation",
  "style-puppet-satire", "style-felt-stopmo", "style-brick-built",
  "style-diorama", "style-marionette", "style-comic-inks",
  "style-manga", "style-watercolour", "style-storybook",
  "style-oil-painting", "style-woodcut", "style-pencil-sketch",
  "style-collage", "style-folk-horror", "style-giallo",
  "style-mockumentary", "style-found-footage", "style-silent-slapstick",
  "style-wuxia", "style-vaporwave", "style-blueprint",
  "style-xray", "style-silhouette", "style-neon-outline",
  "grade-natural", "grade-teal-orange", "grade-bleach",
  "grade-kodachrome", "grade-golden", "grade-mono",
  "grade-high-con-mono", "grade-sepia", "grade-neon-noir",
  "grade-pastel", "grade-steel", "grade-technicolor",
  "grade-faded", "grade-infrared", "grade-duotone",
  "grade-moonlit", "grade-earth", "grade-gasoline",
  "grade-tropic", "grade-industrial", "grade-overtime",
  "grade-circus", "light-window", "light-golden-hour",
  "light-blue-hour", "light-overcast", "light-hard-noon",
  "light-neon", "light-firelight", "light-candlelight",
  "light-moonlight", "light-softbox", "light-rembrandt",
  "light-silhouette", "light-toplight", "light-underlight",
  "light-strobe", "light-caustics", "light-bulb",
  "light-headlights", "light-screen",
]);

function TilePhoto({ id }: { id: string }) {
  return (
    <img
      src={`/studio/cinema/${id}.webp`}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
    />
  );
}

export function OptionArt({
  railId,
  optionId,
  cuts,
}: {
  railId: string;
  optionId: string;
  cuts?: number[];
}) {
  if (optionId.endsWith("-auto")) return <AutoArt />;
  if (TILE_PHOTOS.has(optionId)) return <TilePhoto id={optionId} />;
  if (railId === "aperture") return <Iris f={F_STOPS[optionId] ?? 0} />;
  if (railId === "body") return <Scene stock={STOCKS[optionId]} />;
  if (railId === "lens") return <Scene glass={GLASSES[optionId]} />;
  if (railId === "light") return <Scene lamp={LAMPS[optionId] ?? DEFAULT_LAMP} />;
  if (railId === "grade") return <Scene look={LOOKS[optionId] ?? NEUTRAL} />;
  if (railId === "genre" || railId === "era") {
    const spec = SCENES[optionId] ?? {};
    return <Scene look={spec.look} lamp={spec.lamp} stock={spec.stock} glass={spec.glass} />;
  }
  if (railId === "tempo") return <Scene overlay={cuts && cuts.length ? <CutRhythm cuts={cuts} /> : null} />;
  if (railId === "style") return <StyleArt id={optionId} />;
  return null;
}

/** Do this rail's tiles carry artwork, or are they typographic rows? */
export function railHasArt(railId: string): boolean {
  return ["aperture", "body", "lens", "light", "grade", "genre", "era", "tempo", "style"].includes(railId);
}

export function MoveArt({ glyph }: { glyph: MoveGlyph }) {
  return <Scene glyph={glyph} />;
}

/**
 * The thumbnail on a composer chip. It shows the owner's actual choice once
 * they have made one; until then it shows a representative of that control,
 * dimmed, so an untouched chip still says what it is for rather than going
 * blank or repeating the same "nothing set" smear five times in a row.
 */
export const CHIP_PREVIEW: Record<string, { railId: string; optionId: string }> = {
  film: { railId: "tempo", optionId: "tempo-dynamic" },
  camera: { railId: "aperture", optionId: "ap-f28" },
  style: { railId: "style", optionId: "style-papercraft" },
  color: { railId: "grade", optionId: "grade-teal-orange" },
  lighting: { railId: "light", optionId: "light-window" },
};
