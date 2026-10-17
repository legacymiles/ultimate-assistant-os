import { NextResponse } from "next/server";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { PROJECTS } from "@/lib/catalog";
import { WORKFLOWS, cardStill } from "@/lib/studio/workflows";
import { parseSkillFrontmatter } from "@/lib/skills/parse";
import { flagsIn, proofIn, type QueueFact } from "@/lib/new-jarvis/queue";
import { taskFacts } from "@/lib/new-jarvis/tasks";

// ---------------------------------------------------------------------------
// The evidence behind the In Queue board.
//
// This route gathers FACTS, never verdicts: a page either exists on disk or it
// does not, a lib folder either holds test files or it does not, a SKILL.md
// either names a verification or it does not. The judging is in
// lib/new-jarvis/queue.ts, which is pure and tested; keeping the two apart is
// what lets the board explain itself without this route having an opinion.
//
// It reads the repo it is served from, so it has to stay on Node and dynamic.
// It works deployed as well as locally: apps and workflows come from the repo
// either way, and skills come from the committed `skills/` mirror when there
// is no ~/.claude to read (see /api/skills/scan for why that mirror exists).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Slugs whose code lives in a differently named folder.
 *
 * Copied from the table in CLAUDE.md rather than guessed, because guessing
 * wrong here does not throw — it silently reports "no tests" for an app with
 * fifty, and an honest board cannot afford that. A slug not listed here uses
 * its own name.
 */
