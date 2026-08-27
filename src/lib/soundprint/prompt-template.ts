// ---------------------------------------------------------------------------
// Soundprint — turning a breakdown into the two fields you actually paste.
//
// House rules, learned from what these platforms reward:
//   • Style reads as a dense comma-separated descriptor list, most important
//     first. Genre → mood → instrumentation → tempo → vocal → production.
//   • Never name an artist. Platforms filter them, and a texture description
//     steers the generation harder anyway.
//   • Lyrics carry [Section] meta-tags. They're how you control arrangement —
//     including how you stop the full band from crashing in.
// ---------------------------------------------------------------------------

import { PLATFORMS } from "./platforms";
import {
  SECTION_LABELS,
  type PerformerSwap,
  type PlatformId,
  type PromptSet,
  type SongBrief,
  type StyleBreakdown,
} from "./types";

/** Joins descriptor lists, de-duplicating and trimming to the platform ceiling. */
function joinStyle(parts: string[], limit: number): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  let length = 0;

  for (const raw of parts) {
    const part = raw.trim().replace(/,+$/, "");
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    const cost = part.length + (kept.length ? 2 : 0);
    if (length + cost > limit) continue;
    seen.add(key);
    kept.push(part);
    length += cost;
  }
  return kept.join(", ");
}

export function buildStyle(
  breakdown: StyleBreakdown,
  brief: SongBrief,
  platform: PlatformId,
  performers: PerformerSwap[],
): string {
  const p = PLATFORMS[platform];
  const m = brief.manual;
  const vocal = breakdown.vocal;

  const parts: string[] = [
    ...breakdown.genres,
    ...m.genres,
    ...breakdown.moods,
    ...m.moods,
    ...breakdown.instrumentation,
    ...m.instruments,
  ];

  if (breakdown.tempo) parts.push(breakdown.tempo);
  if (breakdown.key) parts.push(breakdown.key);

  if (brief.vocals === "instrumental") {
    parts.push("instrumental", "no vocals");
  } else if (vocal) {
    if (vocal.range) parts.push(vocal.range);
    parts.push(...vocal.texture, ...vocal.delivery, ...vocal.effects);
  }
  // Voice profiles that replaced a named performer carry real signal.
  for (const swap of performers) {
    if (swap.profile && !swap.profile.startsWith("Describe the voice")) parts.push(swap.profile);
  }
  parts.push(...m.vocalTraits);

  parts.push(...breakdown.production, ...m.production);
  if (breakdown.era) parts.push(breakdown.era);

  // Platforms without a negative field need the exclusions inline or the
  // arrangement wanders straight into the thing you didn't want.
  if (!p.hasExcludeField && breakdown.avoid.length) {
    parts.push(...breakdown.avoid.map((a) => `no ${stripNo(a)}`));
  }

  const style = joinStyle(parts, p.styleSoftLimit);
  // An empty style field is worse than a rough one — always ship something
  // usable, built from whatever the section and the measurements gave us.
  return style || joinStyle(fallbackStyle(breakdown, brief), p.styleSoftLimit);
}

function fallbackStyle(breakdown: StyleBreakdown, brief: SongBrief): string[] {
  const section = SECTION_LABELS[brief.section].toLowerCase();
  const parts: string[] = [];

  if (breakdown.tempo) parts.push(breakdown.tempo);
  if (breakdown.key) parts.push(breakdown.key);
  parts.push(`${section}-style texture`);
  if (brief.scope === "hold") parts.push("sparse arrangement", "restrained throughout");
  parts.push(brief.vocals === "instrumental" ? "instrumental" : "vocal-led");
  if (breakdown.structure) parts.push("atmospheric");
  return parts;
}

function stripNo(s: string): string {
  return s.replace(/^no\s+/i, "").trim();
}

export function buildExclude(breakdown: StyleBreakdown, platform: PlatformId): string {
  if (!PLATFORMS[platform].hasExcludeField) return "";
  return joinStyle(breakdown.avoid.map(stripNo), 200);
}

/**
 * The lyrics field. When the model writes real lyrics we pass them through
 * untouched; this builds the arrangement scaffold used offline and for
 * instrumental tracks.
 */
