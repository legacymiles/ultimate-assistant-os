"use client";

// ---------------------------------------------------------------------------
// The living avatar — the Three.js renderer behind JarvisAvatar.
//
// One procedural body (shaders.ts) that melts between nine forms, a face rig
// that rides its surface (eyes, pupils, brows, a drawn mouth), motes, and a
// halo. Everything is driven every frame from three places without a single
// React re-render:
//
//   the Avatar Controller (lib/new-jarvis/avatar/store.ts) — look, emotion,
//     gestures, whether it transforms on its own;
//   the hub voice (useWakeVoice) — listening / thinking / speaking, the live
//     analyser of Jarvis's own Phonon voice for the mouth, the speech clock
//     for word timing and interruptions;
//   the pointer — the eyes and head follow it.
//
// RTX 3050 budget: one ~10k-vertex mesh (fewer in the pill), no
// post-processing (the eyes glow by colour and an additive sprite), DPR ≤ 1.5,
// and the loop stops when the canvas is off screen or the tab is hidden. A
// GLB is only fetched when the owner asks for one.
// ---------------------------------------------------------------------------

import { Canvas, useFrame } from "@react-three/fiber";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { PRESETS, faceBetween, formIndex, hexToRgb, materialIndex, nextPreset, surfacePoint, type AvatarLook, type Vec3 } from "@/lib/new-jarvis/avatar/looks";
import { avatarStore } from "@/lib/new-jarvis/avatar/store";
import { emotionAt, expressionOf } from "@/lib/new-jarvis/avatar/state";
import { REST, approach, visemeFromSpectrum, visemeFromText, type Viseme } from "@/lib/new-jarvis/avatar/visemes";
import type { SpeechClock, VoiceState } from "@/lib/new-jarvis/useWakeVoice";
import { BODY_FRAGMENT, BODY_VERTEX, MOTES_FRAGMENT, MOTES_VERTEX, MOUTH_FRAGMENT, MOUTH_VERTEX } from "./shaders";

export type AvatarVariant = "hero" | "panel" | "pill";

export interface AvatarVoice {
  state: VoiceState;
  analyser: MutableRefObject<AnalyserNode | null>;
  speech?: MutableRefObject<SpeechClock>;
}

export interface AvatarSceneProps {
  voice: AvatarVoice | null;
  /** A typed turn is running — it thinks even with the voice off. */
  busy?: boolean;
  variant: AvatarVariant;
  reduced: boolean;
}

const MORPH_SECONDS = 1.7;

/**
 * The pointer relative to the avatar, over the whole page — the eyes follow
 * you anywhere, not only while the cursor is over the canvas. Shared by every
 * avatar on the page (there is only ever one or two).
 */
const pointer = { x: 0, y: 0 };
/** `performance.now()` of the last poke — a tap makes it transform at once. */
let pokedAt = 0;
const CAMERA_Z: Record<AvatarVariant, number> = { hero: 6, panel: 6.2, pill: 3.7 };

// --- the look as numbers that can be blended -----------------------------------

interface LookNum {
  primary: THREE.Color;
  secondary: THREE.Color;
  eye: THREE.Color;
  mat: number[];
  glow: number;
  eyeGlow: number;
  scale: number;
  float: number;
}

function numOf(l: AvatarLook): LookNum {
  const m = [0, 0, 0, 0, 0, 0];
  m[materialIndex(l.material)] = 1;
  return {
    primary: new THREE.Color(...hexToRgb(l.primary)),
    secondary: new THREE.Color(...hexToRgb(l.secondary)),
    eye: new THREE.Color(...hexToRgb(l.eye)),
    mat: m,
    glow: l.glow,
    eyeGlow: l.eyeGlow,
    scale: l.scale,
    float: l.float,
  };
}

function lerpNum(out: LookNum, a: LookNum, b: LookNum, t: number) {
  out.primary.copy(a.primary).lerp(b.primary, t);
  out.secondary.copy(a.secondary).lerp(b.secondary, t);
  out.eye.copy(a.eye).lerp(b.eye, t);
  for (let i = 0; i < 6; i += 1) out.mat[i] = a.mat[i] + (b.mat[i] - a.mat[i]) * t;
  out.glow = a.glow + (b.glow - a.glow) * t;
  out.eyeGlow = a.eyeGlow + (b.eyeGlow - a.eyeGlow) * t;
  out.scale = a.scale + (b.scale - a.scale) * t;
  out.float = a.float + (b.float - a.float) * t;
}

