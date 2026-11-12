// ---------------------------------------------------------------------------
// Handing a finished site over — the rules, with nothing that needs a network.
//
// Two ways out of Ship, and they are opposites:
//
//   to the client   the site gets its OWN GitHub repository, made the moment
//                   the owner presses send and not a second earlier, and the
//                   private review link starts opening.
//   to the hub      the site moves in beside the owner's other apps as
//                   `/apps/<slug>`, built by Claude Code in a worktree of the
//                   hub (see src/lib/app-builder/absorb.ts for the same move
//                   from App Builder's side).
//
// A project that IS a hub app already (`appSlug`) can do neither: its repo is
// the hub's own, which is not a thing to hand to a client, and it is already
// in the hub. Saying that plainly is the whole reason `handover()` exists —
// the console used to offer every button to every project and let the failure
// explain afterwards.
// ---------------------------------------------------------------------------

import type { ClientProject } from "./types";

/** GitHub's flat tree, as `/repos/{repo}/git/trees/{sha}?recursive=1` gives it. */
export interface RepoEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

export interface TreeNode {
  name: string;
  /** Full path inside the repo, so a row can link straight at GitHub. */
  path: string;
  kind: "dir" | "file";
  size?: number;
  children: TreeNode[];
}

/**
 * The repository name a site would get: its own name, as a slug.
 *
 * `taken` is every name already on the account, so the second "Portfolio" does
 * not fail the create call with GitHub's own 422 — it becomes `portfolio-2`.
 * Matching is case-insensitive because GitHub's is.
 */
export function repoNameFor(name: string, taken: string[] = []): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "client-site";
  const used = new Set(taken.map((t) => t.trim().toLowerCase().split("/").pop() ?? ""));
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const next = `${base}-${n}`;
    if (!used.has(next)) return next;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * The stored repository as "owner/name", or "" when there isn't one.
 *
 * Reading, not cleaning: `logic.cleanRepo` is what validates it on the way in
 * and it throws a sentence the owner can act on. This side only ever has to
 * decide whether to draw a repository, and a screen is the wrong place to
 * raise an error about a value nobody is editing.
 */
export function repoOf(raw: string | undefined): string {
  const clean = (raw ?? "")
    .trim()
    .replace(/^(?:git@|(?:https?:\/\/)?(?:www\.)?)github\.com[/:]/i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  return /^[\w.-]+\/[\w.-]+$/.test(clean) ? clean : "";
}

export function repoUrl(repo: string): string {
  return `https://github.com/${repo}`;
}

/** The hub route this site would take if it moved in. */
export function hubSlugFor(name: string): string {
  return repoNameFor(name).slice(0, 40);
}

export type HandoverKind =
  /** One of the owner's own hub apps, opened to edit on the page. */
  | "hub-app"
  /** A site of its own: the only kind that can be handed over either way. */
  | "site";

export interface Handover {
  kind: HandoverKind;
  /** The site's own repository, once it has one. */
  repo: string;
  /** Already sent — the link opens and it is in the client's list. */
  sent: boolean;
  /** Pressing send would make a repository, because there isn't one yet. */
  makesRepo: boolean;
  /** Why "Send to Jarvis Plugins" can't run, or "" when it can. */
  pluginsBlocked: string;
  /** Where it already lives in the hub, when it is a hub app. */
  hubPath: string;
}

export function handover(p: ClientProject, hubRepo: string): Handover {
  const repo = repoOf(p.repo);
  const isHubApp = Boolean(p.appSlug) || (repo !== "" && repo.toLowerCase() === hubRepo.toLowerCase());
  const live = [...p.versions].reverse().find((v) => v.status === "review" && v.siteUrl);
  return {
    kind: isHubApp ? "hub-app" : "site",
    repo,
    sent: Boolean(p.sentAt || p.claimedAt),
    makesRepo: !isHubApp && !repo,
    pluginsBlocked: isHubApp ? "already-in" : !live ? "nothing-built" : "",
    hubPath: p.appPath ?? (p.appSlug ? `/apps/${p.appSlug}` : ""),
  };
}

/**
 * GitHub's flat list of paths as the folders it actually is.
 *
 * Folders before files and each level A→Z, which is what every file explorer
 * the owner has ever used does — a tree sorted the way the API happened to
 * return it reads as noise. Entries whose parent folder GitHub did not list
 * (it omits them for a sparse tree) still get one, so nothing is dropped.
 */
export function folderTree(entries: RepoEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", kind: "dir", children: [] };
  const dirAt = (parts: string[]): TreeNode => {
    let node = root;
    const walked: string[] = [];
    for (const part of parts) {
      walked.push(part);
      let next = node.children.find((c) => c.kind === "dir" && c.name === part);
      if (!next) {
        next = { name: part, path: walked.join("/"), kind: "dir", children: [] };
        node.children.push(next);
      }
      node = next;
    }
    return node;
  };

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    if (!parts.length) continue;
    if (entry.type === "tree") {
      dirAt(parts);
      continue;
    }
    const parent = dirAt(parts.slice(0, -1));
    const name = parts[parts.length - 1];
    if (parent.children.some((c) => c.kind === "file" && c.name === name)) continue;
    parent.children.push({ name, path: entry.path, kind: "file", size: entry.size, children: [] });
  }

  const order = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
    for (const n of nodes) if (n.children.length) order(n.children);
    return nodes;
  };
  return order(root.children);
}

