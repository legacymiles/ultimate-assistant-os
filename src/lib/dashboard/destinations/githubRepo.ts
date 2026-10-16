import type { Destination } from "./types";

// ---------------------------------------------------------------------------
// Screenshot of a code repository → the real repo, saved in Folders › Repos.
//
// The owner screenshots repos they want to come back to. A screenshot of a repo
// is useless as a picture; what they want is the repo itself, so on approval
// this FINDS it on GitHub (exact owner/name when the image shows one, search
// otherwise) and saves a link item with the description and stars, in the
// Folders tab where they keep things.
//
// A repo that cannot be confirmed is still saved — as a search link, flagged —
// because losing the capture is worse than an unverified link.
// ---------------------------------------------------------------------------

export interface RepoFields {
  owner: string;
  name: string;
  query: string;
  guessed: boolean;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

interface GhRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
}

async function findRepo(f: RepoFields): Promise<GhRepo | null> {
  const headers = { Accept: "application/vnd.github+json" };
  try {
    if (f.owner && f.name) {
      const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(f.owner)}/${encodeURIComponent(f.name)}`, { headers });
      if (res.ok) return (await res.json()) as GhRepo;
    }
    const q = f.query || [f.owner, f.name].filter(Boolean).join(" ");
    if (!q) return null;
    const res = await fetch(`https://api.github.com/search/repositories?per_page=1&q=${encodeURIComponent(q)}`, { headers });
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: GhRepo[] };
    return json.items?.[0] ?? null;
  } catch {
    return null;
  }
}

export const githubRepoDestination: Destination<RepoFields> = {
  id: "github-repo",
  label: "Folders › Repos",
  appSlug: "dashboard",

  hint:
    '"github-repo" — the photo shows a CODE REPOSITORY or open-source project: a ' +
    "GitHub/GitLab page, a repo name in a post or video, a README, a terminal " +
    "showing a git clone. Route here when the value is finding and saving THAT " +
    "project, not the text on the screen.",

  fields: [
    { name: "owner", type: "string", describe: 'The repo owner or org as shown (the part before "/"); "" if not visible.' },
    { name: "name", type: "string", describe: "The repository name as shown; \"\" if not visible." },
    {
      name: "query",
      type: "string",
      describe: "A short GitHub search query that would find this project if owner/name are missing (project name plus a key word).",
    },
    { name: "guessed", type: "boolean", describe: "true if owner or name were inferred rather than read clearly." },
  ],

  parse(raw) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const out = { owner: str(r.owner), name: str(r.name), query: str(r.query), guessed: r.guessed === true };
    if (!out.name && !out.query) return null;
    return out;
  },

  preview(f) {
    const id = f.owner && f.name ? `${f.owner}/${f.name}` : f.name || f.query;
    return {
      title: id,
      where: "Folders › Repos",
      lines: ["Looked up on GitHub on approval and saved as a link with its description"],
      unverified: f.guessed || !(f.owner && f.name) ? "Repo name not fully readable — will search GitHub for it" : undefined,
    };
  },

  async commit(f) {
    const { createItem, ensureFolderPath } = await import("@/lib/recall/store");
    const repo = await findRepo(f);
    const { folderId } = ensureFolderPath(["Repos"], true);
    const fallback = `https://github.com/search?type=repositories&q=${encodeURIComponent(f.query || `${f.owner} ${f.name}`.trim())}`;
    const body = repo
      ? [repo.description, `★ ${repo.stargazers_count}${repo.language ? ` · ${repo.language}` : ""}`].filter(Boolean).join("\n")
      : "Could not confirm this repo on GitHub — this link searches for it.";
    createItem({
      title: repo?.full_name ?? ([f.owner, f.name].filter(Boolean).join("/") || f.query),
      body,
      summary: body.slice(0, 160),
      kind: "link",
      source: "web",
      folderId,
      tags: ["repo", "github", ...(repo?.language ? [repo.language.toLowerCase()] : [])],
      url: repo?.html_url ?? fallback,
    });
  },
};