const LIB_FOLDER: Record<string, string[]> = {
  dashboard: ["recall", "dashboard"],
  "prompt-architect": ["blueprint"],
  "tiktok-dances": ["dances", "dance-studio"],
  "fire-reveal": ["reveal"],
  "3d-studio": ["studio3d"],
  "cookbook-genie": ["cookbook"],
  "gods-eye-view": ["gods-eye"],
  "kart-showcase": ["kart"],
  "multi-order-calculator": ["calculator"],
  "std-safe": ["stdsafe"],
  "ea-feature-list": ["ea-features", "ea"],
  "website-redesigner": ["redesigner"],
  "seedance-studio": ["seedance"],
  "smart-shot-videos": ["smart-shot"],
  "video-studio-arena": ["video-studio"],
  "skills-library": ["skills"],
  "jarvis-audio-studio": ["jarvis-audio-studio", "mp3-download", "music-classified", "music-creator"],
  "slippery-escape": ["slippery"],
  "projects-timeline": ["repo"],
};

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** `it(` / `test(` cases in one spec file. */
function caseCount(body: string): number {
  return (body.match(/^\s*(?:it|test)(?:\.\w+)?\s*\(/gm) ?? []).length;
}

/**
 * Test files and total cases for one app, across every lib folder it owns.
 *
 * Counts the cases rather than only the files because "has a test file" is a
 * much weaker claim than "has 31 cases", and the row quotes the number.
 */
async function testsFor(slug: string): Promise<{ files: number; cases: number }> {
  const folders = LIB_FOLDER[slug] ?? [slug];
  let files = 0;
  let cases = 0;
  for (const folder of folders) {
    const dir = path.join(process.cwd(), "src", "lib", folder);
    let entries: string[];
    try {
      entries = await readdir(dir, { recursive: true });
    } catch {
      continue;
    }
    const specs = entries.filter((e) => /\.test\.tsx?$/.test(e));
    files += specs.length;
    // Each spec is read in parallel and the counts are summed AFTERWARDS,
    // never with `cases += caseCount(await …)` inside the closure. That form
    // reads `cases` before the await suspends, so every closure starts from
    // the same zero and the last one to land overwrites the rest — which
    // reported 17 cases for a folder holding 303.
    const counted = await Promise.all(
      specs.map(async (spec) => {
        try {
          return caseCount(await readFile(path.join(dir, spec), "utf8"));
        } catch {
          // Unreadable spec: it still counts as a file, just not as cases.
          return 0;
        }
      }),
    );
    cases += counted.reduce((a, b) => a + b, 0);
  }
  return { files, cases };
}

async function appFacts(): Promise<QueueFact[]> {
  return Promise.all(
    PROJECTS.map(async (p): Promise<QueueFact> => {
      const [hasPage, tests] = await Promise.all([
        exists(path.join(process.cwd(), "src", "app", "apps", p.slug, "page.tsx")),
        testsFor(p.slug),
      ]);
      return {
        id: `app:${p.slug}`,
        kind: "app",
        name: p.title,
        blurb: p.tag ?? p.overview.slice(0, 160),
        group: p.category,
        href: p.appUrl ?? p.externalUrl,
        signals: {
          comingSoon: p.status !== "live",
          hasPage,
          testFiles: tests.files,
          tests: tests.cases,
          onHub: true,
          // Only the short tag is scanned, not the whole marketing overview:
          // a paragraph that happens to use the word "experimental" about a
          // feature is not the app declaring itself unfinished.
          flags: flagsIn(p.tag ?? ""),
        },
      };
    }),
  );
}

function workflowFacts(): QueueFact[] {
  return WORKFLOWS.map((w) => ({
    id: `flow:${w.id}`,
    kind: "workflow" as const,
    name: w.name,
    blurb: w.blurb,
    group: w.medium === "video" ? "Video workflow" : "Image workflow",
    href: `/apps/jarvis#studio`,
    signals: {
      hasBrief: w.brief.trim().length > 60,
      hasArt: Boolean(cardStill(w.id) || w.preview?.video || w.preview?.poster),
      // Filled in on the client, which is the only place that can see the
      // Studio conversations — they live in device-local state, not the repo.
      everUsed: false,
    },
  }));
}

/** Root of the Claude Code config dir. Override with CLAUDE_SKILLS_HOME. */
function claudeHome(): string {
  return process.env.CLAUDE_SKILLS_HOME || path.join(homedir(), ".claude");
}

async function referenceCount(dir: string): Promise<number> {
  try {
    const entries = await readdir(path.join(dir, "references"), { recursive: true });
    return entries.filter((e) => /\.(md|json|txt|glsl|mjs|js|ts)$/i.test(e)).length;
  } catch {
    return 0;
  }
}

async function skillFact(
  dir: string,
  slug: string,
  origin: string,
  mirrored: boolean,
): Promise<QueueFact | null> {
  let body: string;
  try {
    body = await readFile(path.join(dir, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
  const parsed = parseSkillFrontmatter(body);
  const references = await referenceCount(dir);
  // Proof may be recorded in a reference file rather than in SKILL.md itself —
  // a gauntlet report is exactly the kind of thing that lives in references/ —
  // so the whole folder is searched before concluding a skill is unproven.
  let proof = proofIn(body);
  if (!proof && references > 0) proof = await proofInReferences(dir);
  return {
    id: `skill:${slug}`,
    kind: "skill",
    name: parsed.title || slug,
    blurb: parsed.overview.slice(0, 200),
    group: origin,
    signals: {
      bodyLines: body.split("\n").length,
      references,
      mirrored,
      proof,
      flags: flagsIn(body),
    },
  };
}

async function proofInReferences(dir: string): Promise<string | undefined> {
  const refs = path.join(dir, "references");
  let entries: string[];
  try {
    entries = await readdir(refs, { recursive: true });
  } catch {
    return undefined;
  }
  for (const entry of entries.filter((e) => /\.md$/i.test(e)).slice(0, 12)) {
    try {
      const found = proofIn(await readFile(path.join(refs, entry), "utf8"));
      if (found) return found;
    } catch {
      // Unreadable reference: just keep looking.
    }
  }
  return undefined;
}

async function skillFacts(): Promise<QueueFact[]> {
  const repoDir = path.join(process.cwd(), "skills");
  const home = claudeHome();
  const personalDir = path.join(home, "skills");

  const [repoNames, personalNames] = await Promise.all([
    readdir(repoDir).catch(() => [] as string[]),
    readdir(personalDir).catch(() => [] as string[]),
  ]);
  const mirrored = new Set(repoNames);

  // The live copy on this PC wins over the committed mirror — a skill edited
  // this morning should be judged as it is now — but whether it is mirrored is
  // read from the repo either way, because that is the fact that decides
  // whether the deployed hub can see it at all.
  const seen = new Set<string>();
  const facts: QueueFact[] = [];

  for (const name of personalNames) {
    const fact = await skillFact(path.join(personalDir, name), name, "Personal", mirrored.has(name));
    if (fact) {
      facts.push(fact);
      seen.add(name);
    }
  }
  for (const name of repoNames) {
    if (seen.has(name)) continue;
    const fact = await skillFact(path.join(repoDir, name), name, "Personal", true);
    if (fact) facts.push(fact);
  }

  return facts;
}

export async function GET() {
  try {
    const [apps, skills] = await Promise.all([appFacts(), skillFacts()]);
    // Pinned priorities first: they are the top of the queue until done.
    const facts = [...taskFacts(), ...apps, ...skills, ...workflowFacts()];
    return NextResponse.json({ facts, scannedAt: new Date().toISOString() });
  } catch (err) {
    // A board that 500s is worse than a board missing a column: the client
    // falls back to what it can build from the imported catalog alone.
    return NextResponse.json(
      { facts: [], error: err instanceof Error ? err.message : "scan failed" },
      { status: 200 },
    );
  }
}