/** How many files are under here, so a collapsed folder still says something. */
/**
 * The files a repository holds that are actually the site.
 *
 * A repository Jarvis has just made is not empty — it holds the README Jarvis
 * itself wrote, and nothing else. Counting that as a source is how a move
 * starts against a repository with no site in it, hands Claude Code a brief
 * pointing at one file, and spends a thread discovering there is nothing to
 * bring in. Licences and a .gitignore are housekeeping for the same reason.
 */
const NOT_THE_SITE = /^(readme(\.[a-z]+)?|license(\.[a-z]+)?|licence(\.[a-z]+)?|\.gitignore|\.gitattributes)$/i;

export function siteFileCount(entries: RepoEntry[]): number {
  return entries.filter((e) => e.type === "blob" && !NOT_THE_SITE.test(e.path)).length;
}

/** True when the repository has nothing in it but the README Jarvis wrote. */
export function repoHasNoSite(entries: RepoEntry[]): boolean {
  return siteFileCount(entries) === 0;
}

export function countFiles(nodes: TreeNode[]): number {
  return nodes.reduce((n, node) => n + (node.kind === "file" ? 1 : countFiles(node.children)), 0);
}

/** "14 KB" — sizes a person reads, never bytes. */
export function readableSize(bytes: number | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The folders a reviewer wants open the moment the tree appears. */
export const OPEN_BY_DEFAULT = new Set(["src", "app", "pages", "components", "public"]);

/**
 * What Claude Code is asked to do to move a client site into the hub.
 *
 * The same move App Builder's `absorbBrief` describes, written from a Client
 * Review project instead of a builder one — the site here is a finished,
 * deployed thing with a repository, not a bucket of accepted features, so the
 * source is the repository and the proof is the live address.
 */
export function pluginsBrief(p: ClientProject, opts: { repo?: string; folder?: string; liveUrl?: string }): string {
  const slug = hubSlugFor(p.name);
  // The repository when there is one, the folder the build still stands in
  // when there isn't — the site has to come from somewhere, and a brief that
  // names neither is a brief that invents a path.
  const source = opts.repo
    ? `${repoUrl(opts.repo)} — clone it into a temporary folder OUTSIDE this worktree and read it there; never add it as a remote of this repository.`
    : `\`${opts.folder ?? ""}\` on this PC — the folder this site was built in.`;
  return [
    "<task>",
    `Bring the site at ${opts.repo ? repoUrl(opts.repo) : `\`${opts.folder ?? ""}\``} into this hub as \`/apps/${slug}\`, following this repository's own CLAUDE.md conventions. Read that file first — it is the operating manual for where things go here.`,
    "</task>",
    "",
    "<the_site>",
    `Name: ${p.name}`,
    `Source: ${source}`,
    opts.liveUrl ? `Live: ${opts.liveUrl} — open it and see what it actually does before you move a file.` : "",
    "</the_site>",
    "",
    "<read_only_source>",
    "That source is READ-ONLY to you. Copy and adapt what you need; do not push to it, move it, rewrite it or delete it. It stays the intact copy until the owner retires it themselves.",
    "</read_only_source>",
    "",
    "<what_moving_in_means>",
    "This is not a file move. Bring it onto the hub's own foundations:",
    `- The route becomes \`src/app/apps/${slug}/page.tsx\`; UI goes in \`src/components/${slug}/\`, logic and types in \`src/lib/${slug}/\` with its tests beside them, server routes in \`src/app/api/${slug}/\`. If a folder name has to differ from the slug, add the row to CLAUDE.md's slug→folder table.`,
    "- Add ONE object to `PROJECTS` in `src/lib/catalog.ts`. That file is the single source of truth for what exists; an app that is not in it silently has no card.",
    `- Add \`"${slug}"\` to \`PLUGIN_SLUGS\` in \`src/lib/studio/plugins.ts\`, so it arrives as a card on Jarvis › App plugins rather than only on the hub grid. That list is also what keeps one app from having two front doors: a slug in it leaves the hub grid, so do not also leave it there by hand.`,
    "- Every AI call goes through `src/lib/ai/provider.ts`. Delete the site's own provider or SDK wiring.",
    "- Cross-device state goes through `src/lib/sync/appState.ts`. Delete the site's own persistence layer where that replaces it.",
    "- Merge its dependencies into the hub's `package.json`, taking the hub's existing version where both have one. Drop anything the hub already provides.",
    "- Its styling becomes the hub's: Tailwind v4 and the tokens in `src/app/globals.css`.",
    "- If it holds the owner's own data, add its slug to `UNPREVIEWABLE` in the catalog so the hub carousel never frames it.",
    "</what_moving_in_means>",
    "",
    "<done>",
    "Typecheck and the full test suite pass (`npx tsc -p tsconfig.json --noEmit`, `npx vitest run`). The app opens at its route and its main task still works end to end — check it in a browser, do not assume.",
    `Its card is on Jarvis › App plugins and it is NOT also on the hub's front grid — open both and look, because \`PLUGIN_SLUGS\` is what decides that and a missing slug shows up nowhere until someone goes hunting.`,
    `Then commit, push your branch and open a pull request into \`main\` titled "${p.name}: move into the hub". Do NOT merge it; the owner merges.`,
    "Say the pull request's address in your last message on its own line as `PR: <url>`, and nothing after it.",
    "</done>",
    "",
    "<leave_alone>",
    "Change nothing else in this repository. No refactors, no drive-by fixes, no reformatting of files this app does not touch — the owner reviews this as one diff and anything extra in it makes that harder.",
    "</leave_alone>",
  ]
    .filter(Boolean)
    .join("\n");
}
