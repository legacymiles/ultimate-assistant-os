import { NextResponse } from "next/server";
import { CATEGORIES, WORKFLOWS } from "@/lib/studio/workflows";
import { loadSkills } from "@/lib/studio/server/skills";
import type { Skill } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// The Studio agents, as Skills Library records.
//
// Studio workflows and the Skills Library grew up as two separate things: a
// workflow is a card you pick in Studio, a skill is a prompt you keep in the
// library. But they are the same object to the owner — "the skills I have" —
// and until now the Studio ones were invisible in the Skills tab.
//
// So this serves them in the library's own shape. The bodies are the real skill
// files on disk (src/lib/studio/skills/<id>.md), which is why this is a route
// and not a client import: nothing bundles those, they travel with the
// deployment through outputFileTracingIncludes.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

const categoryLabel = new Map(CATEGORIES.map((c) => [c.id, c.label]));

/** A stable date so the library does not reorder itself on every request. */
const SHIPPED = "2026-01-01T00:00:00.000Z";

export async function GET() {
  const bodies = await loadSkills(WORKFLOWS.map((w) => w.id));

  const skills: Skill[] = WORKFLOWS.map((w) => {
    const variants = w.variants?.length ? ` · ${w.variants.length} styles` : "";
    return {
      id: `studio-${w.id}`,
      title: w.name,
      overview: `${w.blurb}. ${w.medium === "video" ? "Video" : "Image"} · ${w.format}${variants}.`,
      // The full skill when one exists; otherwise the catalog brief, so a
      // workflow always has something readable rather than an empty page.
      body:
        bodies.get(w.id) ??
        `# ${w.name}\n\n${w.brief}\n\n**Format:** ${w.format}\n\n_This workflow has no full skill file yet; the brief above is what Jarvis runs from._`,
      source: "studio",
      slug: `studio:${w.id}`,
      origin: categoryLabel.get(w.category) ?? "Studio",
      // Where it actually lives, so the detail view can offer to open it.
      sourceUrl: `/apps/jarvis?tab=studio&workflow=${w.id}`,
      createdAt: SHIPPED,
      updatedAt: SHIPPED,
    };
  });

  return NextResponse.json(
    { skills },
    // The catalog only changes on deploy, so let the browser keep it.
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } },
  );
}
