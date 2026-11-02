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

import { slugOf } from "./plan";
import type { BuilderProject } from "./types";

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
    "Typecheck and the full test suite pass (`npx tsc -p tsconfig.json --noEmit`, `npx vitest run`). The app opens at its route and its main task still works end to end — check it in a browser, do not assume.",
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
