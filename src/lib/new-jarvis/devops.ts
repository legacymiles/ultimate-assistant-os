// ---------------------------------------------------------------------------
// GitHub, Vercel and Supabase — as three tools the chat can actually use.
//
// The obvious implementation is "let the model run `gh` and `vercel` through
// the shell", and it is the wrong one. A CLI is a second language the model has
// to guess at, it only works while the PC is on, every call would need a gate
// ("this runs on your PC as you"), and `gh` is not even signed in on this
// machine. So the three things the owner actually asks for — read the repo,
// ship a change, check the deploy, run a migration — are first-class calls
// against the services' own HTTP APIs, made by the WEBSITE.
//
// That means they work with the laptop shut, which is the whole point of the
// hub being deployed. It also means one place decides what each call is
// allowed to do, and `actions.classify` is that place (hub/github, hub/vercel,
// hub/supabase): reads are free, writing a file or opening a PR is an action,
// merging, deploying, deleting and raw SQL are grave.
//
// This file is pure on purpose. The route executes what `buildRequest` returns
// and shapes it with `shapeResponse`; the tests assert both without a network.
// ---------------------------------------------------------------------------

export type DevopsKind = "github" | "vercel" | "supabase";

export const DEVOPS_KINDS: DevopsKind[] = ["github", "vercel", "supabase"];

export interface DevopsSettings {
  /** owner/name used when the model says only "my site". */
  defaultRepo: string;
  /** Vercel team id or slug, when the account is a team. */
  vercelTeam?: string;
}

export interface BuiltRequest {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const numArg = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(100, Math.floor(n)) : fallback;
};

/** The env var each service needs, and the one sentence that gets it set. */
export function keyHelp(kind: DevopsKind): { names: string[]; why: string } {
  switch (kind) {
    case "github":
      return {
        names: ["JARVIS_GITHUB_TOKEN", "GITHUB_TOKEN"],
        why: "Create a fine-grained token at github.com/settings/tokens with Contents and Pull requests read/write, then set JARVIS_GITHUB_TOKEN in the hosting environment.",
      };
    case "vercel":
      return {
        names: ["VERCEL_TOKEN", "VERCEL_API_TOKEN"],
        why: "Create a token at vercel.com/account/tokens, then set VERCEL_TOKEN in the hosting environment.",
      };
    case "supabase":
      return {
        names: ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PAT"],
        why: "Create a personal access token at supabase.com/dashboard/account/tokens, then set SUPABASE_ACCESS_TOKEN in the hosting environment.",
      };
  }
}

export function missingKeyMessage(kind: DevopsKind): string {
  const { names, why } = keyHelp(kind);
  return `Jarvis has no ${kind} key on the website yet, so it can't reach ${kind} with the PC off. ${why} (It looks for ${names.join(" or ")}.)`;
}

// ---------------------------------------------------------------------------
// Building the call
// ---------------------------------------------------------------------------

function repoOf(args: Record<string, unknown>, settings: DevopsSettings): string {
  const raw = str(args.repo) || settings.defaultRepo;
  const clean = raw.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(clean)) {
    throw new Error(`"${raw}" is not a repository. Pass owner/name, like legacymiles/ultimate-assistant-os.`);
  }
  return clean;
}

function pathOf(args: Record<string, unknown>, field = "path"): string {
  const raw = str(args[field]).replace(/^[\\/]+/, "");
  if (!raw) throw new Error(`Which file? Pass its path inside the repo, like src/app/page.tsx.`);
  return raw;
}

function teamQuery(settings: DevopsSettings): string {
  return settings.vercelTeam ? `teamId=${encodeURIComponent(settings.vercelTeam)}` : "";
}

