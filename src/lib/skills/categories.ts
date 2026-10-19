// ---------------------------------------------------------------------------
// Skills Library — categories and nicknames.
//
// A skill says what it is in its own SKILL.md, so the library, Claude and every
// device agree:
//
//   ---
//   name: felix
//   description: … Nicknames: Felix, the Felix skill, be ambitious, end goal skill.
//   metadata:
//     category: Prompt Engineering, Planning
//     nicknames: Felix, the Felix skill, be ambitious, end goal skill
//   ---
//
// The nicknames go in the DESCRIPTION because that is the text Claude reads to
// decide which skill you mean; `metadata.nicknames` is the same list for the
// library, and either one is enough.
//
// Skills that don't say (older ones, plugin skills, the vendored super-board
// pack) fall back to the curated maps below, and failing that to a best guess
// from their name and description — so nothing is left uncategorised, and a
// tag written into the skill always wins over a guess.
// ---------------------------------------------------------------------------

import type { Skill } from "./types";
import { frontmatterOf } from "./parse";
import designSkills from "../redesigner/design-skills.json";

/** The category chips, in display order. A skill's own category outside this list still shows, after these. */
export const CATEGORY_ORDER = [
  "Prompt Engineering",
  "Planning",
  "Build & Ship",
  "Testing & QA",
  "Coding",
  "Web Design",
  "Video Editing",
  "Audio & Music",
  "Images & Art",
  "Games & 3D",
  "Security",
  "Reverse Engineering",
  "Automation & Agents",
  "Memory & Jarvis",
  "Writing & Docs",
  "Data & Finance",
  "Trading",
  "Business",
  "Research",
];

/** slug → categories (comma-separated), for skills that don't carry their own. */
export const CATEGORY_BY_SLUG: Record<string, string> = {
  "github:scroll-world": "Web Design",
  "frontend-design:frontend-design": "Web Design",
  impeccable: "Web Design",
  "h3-scroll-world": "Web Design",
  "cinematic-ui": "Web Design",
  "ui-ux-pro-max": "Web Design",
  "web-design-guidelines": "Web Design",
  "theme-factory": "Web Design",
  "web-artifacts-builder": "Web Design",
  "clone-site": "Web Design",
  "remix-site": "Web Design",
  "shader-extract": "Web Design",
  "taste-skill": "Web Design",
  "soft-skill": "Web Design",
  "minimalist-skill": "Web Design",
  "brutalist-skill": "Web Design",
  "gpt-tasteskill": "Web Design",
  "redesign-skill": "Web Design",
  "imagegen-frontend-web": "Web Design",
  "image-to-code-skill": "Web Design",
  "stitch-skill": "Web Design",
  "dom-clone": "Web Design",
  "taste-skill-v1": "Web Design",
  brandkit: "Web Design",
  "imagegen-frontend-mobile": "Web Design",
  "output-skill": "Web Design",
  ...Object.fromEntries(designSkills.map((s) => [s.name, "Web Design"])),
  // The super-board pack (committed under .claude/skills, upstream-owned, so tagged here).
  "super-board": "Build & Ship",
  "super-build": "Build & Ship, Coding",
  "super-qa": "Testing & QA, Build & Ship",
  "super-review": "Build & Ship, Testing & QA",
  "super-collect": "Build & Ship, Testing & QA",
  "ui-refine-loop": "Web Design, Build & Ship",
  visual: "Writing & Docs, Build & Ship",
  "git-sync": "Build & Ship",
  "unreal-game-builder": "Games & 3D",
  rea: "Reverse Engineering",
};

/**
 * slug → nicknames, for skills whose SKILL.md we don't own. Your own skills
 * should carry theirs in the file instead (see the header).
 */
export const NICKNAMES_BY_SLUG: Record<string, string[]> = {
  // "the board", "super board" and "software factory" belong to the owner's
  // software-factory wrapper, which runs super-board with their defaults.
  "super-board": ["board loop", "drain the board"],
  "super-build": ["builder", "build lane", "Super Build"],
  "super-qa": ["tester", "QA lane", "bug bash", "Super QA"],
  "super-review": ["reviewer", "review lane", "PR review", "Super Review"],
  "super-collect": ["collector", "collect tickets", "triage errors", "what keeps breaking"],
  "ui-refine-loop": ["refine loop", "polish loop", "keep polishing"],
  visual: ["visual recap", "picture this", "map the code"],
  "git-sync": ["sync", "commit and push"],
  rea: ["rea", "reverse engineering skill", "rea skill"],
};

