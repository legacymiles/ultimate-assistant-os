// ---------------------------------------------------------------------------
// MT4/MT5 bot discovery — PERMITTED PUBLIC sources only.
//
//   GitHub   — the public REST API (repository search; code search only with a
//              token), the git trees API to list .mq4/.mq5 files, raw text from
//              raw.githubusercontent.com. Rate limits are read from the
//              response headers and respected: discovery stops early and hands
//              back `retryAfter` instead of hammering the API.
//   Telegram — PUBLIC channels only, through their public web preview
//              https://t.me/s/<channel> (plain HTML, no login, no bot token).
//              Never joins a group, never logs in, never reads private chats.
//              Files posted there can't be downloaded without a client, so
//              they are recorded by name and link only.
//   Web      — results from the hub's search service (injected as `search`),
//              kept only when the page links to .mq4/.mq5/.ex4 files or a
//              GitHub repository.
//
// Downloads: only TEXT source files (.mq4/.mq5/.mqh) and text docs, at most
// 1.5 MB each. Compiled .ex4/.ex5 are recorded as "compiled, not verifiable"
// and NEVER downloaded or executed. Nothing here runs any EA code.
//
// The parsers (HTML → posts, GitHub JSON → candidates, page → links) are pure
// and unit-tested with fixtures in sources.test.ts; the fetchers are thin.
// ---------------------------------------------------------------------------

export type SourceId = "github" | "telegram" | "web";
export type FileKind = "source" | "compiled" | "doc";

export interface CandidateFile {
  name: string;
  url: string;
  kind: FileKind;
  size?: number;
  /** false = known by name only (a Telegram attachment): never downloaded. */
  fetchable: boolean;
}

export interface Candidate {
  source: SourceId;
  sourceUrl: string;
  title: string;
  developer: string;
  publishedAt?: string;
  files: CandidateFile[];
  description: string;
  /** GitHub "owner/repo" referenced by a post or page, to expand later. */
  repos?: string[];
  /** Marketing claims quoted from the post/page. Always unverified. */
  claims?: string[];
}

export const MAX_SOURCE_BYTES = 1.5 * 1024 * 1024;
const UA = "jarvis-queue-247 (mt4-discovery; public sources only)";

// --- small pure helpers ------------------------------------------------------

export function fileKind(name: string): FileKind | null {
  const n = name.toLowerCase();
  if (/\.(mq4|mq5|mqh)$/.test(n)) return "source";
  if (/\.(ex4|ex5)$/.test(n)) return "compiled";
  if (/\.(md|txt|pdf|set)$/.test(n) || /(^|\/)readme(\.\w+)?$/.test(n)) return "doc";
  return null;
}

/** Text a fetch may download: sources and plain-text docs. Never compiled files or PDFs. */
export function isDownloadable(f: Pick<CandidateFile, "name" | "kind" | "url" | "fetchable">): boolean {
  if (!f.fetchable || !/^https:\/\//i.test(f.url)) return false;
  if (f.kind === "source") return true;
  return f.kind === "doc" && /\.(md|txt|set)$|readme$/i.test(f.name);
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

const EA_WORDS = /\b(EA|EAs|expert\s*advisors?|mt4|mt5|mq4|mq5|ex4|ex5|metatrader|forex\s*(robot|bot)s?|trading\s*(robot|bot)s?|scalper|grid\s*bot)\b/i;

export function looksEaRelated(text: string): boolean {
  return EA_WORDS.test(text);
}

const CLAIM = /\d+(\.\d+)?\s*%|win\s*-?\s*rate|\bprofit(s|able)?\b|no\s*loss|never\s*los|guarantee|drawdown|myfxbook|fxblue|backtest|pips?\s*(a|per|\/)\s*(day|week|month)|risk[- ]?free|\bx\d+\b|doubl/i;

/** Sentences that make performance claims. Recorded as unverified, never used as evidence. */
export function extractClaims(text: string): string[] {
  const parts = text.split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (CLAIM.test(p) && !out.includes(p)) out.push(p.slice(0, 200));
    if (out.length >= 5) break;
  }
  return out;
}

/** "owner/repo" from any github.com URL, or null. */
export function repoFromUrl(url: string): string | null {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#]|$)/i.exec(url.trim());
  if (!m) return null;
  const owner = m[1];
  if (/^(topics|search|orgs|sponsors|features|about|marketplace|login|settings|explore|collections)$/i.test(owner)) return null;
  return `${owner}/${m[2]}`;
}

function fileNameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    return url.split("/").pop() ?? url;
  }
}

