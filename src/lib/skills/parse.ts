// ---------------------------------------------------------------------------
// Skills Library — frontmatter parser.
// Claude skill files start with a YAML frontmatter block:
//
//   ---
//   name: some-skill-name
//   description: What the skill does.
//   ---
//   # Body...
//
// We best-effort extract `name` -> title and `description` -> overview. This
// handles inline values, quoted values, and multi-line YAML block scalars
// (`description: >-` / `|` followed by indented lines), which several real
// skills use. Everything stays editable afterwards, so it need not be perfect.
// ---------------------------------------------------------------------------

export interface ParsedSkill {
  title: string;
  overview: string;
}

function stripQuotes(value: string): string {
  const v = value.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1);
    }
  }
  return v;
}

/** Is this a top-level `key:` line (no leading indentation)? */
function topLevelKey(line: string): RegExpMatchArray | null {
  return line.match(/^([A-Za-z0-9_-]+):(.*)$/);
}

/** Parse the frontmatter block into a flat map, handling YAML block scalars. */
function parseBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const m = topLevelKey(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1].toLowerCase();
    const rest = m[2].trim();

    // Block scalar: `>`, `>-`, `>+`, `|`, `|-`, `|+`
    if (rest[0] === ">" || rest[0] === "|") {
      const folded = rest[0] === ">";
      const collected: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === "") {
          collected.push("");
          j++;
          continue;
        }
        if (!/^\s/.test(l)) break; // a new top-level key ends the scalar
        collected.push(l.replace(/^\s+/, ""));
        j++;
      }
      const trimmed = collected.map((s) => s.trim());
      out[key] = folded
        ? trimmed.filter(Boolean).join(" ")
        : trimmed.join("\n").trim();
      i = j;
    } else {
      out[key] = stripQuotes(rest);
      i++;
    }
  }
  return out;
}

/**
 * Extract a title + overview from a pasted skill markdown document.
 * Falls back to the first `# Heading` for the title when no `name:` is present.
 * Returns empty strings when nothing can be found (caller fills in manually).
 */
export function parseSkillFrontmatter(markdown: string): ParsedSkill {
  const result: ParsedSkill = { title: "", overview: "" };
  if (!markdown) return result;

  const text = markdown.replace(/^﻿/, ""); // strip BOM

  const fmMatch = text.match(/^\s*---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const map = parseBlock(fmMatch[1]);
    if (map.name) result.title = map.name;
    if (map.description) result.overview = map.description;
  }

  // Fallback title: first markdown H1 in the body.
  if (!result.title) {
    const h1 = text.match(/^\s*#\s+(.+?)\s*$/m);
    if (h1) result.title = h1[1].trim();
  }

  return result;
}
