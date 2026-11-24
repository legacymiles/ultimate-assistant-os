// ---------------------------------------------------------------------------
// The Master Prompt Guide: versions, changes, rollback, and the ONE skill.
//
// Rules this file enforces:
//  - Nothing rewrites a version. Approving a change makes a NEW version;
//    rolling back makes a new version that copies an old one.
//  - Every version points at the change that produced it, and every change
//    carries what/why/problem/experiments/evidence.
//  - Rejected and pending changes stay in history.
// ---------------------------------------------------------------------------

import type { ChangeRecord, GenreId, GuidePatch, GuideSection, GuideVersion, LabState, Strategy } from "./model";
import { BASE_STRATEGY, cleanOverrides, KNOBS, merge } from "./strategy";
import { GENRES } from "./genres";
import { seedSections } from "./guideSeed";

export type Guide = LabState["guide"];

export const SEED_CHANGE_ID = "change-seed";

export function seedGuide(now: string): Guide {
  const genreStrategy: Record<GenreId, Partial<Strategy>> = {};
  for (const m of GENRES) genreStrategy[m.id] = { ...m.strategy };
  const seed: ChangeRecord = {
    id: SEED_CHANGE_ID,
    kind: "seed",
    title: "Master Prompt Guide v1 — consolidated from the owner's H3 skills and MiniMax's official guides",
    why: "Five overlapping H3 skills disagreed on camera wording, length, cuts per generation and chain length. One guide settles each and marks the rest as open experiments.",
    problem: "No single source of truth for prompting H3; lessons were re-learned per film.",
    experimentIds: [],
    evidence: [
      { text: "h3-prompt: 8,031-char dolly-zoom prompt rendered two mothers; <1,500 chars per shot holds." },
      { text: "h3-prompt: 72 curated prompts — 4% name a focal length, 42% describe depth of field in words." },
      { text: "MiniMax-AI/MiniMax-H3 skills/h3-prompt-writing base-en.txt + ref-en.txt: official sections, keyframe lines, camera type+amplitude+speed, dialogue tags." },
      { text: "seesee75 ComfyUI-MiniMaxH3-Director paper: pinned head ~2.4 s, no cut in a part's last 2 s, audio dulls after ~4 joins (rules only; GPL code not used)." },
      { text: "Local WanGP install read 2026-11-24: pruned 20B int8 FL2VA/Ref2VA, Q2_K text encoder, turbo LoRAs, two-phase upscaler on disk." },
    ],
    patch: {},
    status: "approved",
    proposedBy: "seed",
    createdAt: now,
    decidedAt: now,
    version: 1,
  };
  const v1: GuideVersion = {
    version: 1,
    createdAt: now,
    strategy: { ...BASE_STRATEGY },
    genreStrategy,
    sections: seedSections(),
    changeId: SEED_CHANGE_ID,
    summary: "Seed: h3-prompt + official MiniMax format + 43 genre modules",
  };
  return { versions: [v1], current: 1, changes: [seed], publishedVersion: null, publishedAt: null };
}

export function currentVersion(guide: Guide): GuideVersion {
  return guide.versions.find((v) => v.version === guide.current) ?? guide.versions[guide.versions.length - 1];
}

export function versionOf(guide: Guide, n: number): GuideVersion | undefined {
  return guide.versions.find((v) => v.version === n);
}

/** The strategy a genre uses under a version, with optional experiment overrides on top. */
export function strategyFor(version: GuideVersion, genre: GenreId, overrides?: Partial<Strategy>): Strategy {
  return merge(version.strategy, version.genreStrategy[genre], overrides);
}

