// Material presets, spread onto <meshStandardMaterial {...MAT.paint} />.
// They are prop objects, not shared instances, so every mesh gets its own
// material — that lets Part.tsx fade one part's opacity without touching others.
// transparent+depthWrite keeps them looking opaque at rest while still being
// free to fade for the isolate-a-part dim.

import type { ThreeElements } from "@react-three/fiber";

type MatProps = ThreeElements["meshStandardMaterial"];

const base = { transparent: true, depthWrite: true } as const;

export const MAT: Record<string, MatProps> = {
  // Livery — hot racing orange with a wet gloss
  paint: { ...base, color: "#ff4d1e", metalness: 0.55, roughness: 0.28, envMapIntensity: 1.2 },
  paintDeep: { ...base, color: "#d62f0c", metalness: 0.6, roughness: 0.3, envMapIntensity: 1.1 },
  // Carbon / dark composite
  carbon: { ...base, color: "#15181f", metalness: 0.5, roughness: 0.42, envMapIntensity: 0.8 },
  // Structural gunmetal frame
  frame: { ...base, color: "#39434f", metalness: 0.95, roughness: 0.34, envMapIntensity: 1.0 },
  // Polished engine aluminium
  chrome: { ...base, color: "#d7dee7", metalness: 1, roughness: 0.2, envMapIntensity: 1.3 },
  chromeDark: { ...base, color: "#8b95a1", metalness: 1, roughness: 0.3, envMapIntensity: 1.1 },
  // Tyre rubber
  rubber: { ...base, color: "#0c0e11", metalness: 0.1, roughness: 0.82, envMapIntensity: 0.4 },
  // Cyan-anodized rim
  rim: { ...base, color: "#8fdcff", metalness: 1, roughness: 0.22, emissive: "#0b2a3a", emissiveIntensity: 0.4, envMapIntensity: 1.4 },
  // Emissive cyan accent (bloom catches this)
  accent: { ...base, color: "#dff2ff", emissive: "#57c8ff", emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.3 },
  // Hot engine glow (animated in KartParts)
  heat: { ...base, color: "#ff7a34", emissive: "#ff3a12", emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.5 },
};

export const COLORS = {
  cyan: "#57c8ff",
  cyanSoft: "#cfe8ff",
  heat: "#ff5a1f",
  stage: "#0a0c10",
  stageDeep: "#07090c",
  duskA: "#ff2d7e", // ride: magenta
  duskB: "#22d3ff", // ride: cyan
};