export function buildLyricsScaffold(breakdown: StyleBreakdown, brief: SongBrief): string {
  const section = SECTION_LABELS[brief.section];
  const holding = brief.scope === "hold";
  const lines: string[] = [];

  const texture =
    breakdown.instrumentation.slice(0, 3).join(", ") ||
    brief.manual.instruments.slice(0, 3).join(", ") ||
    "the reference texture";

  if (brief.vocals === "instrumental") {
    lines.push(`[Intro — ${texture}, no drums]`);
    lines.push("");
    lines.push(`[Instrumental — hold the ${section.toLowerCase()} mood]`);
    lines.push("");
    if (holding) {
      lines.push("[Instrumental — same texture, never builds to a full band]");
      lines.push("");
      lines.push("[Outro — fades on the same figure]");
    } else {
      lines.push("[Build — add layers gradually]");
      lines.push("");
      lines.push("[Outro]");
    }
    return lines.join("\n");
  }

  lines.push(`[Intro — ${texture}, no drums]`);
  lines.push("");
  lines.push("[Verse]");
  lines.push("Write four lines here in the mood described above.");
  lines.push("Keep the phrasing conversational and unhurried.");
  lines.push("");

  if (holding) {
    lines.push("[Verse 2 — same restraint, no drums]");
    lines.push("Two more lines, slightly more open than the first verse.");
    lines.push("");
    lines.push("[Outro — resolve on the opening figure]");
  } else {
    lines.push("[Pre-Chorus — start lifting]");
    lines.push("Two lines that raise the stakes.");
    lines.push("");
    lines.push("[Chorus]");
    lines.push("Four lines carrying the hook.");
    lines.push("");
    lines.push("[Bridge]");
    lines.push("Two lines that turn the idea.");
    lines.push("");
    lines.push("[Outro]");
  }

  return lines.join("\n");
}

/** Practical, platform-specific advice shown under the prompts. */
export function buildNotes(
  breakdown: StyleBreakdown,
  brief: SongBrief,
  platform: PlatformId,
): string[] {
  const p = PLATFORMS[platform];
  const notes = [...p.tips];

  if (brief.scope === "hold") {
    notes.push(
      "You asked it to stay in this texture — the exclusions and the [no drums] " +
        "tags are what stop it from dropping into the full arrangement.",
    );
  }
  if (breakdown.avoid.length && !p.hasExcludeField) {
    notes.push("This platform has no exclude field, so the “no …” terms are inside the style prompt.");
  }
  if (brief.vocals === "instrumental") {
    notes.push("Generate two or three takes — instrumentals vary more than vocal tracks.");
  }
  if (!breakdown.genres.length) {
    notes.push(
      "No genre was identified from your description — open “Steer it by hand” and pick " +
        "a couple, or name the reference track. Genre is the single biggest lever on the result.",
    );
  }
  return notes;
}

export function buildTitle(breakdown: StyleBreakdown, brief: SongBrief): string {
  const mood = breakdown.moods[0] ?? brief.manual.moods[0] ?? "";
  const genre = breakdown.genres[0] ?? brief.manual.genres[0] ?? "track";
  const section = SECTION_LABELS[brief.section].toLowerCase();
  const lead = [mood, genre].filter(Boolean).join(" ");
  return titleCase(`${lead} — ${section} feel`);
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function assemblePrompts(
  breakdown: StyleBreakdown,
  brief: SongBrief,
  platform: PlatformId,
  performers: PerformerSwap[],
  lyrics?: string,
): PromptSet {
  return {
    platform,
    title: buildTitle(breakdown, brief),
    style: buildStyle(breakdown, brief, platform, performers),
    lyrics: lyrics?.trim() || buildLyricsScaffold(breakdown, brief),
    exclude: buildExclude(breakdown, platform),
    notes: buildNotes(breakdown, brief, platform),
  };
}

/** Everything as one copyable block, for the Download button. */
export function promptsToMarkdown(prompts: PromptSet, breakdown: StyleBreakdown): string {
  const p = PLATFORMS[prompts.platform];
  const out: string[] = [
    `# ${prompts.title}`,
    "",
    `**Platform:** ${p.name} — ${p.url}`,
    "",
    `## ${p.styleFieldName}`,
    "",
    prompts.style,
    "",
  ];

  if (prompts.exclude) {
    out.push("## Exclude Styles", "", prompts.exclude, "");
  }

  out.push(`## ${p.lyricsFieldName}`, "", prompts.lyrics, "", "## Style breakdown", "");

  if (breakdown.understood) out.push(`_${breakdown.understood}_`, "");
  const row = (label: string, value: string | string[]) => {
    const v = Array.isArray(value) ? value.join(", ") : value;
    if (v) out.push(`- **${label}:** ${v}`);
  };
  row("Genres", breakdown.genres);
  row("Mood", breakdown.moods);
  row("Tempo", breakdown.tempo);
  row("Key", breakdown.key);
  row("Instrumentation", breakdown.instrumentation);
  row("Production", breakdown.production);
  row("Structure", breakdown.structure);
  row("Era", breakdown.era);
  if (breakdown.vocal) {
    row("Vocal range", breakdown.vocal.range);
    row("Vocal texture", breakdown.vocal.texture);
    row("Vocal delivery", breakdown.vocal.delivery);
    row("Vocal treatment", breakdown.vocal.effects);
  }
  row("Avoid", breakdown.avoid);

  if (prompts.notes.length) {
    out.push("", "## Notes", "");
    for (const n of prompts.notes) out.push(`- ${n}`);
  }
  return out.join("\n");
}
