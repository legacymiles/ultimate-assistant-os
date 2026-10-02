"use client";

// ---------------------------------------------------------------------------
// The knowledge graph — the one luminous thing on the page.
//
// This is NOT MemoryCore with interaction bolted on, and that is deliberate.
// MemoryCore has four live callers, one of which (the voice modal) is a
// decorative ball that must not capture pointer events; its auto-rotation and
// its heavy bloom both actively fight picking. So it stays exactly as it is,
// and this is a separate surface built to be touched.
//
// What it draws, in one <points> and one <lineSegments>:
//
//   notes   filled dots, coloured by source, brighter the longer and newer
//   ghosts  notes linked to and never written — the signature of this surface
//   edges   resolved [[wikilinks]], the first real relationships this app has had
//
// The mechanic: a ghost burns brighter the more often the owner has leaned on
// it, and clicking one offers to write it into existence. After the pointer
// has been still a while the ghosts pulse in sequence, most-owed first — the
// brain quietly saying what it is still waiting for.
//
// Performance contract, inherited from MemoryCore's header and kept:
//   * one draw call for every node, never a mesh per node
//   * links are a single BufferGeometry, capped
//   * positions are written into the existing buffer, never reallocated
//   * the loop stops when the layout settles and when the tab is hidden
// ---------------------------------------------------------------------------

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { bounds } from "@/lib/jarvis/graph/force";
import { cameraDistance, focusOn, pickNearest, project, STRIDE } from "@/lib/jarvis/graph/pick";
import {
  DIM_FACTOR,
  EDGE_ACTIVE_COLOR,
  EDGE_COLOR,
  GHOST_COLOR,
  MATCH_COLOR,
  rgb,
  SELECTED_COLOR,
  SOURCE_COLOR,
  TAG_COLOR,
} from "@/lib/jarvis/graph/palette";
import type { UseForceGraph } from "@/lib/jarvis/graph/useForceGraph";
import type { VaultNode } from "@/lib/jarvis/graph/types";

/** Hard cap on drawn edges. A dense vault can produce far more than is legible. */
const MAX_EDGES = 6000;

/** How close the pointer must be, in pixels. Dots are 2-4px; exact hit-testing is miserable. */
const HIT_RADIUS = 15;

interface Props {
  graph: UseForceGraph;
  /** Fired when a ghost is clicked — the invitation to write it. */
  onWriteGhost?: (node: VaultNode) => void;
  /** Keys the owner asked to fly to, e.g. from a voice command. */
  focus?: string[] | null;
  className?: string;
}

export function KnowledgeGraph({ graph, onWriteGhost, focus, className = "h-full w-full" }: Props) {
  // The canvas is unmounted while the tab is hidden. A WebGL context ticking
  // behind a tab the owner cannot see is pure heat.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return (
    <div className={`relative ${className}`} style={{ background: "#07080d" }}>
      {visible && (
        <Canvas
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
          camera={{ position: [0, 0, 6], fov: 52 }}
          onPointerMissed={() => graph.select(null)}
        >
          <Scene graph={graph} onWriteGhost={onWriteGhost} focus={focus} />
          {/* Dialled well back from MemoryCore's 1.5. At that strength a
              selection ring and a hover label are washed out, and this surface
              needs both to be readable. */}
          <EffectComposer>
            <Bloom intensity={0.75} luminanceThreshold={0.25} luminanceSmoothing={0.6} mipmapBlur radius={0.55} />
          </EffectComposer>
        </Canvas>
      )}
    </div>
  );
}

/** A soft round sprite, so points are discs rather than squares. */
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

