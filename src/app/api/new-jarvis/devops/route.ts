import { NextResponse } from "next/server";
import {
  buildRequest,
  missingKeyMessage,
  shapeResponse,
  type BuiltRequest,
  type DevopsKind,
  type DevopsSettings,
} from "@/lib/new-jarvis/devops";

// ---------------------------------------------------------------------------
// The website's half of the GitHub / Vercel / Supabase tools.
//
// These run here, on Vercel, rather than through the PC bridge, because that is
// the whole point: the owner asked to "edit and send updates to github" from
// their phone, with the laptop shut. The bridge is for things only this desk can
// do; these are things a token and an HTTPS call can do from anywhere.
//
// The token never leaves this process. It is read from the environment, put in
// an Authorization header, and the model only ever sees the service's answer.
//
// Session-gated by middleware like the rest of /api/new-jarvis. A missing key is
// a 200 with one plain sentence, not a 500: the agent loop shows it as a step the
// model can recover from and explain, instead of ending the turn.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TIMEOUT_MS = 25_000;

function first(...values: (string | undefined)[]): string {
  return values.find((v) => typeof v === "string" && v.trim())?.trim() ?? "";
}

function tokenFor(kind: DevopsKind): string {
  if (kind === "github") return first(process.env.JARVIS_GITHUB_TOKEN, process.env.GITHUB_TOKEN);
  if (kind === "vercel") return first(process.env.VERCEL_TOKEN, process.env.VERCEL_API_TOKEN);
  return first(process.env.SUPABASE_ACCESS_TOKEN, process.env.SUPABASE_PAT);
}

function settingsFor(): DevopsSettings {
  return {
    defaultRepo: first(process.env.JARVIS_BOARD_REPO, process.env.JARVIS_GITHUB_REPO) || "legacymiles/ultimate-assistant-os",
    vercelTeam: first(process.env.VERCEL_TEAM_ID, process.env.VERCEL_TEAM_SLUG) || undefined,
  };
}

function headersFor(kind: DevopsKind, token: string): Record<string, string> {
  if (kind === "github") {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ultimate-assistant-os",
    };
  }
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** One sentence for the model, from whichever shape the service failed in. */
function plainFailure(kind: DevopsKind, status: number, body: unknown, action: string): string {
  const record = (body ?? {}) as Record<string, unknown>;
  const nested = (record.error ?? {}) as Record<string, unknown>;
  const said =
    (typeof record.message === "string" && record.message) ||
    (typeof nested.message === "string" && nested.message) ||
    (Array.isArray(record.errors) && JSON.stringify(record.errors).slice(0, 300)) ||
    "";

  if (status === 401) {
    return `The ${kind} key was refused (401). It may have been revoked or rolled — set a fresh one in the hosting environment.`;
  }
  if (status === 403) {
    return `${kind} refused that (403)${said ? `: ${said}` : ""}. The token is probably missing a scope this action needs.`;
  }
  if (status === 404) {
    return `${kind} says that does not exist (404)${action === "read_file" ? " — check the path and branch" : ""}.${said ? ` ${said}` : ""}`;
  }
  if (status === 422) {
    return `${kind} rejected the request (422)${said ? `: ${said}` : ""}.`;
  }
  if (status === 429) {
    return `${kind} is rate limiting this token (429). Wait a minute and try again.`;
  }
  return `${kind} answered ${status}${said ? `: ${said}` : "."}`;
}

async function send(kind: DevopsKind, token: string, built: BuiltRequest): Promise<Response> {
  const hasBody = built.body !== undefined;
  return fetch(built.url, {
    method: built.method,
    headers: {
      ...headersFor(kind, token),
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(built.body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

async function jsonOf(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    // Vercel's log endpoint can answer with newline-delimited JSON.
    const rows = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return { text: line };
        }
      });
    return rows;
  }
}

// ---------------------------------------------------------------------------
// One action that is a sequence, not a call: commit several files at once.
//
// The Contents API writes one file per request, which turns "update these four
// components" into four commits and four chances to leave the branch half
// written. Git's data API builds ONE tree and ONE commit, so the branch either
// moves with all of them or with none.
// ---------------------------------------------------------------------------

interface FileEdit {
  path: string;
  content: string;
}

function filesOf(args: Record<string, unknown>): FileEdit[] {
  const raw = args.files;
  if (Array.isArray(raw)) {
    return raw
      .map((f) => (f ?? {}) as Record<string, unknown>)
      .map((f) => ({ path: String(f.path ?? "").replace(/^[\\/]+/, ""), content: String(f.content ?? f.text ?? "") }))
      .filter((f) => f.path);
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>).map(([path, content]) => ({
      path: path.replace(/^[\\/]+/, ""),
      content: String(content ?? ""),
    }));
  }
  return [];
}

