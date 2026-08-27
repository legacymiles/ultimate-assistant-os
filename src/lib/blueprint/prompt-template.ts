// ---------------------------------------------------------------------------
// Deterministic Claude Code prompt assembler.
//
// This is both (a) the offline fallback for the `prompt` stage and (b) the
// canonical structure the AI is asked to follow. Given a finished Overview it
// produces a single, well-organised prompt an agent can act on directly.
// ---------------------------------------------------------------------------

import { KIND_LABELS, type Brief, type Overview } from "./types";
import { toTechnique } from "./skill-router";

export function assemblePrompt(
  overview: Overview,
  brief: Brief,
  opts: { portable?: boolean } = {},
): string {
  const portable = opts.portable ?? false;
  const lines: string[] = [];

  const title = overview.one_liner.trim() || "Build the following project";
  lines.push(`# ${title}`, "");

  // ----- Objective --------------------------------------------------------
  lines.push("## Objective");
  lines.push(
    overview.purpose.trim() ||
      "Build the project described below, prioritising the main features.",
  );
  lines.push("");

  // ----- Design direction & quality bar -----------------------------------
  const bar = overview.quality_bar.trim();
  const direction = overview.design_direction.trim();
  if (bar || direction) {
    lines.push("## Design direction & quality bar");
    if (direction) lines.push(direction, "");
    if (bar) {
      lines.push(
        `Hold this to **${bar}**. Fetch that reference and treat it as the standard ` +
          `to BEAT — beat it specifically on ${winAxes(direction)}.`,
      );
    }
    lines.push("");
  }

  // ----- Recommended approach ---------------------------------------------
  if (overview.recommended_skills.length) {
    lines.push("## Recommended approach");
    for (const r of overview.recommended_skills) {
      if (portable) {
        lines.push(`- ${capitalize(toTechnique(r.skill))}.`);
      } else {
        lines.push(`- Use the \`${r.skill}\` skill for ${r.why}.`);
      }
    }
    lines.push("");
  }

  // ----- Context ----------------------------------------------------------
  lines.push("## Context");
  lines.push(`- **Type:** ${KIND_LABELS[brief.kind]}`);
  if (brief.audience.trim()) lines.push(`- **Audience:** ${brief.audience.trim()}`);
  for (const a of brief.answers) {
    if (a.answer.trim()) lines.push(`- **${stripQ(a.question)}** ${a.answer.trim()}`);
  }
  lines.push("");

  // ----- Main features ----------------------------------------------------
  lines.push("## Main features (must-have — these define the product)");
  if (overview.core_features.length === 0) {
    lines.push("_None specified — infer sensible core features from the objective._");
  } else {
    overview.core_features.forEach((f, i) => {
      lines.push(`${i + 1}. **${f.title.trim()}**`);
      if (f.description.trim()) lines.push(`   ${f.description.trim()}`);
      lines.push(`   - _Done when:_ ${doneWhen(f.title)}`);
    });
  }
  lines.push("");

  // ----- Supporting features ---------------------------------------------
  if (overview.supporting_features.length) {
    lines.push("## Supporting features (secondary — build after the main features)");
    for (const f of overview.supporting_features) {
      const desc = f.description.trim() ? ` — ${f.description.trim()}` : "";
      lines.push(`- **${f.title.trim()}**${desc}`);
    }
    lines.push("");
  }

  // ----- Tech & constraints ----------------------------------------------
  lines.push("## Tech & constraints");
  if (overview.stack.length) {
    for (const s of overview.stack) lines.push(`- ${s}`);
  } else {
    lines.push(
      "- Choose an appropriate, modern stack and briefly justify the choice.",
    );
  }
  lines.push(
    "- Responsive and accessible (keyboard navigation, sensible contrast, honours reduced motion).",
  );
  lines.push("");

  // ----- Open questions ---------------------------------------------------
  if (overview.open_questions.length) {
    lines.push("## Open questions to resolve first");
    for (const q of overview.open_questions) lines.push(`- ${q}`);
    lines.push("");
  }

  // ----- Working agreement ------------------------------------------------
  lines.push("## How to work");
  lines.push(
    "- Start by restating your understanding in one or two lines, and ask about anything ambiguous **before** writing code.",
    "- Build the main features first and get them working end-to-end; treat supporting features as follow-ups.",
    "- Keep components small and composable; verify the app actually runs before claiming it's done.",
  );
  lines.push("");

  // ----- Quality gate -----------------------------------------------------
  if (bar) {
    lines.push("## Quality gate");
    if (portable) {
      lines.push(
        `After a working build, iterate against **${bar}**: compare your work to that ` +
          `reference with fresh eyes and keep refining until it clearly beats it.`,
      );
    } else {
      lines.push(
        `After a working build, run the \`gauntlet-loop\` skill against **${bar}**: a ` +
          `Builder makes the work, a fresh blind Critic compares it against the bar, and ` +
          `you iterate until the Critic — blind — picks your work over the bar. Stop on ` +
          `winning that comparison, not on a fixed round count.`,
      );
    }
  }

  return lines.join("\n").trim() + "\n";
}

