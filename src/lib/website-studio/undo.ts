// ---------------------------------------------------------------------------
// Undo — going back to an earlier version of a live website, for real.
//
// Client Review's old Undo only changed which version the client's link
// showed. That was right when every version was its own branch preview, and
// it is a lie for the owner's hub apps: v1, v2 and v3 all live at the same
// address, and since quick edits merge straight to main, "back to v2" means
// v3's code has to come off main and the site redeploy.
//
// So an undo is planned here, purely, before anything is pressed:
//
//   - the versions newer than the one being gone back to, newest first;
//   - whether any of them shares the target's address (then the code has to
//     change — a link flip would show the same page);
//   - for each, the pull request that put it live, which is what is reverted.
//
// A newer version at the same address with no pull request on record cannot
// be taken off main automatically, and the plan says so in plain words rather
// than flipping the link and calling it undone.
// ---------------------------------------------------------------------------

import type { ReviewVersion } from "@/lib/client-review/types";

export interface UndoStep {
  id: string;
  number: string;
  prUrl: string;
}

export interface UndoPlan {
  target: ReviewVersion;
  /** Pull requests to revert, newest first. */
  reverts: UndoStep[];
  /** The code on main has to change; otherwise only the client's link moves. */
  codeChange: boolean;
  /** Set when it cannot be done: the one sentence to show. */
  blocked?: string;
  /** What the confirm says, in the owner's words. */
  says: string;
}

function n(v: Pick<ReviewVersion, "number">): number {
  return Number(v.number.replace(/\D/g, "")) || 0;
}

/**
 * Same page: scheme, trailing slash, query and hash do not make a different
 * address. A hub app's v1 is stored as its route ("/apps/baby-no-scroll") and
 * later versions as the full live address, so when either side is only a
 * path, the paths are what is compared.
 */
export function sameAddress(a: string, b: string): boolean {
  const norm = (u: string) =>
    u
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  if (!a.trim() || !b.trim()) return false;
  const path = (u: string) =>
    u.trim().startsWith("/") ? norm(u) : norm(u).replace(/^[^/]*/, "");
  if (a.trim().startsWith("/") || b.trim().startsWith("/"))
    return path(a) === path(b);
  return norm(a) === norm(b);
}

const one = (k: number, a: string, b: string) => (k === 1 ? a : b);

export function undoPlan(
  versions: ReviewVersion[],
  versionId: string,
): UndoPlan | null {
  const target = versions.find((v) => v.id === versionId);
  if (!target) return null;
  const newer = versions
    .filter((v) => n(v) > n(target))
    .sort((a, b) => n(b) - n(a));
  const base = { target, reverts: [] as UndoStep[], codeChange: false };
  if (!target.siteUrl)
    return {
      ...base,
      blocked: `${target.number} has no address to go back to.`,
      says: "",
    };
  if (target.status === "building")
    return {
      ...base,
      blocked: `${target.number} is still being built.`,
      says: "",
    };
  if (newer.some((v) => v.status === "building")) {
    return {
      ...base,
      blocked: "A build is running. Stop it or let it land first, then undo.",
      says: "",
    };
  }
  const sharing = newer.filter((v) => sameAddress(v.siteUrl, target.siteUrl));
  if (!sharing.length) {
    return {
      ...base,
      says: `Your client's link shows ${target.number} again. Nothing in the code changes — each version has its own address.`,
    };
  }
  const missing = sharing.filter((v) => !v.prUrl);
  if (missing.length) {
    const k = missing.length;
    return {
      ...base,
      codeChange: true,
      blocked: `${missing.map((v) => v.number).join(" and ")} ${one(k, "has", "have")} no pull request on record, so ${one(k, "it", "they")} can't be taken off main from here. Revert ${one(k, "it", "them")} on GitHub, or undo to a later version.`,
      says: "",
    };
  }
  const reverts = sharing.map((v) => ({
    id: v.id,
    number: v.number,
    prUrl: v.prUrl!,
  }));
  const k = reverts.length;
  return {
    target,
    reverts,
    codeChange: true,
    says: `Put ${target.number} back: ${reverts.map((r) => r.number).join(", ")} ${one(k, "comes", "come")} off main and the site redeploys, about 3 minutes. ${one(k, "That edit stays", "Those edits stay")} in the history, so you can redo ${one(k, "it", "them")} later.`,
  };
}

/**
 * The picture for a version: what it looked like when it landed, or, when that
 * was never captured, the "before" picture the NEXT version took — which is
 * the same page, a moment before it changed.
 */
export function shotFor(versions: ReviewVersion[], v: ReviewVersion): string {
  if (v.image) return v.image;
  const next = versions
    .filter((x) => n(x) > n(v))
    .sort((a, b) => n(a) - n(b))[0];
  return next?.beforeImage ?? "";
}

/** The brief for the PC when GitHub would not do the revert itself. */
export function revertBrief(plan: UndoPlan, live: string): string {
  const prs = plan.reverts.map((r) => `- ${r.number}: ${r.prUrl}`).join("\n");
  return [
    "<task>",
    `Undo: put ${plan.target.number} of this website back by reverting these merged pull requests on main, newest first:`,
    prs,
    "</task>",
    "<speed>",
    "This is an undo, not a build. No skills, no tests beyond the typecheck, no dev server, no screenshots.",
    "Keep a TodoWrite list of 3-5 items.",
    "</speed>",
    "<how_to_finish_here>",
    "Your worktree is ALREADY reset to `origin/main`. Do not rebase, reset or fetch before you start.",
    "1. For each pull request, newest first: `gh pr view <url> --json mergeCommit -q .mergeCommit.oid`, then `git revert --no-edit <sha>` (add `-m 1` if git says it is a merge).",
    "2. `npx tsc -p tsconfig.json --noEmit` once. Never run `npm install` in this folder.",
    `3. Push the branch, then \`gh pr create --base main --title "Undo: back to ${plan.target.number}" --body "Reverts ${plan.reverts.map((r) => r.prUrl).join(" ")}"\` and straight away \`gh pr merge <number> --squash --delete-branch\`. Do not wait for checks.`,
    "4. End your final message with exactly two lines:",
    "PR: <the pull request url>",
    `Preview: ${live}`,
    "If a revert conflicts and you cannot resolve it cleanly, stop, say which one, and end with `Preview: none`.",
    "</how_to_finish_here>",
  ].join("\n");
}