function withQuery(base: string, params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

const GH = "https://api.github.com";
const VC = "https://api.vercel.com";
const SB = "https://api.supabase.com/v1";

/** Build the HTTP call for one action. Throws a sentence the model can act on. */
export function buildRequest(
  kind: DevopsKind,
  action: string,
  args: Record<string, unknown>,
  settings: DevopsSettings,
): BuiltRequest {
  if (kind === "github") {
    const repo = action === "whoami" || action === "repos" || action === "orgs" ? "" : repoOf(args, settings);
    switch (action) {
      case "whoami":
        return { url: `${GH}/user`, method: "GET" };
      case "repos":
        return { url: withQuery(`${GH}/user/repos`, { per_page: numArg(args.limit, 30), sort: "updated" }), method: "GET" };
      case "repo":
        return { url: `${GH}/repos/${repo}`, method: "GET" };
      case "branches":
        return { url: withQuery(`${GH}/repos/${repo}/branches`, { per_page: numArg(args.limit, 30) }), method: "GET" };
      case "commits":
        return {
          url: withQuery(`${GH}/repos/${repo}/commits`, { per_page: numArg(args.limit, 10), sha: str(args.branch) || undefined }),
          method: "GET",
        };
      case "pulls":
        return {
          url: withQuery(`${GH}/repos/${repo}/pulls`, { state: str(args.state) || "open", per_page: numArg(args.limit, 20) }),
          method: "GET",
        };
      case "pull": {
        const number = Number(args.number);
        if (!Number.isFinite(number) || number <= 0) throw new Error("Which pull request? Pass its number.");
        return { url: `${GH}/repos/${repo}/pulls/${number}`, method: "GET" };
      }
      case "pull_files": {
        const number = Number(args.number);
        if (!Number.isFinite(number) || number <= 0) throw new Error("Which pull request? Pass its number.");
        return { url: withQuery(`${GH}/repos/${repo}/pulls/${number}/files`, { per_page: 100 }), method: "GET" };
      }
      case "create_pull": {
        const title = str(args.title).trim();
        const head = str(args.head ?? args.branch).trim();
        const base = str(args.base).trim() || "main";
        if (!title) throw new Error("A pull request needs a title.");
        if (!head) throw new Error("A pull request needs the branch it comes from (`head`).");
        return {
          url: `${GH}/repos/${repo}/pulls`,
          method: "POST",
          body: { title, head, base, body: str(args.body), draft: Boolean(args.draft) },
        };
      }
      case "merge_pull": {
        const number = Number(args.number);
        if (!Number.isFinite(number) || number <= 0) throw new Error("Which pull request? Pass its number.");
        return {
          url: `${GH}/repos/${repo}/pulls/${number}/merge`,
          method: "PUT",
          body: { merge_method: str(args.method) || "squash", commit_title: str(args.title), commit_message: str(args.message) },
        };
      }
      case "issues":
        return {
          url: withQuery(`${GH}/repos/${repo}/issues`, { state: str(args.state) || "open", per_page: numArg(args.limit, 20) }),
          method: "GET",
        };
      case "create_issue": {
        const title = str(args.title).trim();
        if (!title) throw new Error("An issue needs a title.");
        return { url: `${GH}/repos/${repo}/issues`, method: "POST", body: { title, body: str(args.body) } };
      }
      case "read_file":
        return {
          url: withQuery(`${GH}/repos/${repo}/contents/${pathOf(args)}`, { ref: str(args.ref ?? args.branch) || undefined }),
          method: "GET",
        };
      case "write_file":
        return {
          url: `${GH}/repos/${repo}/contents/${pathOf(args)}`,
          method: "PUT",
          body: {
            message: str(args.message) || `Update ${pathOf(args)}`,
            content: Buffer.from(str(args.content ?? args.text), "utf8").toString("base64"),
            ...(str(args.branch) ? { branch: str(args.branch) } : {}),
            ...(str(args.sha) ? { sha: str(args.sha) } : {}),
          },
        };
      case "delete_file":
        return {
          url: `${GH}/repos/${repo}/contents/${pathOf(args)}`,
          method: "DELETE",
          body: {
            message: str(args.message) || `Delete ${pathOf(args)}`,
            ...(str(args.sha) ? { sha: str(args.sha) } : {}),
            ...(str(args.branch) ? { branch: str(args.branch) } : {}),
          },
        };
      case "runs":
        return {
          url: withQuery(`${GH}/repos/${repo}/actions/runs`, { per_page: numArg(args.limit, 10), branch: str(args.branch) || undefined }),
          method: "GET",
        };
      case "rerun": {
        const runId = Number(args.runId ?? args.id);
        if (!Number.isFinite(runId) || runId <= 0) throw new Error("Which run? Pass its runId from runs.");
        return { url: `${GH}/repos/${repo}/actions/runs/${runId}/rerun`, method: "POST", body: {} };
      }
      case "branches_delete": {
        const branch = str(args.branch).trim();
        if (!branch) throw new Error("Which branch? Pass its name.");
        return { url: `${GH}/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, method: "DELETE" };
      }
      default:
        throw new Error(
          `GitHub action "${action}" is not one Jarvis has. Use: whoami, repos, repo, branches, commits, pulls, pull, pull_files, create_pull, merge_pull, issues, create_issue, read_file, write_file, delete_file, runs, rerun, branches_delete.`,
        );
    }
  }

  if (kind === "vercel") {
    const tq = teamQuery(settings);
    const project = str(args.project ?? args.id).trim();
    const needProject = () => {
      if (!project) throw new Error("Which Vercel project? Pass its name or id.");
      return encodeURIComponent(project);
    };
    switch (action) {
      case "whoami":
        return { url: `${VC}/v2/user`, method: "GET" };
      case "teams":
        return { url: withQuery(`${VC}/v2/teams`, { limit: 20 }), method: "GET" };
      case "projects":
        return {
          url: withQuery(`${VC}/v9/projects`, {
            limit: numArg(args.limit, 20),
            teamId: settings.vercelTeam || undefined,
          }),
          method: "GET",
        };
      case "project":
        return { url: withQuery(`${VC}/v9/projects/${needProject()}`, tq ? { teamId: settings.vercelTeam } : {}), method: "GET" };
      case "deployments":
        return {
          url: withQuery(`${VC}/v6/deployments`, {
            limit: numArg(args.limit, 10),
            projectId: project || undefined,
            ...(tq ? { teamId: settings.vercelTeam } : {}),
          }),
          method: "GET",
        };
      case "deployment": {
        const id = str(args.deploymentId ?? args.id).trim();
        if (!id) throw new Error("Which deployment? Pass its id or url from deployments.");
        return { url: withQuery(`${VC}/v13/deployments/${encodeURIComponent(id)}`, tq ? { teamId: settings.vercelTeam } : {}), method: "GET" };
      }
      case "logs": {
        const id = str(args.deploymentId ?? args.id).trim();
        if (!id) throw new Error("Which deployment? Pass its id from deployments.");
        return {
          url: withQuery(`${VC}/v3/deployments/${encodeURIComponent(id)}/events`, {
            limit: numArg(args.limit, 100),
            direction: "backward",
            ...(tq ? { teamId: settings.vercelTeam } : {}),
          }),
          method: "GET",
        };
      }
      case "redeploy": {
        const id = str(args.deploymentId ?? args.id).trim();
        if (!id) throw new Error("Which deployment should be redeployed? Pass its id.");
        return {
          url: `${VC}/v13/deployments`,
          method: "POST",
          body: {
            name: project || str(args.name),
            deploymentId: id,
            target: str(args.target) || "production",
            ...(settings.vercelTeam ? { teamId: settings.vercelTeam } : {}),
          },
        };
      }
      case "env":
        return {
          url: withQuery(`${VC}/v9/projects/${needProject()}/env`, tq ? { teamId: settings.vercelTeam } : {}),
          method: "GET",
        };
      case "env_set": {
        const key = str(args.key).trim();
        const value = str(args.value);
        if (!key) throw new Error("Which variable? Pass its key.");
        if (!value) throw new Error("Pass the value too.");
        return {
          url: withQuery(`${VC}/v10/projects/${needProject()}/env`, tq ? { teamId: settings.vercelTeam, upsert: "true" } : { upsert: "true" }),
          method: "POST",
          body: {
            key,
            value,
            type: "encrypted",
            target: Array.isArray(args.target) && args.target.length ? args.target : ["production", "preview"],
          },
        };
      }
      case "domains":
        return { url: `${VC}/v9/projects/${needProject()}/domains`, method: "GET" };
      default:
        throw new Error(
          `Vercel action "${action}" is not one Jarvis has. Use: whoami, teams, projects, project, deployments, deployment, logs, redeploy, env, env_set, domains.`,
        );
    }
  }

  // Supabase
  const ref = str(args.project ?? args.ref ?? args.id).trim();
  const needRef = () => {
    if (!ref) throw new Error("Which Supabase project? Pass its ref (the id in the project URL).");
    return encodeURIComponent(ref);
  };
  switch (action) {
    case "projects":
      return { url: `${SB}/projects`, method: "GET" };
    case "project":
      return { url: `${SB}/projects/${needRef()}`, method: "GET" };
    case "api_keys":
      return { url: `${SB}/projects/${needRef()}/api-keys`, method: "GET" };
    case "functions":
      return { url: `${SB}/projects/${needRef()}/functions`, method: "GET" };
    case "secrets":
      return { url: `${SB}/projects/${needRef()}/secrets`, method: "GET" };
    case "set_secret": {
      const name = str(args.name).trim();
      const value = str(args.value);
      if (!name || !value) throw new Error("A secret needs a name and a value.");
      return { url: `${SB}/projects/${needRef()}/secrets`, method: "POST", body: { name, value } };
    }
    case "sql": {
      const query = str(args.sql ?? args.query).trim();
      if (!query) throw new Error("Pass the SQL to run.");
      return { url: `${SB}/projects/${needRef()}/database/query`, method: "POST", body: { query } };
    }
    case "tables":
      return {
        url: `${SB}/projects/${needRef()}/database/query`,
        method: "POST",
        body: {
          query:
            "select table_schema, table_name from information_schema.tables " +
            "where table_schema not in ('pg_catalog','information_schema') order by 1, 2",
        },
      };
    case "migrations":
      return {
        url: `${SB}/projects/${needRef()}/database/query`,
        method: "POST",
        body: {
          query:
            "select version, name from supabase_migrations.schema_migrations order by version desc limit 30",
        },
      };
    default:
      throw new Error(
        `Supabase action "${action}" is not one Jarvis has. Use: projects, project, api_keys, functions, secrets, set_secret, sql, tables, migrations.`,
      );
  }
}

// ---------------------------------------------------------------------------
// Reading the answer
// ---------------------------------------------------------------------------

const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

/**
 * Trim a service's reply to what the model needs.
 *
 * The raw payloads are enormous — a GitHub repo object is 8 KB of URLs nobody
 * will click, and Vercel returns an event per log line. Sending them whole
 * burns the chat's context and buries the one number that matters.
 */
export function shapeResponse(kind: DevopsKind, action: string, data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data) && "error" in data) {
    return data as Record<string, unknown>;
  }

  if (kind === "github") {
    if (action === "read_file") {
      // A path that names a folder comes back as an array of entries.
      if (Array.isArray(data)) {
        return {
          entries: list(data).map((e) => ({ name: e.name, path: e.path, type: e.type, sha: e.sha })),
          note: "That path is a folder. Pass a file's path to read it.",
        };
      }
      const file = (data ?? {}) as { content?: string; encoding?: string; path?: string; sha?: string; html_url?: string };
      const text =
        file.encoding === "base64" && file.content ? Buffer.from(file.content, "base64").toString("utf8") : str(file.content);
      return { path: file.path ?? "", sha: file.sha ?? "", url: file.html_url ?? "", text: text.slice(0, 20_000), truncated: text.length > 20_000 };
    }
    if (action === "whoami") {
      const u = (data ?? {}) as Record<string, unknown>;
      return { login: u.login, name: u.name, url: u.html_url };
    }
    if (action === "repos") {
      return { repos: list(data).map((r) => ({ fullName: r.full_name, private: r.private, updated: r.updated_at, url: r.html_url })) };
    }
    if (action === "repo") {
      const r = (data ?? {}) as Record<string, unknown>;
      return { fullName: r.full_name, defaultBranch: r.default_branch, private: r.private, url: r.html_url, pushedAt: r.pushed_at };
    }
    if (action === "branches") {
      return { branches: list(data).map((b) => ({ name: b.name, sha: (b.commit as { sha?: string } | undefined)?.sha?.slice(0, 7) })) };
    }
    if (action === "commits") {
      return {
        commits: list(data).map((c) => {
          const commit = (c.commit ?? {}) as { message?: string; author?: { date?: string } };
          return { sha: str(c.sha).slice(0, 7), message: firstLine(str(commit.message)), at: commit.author?.date, author: (c.author as { login?: string } | null)?.login };
        }),
      };
    }
    if (action === "pulls" || action === "pull") {
      const shape = (p: Record<string, unknown>) => ({
        number: p.number,
        title: p.title,
        state: p.state,
        draft: p.draft,
        url: p.html_url,
        head: (p.head as { ref?: string } | undefined)?.ref,
        base: (p.base as { ref?: string } | undefined)?.ref,
        mergeable: p.mergeable,
      });
      return Array.isArray(data) ? { pulls: list(data).map(shape) } : shape((data ?? {}) as Record<string, unknown>);
    }
    if (action === "pull_files") {
      return { files: list(data).map((f) => ({ file: f.filename, status: f.status, added: f.additions, removed: f.deletions })) };
    }
    if (action === "issues") {
      return {
        issues: list(data).map((i) => ({ number: i.number, title: i.title, state: i.state, url: i.html_url, at: i.created_at })),
      };
    }
    if (action === "runs") {
      const runs = list((data as { workflow_runs?: unknown })?.workflow_runs);
      return {
        runs: runs.map((r) => ({ id: r.id, name: r.name, branch: r.head_branch, status: r.status, conclusion: r.conclusion, url: r.html_url, at: r.created_at })),
      };
    }
    if (action === "merge_pull") {
      const m = (data ?? {}) as Record<string, unknown>;
      return { merged: m.merged, message: m.message, sha: str(m.sha).slice(0, 7) };
    }
    if (action === "write_file" || action === "delete_file") {
      const c = (data ?? {}) as { commit?: { sha?: string; html_url?: string }; content?: { path?: string } };
      return { commit: c.commit?.sha?.slice(0, 7), url: c.commit?.html_url, path: c.content?.path };
    }
    if (action === "create_pull" || action === "create_issue") {
      const p = (data ?? {}) as Record<string, unknown>;
      return { number: p.number, title: p.title, url: p.html_url, state: p.state };
    }
    if (action === "rerun") return { queued: true };
    if (action === "branches_delete") return { deleted: true };
    return compact(data);
  }

  if (kind === "vercel") {
    if (action === "whoami") {
      const u = (data ?? {}) as Record<string, unknown>;
      return { user: u.username ?? u.email ?? u.name, id: u.id };
    }
    if (action === "projects") {
      return { projects: list((data as { projects?: unknown })?.projects).map((p) => ({ name: p.name, id: p.id, framework: p.framework, updated: p.updatedAt, url: p.link })) };
    }
    if (action === "project") {
      const p = (data ?? {}) as Record<string, unknown>;
      return { name: p.name, id: p.id, framework: p.framework, url: p.link, updated: p.updatedAt };
    }
    if (action === "deployments") {
      return {
        deployments: list((data as { deployments?: unknown })?.deployments).map((d) => ({
          id: d.uid ?? d.id,
          url: d.url,
          state: d.state ?? d.readyState,
          target: d.target,
          at: d.createdAt ?? d.created,
          commit: (d.meta as { githubCommitSha?: string } | undefined)?.githubCommitSha?.slice(0, 7),
        })),
      };
    }
    if (action === "deployment") {
      const d = (data ?? {}) as Record<string, unknown>;
      return { id: d.id, url: d.url, state: d.readyState ?? d.state, target: d.target, at: d.createdAt, error: d.errorMessage };
    }
    if (action === "logs") {
      const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      return {
        lines: rows.slice(-120).map((e) => str(e.text ?? e.message ?? e.payload)).filter(Boolean),
        count: rows.length,
      };
    }
    if (action === "redeploy") {
      const d = (data ?? {}) as Record<string, unknown>;
      return { id: d.id ?? d.uid, url: d.url, state: d.readyState ?? d.state };
    }
    if (action === "env") {
      return {
        env: list((data as { envs?: unknown })?.envs).map((e) => ({
          key: e.key,
          target: e.target,
          type: e.type,
          // Values are encrypted at rest and are not needed to answer "is it set?".
          value: e.type === "plain" ? e.value : undefined,
        })),
      };
    }
    if (action === "domains") {
      return { domains: list((data as { domains?: unknown })?.domains).map((d) => ({ name: d.name, verified: d.verified })) };
    }
    return compact(data);
  }

  // Supabase
  if (action === "projects") {
    return {
      projects: list(data).map((p) => ({ ref: p.id, name: p.name, region: p.region, status: p.status, url: p.organization_id ? undefined : undefined })),
    };
  }
  if (action === "project") {
    const p = (data ?? {}) as Record<string, unknown>;
    return {
      ref: p.id,
      name: p.name,
      region: p.region,
      status: p.status,
      dbHost: (p.database as { host?: string } | undefined)?.host,
    };
  }
  if (action === "api_keys") {
    return {
      keys: list(data)
        .filter((k) => k.name === "anon" || k.type === "anon")
        .map((k) => ({ name: k.name, key: k.api_key })),
      note: "Only the public anon key is shown. The service-role key is deliberately withheld from the model.",
    };
  }
  if (action === "functions") {
    return { functions: list(data).map((f) => ({ slug: f.slug, name: f.name, status: f.status, updated: f.updated_at })) };
  }
  if (action === "secrets") {
    // Names only: a model has no use for the values, and a transcript does not
    // need to be a credential store.
    return { secrets: list(data).map((s) => ({ name: s.name })) };
  }
  if (action === "set_secret") return { saved: true };
  if (action === "sql" || action === "tables" || action === "migrations") {
    const rows = Array.isArray(data) ? (data as unknown[]) : ((data as { result?: unknown })?.result ?? []);
    const arr = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
    return { rows: arr.slice(0, 200), count: arr.length, truncated: arr.length > 200 };
  }
  return compact(data);
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
}

function compact(data: unknown): Record<string, unknown> {
  const json = JSON.stringify(data ?? {});
  return json.length > 12_000 ? { json: `${json.slice(0, 12_000)}…`, truncated: true } : { json };
}

// ---------------------------------------------------------------------------
// The client half: one call from the page to the website's own route
// ---------------------------------------------------------------------------

export interface DevopsResponse {
  [key: string]: unknown;
  error?: string;
}

/**
 * Ask the website to make the call.
 *
 * `fetchImpl` is injected so the test can assert the body and the error path
 * without mocking a global. A failure comes back as `{ error }` with status 200
 * so the agent loop shows it as a step the model can recover from rather than
 * ending the whole run.
 */
export async function runDevopsTool(
  kind: DevopsKind,
  args: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<DevopsResponse> {
  let res: Response;
  try {
    res = await fetchImpl("/api/new-jarvis/devops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, action: str(args.action), args }),
    });
  } catch {
    throw new Error(`The website couldn't be reached to ask ${kind}.`);
  }
  const data = (await res.json().catch(() => null)) as DevopsResponse | null;
  if (!data) throw new Error(`${kind} answered ${res.status} with something that was not JSON.`);
  if (typeof data.error === "string") return data;
  if (!res.ok) throw new Error(data.error ?? `${kind} answered ${res.status}.`);
  return data;
}