/** A raw.githubusercontent.com URL for a path in a repo, each segment encoded. */
export function rawUrl(fullName: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${fullName}/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

// --- GitHub: pure parsers -----------------------------------------------------

export interface GithubRepo {
  fullName: string;
  owner: string;
  htmlUrl: string;
  description: string;
  pushedAt: string;
  defaultBranch: string;
  stars: number;
  license: string | null;
}

export function parseGithubRepoSearch(json: unknown): GithubRepo[] {
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  const out: GithubRepo[] = [];
  for (const raw of items) {
    const r = raw as Record<string, unknown>;
    if (typeof r?.full_name !== "string" || typeof r.html_url !== "string") continue;
    if (r.private === true || r.fork === true) continue;
    out.push({
      fullName: r.full_name,
      owner: String((r.owner as { login?: string })?.login ?? r.full_name.split("/")[0]),
      htmlUrl: r.html_url,
      description: typeof r.description === "string" ? r.description : "",
      pushedAt: typeof r.pushed_at === "string" ? r.pushed_at : "",
      defaultBranch: typeof r.default_branch === "string" ? r.default_branch : "HEAD",
      stars: Number(r.stargazers_count) || 0,
      license: ((r.license as { spdx_id?: string } | null)?.spdx_id as string | undefined) ?? null,
    });
  }
  return out;
}

export interface GithubCodeHit {
  fullName: string;
  path: string;
  htmlUrl: string;
}

export function parseGithubCodeSearch(json: unknown): GithubCodeHit[] {
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((raw) => {
    const r = raw as { path?: string; html_url?: string; repository?: { full_name?: string; private?: boolean } };
    if (!r?.path || !r.html_url || !r.repository?.full_name || r.repository.private) return [];
    return [{ fullName: r.repository.full_name, path: r.path, htmlUrl: r.html_url }];
  });
}

export interface TreeEntry {
  path: string;
  size?: number;
}

/** Blobs in a git tree that are EA source, compiled EAs or docs. */
export function parseGithubTree(json: unknown): TreeEntry[] {
  const tree = (json as { tree?: unknown[] })?.tree;
  if (!Array.isArray(tree)) return [];
  return tree.flatMap((raw) => {
    const e = raw as { path?: string; type?: string; size?: number };
    if (e?.type !== "blob" || typeof e.path !== "string") return [];
    if (!fileKind(e.path)) return [];
    if (fileKind(e.path) === "doc" && e.path.includes("/") && !/readme/i.test(e.path)) return [];
    return [{ path: e.path, size: typeof e.size === "number" ? e.size : undefined }];
  });
}

const kindOrder: Record<FileKind, number> = { source: 0, compiled: 1, doc: 2 };

export function repoToCandidate(repo: GithubRepo, entries: TreeEntry[], maxFiles = 40): Candidate {
  const files: CandidateFile[] = entries
    .map((e) => ({ name: e.path, url: rawUrl(repo.fullName, repo.defaultBranch, e.path), kind: fileKind(e.path)!, size: e.size, fetchable: true }))
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || Number(/experts/i.test(b.name)) - Number(/experts/i.test(a.name)) || a.name.localeCompare(b.name))
    .slice(0, maxFiles);
  return {
    source: "github",
    sourceUrl: repo.htmlUrl,
    title: repo.fullName,
    developer: repo.owner,
    publishedAt: repo.pushedAt || undefined,
    files: files.map((f) => (f.kind === "compiled" ? { ...f, fetchable: false } : f)),
    description: [repo.description, repo.stars ? `★${repo.stars}` : "", repo.license ? `license ${repo.license}` : ""].filter(Boolean).join(" · "),
  };
}

