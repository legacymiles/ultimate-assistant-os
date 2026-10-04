// ---------------------------------------------------------------------------
// The brief — what a bake-off lane is actually sent.
//
// This module is the whole reason V2 can beat a design tool that returns
// mockups: a lane does not get "redesign this nicely", it gets a contract. One
// brief per lane, identical except for the design skill named as its sole
// authority, so when three builds come back different, the difference IS the
// skill.
//
// The decision that shapes every line here: V2 NEVER authors a design. No
// palette, no type scale, no layout. A model that writes a token sheet and then
// builds to it produces the average of every landing page it has seen; the
// skills in ~/.claude/skills are tens of kilobytes of specific instruction with
// hard bans in them, and a spec sheet in between keeps the colours and throws
// the opinions away. So the brief carries FACTS and CONSTRAINTS, and hands
// every aesthetic decision to the skill.
//
// Pure and synchronous on purpose. Fetching is the caller's job; this turns
// facts into text, which is the part worth testing.
// ---------------------------------------------------------------------------

/** What a lane is pointed at. */
export type Target =
  | { kind: "new"; idea: string }
  | { kind: "my-app"; slug: string }
  | { kind: "url"; url: string }
  | { kind: "hub-page"; route: string };

/** One feature, as the owner actually wrote it in Projects Timeline. */
export interface BriefFeature {
  title: string;
  description: string;
  group: "core" | "supporting";
}

/**
 * Everything known about the target, gathered by the caller.
 *
 * `features` come from the owner's own Projects Timeline entries, which is the
 * point of the my-app path: the feature list is already written, curated and
 * grouped, so a rebuild has no excuse for losing any of it.
 */
export interface TargetFacts {
  /** What to call it on screen and in the branch name. */
  name: string;
  /** One line. */
  tagline: string;
  /** The long description, where one exists. */
  overview: string;
  features: BriefFeature[];
  /** Route the build must serve, e.g. "/apps/cook-connect". */
  route: string;
  /** Repo folders that hold today's implementation, when it exists. */
  folders: string[];
  /** For a URL target: what the scrape found. */
  scraped?: {
    title: string;
    summary: string;
    navItems: string[];
    ctas: string[];
  };
}

export interface BriefOptions {
  /** The design skill that owns every visual decision in this lane. */
  skill: string;
  target: Target;
  facts: TargetFacts;
  /** Anything the owner typed into the prompt box. Verbatim. */
  intent?: string;
  /** The branch this lane works on, for the lane rules section. */
  branch?: string;
}

const bullet = (s: string) => `- ${s}`;

/** A heading plus body, or nothing at all when the body is empty. */
function section(title: string, body: string): string {
  const trimmed = body.trim();
  return trimmed ? `## ${title}\n\n${trimmed}\n` : "";
}

/**
 * Features, quoted exactly as written.
 *
 * Never summarised, never reworded, never merged. A summarised feature is a
 * dropped feature: the model reads "and various sharing options" and builds
 * one. Numbering them gives the lane something to check itself against at the
 * end, and gives the brief's test something to count.
 */
function featureBlock(features: BriefFeature[]): string {
  if (!features.length) return "";
  const core = features.filter((f) => f.group === "core");
  const extra = features.filter((f) => f.group !== "core");
  const render = (list: BriefFeature[], offset: number) =>
    list
      .map((f, i) => {
        const head = `${offset + i + 1}. **${f.title}**`;
        return f.description.trim() ? `${head} — ${f.description.trim()}` : head;
      })
      .join("\n");

  const parts: string[] = [];
  if (core.length) parts.push(`### Core features (${core.length})\n\n${render(core, 0)}`);
  if (extra.length)
    parts.push(`### Supporting features (${extra.length})\n\n${render(extra, core.length)}`);
  return parts.join("\n\n");
}

function whatBlock(target: Target, facts: TargetFacts, intent?: string): string {
  const lines: string[] = [];
  lines.push(`**${facts.name}** — ${facts.tagline || "no tagline on record"}`);
  lines.push("");

  switch (target.kind) {
    case "new":
      lines.push("This does not exist yet. You are building it for the first time.");
      lines.push("");
      lines.push("The idea, in the owner's words:");
      lines.push("");
      lines.push(`> ${target.idea.trim() || "(nothing was typed)"}`);
      break;
    case "my-app":
      lines.push(
        `This app already exists in this repo and is being REBUILT with a new design. ` +
          `Every feature below works today and must still work when you are done.`,
      );
      break;
    case "url":
      lines.push(
        `This is a rebuild of ${target.url} — a site the owner does not control. ` +
          `Keep what it DOES; replace how it looks.`,
      );
      break;
    case "hub-page":
      lines.push(
        `This is a redesign of the existing page at ${target.route}. ` +
          `Only that page changes; the rest of the app is off limits.`,
      );
      break;
  }

  if (facts.overview.trim()) {
    lines.push("");
    lines.push(facts.overview.trim());
  }

  if (facts.scraped) {
    const s = facts.scraped;
    lines.push("");
    lines.push("What the scrape found on the live site:");
    lines.push("");
    if (s.summary.trim()) lines.push(s.summary.trim());
    if (s.navItems.length) lines.push(bullet(`Navigation: ${s.navItems.join(" · ")}`));
    if (s.ctas.length) lines.push(bullet(`Calls to action: ${s.ctas.join(" · ")}`));
  }

  if (intent && intent.trim()) {
    lines.push("");
    lines.push("The owner also said, verbatim:");
    lines.push("");
    lines.push(`> ${intent.trim()}`);
  }

  return lines.join("\n");
}

