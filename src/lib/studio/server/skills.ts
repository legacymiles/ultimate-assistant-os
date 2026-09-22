import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Reads Studio skill files (src/lib/studio/skills/<id>.md) at request time.
// They travel with the deployment via outputFileTracingIncludes in
// next.config — nothing imports them, so tracing can't infer it.
// ---------------------------------------------------------------------------

const cache = new Map<string, string | null>();

export async function loadSkill(id: string): Promise<string | null> {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  if (process.env.NODE_ENV === "production" && cache.has(id)) return cache.get(id)!;
  let text: string | null = null;
  try {
    text = await readFile(path.join(process.cwd(), "src", "lib", "studio", "skills", `${id}.md`), "utf8");
  } catch {
    // No skill file yet: the catalog's short brief stands in.
  }
  cache.set(id, text);
  return text;
}

export async function loadSkills(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of [...new Set(ids)]) {
    const text = await loadSkill(id);
    if (text) out.set(id, text);
  }
  return out;
}