export function codeHitsToCandidates(hits: GithubCodeHit[]): Candidate[] {
  const byRepo = new Map<string, GithubCodeHit[]>();
  for (const h of hits) byRepo.set(h.fullName, [...(byRepo.get(h.fullName) ?? []), h]);
  return [...byRepo.entries()].map(([fullName, hs]) => ({
    source: "github" as const,
    sourceUrl: `https://github.com/${fullName}`,
    title: fullName,
    developer: fullName.split("/")[0],
    files: hs.map((h) => ({ name: h.path, url: rawUrl(fullName, "HEAD", h.path), kind: fileKind(h.path) ?? "source", fetchable: true })),
    description: "Found by GitHub code search",
  }));
}

// --- Telegram: pure parser ----------------------------------------------------

export interface TelegramPost {
  channel: string;
  id: number;
  url: string;
  date?: string;
  text: string;
  links: string[];
  documents: string[];
}

export function validChannel(name: string): string | null {
  const c = name.trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\/(s\/)?/i, "").replace(/\/.*$/, "");
  return /^[A-Za-z][A-Za-z0-9_]{3,63}$/.test(c) ? c : null;
}

/** Posts from a https://t.me/s/<channel> public preview page, oldest first. */
export function parseTelegramPreview(html: string, channel: string): TelegramPost[] {
  const posts: TelegramPost[] = [];
  const parts = html.split(/(?=<div[^>]+class="[^"]*tgme_widget_message[ "][^>]*data-post=")/);
  for (const part of parts) {
    const idm = /data-post="([^"/]+)\/(\d+)"/.exec(part);
    if (!idm) continue;
    const id = Number(idm[2]);
    const textHtml = /class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(part)?.[1] ?? "";
    const links = [...new Set([...textHtml.matchAll(/href="([^"]+)"/g), ...part.matchAll(/class="[^"]*tgme_widget_message_(?:link_preview|document_wrap)[^"]*"[^>]*href="([^"]+)"/g)]
      .map((m) => decodeEntities(m[1]))
      .filter((u) => /^https?:\/\//i.test(u) && !/^https?:\/\/t\.me\//i.test(u)))];
    const documents = [...part.matchAll(/class="[^"]*tgme_widget_message_document_title[^"]*"[^>]*>([^<]+)</g)].map((m) => decodeEntities(m[1]).trim());
    const date = /<time[^>]+datetime="([^"]+)"/.exec(part)?.[1];
    posts.push({ channel: idm[1] || channel, id, url: `https://t.me/${idm[1] || channel}/${id}`, date, text: htmlToText(textHtml), links, documents });
  }
  return posts.sort((a, b) => a.id - b.id);
}

export function postToCandidate(p: TelegramPost): Candidate | null {
  const docFiles: CandidateFile[] = p.documents.flatMap((d) => {
    const k = fileKind(d);
    return k ? [{ name: d, url: p.url, kind: k, fetchable: false }] : [];
  });
  const linkFiles: CandidateFile[] = p.links.flatMap((u) => {
    const k = fileKind(fileNameOf(u));
    return k ? [{ name: fileNameOf(u), url: u, kind: k, fetchable: k !== "compiled" }] : [];
  });
  const repos = [...new Set(p.links.map(repoFromUrl).filter((r): r is string => !!r))];
  if (!docFiles.length && !linkFiles.length && !repos.length) return null;
  if (!looksEaRelated(`${p.text} ${p.documents.join(" ")} ${p.links.join(" ")}`)) return null;
  const firstLine = p.text.split("\n").find((l) => l.trim())?.trim() ?? "";
  return {
    source: "telegram",
    sourceUrl: p.url,
    title: (firstLine || p.documents[0] || `@${p.channel} post ${p.id}`).slice(0, 100),
    developer: `@${p.channel}`,
    publishedAt: p.date,
    files: [...linkFiles, ...docFiles],
    description: p.text.slice(0, 600),
    repos,
    claims: extractClaims(p.text),
  };
}