/**
 * The design-authority section.
 *
 * Deliberately blunt, and deliberately the only place a design decision is
 * made. The skill is named once and given everything; this brief offers no
 * palette, no fonts and no layout, because an instruction it does not give is
 * an instruction the skill gets to make.
 */
function authorityBlock(skill: string): string {
  return [
    `Invoke the **${skill}** skill before you write a single line of UI, and let it drive.`,
    "",
    `It owns every visual decision in this build: layout, type, colour, motion, density, ` +
      `chrome, the lot. This brief deliberately does not name a palette, a typeface or a ` +
      `layout — where it is silent, \`${skill}\` decides. Do not split the difference with ` +
      `your own taste, and do not reach for another design skill.`,
    "",
    `This build is one lane of a bake-off: the same brief is being built right now by other ` +
      `lanes under different design skills, and they will be compared side by side. A lane ` +
      `that quietly converges on a safe, familiar layout has wasted the run. Let ` +
      `\`${skill}\` be as distinctive as it wants to be.`,
  ].join("\n");
}

function contractBlock(target: Target, facts: TargetFacts): string {
  const lines = [
    "Non-negotiable, and checked when the lane is reviewed:",
    "",
    bullet(
      target.kind === "new"
        ? "Everything described above actually works. Not a mockup, not placeholder buttons."
        : "Every feature listed above still works. Losing one is a failed build, however good it looks.",
    ),
    bullet("Next.js App Router, TypeScript and Tailwind v4 — the stack this repo already uses."),
    bullet(
      "No new dependencies. If you are certain one is unavoidable, stop and say so instead of installing it.",
    ),
    bullet(
      "It must run with NO environment keys set. A missing key degrades visibly and never 500s.",
    ),
    bullet("`npx tsc --noEmit` passes, and any test you touch still passes."),
  ];
  if (facts.folders.length) {
    lines.push(
      bullet(
        `Today's implementation lives in ${facts.folders.map((f) => `\`${f}\``).join(", ")} — ` +
          `read it before you change it.`,
      ),
    );
  }
  return lines.join("\n");
}

function laneBlock(facts: TargetFacts, branch?: string): string {
  return [
    bullet(
      "You are in your own git worktree on your own branch. Everything you need to change is " +
        "inside it; nothing outside it is yours to touch.",
    ),
    bullet(`Serve the result at \`${facts.route}\`.`),
    bullet(
      "Add or update the entry in `src/lib/catalog.ts` so the app appears in the hub. " +
        "An app that is not in the catalog does not exist.",
    ),
    bullet(
      "`node_modules` is a junction shared with the main checkout — do not install, remove or " +
        "update packages.",
    ),
    bullet(
      "Commit nothing. The owner lands or discards this lane after comparing it with the others.",
    ),
    branch ? bullet(`Your branch: \`${branch}\`.`) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Build the prompt one lane receives.
 *
 * The order is the argument: what it is, who decides how it looks, what must
 * remain true, and where you may work. Design authority comes second — before
 * the constraints — because a model that reads a wall of rules first builds
 * defensively, and defensive is exactly the bland outcome this is meant to
 * avoid.
 */
export function buildBrief(opts: BriefOptions): string {
  const { skill, target, facts, intent, branch } = opts;
  const head = [
    `# Build: ${facts.name}`,
    "",
    `Design skill for this lane: **${skill}**`,
    "",
  ].join("\n");

  return [
    head,
    section("What this is", whatBlock(target, facts, intent)),
    section("Features", featureBlock(facts.features)),
    section("Design authority", authorityBlock(skill)),
    section("The contract", contractBlock(target, facts)),
    section("Your lane", laneBlock(facts, branch)),
    section(
      "When you are done",
      [
        "Say which features you implemented, naming them by the numbers above, and say plainly " +
          "if you could not finish one — a missing feature that is declared is recoverable, " +
          "and one that is quietly skipped is found by the owner later.",
        "",
        `Then say, in two or three sentences, what \`${skill}\` led you to do that you would ` +
          "not have done otherwise. That sentence is what the bake-off is measuring.",
      ].join("\n"),
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

/** A short, git-safe branch name for a lane. Flat: `refs/heads/jarvis` exists. */
export function laneBranch(name: string, skill: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28);
  const base = slug(name) || "bakeoff";
  const tail = slug(skill) || "skill";
  return `bakeoff-${base}-${tail}`;
}
