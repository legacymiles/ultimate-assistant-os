import * as THREE from "three";
import { clamp } from "./math";

/** One biome = a full mood: sky, fog, lights, arena accent, star density. */
export interface Biome {
  name: string;
  label: string;
  skyTop: THREE.Color;
  skyBottom: THREE.Color;
  fog: THREE.Color;
  fogDensity: number;
  ambient: THREE.Color;
  ambientIntensity: number;
  key: THREE.Color;
  keyIntensity: number;
  accent: THREE.Color;
  cloud: THREE.Color;
  stars: number; // 0..1 star field visibility
}

const c = (hex: string) => new THREE.Color(hex);

export const BIOMES: Biome[] = [
  {
    name: "sky-arena",
    label: "SKY ARENA",
    skyTop: c("#252a6e"),
    skyBottom: c("#ff9bb8"),
    fog: c("#7d6fc4"),
    fogDensity: 0.016,
    ambient: c("#8d97ff"),
    ambientIntensity: 0.55,
    key: c("#fff1d6"),
    keyIntensity: 2.4,
    accent: c("#22e6c8"),
    cloud: c("#ffd9ec"),
    stars: 0.0,
  },
  {
    name: "crystal-caverns",
    label: "CRYSTAL CAVERNS",
    skyTop: c("#0e0726"),
    skyBottom: c("#8a4bdc"),
    fog: c("#381d70"),
    fogDensity: 0.022,
    ambient: c("#a37bff"),
    ambientIntensity: 0.5,
    key: c("#d9b8ff"),
    keyIntensity: 2.0,
    accent: c("#7ef0ff"),
    cloud: c("#a97ef7"),
    stars: 0.15,
  },
  {
    name: "neon-city",
    label: "NEON CITY",
    skyTop: c("#04020d"),
    skyBottom: c("#3a1157"),
    fog: c("#150a26"),
    fogDensity: 0.026,
    ambient: c("#ff4fd8"),
    ambientIntensity: 0.45,
    key: c("#00f0ff"),
    keyIntensity: 2.6,
    accent: c("#ff2fb8"),
    cloud: c("#40185e"),
    stars: 0.35,
  },
  {
    name: "deep-space",
    label: "DEEP SPACE",
    skyTop: c("#010207"),
    skyBottom: c("#0b1030"),
    fog: c("#05070f"),
    fogDensity: 0.014,
    ambient: c("#9fb6ff"),
    ambientIntensity: 0.4,
    key: c("#cdd8ff"),
    keyIntensity: 2.2,
    accent: c("#ffd166"),
    cloud: c("#1b2440"),
    stars: 1.0,
  },
];

/** Mutable palette target — reused every frame, zero allocation. */
export interface PaletteSample {
  skyTop: THREE.Color;
  skyBottom: THREE.Color;
  fog: THREE.Color;
  fogDensity: number;
  ambient: THREE.Color;
  ambientIntensity: number;
  key: THREE.Color;
  keyIntensity: number;
  accent: THREE.Color;
  cloud: THREE.Color;
  stars: number;
  biomeIndex: number;
}

export const createPaletteSample = (): PaletteSample => ({
  skyTop: new THREE.Color(),
  skyBottom: new THREE.Color(),
  fog: new THREE.Color(),
  fogDensity: 0.016,
  ambient: new THREE.Color(),
  ambientIntensity: 0.5,
  key: new THREE.Color(),
  keyIntensity: 2.2,
  accent: new THREE.Color(),
  cloud: new THREE.Color(),
  stars: 0,
  biomeIndex: 0,
});

/** Blend biomes by scroll progress (0..1) into `out` without allocating. */
export function samplePalette(progress: number, out: PaletteSample): PaletteSample {
  const segs = BIOMES.length - 1;
  const p = clamp(progress, 0, 1) * segs;
  const i = Math.min(Math.floor(p), segs - 1);
  // Smoothstep the blend so biomes hold, then transition with intent.
  const raw = p - i;
  const t = raw * raw * (3 - 2 * raw);
  const a = BIOMES[i];
  const b = BIOMES[i + 1];

  out.skyTop.lerpColors(a.skyTop, b.skyTop, t);
  out.skyBottom.lerpColors(a.skyBottom, b.skyBottom, t);
  out.fog.lerpColors(a.fog, b.fog, t);
  out.ambient.lerpColors(a.ambient, b.ambient, t);
  out.key.lerpColors(a.key, b.key, t);
  out.accent.lerpColors(a.accent, b.accent, t);
  out.cloud.lerpColors(a.cloud, b.cloud, t);
  out.fogDensity = a.fogDensity + (b.fogDensity - a.fogDensity) * t;
  out.ambientIntensity = a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * t;
  out.keyIntensity = a.keyIntensity + (b.keyIntensity - a.keyIntensity) * t;
  out.stars = a.stars + (b.stars - a.stars) * t;
  out.biomeIndex = raw > 0.5 ? i + 1 : i;
  return out;
}