function Scene({ graph, onWriteGhost, focus }: { graph: UseForceGraph; onWriteGhost?: Props["onWriteGhost"]; focus?: string[] | null }) {
  const { state, nodes, index, selection, matches, lit, idle, tick, moving, touch, reduced } = graph;
  const { camera, size, invalidate } = useThree();

  const points = useRef<THREE.Points>(null);
  const lines = useRef<THREE.LineSegments>(null);
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  const texture = useMemo(() => dotTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);

  const count = nodes.length;

  // --- buffers, allocated once per graph shape ----------------------------
  const buffers = useMemo(() => {
    const positions = new Float32Array(Math.max(1, count) * 3);
    const colors = new Float32Array(Math.max(1, count) * 3);
    const sizes = new Float32Array(Math.max(1, count));

    // Edges are flattened here, once, from the node list — the same
    // de-duplication the simulation does, so the drawn lines and the springs
    // are the same set.
    const pairs: number[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      for (const link of nodes[i].links) {
        const j = index.get(link);
        if (j === undefined || j === i) continue;
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push(i, j);
        if (pairs.length / 2 >= MAX_EDGES) break;
      }
      if (pairs.length / 2 >= MAX_EDGES) break;
    }

    const edgeIndex = new Uint32Array(pairs);
    return {
      positions,
      colors,
      sizes,
      edgeIndex,
      edgePositions: new Float32Array(Math.max(1, edgeIndex.length) * 3),
      edgeColors: new Float32Array(Math.max(1, edgeIndex.length) * 3),
      screen: new Float32Array(Math.max(1, count) * STRIDE),
    };
  }, [count, index, nodes]);

  // --- node colours, recomputed only when what is lit changes -------------
  const baseColors = useMemo(() => {
    const out = new Float32Array(Math.max(1, count) * 3);
    for (let i = 0; i < count; i += 1) {
      const node = nodes[i];
      const hex =
        node.kind === "ghost" ? GHOST_COLOR : node.kind === "tag" ? TAG_COLOR : SOURCE_COLOR[node.source] ?? "#e9ecf3";
      const [r, g, b] = rgb(hex);
      // Pushed past 1.0 so the bloom pass has something to bleed. Strength is
      // the multiplier, which is what makes a long recent note read as present
      // and a stub read as faint.
      const gain = 1.15 + node.strength * 0.7;
      out[i * 3] = r * gain;
      out[i * 3 + 1] = g * gain;
      out[i * 3 + 2] = b * gain;
    }
    return out;
  }, [count, nodes]);

  // The owed ghosts, in demand order, for the idle pulse.
  const owedOrder = useMemo(
    () =>
      nodes
        .map((n, i) => ({ i, n }))
        .filter(({ n }) => n.kind === "ghost")
        .sort((a, b) => b.n.strength - a.n.strength)
        .map(({ i }) => i),
    [nodes],
  );

  // Framing.
  //
  // A graph whose camera does not fit it reads as broken, and the extent
  // changes constantly — while it settles, when the node count changes, and
  // every time the Repel slider moves. So the camera KEEPS framing until the
  // owner takes the controls, and then never fights them again. Framing only
  // once, on settle, was the version that left a seven-note vault as a
  // thumbnail in the middle of a large black panel.
  const taken = useRef(false);
  const framed = useRef(false);
  const frames = useRef(0);
  useEffect(() => {
    taken.current = false;
    framed.current = false;
    frames.current = 0;
  }, [count]);

  useFrame((_, delta) => {
    if (!count) return;
    const { positions, colors, sizes, edgeIndex, edgePositions, edgeColors, screen } = buffers;

    if (moving && !reduced) tick();

    // --- positions into the draw buffer ----------------------------------
    positions.set(state.positions.subarray(0, count * 3));

    const selected = selection.selected;
    const hovered = selection.hovered;
    const anyLit = lit !== null;
    const anyMatch = matches.size > 0;
    const t = performance.now() / 1000;

    for (let i = 0; i < count; i += 1) {
      const node = nodes[i];
      const isLit = !anyLit || lit!.has(node.key);
      const isMatch = matches.has(node.key);
      const dim = (anyLit && !isLit) || (anyMatch && !isMatch);

      let scale = dim ? DIM_FACTOR : 1;
      let r = baseColors[i * 3];
      let g = baseColors[i * 3 + 1];
      let b = baseColors[i * 3 + 2];

      if (anyMatch && isMatch) {
        const [mr, mg, mb] = rgb(MATCH_COLOR);
        r = mr * 1.9;
        g = mg * 1.9;
        b = mb * 1.9;
      }
      if (node.key === selected || node.key === hovered) {
        const [sr, sg, sb] = rgb(SELECTED_COLOR);
        r = sr * 2.2;
        g = sg * 2.2;
        b = sb * 2.2;
        scale = 1;
      }

      colors[i * 3] = r * scale;
      colors[i * 3 + 1] = g * scale;
      colors[i * 3 + 2] = b * scale;

      let radius = 0.055 + node.strength * 0.075;
      if (node.kind === "ghost") {
        // A ghost is an absence and should read as one — smaller and dimmer
        // than a real note of the same demand.
        radius *= 0.8;
        if (idle) {
          // The idle mechanic. Each owed ghost takes its turn, most-demanded
          // first, so the sequence reads as a queue rather than a shimmer.
          const place = owedOrder.indexOf(i);
          if (place !== -1) {
            const phase = t * 1.1 - place * 0.55;
            const pulse = Math.max(0, Math.sin(phase));
            radius *= 1 + pulse * 0.9;
            colors[i * 3] += pulse * 0.5;
            colors[i * 3 + 1] += pulse * 0.55;
            colors[i * 3 + 2] += pulse * 0.7;
          }
        }
      }
      if (node.key === selected) radius *= 1.5;
      sizes[i] = radius;
    }

    // --- edges -------------------------------------------------------------
    const [er, eg, eb] = rgb(EDGE_COLOR);
    const [ar, ag, ab] = rgb(EDGE_ACTIVE_COLOR);
    for (let e = 0; e < edgeIndex.length; e += 2) {
      const a = edgeIndex[e];
      const bIdx = edgeIndex[e + 1];
      for (let v = 0; v < 2; v += 1) {
        const node = v === 0 ? a : bIdx;
        const o = (e + v) * 3;
        edgePositions[o] = state.positions[node * 3];
        edgePositions[o + 1] = state.positions[node * 3 + 1];
        edgePositions[o + 2] = state.positions[node * 3 + 2];
      }
      // An edge is "active" when the thing being pointed at is one of its ends.
      const active = anyLit && (lit!.has(nodes[a].key) && lit!.has(nodes[bIdx].key));
      const fade = anyLit && !active ? 0.12 : 1;
      for (let v = 0; v < 2; v += 1) {
        const o = (e + v) * 3;
        edgeColors[o] = (active ? ar : er) * fade;
        edgeColors[o + 1] = (active ? ag : eg) * fade;
        edgeColors[o + 2] = (active ? ab : eb) * fade;
      }
    }

    const pg = points.current?.geometry;
    if (pg) {
      pg.attributes.position.needsUpdate = true;
      pg.attributes.color.needsUpdate = true;
      (pg.attributes.size as THREE.BufferAttribute | undefined) &&
        ((pg.attributes.size as THREE.BufferAttribute).needsUpdate = true);
      pg.computeBoundingSphere();
    }
    const lg = lines.current?.geometry;
    if (lg) {
      lg.attributes.position.needsUpdate = true;
      lg.attributes.color.needsUpdate = true;
    }

    // --- framing ----------------------------------------------------------
    //
    // Once, when the layout stops — not every frame. Moving the camera and the
    // orbit target on every tick means two things are driving the same
    // controls at once, and the fight between them is what produced NaN
    // positions and a lost WebGL context. Annealing guarantees a stop, so
    // "once, on settle" is now a thing that reliably happens; the frame count
    // is only a backstop for a graph that somehow never settles.
    //
    // Re-framed periodically while it settles rather than once at the end: a
    // settle takes a few seconds, and a camera that waits for it leaves the
    // graph as a thumbnail in the middle of a large black panel the whole
    // time. Every twentieth frame is a snap, not a lerp, so there is still
    // only ever one thing driving the controls.
    frames.current += 1;
    const due = frames.current % 20 === 1 || (!moving && !framed.current);
    if (due && !framed.current && !taken.current) {
      const { min, max } = bounds(state);
      const finite = min.every(Number.isFinite) && max.every(Number.isFinite);
      if (finite) {
        const radius = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
        const cx = (min[0] + max[0]) / 2;
        const cy = (min[1] + max[1]) / 2;
        const cz = (min[2] + max[2]) / 2;
        camera.position.set(cx, cy, cz + cameraDistance(radius));
        if (controls.current) {
          controls.current.target.set(cx, cy, cz);
          controls.current.update();
        }
        camera.updateProjectionMatrix();
        // Only a settled layout is framed for good; until then the camera
        // keeps following it.
        if (!moving) framed.current = true;
      }
    }

    // --- picking ----------------------------------------------------------
    // Projected every frame because the layout moves; the result is what the
    // pointer handler on the overlay reads.
    camera.updateMatrixWorld();
    const viewProj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    project(state.positions, count, viewProj.elements, size.width, size.height, screen);

    if ((moving && !reduced) || !framed.current) invalidate();
    void delta;
  });

  // Fly to a cluster when asked. The camera move is the reward for a voice
  // command naming a corner of the graph.
  useEffect(() => {
    if (!focus?.length) return;
    const indices = focus.map((k) => index.get(k)).filter((i): i is number => i !== undefined);
    const target = focusOn(state, indices);
    if (!target) return;
    const [x, y, z] = target.centre;
    const distance = cameraDistance(target.radius);
    camera.position.set(x, y, z + distance);
    controls.current?.target.set(x, y, z);
    controls.current?.update();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // --- pointer ------------------------------------------------------------
  // On the canvas's own DOM element rather than through R3F's raycaster:
  // Points.threshold is in world units, so a raycast hit radius grows as you
  // zoom in and shrinks as you zoom out — exactly backwards for a graph whose
  // whole interaction is zooming into clusters.
  const { gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;

    const at = (event: PointerEvent | MouseEvent): number => {
      const rect = el.getBoundingClientRect();
      return pickNearest(buffers.screen, count, event.clientX - rect.left, event.clientY - rect.top, HIT_RADIUS);
    };

    const onMove = (event: PointerEvent) => {
      touch();
      const hit = at(event);
      graph.hover(hit === -1 ? null : nodes[hit].key);
      el.style.cursor = hit === -1 ? "grab" : "pointer";
    };

    const onLeave = () => graph.hover(null);

    const onClick = (event: MouseEvent) => {
      const hit = at(event);
      if (hit === -1) return;
      const node = nodes[hit];
      graph.select(node.key);
      // The signature moment: a ghost is an invitation, not a dead end.
      if (node.kind === "ghost") onWriteGhost?.(node);
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("click", onClick);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("click", onClick);
    };
  }, [buffers.screen, count, gl, graph, nodes, onWriteGhost, touch]);

  if (!count) return null;

  return (
    <>
      <OrbitControls
        ref={controls}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.55}
        zoomSpeed={0.7}
        minDistance={0.6}
        maxDistance={400}
        // Auto-rotate is deliberately off. You cannot click a target that is
        // drifting out from under the cursor, and this graph is for clicking.
        autoRotate={false}
        onStart={() => {
          taken.current = true;
        }}
        onChange={() => invalidate()}
      />

      <points ref={points}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[buffers.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[buffers.colors, 3]} />
          <bufferAttribute attach="attributes-size" args={[buffers.sizes, 1]} />
        </bufferGeometry>
        <pointsMaterial
          vertexColors
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          map={texture}
          sizeAttenuation
          size={0.1}
        />
      </points>

      <lineSegments ref={lines}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[buffers.edgePositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[buffers.edgeColors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
    </>
  );
}
