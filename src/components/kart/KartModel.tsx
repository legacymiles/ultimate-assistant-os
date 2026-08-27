"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PART_BY_ID } from "@/lib/kart/parts";
import { useKart, PHASE } from "@/lib/kart/store";
import { Part } from "./Part";
import { Annotations } from "./Annotations";
import {
  Wheel, Nose, Bumper, Seat, Steering, Engine, Exhaust, Wing, Floor, Frame,
} from "./KartParts";

export function KartModel() {
  const root = useRef<THREE.Group>(null!);

  useFrame((state) => {
    const g = root.current;
    if (!g) return;
    const { reducedMotion, progress } = useKart.getState();
    const breath = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 0.8) * 0.015;
    g.position.y = THREE.MathUtils.lerp(g.position.y, breath, 0.1);
    g.rotation.y = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 0.25) * 0.02;
    g.visible = progress < PHASE.diveEnd + 0.08;
  });

  return (
    <group ref={root}>
      <Frame />

      <Part def={PART_BY_ID.nose}><Nose /></Part>
      <Part def={PART_BY_ID.bumper}><Bumper /></Part>

      <Part def={PART_BY_ID.seat}><Seat /></Part>
      <Part def={PART_BY_ID.steering}><Steering /></Part>

      <Part def={PART_BY_ID.engine}><Engine /></Part>
      <Part def={PART_BY_ID.exhaust}><Exhaust /></Part>

      <Part def={PART_BY_ID.wheelFL}><Wheel radius={0.28} width={0.2} /></Part>
      <Part def={PART_BY_ID.wheelFR}><Wheel radius={0.28} width={0.2} /></Part>
      <Part def={PART_BY_ID.wheelRL}><Wheel radius={0.3} width={0.3} /></Part>
      <Part def={PART_BY_ID.wheelRR}><Wheel radius={0.3} width={0.3} /></Part>

      <Part def={PART_BY_ID.wing}><Wing /></Part>
      <Part def={PART_BY_ID.floor}><Floor /></Part>

      <Annotations />
    </group>
  );
}
