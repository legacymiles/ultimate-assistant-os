// ---------------------------------------------------------------------------
// The storyboard a recreation task hands back — and the per-shot H3 prompts.
//
// The H3 Lab's Blueprint (lib/h3-lab/model.ts) is the analysis: per shot, who
// is where, what happens, camera, light, set, props, transition. The
// storyboard is the same facts reshaped for reading on a card — camera,
// movement and angle split apart, colour / VFX / pacing pulled out of the
// prose — with Storage keys in place of data-URL keyframes.
//
// Prompts are not written here: buildRecreation() runs the H3 Lab's own
// recreate() → compileProduction() → lint(), so a queue recreation and a Lab
// recreation of the same blueprint produce the same prompts.
// ---------------------------------------------------------------------------

import type { Blueprint, BlueprintShot, Production, ShotSpec } from "@/lib/h3-lab/model";
import type { AnalysisDraft } from "@/lib/h3-lab/server/brain";
import { compileProduction, initialState, recreate } from "@/lib/h3-lab/state";
import { lint, type LintFinding } from "@/lib/h3-lab/lint";
import type { ShotSpan } from "./scenes";
import { applyChanges, type H3Changes } from "./changes";

export interface StoryboardShot {
  n: number;
  start: number;
  end: number;
  duration: number;
  /** Framing as the analysis wrote it ("medium two-shot, eye level"). */
  camera: string;
  /** "push-in, small, slow". */
  movement: string;
  /** Eye level / low angle / overhead … when the framing names one. */
  angle: string;
  subjects: string[];
  action: string;
  environment: string;
  lighting: string;
  color: string;
  transition: string;
  vfx: string;
  /** fast / medium / slow, from the shot's measured length. */
  pacing: string;
  /** Storage keys of the shot's keyframes (bucket queue-247). */
  frames: string[];
}

export interface Storyboard {
  source: string;
  engine: "ai" | "offline";
  width: number;
  height: number;
  genre: string;
  style: string;
  grade: string;
  pacing: string;
  sound: string;
  totalDuration: number;
  characters: { label: string; description: string }[];
  environments: { label: string; description: string }[];
  shots: StoryboardShot[];
  notice?: string;
}

const ANGLE = /\b(eye[- ]level|low[- ]angle|high[- ]angle|overhead|top[- ]down|bird['’]?s[- ]eye|worm['’]?s[- ]eye|dutch(?: angle| tilt)?|over[- ]the[- ]shoulder|pov|point[- ]of[- ]view|profile|frontal|three[- ]quarter)\b/i;
const COLOR = /\b(warm|cool|cold|teal|orange|amber|golden|blue|red|green|magenta|purple|pink|neon|pastel|muted|desaturated|saturated|vivid|monochrome|black and white|b&w|sepia|high[- ]contrast|low[- ]contrast|moody|bright|dark|grey|gray|earthy|natural colou?rs?)\b/gi;
const GRADE = /\b(grade|graded|grading|lut|film (?:look|stock|grain)|grain|teal and orange|bleach bypass|kodak|fuji|16 ?mm|35 ?mm|super 8|vhs|cinematic|filmic|desaturated|saturated|crushed blacks|lifted blacks|monochrome|black and white|sepia|pastel|neon)\b/i;
const VFX = /\b(slow[- ]motion|speed[- ]ramp|time[- ]lapse|freeze[- ]frame|explosions?|smoke|fire|sparks|lens flares?|particles|glow(?:ing)?|cgi|green ?screen|split[- ]screen|text overlay|on-screen text|glitch|motion blur|rain|snow|fog|haze|light leaks?|double exposure|zoom blur|whip pan)\b/gi;

function uniq(list: string[]): string[] {
  return [...new Set(list.map((s) => s.toLowerCase()))];
}

export function pacingOf(duration: number): "fast" | "medium" | "slow" {
  return duration < 1.2 ? "fast" : duration < 3.5 ? "medium" : "slow";
}

function movementOf(c: BlueprintShot["camera"]): string {
  return c.move === "static" ? "static (locked off)" : `${c.move}, ${c.amount} amplitude, ${c.speed}`;
}

