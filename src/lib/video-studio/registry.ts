// ---------------------------------------------------------------------------
// The method registry — isomorphic half.
//
// This is the ONLY place the five shipped methods are named. The UI reads this
// list and draws whatever is in it; nothing else in the app hard-codes a
// method id. Adding a sixth is:
//
//   1. src/lib/video-studio/methods/<id>/{meta.ts,skill.ts,server.ts}
//   2. one import + one entry here
//   3. one import + one entry in server/registry.ts
//
// See methods/README.md for the full checklist.
// ---------------------------------------------------------------------------

import type { MethodMeta, MethodSkill } from "./types";

import { meta as remotionMeta } from "./methods/remotion/meta";
import { skill as remotionSkill } from "./methods/remotion/skill";
import { meta as hyperframesMeta } from "./methods/hyperframes/meta";
import { skill as hyperframesSkill } from "./methods/hyperframes/skill";
import { meta as unrealMeta } from "./methods/unreal/meta";
import { skill as unrealSkill } from "./methods/unreal/skill";
import { meta as blenderMeta } from "./methods/blender/meta";
import { skill as blenderSkill } from "./methods/blender/skill";
import { meta as h3Meta } from "./methods/h3/meta";
import { skill as h3Skill } from "./methods/h3/skill";

export interface RegisteredMethod {
  meta: MethodMeta;
  skill: MethodSkill;
}

/** Registration order is display order on the method picker. */
export const METHODS: RegisteredMethod[] = [
  { meta: remotionMeta, skill: remotionSkill },
  { meta: hyperframesMeta, skill: hyperframesSkill },
  { meta: unrealMeta, skill: unrealSkill },
  { meta: blenderMeta, skill: blenderSkill },
  { meta: h3Meta, skill: h3Skill },
];

/** Every method the picker shows. */
export function visibleMethods(): RegisteredMethod[] {
  return METHODS.filter((m) => !m.meta.hidden);
}

export function methodById(id: string): RegisteredMethod | null {
  return METHODS.find((m) => m.meta.id === id) ?? null;
}

export function methodName(id: string): string {
  if (id === DIRECTOR_ID) return "AI Director";
  return methodById(id)?.meta.name ?? id;
}

export function isMethodId(value: unknown): value is string {
  return typeof value === "string" && METHODS.some((m) => m.meta.id === value);
}

/**
 * The pseudo-method for AI Director mode. It is not in METHODS because it is
 * not an engine — it is a routing decision that assigns a real method to every
 * scene. Kept here so the id has exactly one definition.
 */
export const DIRECTOR_ID = "director";

/** Version letters for the comparison strip: A, B, C… in creation order. */
export function versionLetter(n: number): string {
  return String.fromCharCode(65 + (n % 26));
}
