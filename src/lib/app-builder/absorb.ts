// ---------------------------------------------------------------------------
// Moving a finished app INTO the hub.
//
// An app built from App Builder starts life standalone: its own folder, its own
// repository, its own dependencies. That is the right shape for something a
// client might be handed, and the wrong shape for something the owner wants
// beside their other forty apps. So this is the other direction — absorb it as
// `/apps/<slug>`, then retire the standalone.
//
// Why this is a BRIEF and not a script: it is not a file move. The hub has one
// catalog that is the single source of truth, a settled folder convention, a
// shared AI provider, a shared sync layer and one package.json. Bringing an app
// in means rewriting its imports onto those, merging its dependencies, and
// deleting the parts the hub already provides. A script that moved files would
// produce something that type-checks and is wrong.
//
// Pure, so the brief the PC receives is the brief the tests read.
// ---------------------------------------------------------------------------

import type { BuildPhase } from "./build";
import { slugOf } from "./plan";
import type { BuilderProject } from "./types";

/**
 * A thread's phase, said in the language of a move rather than a build.
 *
 * `phaseLabel` is written for a build ("Starting the build", "Built"), which is
 * the wrong sentence on a thread that is bringing a finished app in. Shared by
 * both doors into the hub — App Builder's Move into Jarvis and Client Review's
 * Ship — so the same thread never gets described two different ways.
 */
export const MOVE_PHASE_LABEL: Record<BuildPhase, string> = {
  starting: "Starting",
  reconnecting: "Reconnecting to your PC",
  resuming: "Picking it back up",
  paused: "Waiting for a limit to reset",
  working: "Working",
  asking: "Waiting on your answer",
  checking: "Checking it works",
  unverified: "Moved, but the checks are failing",
  unfinished: "Stopped before it finished",
  done: "Finished",
  failed: "Stopped",
  stopped: "Stopped",
  lost: "No longer running",
};

/** Phases a move will not leave on its own: the owner has to do something. */
export function moveEnded(phase: BuildPhase): boolean {
  return phase === "done" || phase === "failed" || phase === "stopped" || phase === "lost" || phase === "unfinished";
}

/** Ended badly — there is no pull request coming unless it is started again. */
export function moveDied(phase: BuildPhase): boolean {
  return phase === "failed" || phase === "stopped" || phase === "lost" || phase === "unfinished";
}

/**
 * The line that puts a moved app on Jarvis › App plugins, not just the grid.
 *
 * Shared with the Client Review brief on purpose. A move that adds the catalog
 * entry and stops there lands the app on the hub's front grid, which is NOT
 * where the owner looks for it — and "it isn't in App plugins" is the single
 * thing that has had to be finished by hand after a move. Two briefs saying
 * this in their own words is how one of them quietly stops saying it.
 */
export function hubPluginLine(slug: string): string {
  return `- Add \`"${slug}"\` to \`PLUGIN_SLUGS\` in \`src/lib/studio/plugins.ts\`, so it arrives as a card on Jarvis › App plugins rather than only on the hub's front grid. That list is also what stops one app having two front doors: a slug in it leaves the grid, so do not also leave it there by hand.`;
}

/**
 * What "the checks pass" means in THIS repository — the clean-clone workflow.
 *
 * Written out as the one command plus the two traps, because "typecheck and the
 * tests pass" is what the brief used to say and it is not enough twice over:
 *
 *   `tsc --noEmit` does not see an App Router mistake. A route file that
 *   exports anything but a handler typechecks clean and fails `next build`.
 *   A move was reported finished on a green typecheck and could not build.
 *
 *   `docs/apps/README.md` goes stale the instant a catalog entry is added, and
 *   `check:apps` is a CI step. Every move that adds an app and does not
 *   regenerate it opens a red pull request.
 *
 * Both of those happened on the same move. A brief that only asks for what the
 * agent was already going to do is not a gate.
 */
export const HUB_VERIFY_LINES: readonly string[] = [
  "Run `npm run verify` and get it green BEFORE you commit. That is this repository's own gate, in CI's order: `check:apps`, `check:fonts`, `tsc --noEmit`, `npm test`, `npm run build`. The clean-clone workflow runs the same steps on your pull request, so one that opens red is not finished work — it is yours to fix, not the owner's.",
  "Two of those catch what nothing else does, and both have failed a move before. If `check:apps` fails, run `npm run apps:index` and COMMIT the regenerated `docs/apps/README.md` — adding a catalog entry always makes it stale. And `npm run build` is the only check that sees an App Router mistake: a `route.ts` may export nothing but route handlers, so move any helper a test imports into `src/lib/<slug>/` first. `tsc --noEmit` passes clean while that build fails, so never call a route file checked because the typecheck was green.",
  "Then open the app at its route and do its main task end to end in a browser. Do not assume.",
]