/** A short phrase naming the axes to beat, inferred from the design direction. */
function winAxes(direction: string): string {
  const d = direction.toLowerCase();
  if (/motion|animat|scroll|3d|webgl|interactiv|cinematic/.test(d)) {
    return "motion polish, the hero moment, and overall craft";
  }
  if (/clean|minimal|editorial|type|content/.test(d)) {
    return "typographic polish, clarity, and the core experience";
  }
  return "polish, the core experience, and overall craft";
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Wrap a finished build prompt in a paste-ready Builder-vs-Critic gauntlet
 * handoff — the "Copy for Gauntlet" export for the web surfaces, which can't
 * invoke the skill directly.
 */
export function assembleGauntletHandoff(prompt: string, overview: Overview): string {
  const bar = overview.quality_bar.trim() || "the best-in-class reference for this kind of product";
  return [
    "ultracode /loop",
    "",
    `Build the project specified below, then push it past "good enough" with a ` +
      `Builder-vs-Critic gauntlet against **${bar}**.`,
    "",
    `Decompose into the smallest shippable pieces. For each piece run two independent ` +
      `agents: a BUILDER that produces/refines it, and a fresh blind CRITIC that compares ` +
      `it against ${bar} (labels stripped, order randomized) and picks a winner plus every ` +
      `concrete way the loser falls short. Feed the top gap back to the builder and loop ` +
      `until the critic, blind, picks your work over the bar — never stop on a round count.`,
    "",
    "--- BUILD SPEC ---",
    "",
    prompt.trim(),
  ].join("\n");
}

/** Turn "What is the goal?" into "What is the goal?:" style context labels. */
function stripQ(q: string): string {
  const t = q.trim();
  return t.endsWith("?") || t.endsWith(":") ? t : `${t}:`;
}

/** A light, generic acceptance line derived from a feature title. */
function doneWhen(title: string): string {
  const t = title.trim().replace(/\.$/, "");
  if (!t) return "the feature works as described.";
  const lower = t[0].toLowerCase() + t.slice(1);
  return `a user can use ${lower} and it behaves as described.`;
}

/** Render the Overview itself as a portable markdown spec (the export). */
export function overviewToMarkdown(overview: Overview, brief: Brief): string {
  const lines: string[] = [];
  lines.push(`# ${overview.one_liner.trim() || "Project overview"}`, "");
  lines.push(`> ${KIND_LABELS[brief.kind]}${brief.audience.trim() ? ` · for ${brief.audience.trim()}` : ""}`, "");
  if (overview.purpose.trim()) lines.push(overview.purpose.trim(), "");

  if (overview.design_direction.trim() || overview.quality_bar.trim()) {
    lines.push("## Design direction");
    if (overview.design_direction.trim()) lines.push(overview.design_direction.trim());
    if (overview.quality_bar.trim()) lines.push(`**Quality bar to beat:** ${overview.quality_bar.trim()}`);
    lines.push("");
  }

  if (overview.recommended_skills.length) {
    lines.push("## Recommended skills");
    overview.recommended_skills.forEach((r) =>
      lines.push(`- **${r.skill}** — ${r.why}`),
    );
    lines.push("");
  }

  lines.push("## Core features");
  overview.core_features.forEach((f) =>
    lines.push(`- **${f.title.trim()}** — ${f.description.trim()}`),
  );
  lines.push("");

  if (overview.supporting_features.length) {
    lines.push("## Supporting features");
    overview.supporting_features.forEach((f) =>
      lines.push(`- **${f.title.trim()}** — ${f.description.trim()}`),
    );
    lines.push("");
  }

  if (overview.stack.length) {
    lines.push("## Suggested stack");
    overview.stack.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }

  if (overview.open_questions.length) {
    lines.push("## Open questions");
    overview.open_questions.forEach((q) => lines.push(`- ${q}`));
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}
