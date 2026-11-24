// ---------------------------------------------------------------------------
// Pre-render checks — the Master Guide's checklist, made executable.
//
// Each check is a measurement of the compiled prompt or the spec, never a
// guess. Ideas for the check list come from the guide's documented failure
// patterns and from imbutus/ComfyUI-MiniMaxDirector's linter (MIT) — this is
// an independent implementation, not a port.
// ---------------------------------------------------------------------------

import type { Compiled } from "./compile";
import type { ShotSpec } from "./model";

export interface LintFinding {
  level: "error" | "warn" | "info";
  code: string;
  message: string;
}

const WORDS_PER_SECOND = 2.5;

/** Just the shot blocks and the closing block: what is written per shot. */
export function describedLength(prompt: string): number {
  const start = prompt.search(/(?:integrated_multimodal_description|detailed_description):/);
  const body = start >= 0 ? prompt.slice(start) : prompt;
  const end = body.search(/\noverall_soundscape:/);
  return (end >= 0 ? body.slice(0, end) : body).length;
}

const POSITION_WORDS = /\b(at the far end|in the foreground|in the background|behind (?:him|her|them)|close behind|far away|in the distance|next to|beside)\b/gi;

export function lint(spec: ShotSpec, compiled: Compiled): LintFinding[] {
  const out: LintFinding[] = [];
  const shots = Math.max(1, (compiled.prompt.match(/\[Shot \d+\]/g) ?? []).length);
  // The ~1,500 ceiling is per shot of PROSE. subject_definitions,
  // retention_analysis and the two sound lines are fixed overhead for the whole
  // generation, so counting them per shot would fail a perfectly good one-shot
  // prompt for describing its own soundscape.
  const perShot = describedLength(compiled.prompt) / shots;

  if (perShot > 1500) out.push({ level: "error", code: "too-long", message: `${Math.round(perShot)} characters per shot — over the ~1,500 ceiling where H3 starts compositing instead of performing.` });
  else if (perShot > 1100) out.push({ level: "warn", code: "long", message: `${Math.round(perShot)} characters per shot — near the ceiling.` });

  if (!spec.action.trim()) out.push({ level: "error", code: "no-change", message: "Nothing happens: the shot needs an action that physically changes, or it renders as a still photograph." });

  // Two positions for one subject → two of them.
  const positions = compiled.prompt.match(POSITION_WORDS) ?? [];
  if (positions.length >= 3) out.push({ level: "warn", code: "positions", message: `Placement words appear ${positions.length}× (${[...new Set(positions.map((p) => p.toLowerCase()))].join(", ")}). Check nobody is described in two positions.` });

  // Dialogue that cannot fit.
  const words = spec.dialogue.reduce((n, d) => n + d.line.split(/\s+/).filter(Boolean).length, 0);
  const capacity = Math.floor(spec.durationSec * WORDS_PER_SECOND);
  if (words > capacity) out.push({ level: "error", code: "dialogue-overrun", message: `${words} words of dialogue in ${spec.durationSec}s — about ${capacity} fit at 2.5 words/s. The rest gets cut off.` });

  if (spec.beats.length > 3 && spec.durationSec <= 15) out.push({ level: "warn", code: "beats", message: `${spec.beats.length} beats in one generation — more than three timed beats per shot makes H3 freeze. Merge or split.` });

  if (spec.durationSec < 4 || spec.durationSec > 15) out.push({ level: "error", code: "duration", message: `H3 renders 4-15 s per generation; ${spec.durationSec}s needs chaining or a longer shot.` });

  if (/\d+\s?mm\b|f\/\d/.test(compiled.prompt) && !/depth of field|shallow|wide-angle|long lens|telephoto/i.test(compiled.prompt)) {
    out.push({ level: "info", code: "lens-numbers", message: "Lens given only as numbers — say it in words too (\"wide-angle, shallow depth of field\")." });
  }

  if (/\[(push in|pan left|pan right|zoom in|tracking shot)\]/i.test(compiled.prompt)) out.push({ level: "error", code: "bracket-camera", message: "Bracket camera tags are Hailuo-02 syntax; H3 ignores them." });

  if (compiled.references.length > 9) out.push({ level: "error", code: "too-many-refs", message: "More than nine reference pictures." });

  const defined = new Set((compiled.prompt.match(/<Subject \d+>/g) ?? []));
  if (defined.size > compiled.references.length) out.push({ level: "error", code: "phantom-ref", message: "A <Subject N> is named that no attached picture backs." });

  if (!/overall_soundscape:/.test(compiled.prompt)) out.push({ level: "error", code: "no-sound", message: "No soundscape — H3 always generates audio; an empty one means the model picks." });

  if (spec.characterIds.length >= 2 && /\b(grapple|wrestle|carry|carries|embrace|hug|tangle)/i.test(spec.action + spec.beats.join(" "))) {
    out.push({ level: "warn", code: "contact", message: "Two bodies in close contact — H3's most fragile case (limbs merge). Keep contact simple or bodies apart." });
  }

  if (/\b(walks in|enters|comes in|arrives)\b/i.test(spec.action) && !/already/i.test(spec.action)) {
    out.push({ level: "info", code: "entrance", message: "H3 ignores off-frame entrances — start the subject already in frame, mid-event." });
  }

  return out;
}

export function lintSummary(findings: LintFinding[]): { errors: number; warnings: number } {
  return {
    errors: findings.filter((f) => f.level === "error").length,
    warnings: findings.filter((f) => f.level === "warn").length,
  };
}