export function applyPatch(prev: GuideVersion, patch: GuidePatch, version: number, changeId: string, summary: string, now: string): GuideVersion {
  const strategy = merge(prev.strategy, patch.strategy);
  const genreStrategy: Record<GenreId, Partial<Strategy>> = {};
  for (const [k, v] of Object.entries(prev.genreStrategy)) genreStrategy[k] = { ...v };
  for (const g of patch.genreStrategy ?? []) {
    genreStrategy[g.genre] = { ...(genreStrategy[g.genre] ?? {}), ...cleanOverrides(g.set) };
  }
  const sections = prev.sections.map((s) => ({ ...s }));
  for (const s of patch.sections ?? []) {
    const i = sections.findIndex((x) => x.id === s.id);
    if (i >= 0) sections[i] = { ...s };
    else sections.push({ ...s });
  }
  return { version, createdAt: now, strategy, genreStrategy, sections, changeId, summary };
}

function nextVersionNumber(guide: Guide): number {
  return Math.max(0, ...guide.versions.map((v) => v.version)) + 1;
}

/** Approve a pending change → a new current version. Returns the same guide if it cannot. */
export function approveChange(guide: Guide, id: string, now: string, note?: string): { guide: Guide; version: number | null } {
  const change = guide.changes.find((c) => c.id === id);
  if (!change || change.status !== "pending") return { guide, version: null };
  const n = nextVersionNumber(guide);
  const next = applyPatch(currentVersion(guide), change.patch, n, change.id, change.title, now);
  return {
    version: n,
    guide: {
      ...guide,
      versions: [...guide.versions, next],
      current: n,
      changes: guide.changes.map((c) =>
        c.id === id ? { ...c, status: "approved", decidedAt: now, decisionNote: note, version: n } : c,
      ),
    },
  };
}

export function rejectChange(guide: Guide, id: string, now: string, note?: string): Guide {
  return {
    ...guide,
    changes: guide.changes.map((c) =>
      c.id === id && c.status === "pending" ? { ...c, status: "rejected", decidedAt: now, decisionNote: note } : c,
    ),
  };
}

/** Roll back = a NEW version whose content copies `to`. History is never deleted. */
export function rollback(guide: Guide, to: number, why: string, changeId: string, now: string): Guide {
  const target = versionOf(guide, to);
  if (!target || to === guide.current) return guide;
  const n = nextVersionNumber(guide);
  const change: ChangeRecord = {
    id: changeId,
    kind: "rollback",
    title: `Roll back to v${to}`,
    why: why || "Owner rolled back.",
    problem: `v${guide.current} is being replaced by the content of v${to}.`,
    experimentIds: [],
    evidence: [],
    patch: {},
    status: "approved",
    proposedBy: "owner",
    createdAt: now,
    decidedAt: now,
    version: n,
  };
  const copy: GuideVersion = {
    ...target,
    version: n,
    createdAt: now,
    changeId,
    summary: `Rollback to v${to}`,
    sections: target.sections.map((s) => ({ ...s })),
    strategy: { ...target.strategy },
    genreStrategy: Object.fromEntries(Object.entries(target.genreStrategy).map(([k, v]) => [k, { ...v }])),
  };
  return { ...guide, versions: [...guide.versions, copy], current: n, changes: [...guide.changes, change] };
}

export interface VersionDiff {
  strategy: { knob: string; from: string; to: string }[];
  genres: { genre: string; knob: string; from: string | null; to: string | null }[];
  sectionsAdded: string[];
  sectionsChanged: string[];
  sectionsRemoved: string[];
}

export function diffVersions(a: GuideVersion, b: GuideVersion): VersionDiff {
  const strategy = KNOBS.filter((k) => a.strategy[k.knob] !== b.strategy[k.knob]).map((k) => ({
    knob: k.knob,
    from: a.strategy[k.knob],
    to: b.strategy[k.knob],
  }));
  const genres: VersionDiff["genres"] = [];
  const ids = new Set([...Object.keys(a.genreStrategy), ...Object.keys(b.genreStrategy)]);
  for (const g of ids) {
    for (const k of KNOBS) {
      const from = (a.genreStrategy[g]?.[k.knob] as string | undefined) ?? null;
      const to = (b.genreStrategy[g]?.[k.knob] as string | undefined) ?? null;
      if (from !== to) genres.push({ genre: g, knob: k.knob, from, to });
    }
  }
  const aMap = new Map(a.sections.map((s) => [s.id, s]));
  const bMap = new Map(b.sections.map((s) => [s.id, s]));
  return {
    strategy,
    genres,
    sectionsAdded: [...bMap.keys()].filter((k) => !aMap.has(k)),
    sectionsRemoved: [...aMap.keys()].filter((k) => !bMap.has(k)),
    sectionsChanged: [...bMap.keys()].filter((k) => aMap.has(k) && aMap.get(k)!.body !== bMap.get(k)!.body),
  };
}

