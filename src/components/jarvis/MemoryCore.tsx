"use client";

// ---------------------------------------------------------------------------
// The memory core: Jarvis's memories as a slowly turning ball of connected
// dots, one dot per real memory, coloured by where the memory came from.
//
// Two layouts share one set of points so switching between them can be a lerp
// rather than a rebuild:
//   sphere  — Fibonacci placement, an even shell with no clumping at the poles
//   network — the same dots pulled into one cluster per source, spread out
//
// Performance rules this file keeps, because the sphere sits on the dashboard
// and must never be the reason a tab gets hot:
//   * one <points> draw call for every memory, never a mesh per memory
//   * link lines are a single BufferGeometry, capped
//   * the frame loop stops when the tab is hidden
// ---------------------------------------------------------------------------

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { GraphNode } from "@/lib/jarvis/memoryClient";
import type { MemorySource } from "@/lib/jarvis/types";

/** Source colours. Chosen to stay distinguishable at 2px on black. */
export const SOURCE_COLOR: Record<MemorySource, string> = {
  note: "#6ee7ff", // cyan
  chat: "#8b8cff", // violet
  "master-folder": "#ffd479", // amber
  skill: "#c4b5fd", // lilac
  file: "#ff9f7f", // coral
  email: "#5ee0c0", // mint
  event: "#ff5fa2", // pink
  profile: "#e9ecf3", // near-white
};

const MAX_LINKS = 4000;