const cloneNum = (n: LookNum): LookNum => ({
  primary: n.primary.clone(),
  secondary: n.secondary.clone(),
  eye: n.eye.clone(),
  mat: [...n.mat],
  glow: n.glow,
  eyeGlow: n.eyeGlow,
  scale: n.scale,
  float: n.float,
});

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** A soft round glow, drawn once — the eyes' bloom without post-processing. */
function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.25, "rgba(255,255,255,0.45)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const Z: Vec3 = [0, 0, 1];
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const zAxis = new THREE.Vector3(...Z);

/** Put `obj` on the surface at `dir`, facing outward, lifted by `lift`. */
function placeOn(obj: THREE.Object3D, a: number, b: number, mix: number, dir: Vec3, lift: number) {
  const p = surfacePoint(a, b, mix, dir);
  tmpV.set(dir[0], dir[1], dir[2]);
  obj.position.set(p[0] + dir[0] * lift, p[1] + dir[1] * lift, p[2] + dir[2] * lift);
  tmpQ.setFromUnitVectors(zAxis, tmpV);
  obj.quaternion.copy(tmpQ);
}

function liftDir(d: Vec3, up: number): Vec3 {
  const v: Vec3 = [d[0], d[1] + up, d[2]];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// --- the rig ------------------------------------------------------------------

function Rig({ voice, busy, variant, reduced }: AvatarSceneProps) {
  const pill = variant === "pill";
  const head = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Mesh>(null);
  const eyes = useRef<(THREE.Group | null)[]>([null, null]);
  const eyeBalls = useRef<(THREE.Mesh | null)[]>([null, null]);
  const pupils = useRef<(THREE.Mesh | null)[]>([null, null]);
  const glows = useRef<(THREE.Sprite | null)[]>([null, null]);
  const brows = useRef<(THREE.Mesh | null)[]>([null, null]);
  const halo = useRef<THREE.Mesh>(null);
  const haloMat = useRef<THREE.MeshBasicMaterial>(null);
  const [model, setModel] = useState<string | null>(null);

  const texture = useMemo(() => (typeof document === "undefined" ? null : glowTexture()), []);
  useEffect(() => () => texture?.dispose(), [texture]);

  const segs = pill ? [72, 48] : [128, 96];
  const motes = useMemo(() => {
    const n = pill ? 70 : reduced ? 120 : 260;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = 1.25 + Math.random() * 0.75;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(th) * s * r, u * r * 0.85, Math.sin(th) * s * r], i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, [pill, reduced]);
  useEffect(() => () => motes.dispose(), [motes]);

  const uniforms = useMemo(
    () => ({
      body: {
        uTime: { value: 0 },
        uFormA: { value: 0 },
        uFormB: { value: 0 },
        uMix: { value: 0 },
        uPulse: { value: 0 },
        uBreath: { value: 0 },
        uListen: { value: 0 },
        uPrimary: { value: new THREE.Color("#47e8ff") },
        uSecondary: { value: new THREE.Color("#7c5cff") },
        uGlow: { value: 1 },
        uMatA: { value: new THREE.Vector3(1, 0, 0) },
        uMatB: { value: new THREE.Vector3(0, 0, 0) },
        uWarmth: { value: 0 },
      },
      mouth: { uColor: { value: new THREE.Color("#47e8ff") }, uSmile: { value: 0.15 }, uOpen: { value: 0 }, uGlow: { value: 1 } },
      motes: { uTime: { value: 0 }, uPulse: { value: 0 }, uSpin: { value: 1 }, uSize: { value: pill ? 6 : 9 }, uColor: { value: new THREE.Color("#47e8ff") } },
    }),
    [pill],
  );

  // Built here rather than as <shaderMaterial uniforms={…}> JSX: that path
  // hands the material a COPY of the uniforms, so every per-frame write below
  // went to an object the GPU never reads — the body stayed the first form
  // whatever it was told. These keep the very objects useFrame writes to.
  const materials = useMemo(
    () => ({
      body: new THREE.ShaderMaterial({ vertexShader: BODY_VERTEX, fragmentShader: BODY_FRAGMENT, uniforms: uniforms.body, transparent: true }),
      mouth: new THREE.ShaderMaterial({ vertexShader: MOUTH_VERTEX, fragmentShader: MOUTH_FRAGMENT, uniforms: uniforms.mouth, transparent: true, depthWrite: false }),
      motes: new THREE.ShaderMaterial({
        vertexShader: MOTES_VERTEX,
        fragmentShader: MOTES_FRAGMENT,
        uniforms: uniforms.motes,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    }),
    [uniforms],
  );
  useEffect(
    () => () => {
      materials.body.dispose();
      materials.mouth.dispose();
      materials.motes.dispose();
    },
    [materials],
  );

  // The animation's memory, kept out of React.
  const sim = useRef({
    preset: 0,
    target: null as AvatarLook | null,
    formA: 0,
    formB: 0,
    morphAt: -10,
    lastCycleAt: 0,
    from: numOf(PRESETS[0].look),
    to: numOf(PRESETS[0].look),
    cur: numOf(PRESETS[0].look),
    expr: { smile: 0.15, brow: 0, eyeOpen: 1, energy: 0.35, warmth: 0 },
    mouth: { ...REST } as Viseme,
    blinkAt: 2,
    blink: 1,
    gesture: null as null | { name: string; start: number; id: number },
    lastGestureId: 0,
    speechAt: 0,
    interruptSeen: 0,
    pokeSeen: 0,
    jolt: 0,
    rot: new THREE.Euler(),
    data: new Uint8Array(256),
    gaze: new THREE.Vector2(),
  });

  useFrame((state, dt) => {
    const s = sim.current;
    const t = state.clock.elapsedTime;
    const now = Date.now();
    const av = avatarStore.get();
    const vs: VoiceState = voice?.state ?? "off";
    const speaking = vs === "speaking";
    const thinking = vs === "thinking" || (busy && !speaking && vs !== "hearing");
    const hearing = vs === "hearing";

    // 1. What should be showing: the owner's look, or the next form in the cycle.
    let want: AvatarLook;
    const poke = pokedAt !== s.pokeSeen;
    s.pokeSeen = pokedAt;
    if (av.prefs.cycle && !reduced) {
      const due = poke || t - s.lastCycleAt >= av.prefs.seconds;
      if (s.target === null) {
        s.lastCycleAt = t;
      } else if (due && !speaking && !hearing) {
        s.preset = nextPreset(s.preset);
        s.lastCycleAt = t;
      }
      want = PRESETS[s.preset].look;
    } else {
      want = av.prefs.custom ? av.prefs.look : PRESETS[s.preset].look;
    }
    if (want !== s.target) {
      const first = s.target === null;
      const p = Math.min(1, (t - s.morphAt) / MORPH_SECONDS);
      s.from = cloneNum(s.cur);
      s.formA = first ? formIndex(want.form) : p >= 0.5 ? s.formB : s.formA;
      s.formB = formIndex(want.form);
      s.to = numOf(want);
      s.morphAt = first ? -10 : t;
      s.target = want;
      avatarStore.setShowing(want);
      if (first) s.cur = numOf(want);
      setModel(want.model ?? null);
    }

    // A poke (tap) jumps straight to the next form.
    const poked = av.gestures.find((g) => g.id > s.lastGestureId);
    if (poked) {
      s.lastGestureId = poked.id;
      s.gesture = { name: poked.gesture, start: t, id: poked.id };
      avatarStore.consumeGestures(poked.id);
    }

    // 2. The morph: shape, colour and material blend together.
    const raw = Math.min(1, Math.max(0, (t - s.morphAt) / MORPH_SECONDS));
    const m = ease(raw);
    lerpNum(s.cur, s.from, s.to, m);
    const pulse = reduced ? 0 : Math.sin(Math.PI * raw) * (raw < 1 ? 1 : 0);
    if (raw >= 1) s.formA = s.formB;
    const mix = s.formA === s.formB ? 0 : m;

    // 3. Expression: the passing emotion, bent by what the voice is doing.
    const emotion = emotionAt(av, now);
    const e = expressionOf(thinking && emotion === "neutral" ? "thinking" : emotion);
    const k = 1 - Math.exp(-5 * dt);
    s.expr.smile += (e.smile - s.expr.smile) * k;
    s.expr.brow += (e.brow + (hearing ? 0.25 : 0) - s.expr.brow) * k;
    s.expr.eyeOpen += (e.eyeOpen * (hearing ? 1.12 : 1) - s.expr.eyeOpen) * k;
    s.expr.energy += (e.energy - s.expr.energy) * k;
    s.expr.warmth += (e.warmth - s.expr.warmth) * k;

    // Interrupted mid-sentence: a flinch, then it settles.
    const sp = voice?.speech?.current;
    if (sp && sp.interruptedAt && sp.interruptedAt !== s.interruptSeen) {
      s.interruptSeen = sp.interruptedAt;
      s.jolt = 1;
    }
    s.jolt = Math.max(0, s.jolt - dt * 2.2);
    // A new sentence starts: match the face to its tone.
    if (sp && sp.startedAt && sp.startedAt !== s.speechAt) {
      s.speechAt = sp.startedAt;
      avatarStore.react(sp.text);
    }

    // 4. The mouth: measured from Jarvis's own voice when it can be, from the
    // words when it can't, and shut the instant it is cut off.
    let v: Viseme = REST;
    if (speaking && s.jolt < 0.6) {
      const a = voice?.analyser.current;
      if (a) {
        if (s.data.length !== a.frequencyBinCount) s.data = new Uint8Array(a.frequencyBinCount);
        a.getByteFrequencyData(s.data);
        v = visemeFromSpectrum(s.data, a.context.sampleRate, a.fftSize);
      } else if (sp?.startedAt) {
        v = visemeFromText(sp.text, performance.now() - sp.startedAt, sp.boundary);
      } else {
        v = { open: 0.25 + 0.25 * Math.abs(Math.sin(t * 11)), wide: 0.3, round: 0 };
      }
    }
    s.mouth.open = approach(s.mouth.open, v.open, 22, dt);
    s.mouth.wide = approach(s.mouth.wide, v.wide, 14, dt);
    s.mouth.round = approach(s.mouth.round, v.round, 14, dt);

    // 5. Blinking, every 2–6 s, faster when it's surprised.
    if (t > s.blinkAt) {
      s.blink = 0;
      s.blinkAt = t + 2 + Math.random() * 4;
    }
    if (s.jolt > 0.95) s.blink = 0;
    s.blink = Math.min(1, s.blink + dt * 9);
    const lid = Math.max(0.08, Math.sin(Math.min(1, s.blink) * Math.PI * 0.5) ** 0.6);

    // 6. The head: floats, breathes, follows the pointer, leans in to listen,
    // drifts while it thinks, nods along with its own voice, plays gestures.
    const g = head.current;
    if (g) {
      const fl = s.cur.float;
      const breath = Math.sin(t * 1.4);
      let y = reduced ? 0 : Math.sin(t * 0.9) * 0.05 * fl + (fl > 1.2 ? Math.sin(t * 0.45) * 0.08 : 0);
      let rx = -pointer.y * 0.18 + (hearing ? 0.12 : 0) - s.jolt * 0.25;
      let ry = pointer.x * 0.32 + (thinking ? Math.sin(t * 0.6) * 0.22 : 0);
      let rz = thinking ? Math.sin(t * 0.4) * 0.06 : 0;
      if (speaking) rx += s.mouth.open * 0.06;
      if (s.gesture) {
        const dur = s.gesture.name === "spin" ? 1.3 : 0.95;
        const p = Math.min(1, (t - s.gesture.start) / dur);
        const fade = 1 - p;
        switch (s.gesture.name) {
          case "nod":
            rx += Math.sin(p * Math.PI * 2) * 0.22 * fade;
            break;
          case "shake":
            ry += Math.sin(p * Math.PI * 4) * 0.28 * fade;
            break;
          case "tilt":
            rz += Math.sin(p * Math.PI) * 0.28;
            break;
          case "spin":
            if (!reduced) ry += ease(p) * Math.PI * 2;
            break;
          case "bounce":
            if (!reduced) y += Math.abs(Math.sin(p * Math.PI * 2)) * 0.22 * fade;
            break;
          case "wave":
            rz += Math.sin(p * Math.PI * 4) * 0.14 * fade;
            break;
        }
        if (p >= 1) s.gesture = null;
      }
      g.position.y = approach(g.position.y, y, 8, dt);
      s.rot.set(approach(s.rot.x, rx, 6, dt), approach(s.rot.y, ry, 6, dt), approach(s.rot.z, rz, 6, dt));
      g.rotation.copy(s.rot);
      if (s.gesture?.name === "spin") g.rotation.y = ry;
      const sc = s.cur.scale * (1 + breath * 0.008) * (1 + s.jolt * 0.04);
      g.scale.setScalar(sc);

      const u = uniforms.body;
      u.uTime.value = t;
      u.uFormA.value = s.formA;
      u.uFormB.value = s.formB;
      u.uMix.value = mix;
      u.uPulse.value = pulse;
      u.uBreath.value = breath;
      u.uListen.value = hearing ? 0.6 : 0;
      u.uPrimary.value.copy(s.cur.primary);
      u.uSecondary.value.copy(s.cur.secondary);
      u.uGlow.value = s.cur.glow * (0.85 + s.expr.energy * 0.3) + (speaking ? s.mouth.open * 0.3 : 0);
      u.uMatA.value.set(s.cur.mat[0], s.cur.mat[1], s.cur.mat[2]);
      u.uMatB.value.set(s.cur.mat[3], s.cur.mat[4], s.cur.mat[5]);
      u.uWarmth.value = s.expr.warmth;

      // Face parts follow the surface as it melts.
      const face = faceBetween(s.formA, s.formB, mix);
      const gx = THREE.MathUtils.clamp(pointer.x * 0.6 + (thinking ? Math.sin(t * 0.7) * 0.5 : 0), -1, 1);
      const gy = THREE.MathUtils.clamp(pointer.y * 0.6 + (thinking ? 0.5 : 0), -1, 1);
      s.gaze.set(approach(s.gaze.x, gx, 8, dt), approach(s.gaze.y, gy, 8, dt));
      for (let i = 0; i < 2; i += 1) {
        const side = i === 0 ? -1 : 1;
        const dir = i === 0 ? face.eyeL : face.eyeR;
        const eg = eyes.current[i];
        if (eg) {
          placeOn(eg, s.formA, s.formB, mix, dir, 0.005);
          eg.rotateZ(-side * face.eyeTilt * 0.6);
        }
        const open = THREE.MathUtils.clamp(s.expr.eyeOpen * lid, 0.06, 1.5);
        const ball = eyeBalls.current[i];
        if (ball) {
          ball.scale.set(face.eyeSize[0], face.eyeSize[1] * open, face.eyeSize[0] * 0.35);
          (ball.material as THREE.MeshBasicMaterial).color.copy(s.cur.eye).multiplyScalar(0.6 + s.cur.eyeGlow * 0.55);
        }
        const pu = pupils.current[i];
        if (pu) {
          // Glowing eyes are lit all the way across: the pupil shrinks to a pin.
          const lit = 1 - THREE.MathUtils.clamp((s.cur.eyeGlow - 1.3) / 0.7, 0, 1) * 0.8;
          const px = face.pupil[0] * lit;
          const py = face.pupil[1] * lit;
          pu.visible = px > 0.05;
          pu.scale.set(face.eyeSize[0] * px, face.eyeSize[1] * py * open, face.eyeSize[0] * 0.2);
          pu.position.set(s.gaze.x * face.eyeSize[0] * 0.38, s.gaze.y * face.eyeSize[1] * 0.3 * open, face.eyeSize[0] * 0.3);
        }
        const gl = glows.current[i];
        if (gl) {
          const sz = face.eyeSize[0] * (3.6 + s.cur.eyeGlow * 1.6);
          gl.scale.set(sz, sz * (0.6 + 0.4 * open), 1);
          (gl.material as THREE.SpriteMaterial).color.copy(s.cur.eye);
          (gl.material as THREE.SpriteMaterial).opacity = Math.min(1, s.cur.eyeGlow * 0.38) * open;
        }
        const br = brows.current[i];
        if (br) {
          const lift = 0.16 + Math.max(0, s.expr.eyeOpen - 1) * 0.08 + s.expr.brow * 0.025;
          placeOn(br, s.formA, s.formB, mix, liftDir(dir, lift), 0.01);
          br.rotateZ(-side * (s.expr.brow * 0.45 - face.eyeTilt * 0.4));
          br.scale.set(face.eyeSize[0] * 1.5 * face.brows, Math.max(0.001, 0.018 * face.brows), 0.012);
          br.visible = face.brows > 0.05;
        }
      }
      const mo = mouth.current;
      if (mo) {
        placeOn(mo, s.formA, s.formB, mix, face.mouth, 0.012);
        const w = face.mouthWidth * (1 + s.mouth.wide * 0.35 - s.mouth.round * 0.45);
        mo.scale.set(w * 2, face.mouthWidth * 1.3, 1);
        const um = uniforms.mouth;
        um.uSmile.value = s.expr.smile * (1 - s.mouth.open * 0.5);
        um.uOpen.value = s.mouth.open * (0.6 + s.mouth.round * 0.4);
        um.uColor.value.copy(s.cur.primary).lerp(new THREE.Color(1, 1, 1), 0.25);
        um.uGlow.value = 0.8 + s.cur.glow * 0.4;
      }
    }

    // 7. Motes and halo: they spin while it thinks, gather while it listens,
    // and blow outward with each transformation.
    const mu = uniforms.motes;
    mu.uTime.value = t;
    mu.uPulse.value = pulse + (hearing ? -0.25 : 0);
    mu.uSpin.value = approach(mu.uSpin.value, thinking ? 4 : speaking ? 1.8 : 1, 3, dt);
    mu.uColor.value.copy(s.cur.primary).lerp(s.cur.secondary, 0.3);
    if (halo.current && haloMat.current) {
      const h = 1 + (hearing ? -0.06 : 0) + pulse * 0.25 + (speaking ? s.mouth.open * 0.05 : 0);
      halo.current.scale.setScalar(approach(halo.current.scale.x, h, 6, dt));
      halo.current.rotation.z += dt * (thinking ? 1.2 : 0.15);
      haloMat.current.color.copy(s.cur.primary);
      haloMat.current.opacity = 0.18 + pulse * 0.4 + (hearing ? 0.15 : 0);
    }
  });

  return (
    <>
      <mesh ref={halo} position={[0, 0, -0.9]}>
        <ringGeometry args={[1.42, 1.47, 96, 1, 0, Math.PI * 1.7]} />
        <meshBasicMaterial ref={haloMat} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <points geometry={motes}>
        <primitive object={materials.motes} attach="material" />
      </points>
      <group ref={head}>
        {model ? (
          <ModelBoundary key={model} fallback={null} onFail={() => setModel(null)}>
            <Suspense fallback={null}>
              <GltfBody url={model} sim={sim} voice={voice} />
            </Suspense>
          </ModelBoundary>
        ) : null}
        <mesh visible={!model}>
          <sphereGeometry args={[1, segs[0], segs[1]]} />
          <primitive object={materials.body} attach="material" />
        </mesh>
        <group visible={!model}>
          {[0, 1].map((i) => (
            <group key={i} ref={(el) => void (eyes.current[i] = el)}>
              <sprite ref={(el) => void (glows.current[i] = el)} position={[0, 0, -0.01]}>
                <spriteMaterial map={texture ?? undefined} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
              </sprite>
              <mesh ref={(el) => void (eyeBalls.current[i] = el)}>
                <sphereGeometry args={[1, 24, 16]} />
                <meshBasicMaterial toneMapped={false} />
              </mesh>
              <mesh ref={(el) => void (pupils.current[i] = el)}>
                <sphereGeometry args={[1, 16, 12]} />
                <meshBasicMaterial color="#04070d" />
              </mesh>
            </group>
          ))}
          {[0, 1].map((i) => (
            <mesh key={`b${i}`} ref={(el) => void (brows.current[i] = el)}>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial color="#e9fbff" toneMapped={false} />
            </mesh>
          ))}
          <mesh ref={mouth}>
            <planeGeometry args={[1, 1]} />
            <primitive object={materials.mouth} attach="material" />
          </mesh>
        </group>
      </group>
    </>
  );
}

// --- an interchangeable GLB/GLTF body -------------------------------------------

type Sim = MutableRefObject<{ mouth: Viseme; blink: number; expr: { smile: number } }>;

/**
 * A model the owner asked for ("use this model: …/fox.glb"). Loaded only then.
 * Morph targets named like the usual viseme / ARKit sets are driven by the same
 * mouth, blink and smile as the procedural face; an `idle` / `talk` clip plays
 * if the file has one.
 */
function GltfBody({ url, sim, voice }: { url: string; sim: Sim; voice: AvatarVoice | null }) {
  const gltf = useGLTF(url);
  const mixer = useMemo(() => new THREE.AnimationMixer(gltf.scene), [gltf.scene]);
  const fitted = useMemo(() => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const k = 2 / Math.max(size.x, size.y, size.z, 0.001);
    return { k, centre };
  }, [gltf.scene]);
  const targets = useMemo(() => {
    const out: { mesh: THREE.Mesh; open: number[]; smile: number[]; blink: number[] }[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const dict = mesh.morphTargetDictionary;
      if (!dict || !mesh.morphTargetInfluences) return;
      const find = (re: RegExp) => Object.entries(dict).filter(([n]) => re.test(n)).map(([, i]) => i);
      out.push({ mesh, open: find(/jawopen|mouthopen|viseme_aa|^aa$|mouth_open/i), smile: find(/mouthsmile|smile/i), blink: find(/eyeblink|blink/i) });
    });
    return out;
  }, [gltf.scene]);
  const clips = gltf.animations;
  useEffect(() => {
    const idle = clips.find((c) => /idle/i.test(c.name)) ?? clips[0];
    if (idle) mixer.clipAction(idle).play();
    return () => void mixer.stopAllAction();
  }, [clips, mixer]);
  const talking = useRef(false);
  useFrame((_, dt) => {
    mixer.update(dt);
    const s = sim.current;
    const speak = voice?.state === "speaking";
    if (speak !== talking.current) {
      talking.current = speak;
      const talk = clips.find((c) => /talk|speak/i.test(c.name));
      if (talk) {
        const a = mixer.clipAction(talk);
        if (speak) a.reset().fadeIn(0.2).play();
        else a.fadeOut(0.3);
      }
    }
    for (const t of targets) {
      const inf = t.mesh.morphTargetInfluences!;
      for (const i of t.open) inf[i] = s.mouth.open;
      for (const i of t.smile) inf[i] = Math.max(0, s.expr.smile);
      for (const i of t.blink) inf[i] = 1 - Math.min(1, s.blink);
    }
  });
  return <primitive object={gltf.scene} scale={fitted.k} position={fitted.centre.clone().multiplyScalar(-fitted.k)} />;
}

class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// --- the canvas ---------------------------------------------------------------

export default function AvatarScene(props: AvatarSceneProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  // Stop drawing when nobody can see it: off screen, or the tab in the background.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let onScreen = true;
    const sync = () => setVisible(onScreen && document.visibilityState === "visible");
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      sync();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const span = Math.max(r.width, 320);
      pointer.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / span));
      pointer.y = Math.max(-1, Math.min(1, -(e.clientY - (r.top + r.height / 2)) / span));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div ref={wrap} className="jav-canvas">
      <Canvas
        frameloop={visible ? "always" : "never"}
        dpr={props.variant === "pill" ? [1, 1.25] : [1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ fov: 30, position: [0, 0, CAMERA_Z[props.variant]] }}
        onPointerDown={() => {
          // A poke: it flinches, and (while it transforms on its own) jumps to the next form.
          pokedAt = performance.now();
          avatarStore.apply([
            { type: "gesture", gesture: "bounce" },
            { type: "emotion", emotion: "surprised", seconds: 1.2 },
          ]);
        }}
      >
        <Rig {...props} />
      </Canvas>
    </div>
  );
}