function strategyTable(s: Strategy): string {
  return KNOBS.map((k) => {
    const v = k.values.find((x) => x.value === s[k.knob]);
    return `| ${k.label} | ${v?.label ?? s[k.knob]} | ${v?.does ?? ""} |`;
  }).join("\n");
}

/** The guide as one markdown document (the Guide page's "Read it all", and the skill body). */
export function guideMarkdown(v: GuideVersion, opts: { examples?: string[] } = {}): string {
  const core = v.sections.filter((s) => !s.genre);
  const genre = v.sections.filter((s) => s.genre);
  const parts = [
    `# H3 Master Prompt Guide — v${v.version}`,
    "",
    `> The ONE source of truth for prompting MiniMax H3. Maintained by H3 Prompt Lab (/apps/h3-experiments): every change below was approved with evidence, and the lab's experiments are separate until they are. Version ${v.version}, ${v.createdAt.slice(0, 10)}.`,
    "",
    "## Default compiler settings",
    "",
    "| Knob | Setting | What it does |",
    "|---|---|---|",
    strategyTable(v.strategy),
    "",
    ...core.flatMap((s) => [`## ${s.title}`, "", s.body, ""]),
    "## Genre modules",
    "",
    "Pick the genre first; its settings override the defaults above. Combine modules when a film mixes them (a fight inside a micro-drama: the fight module for that scene, the micro-drama module for identity).",
    "",
    ...genre.flatMap((s) => [`### ${s.title}`, "", s.body, ""]),
  ];
  if (opts.examples?.length) {
    parts.push("## Examples that scored well in the lab", "", ...opts.examples.map((e) => "```\n" + e + "\n```\n"));
  }
  return parts.join("\n");
}

export const SKILL_NAME = "h3-prompt";
export const SKILL_DESCRIPTION =
  "The ONE authoritative MiniMax H3 prompting skill — the approved Master Prompt Guide from H3 Prompt Lab: official production-brief format (base and Ref2VA), camera, shot structure and length, character and environment continuity, action choreography, dialogue, sound, chaining past 15 s, 43 genre modules (micro drama to fight scenes, trailers, game cinematics, ads), failure patterns and a pre-render checklist. Use whenever writing, reviewing or fixing a prompt for MiniMax H3 (or Hailuo/Seedance), compiling shots from a storyboard or reference images, and whenever a clip came back WARPED: a character appearing twice, a camera move flattened to a push-in, identity drift, frozen action.";

/** The SKILL.md the Publish button writes. */
export function skillMarkdown(v: GuideVersion, opts: { examples?: string[] } = {}): string {
  return [
    "---",
    `name: ${SKILL_NAME}`,
    `description: "${SKILL_DESCRIPTION.replace(/"/g, "'")}"`,
    "---",
    "",
    guideMarkdown(v, opts),
    "",
    "## Related",
    "",
    "- **H3 Prompt Lab** (`/apps/h3-experiments` in the hub) runs the experiments that change this guide. Propose a change there; never edit this file by hand.",
    "- `h3-scene-continuity` keeps `scripts/continuity.mjs` for measuring stitched films; `film-plan` decides what the shots ARE (its `references/cinematography.md`); this skill decides how they are worded.",
    "- Reference implementation in the hub: `src/lib/h3-lab/compile.ts` (the lab compiler) and `src/lib/smart-shot/h3prompt.ts` (Smart Shot).",
    "",
  ].join("\n");
}

export function sectionById(v: GuideVersion, id: string): GuideSection | undefined {
  return v.sections.find((s) => s.id === id);
}