/** Where the app will live inside the hub. */
export function hubSlug(p: BuilderProject): string {
  return slugOf(p.understanding?.name ?? p.idea);
}

export function absorbTitle(p: BuilderProject): string {
  return `Move ${p.understanding?.name ?? "app"} into the hub`;
}

/**
 * The branch the merge lands on. Named for the app rather than the thread, so
 * the owner can tell what a branch is for a week later.
 */
export function absorbBranch(p: BuilderProject): string {
  return `absorb/${hubSlug(p)}`;
}

/**
 * What Claude Code is asked to do, working in a worktree of the hub.
 *
 * `from` is the standalone app's folder on disk. It is read, never moved: the
 * standalone repository stays exactly as it is until the owner retires it, so
 * a merge that goes wrong costs a branch and nothing else.
 */
export function absorbBrief(p: BuilderProject, from: string): string {
  const slug = hubSlug(p);
  const name = p.understanding?.name ?? slug;
  const accepted = p.features.filter((f) => f.status === "accepted");
  return [
    "<task>",
    `Bring the app at \`${from}\` into this hub as \`/apps/${slug}\`, following this repository's own CLAUDE.md conventions. Read that file first — it is the operating manual for where things go here.`,
    "</task>",
    "",
    "<read_only_source>",
    `\`${from}\` is a separate repository and it is READ-ONLY to you. Copy and adapt what you need; do not move, rewrite, commit to, or delete anything inside it. The owner retires it themselves once this has merged, and until then it is the only intact copy of the app.`,
    "</read_only_source>",
    "",
    "<what_moving_in_means>",
    "This is not a file move. Bring it onto the hub's own foundations:",
    `- The route becomes \`src/app/apps/${slug}/page.tsx\`; UI goes in \`src/components/${slug}/\`, logic and types in \`src/lib/${slug}/\` with its tests beside them, server routes in \`src/app/api/${slug}/\`. If a folder name has to differ from the slug, add the row to CLAUDE.md's slug→folder table.`,
    "- Add ONE object to `PROJECTS` in `src/lib/catalog.ts`. That file is the single source of truth for what exists; an app that is not in it silently has no card.",
    hubPluginLine(slug),
    "- Every AI call goes through `src/lib/ai/provider.ts`. Delete the app's own provider or SDK wiring.",
    "- Cross-device state goes through `src/lib/sync/appState.ts` (`loadLocal` / `saveSynced` / `useRemotePull`). Delete the app's own persistence layer where that replaces it.",
    "- Merge its dependencies into the hub's `package.json`, taking the hub's existing version where both have one. Drop anything the hub already provides.",
    "- Its styling becomes the hub's: Tailwind v4 and the tokens in `src/app/globals.css`.",
    "- If it holds the owner's own data, add its slug to `UNPREVIEWABLE` in the catalog so the hub carousel never frames it.",
    "</what_moving_in_means>",
    "",
    accepted.length
      ? `<keep_working>\nEvery one of these must still work after the move — they are the app, in the owner's own words:\n${accepted
          .map((f, i) => `${i + 1}. ${f.title}`)
          .join("\n")}\n</keep_working>`
      : "",
    "",
    "<done>",
    ...HUB_VERIFY_LINES,
    `Its card is on Jarvis › App plugins and it is NOT also on the hub's front grid — open both and look, because \`PLUGIN_SLUGS\` is what decides that and a missing slug shows up nowhere until someone goes hunting.`,
    `Then commit and open a pull request into \`main\` titled "${name}: move into the hub". Do NOT merge it; the owner merges.`,
    "Say the pull request's address in your last message on its own line as `PR: <url>`, so App Builder can follow it without guessing.",
    "</done>",
    "",
    "<leave_alone>",
    "Change nothing else in this repository. No refactors, no drive-by fixes, no reformatting of files this app does not touch — the owner reviews this as one diff and anything extra in it makes that harder.",
    "</leave_alone>",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The pull request this move opened, read from Claude's own last words. */
export function absorbPr(text: string): string | undefined {
  const matches = [...text.matchAll(/^\s*PR:\s*(\S+)\s*$/gim)];
  const last = matches.at(-1)?.[1];
  if (!last) return undefined;
  const clean = last.replace(/[)\].,;]+$/, "");
  return /^https?:\/\/\S+$/i.test(clean) ? clean : undefined;
}
