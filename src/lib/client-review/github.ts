// ---------------------------------------------------------------------------
// The GitHub half of handing a site over — made by the WEBSITE, not the PC.
//
// A client's repository has to exist whether or not the owner's PC is on, so
// it is created here with the hub's own token rather than by asking Claude
// Code to run `gh` somewhere. That is the same reasoning as
// src/lib/new-jarvis/devops.ts, and the same token: one key, set once.
//
// Nothing here ever reaches a browser. The console asks the admin route, the
// route asks this, and the token stays in the environment (S1).
// ---------------------------------------------------------------------------

import "server-only";

import { ReviewError } from "./logic";
import type { RepoEntry } from "./handover";

const GH = "https://api.github.com";

export function githubToken(): string {
  return (process.env.JARVIS_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim();
}

export function githubReady(): boolean {
  return githubToken().length > 0;
}

/** The one sentence to show when there is no key (R4). */
export const NO_TOKEN =
  "Jarvis has no GitHub key on the website yet, so it can't make a repository for this site. Create a fine-grained token at github.com/settings/tokens with Administration, Contents and Metadata read/write, then set JARVIS_GITHUB_TOKEN in Vercel. Everything else on this screen keeps working without it.";

interface GhError {
  message?: string;
  errors?: { message?: string; field?: string; code?: string }[];
}

/**
 * One call to GitHub, with its own words turned into a sentence.
 *
 * GitHub answers a refused create with a 422 and a nested `errors` array; the
 * bare `message` for that is "Repository creation failed", which tells the
 * owner nothing about the name already being taken (R3).
 */
async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const token = githubToken();
  if (!token) throw new ReviewError(NO_TOKEN, 503);
  let res: Response;
  try {
    res = await fetch(`${GH}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "jarvis-client-review",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ReviewError("Couldn't reach GitHub just now. Try again in a moment.", 502);
  }
  const body = (await res.json().catch(() => null)) as (T & GhError) | null;
  if (res.ok) return body as T;

  const detail = body?.errors?.map((e) => e.message).filter(Boolean).join(" ");
  const said = detail || body?.message || "";
  if (res.status === 401 || res.status === 403) {
    throw new ReviewError(
      `GitHub turned the key down${said ? ` (${said})` : ""}. Check JARVIS_GITHUB_TOKEN is still valid and has Administration and Contents read/write.`,
      502,
    );
  }
  if (res.status === 404) throw new ReviewError("GitHub says that repository doesn't exist, or the key can't see it.", 404);
  throw new ReviewError(said ? `GitHub said: ${said}` : "GitHub refused that, and didn't say why.", 502);
}

export interface GhRepo {
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
}

/** Who the key belongs to — the account a new repository is made under. */
export async function whoami(): Promise<string> {
  const me = await gh<{ login?: string }>("/user");
  if (!me.login) throw new ReviewError("GitHub didn't say which account that key belongs to.", 502);
  return me.login;
}

/** Every repository name already on the account, so a new one never collides. */
export async function existingRepoNames(): Promise<string[]> {
  const page = await gh<{ name: string }[]>("/user/repos?per_page=100&sort=updated&affiliation=owner");
  return Array.isArray(page) ? page.map((r) => r.name) : [];
}

/**
 * Make the site its own repository.
 *
 * `auto_init` on purpose: a repository with no commits has no default branch,
 * so the folder view would have nothing to read and a push would need the
 * branch invented. A README naming the site is the honest first commit, and
 * the build's own code is pushed on top of it.
 */
export async function createRepo(input: { name: string; description: string; readme: string }): Promise<GhRepo> {
  const repo = await gh<GhRepo>("/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      description: input.description.slice(0, 350),
      private: true,
      auto_init: true,
      has_issues: true,
      has_wiki: false,
      has_projects: false,
    }),
  });
  // Best effort: the repository is the thing that had to be made, and a
  // README that didn't take its text is not worth failing the handover over.
  await putReadme(repo.full_name, input.readme).catch(() => {});
  return repo;
}

/** Replace the generated README with one that says what this site is. */
async function putReadme(repo: string, text: string): Promise<void> {
  const current = await gh<{ sha?: string }>(`/repos/${repo}/contents/README.md`).catch(() => ({ sha: undefined }));
  await gh(`/repos/${repo}/contents/README.md`, {
    method: "PUT",
    body: JSON.stringify({
      message: "Say what this site is",
      content: Buffer.from(text, "utf8").toString("base64"),
      ...(current.sha ? { sha: current.sha } : {}),
    }),
  });
}

export async function readRepo(repo: string): Promise<GhRepo> {
  return gh<GhRepo>(`/repos/${repo}`);
}

export interface RepoTree {
  repo: string;
  branch: string;
  url: string;
  entries: RepoEntry[];
  /** GitHub stopped listing at 100,000 entries; the tree shown is partial. */
  truncated: boolean;
}

/**
 * The repository's files, flat, for the folder view.
 *
 * One extra call to learn the default branch rather than assuming `main`: a
 * site built from a template can easily be on `master`, and a tree view that
 * says "empty" because it asked for the wrong branch is worse than slow.
 */
export async function readTree(repo: string): Promise<RepoTree> {
  const info = await readRepo(repo);
  const branch = info.default_branch || "main";
  const tree = await gh<{ tree?: { path?: string; type?: string; size?: number }[]; truncated?: boolean }>(
    `/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  ).catch((e) => {
    // A repository with no commits yet answers 409, which is not an error
    // worth showing — it is simply empty.
    if (e instanceof ReviewError && e.status === 404) return { tree: [], truncated: false };
    throw e;
  });
  const entries: RepoEntry[] = (tree.tree ?? [])
    .filter((t): t is { path: string; type: "blob" | "tree"; size?: number } =>
      typeof t.path === "string" && (t.type === "blob" || t.type === "tree"),
    )
    .map((t) => ({ path: t.path, type: t.type, size: t.size }));
  return { repo: info.full_name, branch, url: info.html_url, entries, truncated: tree.truncated === true };
}

/** The first commit's README: what this is, who it is for, and where it came from. */
export function readmeFor(input: { name: string; clientName: string; liveUrl: string }): string {
  return [
    `# ${input.name}`,
    "",
    input.clientName ? `Built for ${input.clientName}.` : "",
    input.liveUrl ? `Live: ${input.liveUrl}` : "",
    "",
    "This repository is this site's own home. Edit requests come in through the client's",
    "Jarvis review link and land on a branch here as a pull request.",
    "",
  ]
    .filter((l, i, all) => !(l === "" && all[i - 1] === ""))
    .join("\n");
}