/** Evenly spaced points on a sphere — no pole clumping, unlike random lat/long. */
function fibonacciSphere(i: number, n: number, radius: number): THREE.Vector3 {
  const y = 1 - (i / Math.max(1, n - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * Math.PI * (3 - Math.sqrt(5));
  return new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius);
}

/** A soft round sprite, drawn once, so points are discs and not squares. */
function dotTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

interface CoreProps {
  nodes: GraphNode[];
  /** 0–1 voice level; the ball breathes with it. */
  amplitude: number;
  mode: "sphere" | "network";
  /** Memory ids to highlight (a search result); others dim. */
  highlight?: Set<string>;
  /** Placeholder dots when there are no memories yet. */
  placeholder: boolean;
}

function Cloud({ nodes, amplitude, mode, highlight, placeholder }: CoreProps) {
  const points = useRef<THREE.Points>(null);
  const lines = useRef<THREE.LineSegments>(null);
  const group = useRef<THREE.Group>(null);
  const tex = useMemo(dotTexture, []);
  const { invalidate } = useThree();

  // Both layouts, computed once per node set. The render position is a lerp
  // between them driven by `mode`, so the switch animates for free.
  const { spherePos, networkPos, colors, sizes, linkPositions } = useMemo(() => {
    const n = nodes.length;
    const sphere = new Float32Array(n * 3);
    const network = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const color = new THREE.Color();

    // One cluster centre per source, itself placed on a ring.
    const sources = [...new Set(nodes.map((x) => x.source))];
    const centres = new Map<MemorySource, THREE.Vector3>();
    sources.forEach((s, i) => {
      const a = (i / Math.max(1, sources.length)) * Math.PI * 2;
      centres.set(s, new THREE.Vector3(Math.cos(a) * 2.1, (i % 3) * 0.55 - 0.55, Math.sin(a) * 2.1));
    });

    nodes.forEach((node, i) => {
      const p = fibonacciSphere(i, n, 1.6 + (1 - node.strength) * 0.12);
      sphere[i * 3] = p.x;
      sphere[i * 3 + 1] = p.y;
      sphere[i * 3 + 2] = p.z;

      const c = centres.get(node.source) ?? new THREE.Vector3();
      // Deterministic jitter from the id, so a node keeps its spot between renders.
      const h = [...node.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 9973, 7);
      network[i * 3] = c.x + (((h % 100) / 100) - 0.5) * 1.5;
      network[i * 3 + 1] = c.y + ((((h / 7) % 100) / 100) - 0.5) * 1.5;
      network[i * 3 + 2] = c.z + ((((h / 13) % 100) / 100) - 0.5) * 1.5;

      const dim = highlight && highlight.size > 0 && !highlight.has(node.id);
      color.set(placeholder ? "#39415c" : SOURCE_COLOR[node.source] ?? "#e9ecf3");
      // Push past 1.0 so the bloom pass has something to bleed: this is what
      // turns a field of flat dots into a lit ball.
      if (!placeholder) color.multiplyScalar(1.5 + node.strength * 0.8);
      if (dim) color.multiplyScalar(0.18);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      sizes[i] = (placeholder ? 0.035 : 0.045 + node.strength * 0.05) * (dim ? 0.7 : 1);
    });

    // Links, capped: two vertices per link, drawn in the sphere layout.
    const index = new Map(nodes.map((x, i) => [x.id, i]));
    const segs: number[] = [];
    for (const node of nodes) {
      for (const other of node.links) {
        const a = index.get(node.id);
        const b = index.get(other);
        if (a === undefined || b === undefined || a > b) continue;
        segs.push(sphere[a * 3], sphere[a * 3 + 1], sphere[a * 3 + 2]);
        segs.push(sphere[b * 3], sphere[b * 3 + 1], sphere[b * 3 + 2]);
        if (segs.length / 6 >= MAX_LINKS) break;
      }
      if (segs.length / 6 >= MAX_LINKS) break;
    }

    // With no real links yet, join each dot to a near neighbour so the ball
    // still reads as a web. These are decorative and the HUD does not count
    // them as relationships.
    if (!segs.length && n > 8) {
      // Neighbours on the Fibonacci spiral: the next point, and the point one
      // turn away. Those are the two dots physically nearest, so the web wraps
      // the surface instead of cutting chords through the middle.
      const turn = Math.max(2, Math.round(Math.sqrt(n)));
      for (let i = 0; i < n; i += 1) {
        const j = (i + (i % 2 === 0 ? 1 : turn)) % n;
        segs.push(sphere[i * 3], sphere[i * 3 + 1], sphere[i * 3 + 2]);
        segs.push(sphere[j * 3], sphere[j * 3 + 1], sphere[j * 3 + 2]);
        if (segs.length / 6 >= Math.min(MAX_LINKS, n)) break;
      }
    }

    return {
      spherePos: sphere,
      networkPos: network,
      colors,
      sizes,
      linkPositions: new Float32Array(segs),
    };
  }, [nodes, highlight, placeholder]);

  const blend = useRef(0);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    g.rotation.y += delta * 0.09;
    g.rotation.x = Math.sin(state.clock.elapsedTime * 0.12) * 0.12;

    // Breathe with the voice, and idle at a gentle pulse.
    const idle = 1 + Math.sin(state.clock.elapsedTime * 0.8) * 0.012;
    const target = idle + amplitude * 0.18;
    g.scale.setScalar(THREE.MathUtils.lerp(g.scale.x, target, 0.12));

    // Animate between the two layouts.
    const want = mode === "sphere" ? 0 : 1;
    if (Math.abs(blend.current - want) > 0.001) {
      blend.current = THREE.MathUtils.lerp(blend.current, want, 0.06);
      const attr = points.current?.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (attr) {
        const a = attr.array as Float32Array;
        for (let i = 0; i < a.length; i += 1) {
          a[i] = spherePos[i] + (networkPos[i] - spherePos[i]) * blend.current;
        }
        attr.needsUpdate = true;
      }
      const lineMat = lines.current?.material as THREE.LineBasicMaterial | undefined;
      if (lineMat) lineMat.opacity = 0.28 * (1 - blend.current);
    }
    invalidate();
  });

  if (!nodes.length) return null;

  return (
    <group ref={group}>
      {/* The inner glow: a dark sphere that catches the bloom and gives the
          dots something to sit on, so the ball reads as a body. */}
      <mesh scale={1.42}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color="#0a1030" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <points ref={points}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[spherePos.slice(), 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
          <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
        </bufferGeometry>
        <pointsMaterial
          vertexColors
          size={0.085}
          sizeAttenuation
          map={tex}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      {linkPositions.length > 0 && (
        <lineSegments ref={lines}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[linkPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial
            color={placeholder ? "#2a3049" : "#5b7cff"}
            transparent
            opacity={0.28}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
      )}
    </group>
  );
}

export interface MemoryCoreProps {
  nodes: GraphNode[];
  amplitude?: number;
  mode?: "sphere" | "network";
  highlight?: Set<string>;
  /** Height of the canvas box. */
  className?: string;
}

/**
 * The visual. It renders nothing but the ball — HUD, mode switch and search
 * belong to whichever tab is hosting it.
 */
export function MemoryCore({ nodes, amplitude = 0, mode = "sphere", highlight, className }: MemoryCoreProps) {
  const [visible, setVisible] = useState(true);

  // Stop rendering entirely when the tab is in the background.
  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const placeholder = nodes.length === 0;
  const drawn = useMemo<GraphNode[]>(() => {
    if (!placeholder) return nodes;
    // An honest empty state: dim dots, no fake titles, nothing searchable.
    return Array.from({ length: 420 }, (_, i) => ({
      id: `placeholder-${i}`,
      source: "note" as MemorySource,
      title: "",
      strength: 0.2,
      links: [],
    }));
  }, [nodes, placeholder]);

  return (
    <div className={className ?? "h-64 w-full"}>
      {visible && (
        <Canvas
          camera={{ position: [0, 0, 4.4], fov: 52 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
        >
          <Cloud
            nodes={drawn}
            amplitude={amplitude}
            mode={mode}
            highlight={highlight}
            placeholder={placeholder}
          />
          <EffectComposer>
            <Bloom intensity={1.5} luminanceThreshold={0.12} luminanceSmoothing={0.5} mipmapBlur radius={0.7} />
          </EffectComposer>
        </Canvas>
      )}
    </div>
  );
}