/** Best-guess categories from words in a skill's name and description. First hit is the primary. */
const GUESS: [string, RegExp][] = [
  ["Prompt Engineering", /\bprompts?\b|prompt engineer|be ambitious|\bfelix\b/],
  ["Reverse Engineering", /reverse[- ]engineer|decompil|disassembl|\brea\b|black-box/],
  ["Security", /\bsecurity\b|vulnerab|pentest|penetration|threat model|\bsecrets?\b|\bcve\b|hardening/],
  ["Video Editing", /\bvideos?\b|\bfilm\b|footage|\bclips?\b|\bedit(ing)? (the )?video|youtube|tiktok|motion graphic|\breels?\b/],
  ["Audio & Music", /\baudio\b|\bmusic\b|\bsongs?\b|\bmp3\b|\bbeats?\b|voice ?over|podcast/],
  ["Images & Art", /\bimages?\b|\bphotos?\b|illustrat|\bart\b|watercolou?r|\blogo\b/],
  ["Games & 3D", /\bgames?\b|\bunreal\b|\b3d\b|blender|three\.js|webgl/],
  ["Web Design", /\bdesign\b|\bui\b|\bux\b|frontend|front-end|\bcss\b|tailwind|landing page|website|typograph/],
  ["Testing & QA", /\bqa\b|\btests?\b|testing|playwright|vitest|bug bash/],
  ["Build & Ship", /super-board|pipeline|\bmerge\b|pull request|\bprs?\b|deploy|\bgit\b|release/],
  ["Coding", /\bcode\b|coding|typescript|javascript|react|next\.js|\bapi\b|refactor|debug/],
  ["Automation & Agents", /\bagents?\b|automat|workflow|schedul|browser/],
  ["Memory & Jarvis", /\bmemory\b|\bjarvis\b/],
  ["Writing & Docs", /\bwrit(e|ing)\b|\bdocs?\b|document|\bcopy\b|\bblog\b|\bemail\b|\bslides?\b|presentation/],
  ["Trading", /trading|\bmt4\b|expert advisor|forex|\bstocks?\b|crypto/],
  ["Data & Finance", /\bdata\b|spreadsheet|\bexcel\b|finance|budget|\bcharts?\b|analytics/],
  ["Business", /business|funding|\bclients?\b|\bsales\b|marketing|\bseo\b/],
  ["Research", /research|literature|\bsources\b/],
];

const list = (v: string | undefined): string[] =>
  (v ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "").replace(/\.$/, ""))
    .filter(Boolean);

/** The "Nicknames: a, b, c." sentence in a description, if any. */
function nicknamesInDescription(description: string): string[] {
  const m = description.match(/\b(?:nicknames?|also called|aka)\s*:\s*([^.]+?)(?:\.\s|\.$|$)/i);
  return m ? list(m[1]) : [];
}

export interface SkillMeta {
  /** Primary first. Never empty: worst case "Other". */
  categories: string[];
  /** True when every category is a guess rather than written in the skill or the map. */
  guessed: boolean;
  nicknames: string[];
  /** How to call it in Claude Code. */
  command: string;
}

const cache = new WeakMap<Skill, SkillMeta>();

export function skillMeta(skill: Skill): SkillMeta {
  const hit = cache.get(skill);
  if (hit) return hit;
  const fm = frontmatterOf(skill.body);
  const slug = skill.slug ?? "";
  const bare = slug.includes(":") ? slug.split(":").pop()! : slug;
  const name = fm.name || bare || skill.title;

  let categories = [...list(fm["metadata.category"]), ...list(fm["metadata.categories"])];
  if (!categories.length) categories = list(CATEGORY_BY_SLUG[slug] ?? CATEGORY_BY_SLUG[bare]);
  let guessed = false;
  if (!categories.length) {
    const text = `${skill.title} ${bare} ${skill.overview}`.toLowerCase();
    categories = GUESS.filter(([, re]) => re.test(text))
      .map(([c]) => c)
      .slice(0, 2);
    guessed = categories.length > 0;
    if (!categories.length) categories = ["Other"];
  }

  const seen = new Set<string>([name.toLowerCase()]);
  const nicknames: string[] = [];
  for (const n of [...list(fm["metadata.nicknames"]), ...nicknamesInDescription(skill.overview || fm.description || ""), ...(NICKNAMES_BY_SLUG[slug] ?? NICKNAMES_BY_SLUG[bare] ?? [])]) {
    const k = n.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      nicknames.push(n);
    }
  }

  const meta = { categories: [...new Set(categories)], guessed, nicknames, command: `/${name}` };
  cache.set(skill, meta);
  return meta;
}

/** The primary category, for older callers. */
export function categoryFor(skill: Skill): string | null {
  return skillMeta(skill).categories[0] ?? null;
}

/** Does the skill match a search? Name, nicknames, categories, description. */
export function matchesQuery(skill: Skill, q: string): boolean {
  const query = q.trim().toLowerCase().replace(/^\//, "");
  if (!query) return true;
  const m = skillMeta(skill);
  const hay = [skill.title, skill.slug ?? "", skill.overview, m.command, ...m.nicknames, ...m.categories].join(" \n ").toLowerCase();
  return query.split(/\s+/).every((word) => hay.includes(word));
}

/**
 * Every category with how many skills it has, in display order. The full
 * standard set is always listed (even at 0), so the chips never move or vanish
 * as skills are added — plus any category a skill names that isn't standard.
 */
export function categoriesIn(skills: Skill[]): { name: string; count: number }[] {
  const counts = new Map<string, number>(CATEGORY_ORDER.map((c) => [c, 0]));
  for (const s of skills) for (const c of skillMeta(s).categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a.name);
      const ib = CATEGORY_ORDER.indexOf(b.name);
      if (a.name === "Other") return 1;
      if (b.name === "Other") return -1;
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.name.localeCompare(b.name);
    });
}

/**
 * Two skills answering to the same nickname is exactly the confusion nicknames
 * are meant to prevent. Returns nickname → the skills that share it.
 */
export function nicknameClashes(skills: Skill[]): Map<string, string[]> {
  const owners = new Map<string, Set<string>>();
  for (const s of skills) {
    const m = skillMeta(s);
    const name = m.command.slice(1);
    for (const n of [name, ...m.nicknames]) {
      const k = n.toLowerCase().replace(/^\//, "");
      if (!owners.has(k)) owners.set(k, new Set());
      owners.get(k)!.add(name);
    }
  }
  const out = new Map<string, string[]>();
  for (const [k, set] of owners) if (set.size > 1) out.set(k, [...set]);
  return out;
}