/** Blueprint → Storyboard. Frame keys come from each shot's `keyframes` (keys, not data URLs, in a queue blueprint). */
export function toStoryboard(bp: Blueprint): Storyboard {
  const shots: StoryboardShot[] = bp.shots.map((s, i) => {
    const duration = Math.round((s.end - s.start) * 100) / 100;
    const color = uniq([...(`${s.lighting} ${bp.style}`.match(COLOR) ?? [])]).slice(0, 5).join(", ");
    const vfx = uniq([...(`${s.actions} ${s.props} ${s.lighting} ${s.transitionIn}`.match(VFX) ?? [])]).slice(0, 5).join(", ");
    return {
      n: i + 1,
      start: s.start,
      end: s.end,
      duration,
      camera: s.camera.angle || "",
      movement: movementOf(s.camera),
      angle: (ANGLE.exec(s.camera.angle)?.[0] ?? "").toLowerCase(),
      subjects: s.characters,
      action: [s.actions, s.positions].filter(Boolean).join(" — "),
      environment: s.environment,
      lighting: s.lighting,
      color,
      transition: s.transitionIn || (i === 0 ? "opening" : "cut"),
      vfx,
      pacing: pacingOf(duration),
      frames: s.keyframes,
    };
  });
  const avg = shots.length ? bp.durationSec / shots.length : 0;
  const grade = bp.style
    .split(/[,;.]/)
    .map((p) => p.trim())
    .filter((p) => GRADE.test(p))
    .join(", ");
  return {
    source: bp.sourceName,
    engine: bp.engine,
    width: bp.width,
    height: bp.height,
    genre: bp.genre,
    style: bp.style,
    grade,
    pacing: bp.editingRhythm || `${shots.length} shots, average ${avg.toFixed(1)} s — ${pacingOf(avg)} cutting`,
    sound: bp.sound,
    totalDuration: bp.durationSec,
    characters: bp.characters,
    environments: bp.environments,
    shots,
    ...(bp.notice ? { notice: bp.notice } : {}),
  };
}

/**
 * Measured shots + the analysis draft + keyframe keys → the Lab's Blueprint
 * shape (detection "ffmpeg-scdet"), so the Lab's recreate() takes it as-is.
 */
export function blueprintFrom(args: {
  id: string;
  name: string;
  probe: { duration: number; width: number; height: number };
  shots: ShotSpan[];
  frames: string[][];
  draft: AnalysisDraft;
  engine: "ai" | "offline";
  notice?: string;
  now: string;
}): Blueprint {
  const { shots, draft } = args;
  const total = args.probe.duration || shots[shots.length - 1]?.end || 0;
  return {
    id: args.id,
    sourceName: args.name,
    durationSec: total,
    width: args.probe.width || 1920,
    height: args.probe.height || 1080,
    createdAt: args.now,
    detection: "ffmpeg-scdet",
    engine: args.engine,
    genre: draft.genre,
    style: draft.style,
    editingRhythm: draft.editingRhythm || `${shots.length} shots, average ${(total / Math.max(1, shots.length)).toFixed(1)}s`,
    sound: draft.sound,
    characters: draft.characters,
    environments: draft.environments,
    shots: shots.map((s, i) => ({
      index: i,
      start: s.start,
      end: s.end,
      keyframes: args.frames[i] ?? [],
      cutStrength: s.cutStrength,
      ...draft.shots[i],
    })),
    ...(args.notice ? { notice: args.notice } : {}),
  };
}

export interface ShotPrompt {
  n: number;
  /** The compiled H3 prompt (official base / Ref2VA format from the Lab's compiler). */
  prompt: string;
  spec: ShotSpec;
  lint: LintFinding[];
}

export interface Recreation {
  production: Production;
  prompts: ShotPrompt[];
  applied: string[];
  unmatched: string[];
}

/**
 * The H3 Lab's own recreation, run on a throwaway lab state: the owner's
 * changes become bible entries, recreate() maps the reference's people and
 * places to them, compileProduction() writes each scene's prompt with the
 * current Master Guide strategy for the genre, lint() checks each.
 */
export function buildRecreation(bp: Blueprint, changes: H3Changes, title: string, now: string): Recreation {
  const a = applyChanges(bp, changes, now);
  const lab = initialState(now);
  lab.characters = a.characters;
  lab.environments = a.environments;
  const prod = recreate(lab, a.blueprint, title, a.castMap, a.envMap, now);
  prod.continuityRules = prod.continuityRules.map((r) => (/[.!?]$/.test(r.trim()) ? r : `${r.trim()}.`));
  if (changes.extra) prod.continuityRules.push(changes.extra);
  compileProduction(lab, prod.id, now);
  const prompts = prod.scenes
    .slice()
    .sort((x, y) => x.order - y.order)
    .map((sc, i) => {
      const prompt = sc.compiled?.prompt ?? "";
      return {
        n: i + 1,
        prompt,
        spec: sc.spec,
        lint: lint(sc.spec, { mode: "base", prompt, references: [], chars: prompt.length, words: prompt.split(/\s+/).filter(Boolean).length }),
      };
    });
  return { production: prod, prompts, applied: a.applied, unmatched: a.unmatched };
}
