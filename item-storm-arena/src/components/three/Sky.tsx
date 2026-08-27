"use client";
/**
 * Sky dome: vertical gradient + procedural star field + soft nebula band.
 * Uniforms are lerped every frame from the biome palette; the "galaxy"
 * combo event forces stars and nebula to full regardless of biome.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { paletteNow } from "./Atmosphere";
import { useArena } from "@/lib/store";
import { damp, wallNow } from "@/lib/math";

const vertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uNebula;
  uniform float uStars;
  uniform float uTime;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  void main() {
    float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uBottom, uTop, pow(h, 1.35));

    // star field: quantize direction, sparkle the lucky cells
    vec3 cell = floor(vDir * 90.0);
    float star = step(0.992, hash(cell));
    float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + hash(cell.zyx) * 40.0);
    col += vec3(star * twinkle * uStars);

    // soft nebula band along an arbitrary diagonal
    float band = 1.0 - abs(dot(vDir, normalize(vec3(0.4, 0.75, 0.2))));
    float neb = smoothstep(0.75, 1.0, band) * uStars * 0.5;
    col += uNebula * neb;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const GALAXY_TOP = new THREE.Color("#01020a");
const GALAXY_BOTTOM = new THREE.Color("#0d1233");

export function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color("#252a6e") },
          uBottom: { value: new THREE.Color("#ff9bb8") },
          uNebula: { value: new THREE.Color("#8a5cff") },
          uStars: { value: 0 },
          uTime: { value: 0 },
        },
      }),
    []
  );
  const stars = useRef(0);

  useFrame((state, dt) => {
    const now = state.clock.elapsedTime;
    const store = useArena.getState();
    const galaxy = store.event === "galaxy" && wallNow() < store.eventUntil;

    material.uniforms.uTime.value = now;
    material.uniforms.uNebula.value.copy(paletteNow.accent);

    const target = galaxy ? 1 : paletteNow.stars;
    stars.current = damp(stars.current, target, 3, dt);
    material.uniforms.uStars.value = stars.current;

    // The galaxy combo doesn't just add stars — it takes the daylight away.
    // Night falls over whatever biome you're in, so the payoff always lands.
    const night = galaxy ? stars.current : Math.max(0, stars.current - paletteNow.stars);
    material.uniforms.uTop.value.copy(paletteNow.skyTop).lerp(GALAXY_TOP, night * 0.9);
    material.uniforms.uBottom.value.copy(paletteNow.skyBottom).lerp(GALAXY_BOTTOM, night * 0.9);
  });

  return (
    <mesh material={material} frustumCulled={false}>
      <sphereGeometry args={[70, 32, 24]} />
    </mesh>
  );
}