// --- Web: pure page parser -----------------------------------------------------

export function extractEaLinks(html: string, baseUrl: string): { title: string; files: CandidateFile[]; repos: string[]; text: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim().slice(0, 120);
  const files: CandidateFile[] = [];
  const repos = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    let url: string;
    try {
      url = new URL(decodeEntities(m[1]), baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(url)) continue;
    const repo = repoFromUrl(url);
    const name = fileNameOf(url);
    const k = fileKind(name);
    if (k && k !== "doc") {
      if (!files.some((f) => f.url === url)) files.push({ name, url, kind: k, fetchable: k === "source" && /^https:/i.test(url) });
    } else if (repo) repos.add(repo);
  }
  const text = htmlToText(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")).replace(/\s+/g, " ").slice(0, 3000);
  return { title, files, repos: [...repos], text };
}

// --- fetching -------------------------------------------------------------------

export class RateLimited extends Error {
  constructor(public retryAfter: string, message = "GitHub rate limit reached") {
    super(message);
  }
}

/** When GitHub says to come back, from its headers; null when it is fine. */
export function githubRetryAfter(status: number, headers: Headers, now: Date): string | null {
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = Number(headers.get("x-ratelimit-reset"));
  const retry = Number(headers.get("retry-after"));
  const limited = status === 429 || (status === 403 && (remaining === "0" || Number.isFinite(retry) && retry > 0)) || remaining === "0";
  if (!limited) return null;
  if (Number.isFinite(retry) && retry > 0) return new Date(now.getTime() + retry * 1000).toISOString();
  if (Number.isFinite(reset) && reset > 0) return new Date(Math.max(reset * 1000, now.getTime() + 60_000)).toISOString();
  return new Date(now.getTime() + 15 * 60_000).toISOString();
}

export function githubToken(): string | undefined {
  return process.env.JARVIS_GITHUB_TOKEN || process.env.GITHUB_TOKEN || undefined;
}

async function ghJson(url: string, signal: AbortSignal, now: Date, token?: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": UA, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal,
  });
  const retryAfter = githubRetryAfter(res.status, res.headers, now);
  if (!res.ok) {
    if (retryAfter) throw new RateLimited(retryAfter);
    throw new Error(`GitHub ${res.status} for ${url.replace(/\?.*$/, "")}`);
  }
  const body = await res.json();
  // Last call of the window: use this answer, then stop before the next one.
  if (retryAfter) return Object.assign(body as object, { __retryAfter: retryAfter });
  return body;
}

export interface DiscoverResult {
  candidates: Candidate[];
  notes: string[];
  retryAfter?: string;
}

