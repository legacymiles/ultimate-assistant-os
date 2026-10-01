// The video methods — one folder each.
//
// The seed registry is the truth about what exists; the disk scan only fills in
// the live `description` for the skills that are genuinely video methods, so a
// skill edited on disk shows its current description without anyone editing
// code. An earlier version scanned every skill whose text mentioned "video" and
// swept in website builders and design skills, which made the list useless.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { SEED_METHODS, VIDEO_SKILL_IDS, type Method } from "@/lib/h3-lab/methods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOTS = [join(homedir(), ".claude", "skills"), join(process.cwd(), "skills")];

/** The `description:` value from YAML frontmatter, unfolding wrapped lines. */
function description(md: string): string | undefined {
  if (!md.startsWith("---")) return undefined;
  const end = md.indexOf("\n---", 3);
  if (end < 0) return undefined;
  let value = "";
  let capturing = false;
  for (const line of md.slice(3, end).split("\n")) {
    const m = /^([a-z_]+):\s*(.*)$/i.exec(line);
    if (m) {
      if (capturing) break;
      if (m[1] !== "description") continue;
      capturing = true;
      value = m[2];
    } else if (capturing && /^\s+\S/.test(line)) {
      value = `${value} ${line.trim()}`;
    }
  }
  // `description: >-` leaves its folded-block marker as the first characters.
  return value.replace(/^[>|][-+]?\s*/, "").trim() || undefined;
}

export async function GET() {
  const methods: Method[] = SEED_METHODS.map((m) => ({ ...m }));

  // Refresh skill descriptions from disk, where they are actually maintained.
  for (const method of methods) {
    if (method.kind !== "skill" || !VIDEO_SKILL_IDS.has(method.id)) continue;
    for (const root of ROOTS) {
      try {
        const live = description(await readFile(join(root, method.id, "SKILL.md"), "utf8"));
        if (live) {
          method.description = live;
          break;
        }
      } catch {
        // Not in this root, or no skills dir at all on a deploy.
      }
    }
  }

  return NextResponse.json({ methods });
}
