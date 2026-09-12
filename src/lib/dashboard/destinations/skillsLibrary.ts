import { createSkill } from "@/lib/skills/store";
import type { Destination } from "./types";

// ---------------------------------------------------------------------------
// Screenshot of a prompt or skill → a record in the Skills Library.
//
// The case this serves: a good system prompt, agent instruction or skill
// definition seen somewhere it cannot be copied from — a talk slide, a
// screenshot in a thread, someone's terminal. Retyping it is exactly the chore
// worth automating, and the vision pass already transcribes text verbatim.
//
// `body` is therefore the load-bearing field, and the prompt tells the model to
// transcribe rather than summarise. A "helpful" paraphrase of a prompt is
// useless — the wording IS the artifact.
// ---------------------------------------------------------------------------

export interface SkillFields {
  title: string;
  overview: string;
  body: string;
  truncated: boolean;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const skillsLibraryDestination: Destination<SkillFields> = {
  id: "skills-library",
  label: "Skills Library",
  appSlug: "skills-library",

  hint:
    '"skills-library" — the photo shows a PROMPT, a skill definition, an agent ' +
    "instruction, a system message or a reusable block of instruction text " +
    "worth keeping and reusing later. Route here when the value of the image is " +
    "the WORDING itself, not the fact it describes.",

  fields: [
    { name: "title", type: "string", describe: "Short name for the prompt or skill." },
    {
      name: "overview",
      type: "string",
      describe: "One sentence: what this prompt is for and when you would reach for it.",
    },
    {
      name: "body",
      type: "string",
      describe:
        "The prompt text TRANSCRIBED VERBATIM, preserving line breaks, bullets " +
        "and formatting. Do not summarise, improve or complete it — the exact " +
        "wording is the whole point. Transcribe only what is legible.",
    },
    {
      name: "truncated",
      type: "boolean",
      describe:
        "true if the text is cut off by the edge of the image or unreadable in " +
        "places, so the user is told the capture is partial.",
    },
  ],

  parse(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const title = str(r.title);
    const body = str(r.body);
    // A skill with no text is not a skill — a screenshot the model could not
    // read is better dropped than saved as an empty record the user later finds
    // and cannot explain.
    if (!title || !body) return null;
    return {
      title,
      overview: str(r.overview),
      body,
      truncated: r.truncated === true,
    };
  },

  preview(f) {
    const lines: string[] = [];
    if (f.overview) lines.push(f.overview);
    const preview = f.body.split("\n").slice(0, 3).join(" ").slice(0, 160);
    lines.push(`"${preview}${f.body.length > 160 ? "…" : ""}"`);
    lines.push(`${f.body.length} characters transcribed`);
    return {
      title: f.title,
      where: "Skills Library",
      lines,
      unverified: f.truncated
        ? "Text runs past the edge of the photo — this capture is incomplete"
        : undefined,
    };
  },

  async commit(f) {
    await createSkill({ title: f.title, overview: f.overview, body: f.body });
  },
};