export async function discoverGithub(opts: {
  query: string;
  since?: string;
  maxRepos: number;
  signal: AbortSignal;
  now: Date;
  skipRepos?: Set<string>;
}): Promise<DiscoverResult & { newestPushed?: string; calls: number }> {
  const token = githubToken();
  const notes: string[] = [];
  const candidates: Candidate[] = [];
  let calls = 0;
  let newestPushed: string | undefined;
  const sinceDay = opts.since ? opts.since.slice(0, 10) : "";
  const q = `${opts.query}${sinceDay ? ` pushed:>=${sinceDay}` : ""}`;
  try {
    calls++;
    const body = await ghJson(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=${Math.min(30, opts.maxRepos * 2)}`,
      opts.signal,
      opts.now,
      token,
    );
    let stopAfter = (body as { __retryAfter?: string }).__retryAfter;
    const repos = parseGithubRepoSearch(body).filter((r) => !opts.skipRepos?.has(r.fullName));
    for (const r of repos) if (r.pushedAt && (!newestPushed || r.pushedAt > newestPushed)) newestPushed = r.pushedAt;
    notes.push(`GitHub repository search "${q}": ${repos.length} repo(s)`);

    if (token && !stopAfter) {
      calls++;
      const code = await ghJson(
        `https://api.github.com/search/code?q=${encodeURIComponent("extension:mq4 OrderSend")}&per_page=10`,
        opts.signal,
        opts.now,
        token,
      );
      stopAfter = (code as { __retryAfter?: string }).__retryAfter;
      const hits = parseGithubCodeSearch(code).filter((h) => !opts.skipRepos?.has(h.fullName) && !repos.some((r) => r.fullName === h.fullName));
      candidates.push(...codeHitsToCandidates(hits).slice(0, opts.maxRepos));
      notes.push(`GitHub code search: ${hits.length} file(s)`);
    } else if (!token) {
      notes.push("No GitHub token — code search skipped (repository search only).");
    }

    for (const r of repos.slice(0, opts.maxRepos)) {
      if (opts.signal.aborted || stopAfter) break;
      calls++;
      const tree = await ghJson(
        `https://api.github.com/repos/${r.fullName}/git/trees/${encodeURIComponent(r.defaultBranch)}?recursive=1`,
        opts.signal,
        opts.now,
        token,
      );
      stopAfter = (tree as { __retryAfter?: string }).__retryAfter;
      const entries = parseGithubTree(tree);
      if (entries.some((e) => fileKind(e.path) !== "doc")) candidates.push(repoToCandidate(r, entries));
    }
    if (stopAfter) return { candidates, notes: [...notes, "GitHub rate limit window used up — stopping early."], retryAfter: stopAfter, newestPushed, calls };
    return { candidates, notes, newestPushed, calls };
  } catch (e) {
    if (e instanceof RateLimited) return { candidates, notes: [...notes, `GitHub rate-limited until ${e.retryAfter}.`], retryAfter: e.retryAfter, newestPushed, calls };
    throw e;
  }
}

/** Expand one "owner/repo" (linked from a post or page) into a candidate. */
export async function githubRepoCandidate(fullName: string, signal: AbortSignal, now: Date): Promise<Candidate | null> {
  const token = githubToken();
  const meta = (await ghJson(`https://api.github.com/repos/${fullName}`, signal, now, token)) as Record<string, unknown>;
  const [repo] = parseGithubRepoSearch({ items: [meta] });
  if (!repo) return null;
  const tree = await ghJson(`https://api.github.com/repos/${fullName}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`, signal, now, token);
  const entries = parseGithubTree(tree);
  return entries.length ? repoToCandidate(repo, entries) : null;
}

export async function discoverTelegram(opts: {
  channels: string[];
  cursors: Record<string, number>;
  signal: AbortSignal;
}): Promise<DiscoverResult & { cursors: Record<string, number> }> {
  const cursors = { ...opts.cursors };
  const candidates: Candidate[] = [];
  const notes: string[] = [];
  for (const raw of opts.channels.slice(0, 20)) {
    if (opts.signal.aborted) break;
    const channel = validChannel(raw);
    if (!channel) {
      notes.push(`Skipped "${raw}": not a public channel name.`);
      continue;
    }
    try {
      const res = await fetch(`https://t.me/s/${channel}`, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: opts.signal, redirect: "follow" });
      if (!res.ok) {
        notes.push(`@${channel}: preview returned ${res.status}.`);
        continue;
      }
      const html = await res.text();
      const posts = parseTelegramPreview(html, channel);
      if (!posts.length) {
        notes.push(`@${channel}: no public preview (private, or not a channel) — skipped.`);
        continue;
      }
      const last = cursors[channel] ?? 0;
      const fresh = posts.filter((p) => p.id > last);
      let added = 0;
      for (const p of fresh) {
        const c = postToCandidate(p);
        if (c) {
          candidates.push(c);
          added++;
        }
      }
      cursors[channel] = Math.max(last, ...posts.map((p) => p.id));
      notes.push(`@${channel}: ${fresh.length} new post(s), ${added} with EA files or repos.`);
    } catch (e) {
      if (opts.signal.aborted) break;
      notes.push(`@${channel}: ${(e as Error).message}`);
    }
  }
  return { candidates, notes, cursors };
}

export type SearchFn = (query: string) => Promise<{ url: string; title: string; description?: string }[]>;