async function commitFiles(
  kind: DevopsKind,
  token: string,
  args: Record<string, unknown>,
  settings: DevopsSettings,
): Promise<Record<string, unknown>> {
  const files = filesOf(args);
  if (!files.length) throw new Error("Pass at least one file: files: [{ path, content }].");
  const repo = String(args.repo ?? settings.defaultRepo).replace(/\.git$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`"${repo}" is not a repository. Pass owner/name.`);
  const message = String(args.message ?? "").trim() || `Update ${files.length} file${files.length === 1 ? "" : "s"}`;
  const api = `https://api.github.com/repos/${repo}`;
  const call = async <T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<T> => {
    const res = await fetch(url, {
      method,
      headers: { ...headersFor(kind, token), "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const data = await jsonOf(res);
    if (!res.ok) throw new Error(plainFailure(kind, res.status, data, "commit_files"));
    return data as T;
  };

  const branch = String(args.branch ?? "").trim() || String((await call<{ default_branch?: string }>(api, "GET")).default_branch ?? "main");
  const ref = await call<{ object?: { sha?: string } }>(`${api}/git/ref/heads/${encodeURIComponent(branch)}`, "GET");
  const parent = String(ref.object?.sha ?? "");
  if (!parent) throw new Error(`GitHub did not report a head for ${branch}.`);
  const base = await call<{ tree?: { sha?: string } }>(`${api}/git/commits/${parent}`, "GET");
  const baseTree = String(base.tree?.sha ?? "");
  if (!baseTree) throw new Error(`GitHub did not report a tree for ${branch}.`);

  const tree = [];
  for (const file of files) {
    const blob = await call<{ sha?: string }>(`${api}/git/blobs`, "POST", { content: file.content, encoding: "utf-8" });
    if (!blob.sha) throw new Error(`GitHub did not store ${file.path}.`);
    tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const nextTree = await call<{ sha?: string }>(`${api}/git/trees`, "POST", { base_tree: baseTree, tree });
  if (!nextTree.sha) throw new Error("GitHub did not build a tree for the change.");
  const commit = await call<{ sha?: string; html_url?: string }>(`${api}/git/commits`, "POST", {
    message,
    tree: nextTree.sha,
    parents: [parent],
  });
  if (!commit.sha) throw new Error("GitHub did not create the commit.");
  await call(`${api}/git/refs/heads/${encodeURIComponent(branch)}`, "PATCH", { sha: commit.sha, force: false });

  return {
    commit: commit.sha.slice(0, 7),
    url: commit.html_url,
    branch,
    files: files.map((f) => f.path),
    note: `Committed ${files.length} file${files.length === 1 ? "" : "s"} to ${branch} in one commit. Nothing is deployed until Vercel builds it.`,
  };
}

// ---------------------------------------------------------------------------

interface Body {
  kind?: unknown;
  action?: unknown;
  args?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const kind = body.kind === "github" || body.kind === "vercel" || body.kind === "supabase" ? (body.kind as DevopsKind) : null;
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const args = body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};
  if (!kind) return NextResponse.json({ error: "Which service — github, vercel or supabase?" }, { status: 400 });
  if (!action) return NextResponse.json({ error: "Which action?" }, { status: 400 });

  const token = tokenFor(kind);
  if (!token) return NextResponse.json({ error: missingKeyMessage(kind) });

  const settings = settingsFor();

  try {
    if (kind === "github" && action === "commit_files") {
      return NextResponse.json(await commitFiles(kind, token, args, settings));
    }

    const built = buildRequest(kind, action, args, settings);

    // Updating or deleting a file needs the blob's current sha. The model should
    // not have to make two calls to learn it, and it is the single most common
    // way an otherwise-correct write fails with 422.
    if (kind === "github" && (action === "write_file" || action === "delete_file") && !String(args.sha ?? "").trim()) {
      const ref = String(args.branch ?? "").trim();
      const probe = await send(kind, token, {
        url: ref ? `${built.url}?ref=${encodeURIComponent(ref)}` : built.url,
        method: "GET",
      });
      if (probe.status === 404 && action === "write_file") {
        // New file: no sha wanted.
      } else if (probe.ok) {
        const found = (await jsonOf(probe)) as { sha?: string };
        if (found.sha) {
          const withSha = { ...(built.body as Record<string, unknown>), sha: found.sha };
          built.body = withSha;
        }
      } else {
        return NextResponse.json({ error: plainFailure(kind, probe.status, await jsonOf(probe), action) });
      }
    }

    const res = await send(kind, token, built);
    const data = await jsonOf(res);
    if (!res.ok) return NextResponse.json({ error: plainFailure(kind, res.status, data, action) });
    return NextResponse.json(shapeResponse(kind, action, data));
  } catch (e) {
    const message = e instanceof Error ? e.message : `The ${kind} call failed.`;
    return NextResponse.json({ error: message });
  }
}
