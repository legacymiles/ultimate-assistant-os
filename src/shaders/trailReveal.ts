// ---------------------------------------------------------------------------
// Parametric mouse-trail image reveal (Unicorn Studio "Reveal Background").
//
// A ring buffer of recent pointer positions drives a wide warp field (morphs
// the whole image around the cursor and eases back) plus a tight reveal core
// exposed through a grainy particle DISSOLVE. Every feel parameter is exposed
// as a uniform so the on-screen panel can drive it live:
//   radius, strength, hardness, tail, fluidity, dissipation, chromatic,
//   momentum, scale — matching the Unicorn Studio control set.
// See ~/.claude/skills/webgl-trail-reveal for the technique writeup.
// ---------------------------------------------------------------------------

export const TRAIL_N = 30;

export const trailRevealVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const trailRevealFragment = /* glsl */ `
  precision highp float;
  #define TRAIL_N ${TRAIL_N}

  varying vec2 vUv;

  uniform sampler2D uBase;
  uniform sampler2D uReveal;
  uniform float uTime;
  uniform vec2  uTrailPos[TRAIL_N];
  uniform vec2  uTrailDir[TRAIL_N];
  uniform float uTrailAge[TRAIL_N];
  uniform float uPlaneAspect;
  uniform float uImageAspect;
  uniform vec3  uRimColor;
  uniform float uEnergy;

  // --- live control parameters (all 0..1) ---
  uniform float uRadius;      // brush size
  uniform float uStrength;    // reveal opacity / push
  uniform float uHardness;    // edge crispness (soft grain <-> hard)
  uniform float uFluidity;    // warp / flow amount
  uniform float uChroma;      // chromatic aberration
  uniform float uScale;       // rigid displacement magnitude
  uniform float uTailFade;    // exponent from Dissipation (fast tail fade)
  uniform float uMode;        // 0 trail 1 liquid 2 ripple 3 glitch 4 pixel 5 bulge

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, amp = 0.5;
    for (int i = 0; i < 3; i++) { v += amp * noise(p); p *= 2.1; amp *= 0.5; }
    return v;
  }

  vec2 containUv(vec2 uv, out float inside) {
    float pa = uPlaneAspect, ia = uImageAspect;
    vec2 s = pa > ia ? vec2(pa / ia, 1.0) : vec2(1.0, ia / pa);
    vec2 c = (uv - 0.5) * s + 0.5;
    inside = step(0.0, c.x) * step(c.x, 1.0) * step(0.0, c.y) * step(c.y, 1.0);
    return c;
  }

  void main() {
    float inside;
    vec2 imgUv = containUv(vUv, inside);
    if (inside < 0.5) { gl_FragColor = vec4(0.02, 0.024, 0.039, 1.0); return; }

    int mode = int(uMode + 0.5);
    float baseR = mix(0.05, 0.4, uRadius);

    float mask = 0.0;
    vec2  warp = vec2(0.0);
    float field = 0.0;
    for (int i = 0; i < TRAIL_N; i++) {
      vec2 rel = vUv - uTrailPos[i];
      vec2 d = rel; d.x *= uPlaneAspect;
      float age = uTrailAge[i];
      float dist = length(d);
      vec2 outward = dist > 1e-4 ? d / dist : vec2(0.0);
      float fade = pow(1.0 - age, uTailFade);

      float rr = baseR * (1.0 - age * 0.55);      // reveal core (tight)
      float wr = rr * 2.3;                          // morph field (wide)
      float ww = (1.0 - smoothstep(0.0, wr, dist)) * fade;
      field = max(field, ww);

      vec2 contrib = uTrailDir[i] * 1.0 + outward * 0.35;
      if (mode == 2) {                              // ripple
        float ph = sin(dist * (30.0 / max(baseR * 2.6, 0.2)) - uTime * 7.0);
        contrib = outward * ph * 1.5;
      } else if (mode == 5) {                       // bulge
        contrib = -outward * 1.3;
      }
      warp += contrib * ww;

      float rf = 1.0 - smoothstep(rr * 0.35, rr, dist);
      mask = max(mask, rf * fade);
    }
    mask = clamp(mask, 0.0, 1.0);
    warp = warp / (1.0 + length(warp));
    field = clamp(field, 0.0, 1.0);

    // displacement: fluidity = organic morph, scale = rigid shift
    vec2 shift = warp * (0.04 + uFluidity * 0.3 + uScale * 0.16);
    if (mode == 1) {                                // liquid flow
      vec2 flow = vec2(fbm(imgUv * 5.5 + uTime * 0.35), fbm(imgUv * 5.5 - uTime * 0.3)) - 0.5;
      shift += flow * 0.11 * uFluidity * field;
    }
    if (mode == 3) {                                // glitch blocks
      vec2 cell = floor(vUv * 70.0);
      float g = step(0.55, hash(cell + floor(uTime * 14.0)));
      shift += vec2(hash(cell) - 0.5, hash(cell + 7.3) - 0.5) * 0.16 * g * field;
    }

    float edge = 4.0 * mask * (1.0 - mask);

    // whole image morphs around the cursor (base warps too, eases back)
    vec3 base = texture2D(uBase, imgUv + shift * 0.6).rgb;

    vec2 rUv = imgUv + shift;
    if (mode == 4) {                                // pixel mosaic
      float px = 62.0;
      rUv = (floor(rUv * px) + 0.5) / px;
    }
    float split = (uChroma * 0.012 + uEnergy * 0.002) * (edge * 0.7 + mask * 0.3);
    vec3 rev;
    rev.r = texture2D(uReveal, rUv + vec2(split, 0.0)).r;
    rev.g = texture2D(uReveal, rUv).g;
    rev.b = texture2D(uReveal, rUv - vec2(split, 0.0)).b;

    // grainy particle DISSOLVE — hardness controls grain size + band width
    float grain = fbm(imgUv * mix(70.0, 250.0, uHardness) + shift * 8.0);
    float m = clamp(mask * (0.45 + uStrength * 1.35), 0.0, 1.3);
    float bw = mix(0.3, 0.03, uHardness);
    float revealAmt = smoothstep(grain - bw, grain + bw, m);

    vec3 col = mix(base, rev, revealAmt);
    col += uRimColor * edge * (0.22 + uEnergy * 0.1);
    float scan = sin(vUv.y * 900.0 + uTime * 5.0) * (0.012 + (mode == 3 ? 0.03 : 0.0)) * edge;
    col += scan;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// --- effect modes (the "Type" selector) ------------------------------------
export interface RevealMode {
  id: string;
  label: string;
  rim: [number, number, number];
  accent: string;
  mode: number;
}

export const MODES: RevealMode[] = [
  { id: "trail", label: "Trail", rim: [1.0, 0.5, 0.16], accent: "#ff6a1f", mode: 0 },
  { id: "liquid", label: "Liquid", rim: [0.55, 0.95, 1.0], accent: "#5fe6ff", mode: 1 },
  { id: "ripple", label: "Ripple", rim: [0.4, 0.62, 1.0], accent: "#4a90ff", mode: 2 },
  { id: "glitch", label: "Glitch", rim: [1.0, 0.2, 0.85], accent: "#ff36c8", mode: 3 },
  { id: "pixel", label: "Pixel", rim: [0.5, 1.0, 0.35], accent: "#7dff45", mode: 4 },
  { id: "bulge", label: "Bulge", rim: [0.62, 0.35, 1.0], accent: "#a56bff", mode: 5 },
];

// --- live control parameters -----------------------------------------------
export interface RevealParams {
  radius: number;
  strength: number;
  hardness: number;
  tail: number;
  fluidity: number;
  dissipation: number;
  chromatic: number;
  momentum: number;
  scale: number;
}

// defaults mirror the Unicorn Studio reference panel
export const DEFAULT_PARAMS: RevealParams = {
  radius: 0.43,
  strength: 0.55,
  hardness: 0.2,
  tail: 0.89,
  fluidity: 0.29,
  dissipation: 1.0,
  chromatic: 0.42,
  momentum: 0.75,
  scale: 0.0,
};

export const PARAM_META: { key: keyof RevealParams; label: string; hint: string }[] = [
  { key: "radius", label: "Radius", hint: "Size of the reveal brush" },
  { key: "strength", label: "Strength", hint: "How much is revealed" },
  { key: "hardness", label: "Hardness", hint: "Edge crispness vs. soft grain" },
  { key: "tail", label: "Tail", hint: "How long the trail persists" },
  { key: "fluidity", label: "Fluidity", hint: "Organic flow / morph amount" },
  { key: "dissipation", label: "Dissipation", hint: "How fast the trail fades" },
  { key: "chromatic", label: "Chromatic ab.", hint: "RGB colour split at the edge" },
  { key: "momentum", label: "Momentum", hint: "Cursor inertia / follow-through" },
  { key: "scale", label: "Scale", hint: "Rigid displacement amount" },
];