export async function discoverWeb(opts: {
  queries: string[];
  search: SearchFn;
  seen: Set<string>;
  maxPages: number;
  signal: AbortSignal;
}): Promise<DiscoverResult & { visited: string[]; searches: number }> {
  const candidates: Candidate[] = [];
  const notes: string[] = [];
  const visited: string[] = [];
  let searches = 0;
  let pages = 0;
  for (const q of opts.queries.slice(0, 4)) {
    if (opts.signal.aborted) break;
    let results: { url: string; title: string; description?: string }[];
    try {
      searches++;
      results = await opts.search(q);
    } catch (e) {
      notes.push(`Web search "${q}" failed: ${(e as Error).message}`);
      continue;
    }
    let kept = 0;
    for (const r of results) {
      if (pages >= opts.maxPages || opts.signal.aborted) break;
      if (!/^https?:\/\//i.test(r.url) || opts.seen.has(r.url) || visited.includes(r.url)) continue;
      visited.push(r.url);
      const directRepo = repoFromUrl(r.url);
      const directKind = fileKind(fileNameOf(r.url));
      if (directRepo || directKind === "source" || directKind === "compiled") {
        candidates.push({
          source: "web",
          sourceUrl: r.url,
          title: r.title.slice(0, 100),
          developer: directRepo ? directRepo.split("/")[0] : hostOf(r.url),
          files: directKind && directKind !== "doc" ? [{ name: fileNameOf(r.url), url: r.url, kind: directKind, fetchable: directKind === "source" }] : [],
          description: r.description ?? "",
          repos: directRepo ? [directRepo] : [],
          claims: extractClaims(r.description ?? ""),
        });
        kept++;
        continue;
      }
      pages++;
      try {
        const res = await fetch(r.url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: opts.signal, redirect: "follow" });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !/html/i.test(type)) continue;
        const html = (await readCapped(res, 2 * 1024 * 1024)) ?? "";
        const page = extractEaLinks(html, r.url);
        if (!page.files.length && !page.repos.length) continue;
        candidates.push({
          source: "web",
          sourceUrl: r.url,
          title: (page.title || r.title).slice(0, 100),
          developer: hostOf(r.url),
          files: page.files.slice(0, 20),
          description: (r.description || page.text).slice(0, 600),
          repos: page.repos.slice(0, 5),
          claims: extractClaims(page.text),
        });
        kept++;
      } catch (e) {
        if (opts.signal.aborted) break;
      }
    }
    notes.push(`Web "${q}": ${results.length} result(s), ${kept} link to EA files or repos.`);
  }
  return { candidates, notes, visited, searches };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

/** Body bytes, or null if larger than `cap`. */
async function readCappedBytes(res: Response, cap: number): Promise<Uint8Array | null> {
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > cap) return null;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > cap ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return all;
}

/** Text from bytes: UTF-16 LE/BE when a BOM says so (MetaEditor's default), else UTF-8. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

async function readCapped(res: Response, cap: number): Promise<string | null> {
  const bytes = await readCappedBytes(res, cap);
  return bytes ? decodeText(bytes) : null;
}

/**
 * Download one TEXT source/doc file. Refuses compiled files, non-https URLs,
 * anything over 1.5 MB and anything that turns out to be binary. The text is
 * only ever read by the static analyzer — never compiled or run.
 */
export async function fetchSourceText(file: CandidateFile, signal: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; why: string }> {
  if (file.kind === "compiled") return { ok: false, why: "compiled file — never downloaded" };
  if (!isDownloadable(file)) return { ok: false, why: "not a downloadable text file" };
  if (file.size !== undefined && file.size > MAX_SOURCE_BYTES) return { ok: false, why: `too large (${Math.round(file.size / 1024)} KB)` };
  const res = await fetch(file.url, { headers: { "User-Agent": UA, Accept: "text/plain, */*" }, signal, redirect: "follow" });
  if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
  const text = await readCapped(res, MAX_SOURCE_BYTES);
  if (text === null) return { ok: false, why: "over 1.5 MB" };
  if (text.slice(0, 4000).includes("\u0000")) return { ok: false, why: "binary content" };
  return { ok: true, text };
}
