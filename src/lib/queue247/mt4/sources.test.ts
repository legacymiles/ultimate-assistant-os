import { afterEach, describe, expect, it, vi } from "vitest";
import {
  codeHitsToCandidates,
  decodeText,
  discoverGithub,
  discoverTelegram,
  discoverWeb,
  extractClaims,
  extractEaLinks,
  fetchSourceText,
  fileKind,
  githubRetryAfter,
  isDownloadable,
  parseGithubCodeSearch,
  parseGithubRepoSearch,
  parseGithubTree,
  parseTelegramPreview,
  postToCandidate,
  rawUrl,
  repoFromUrl,
  repoToCandidate,
  validChannel,
} from "./sources";

const TG_HTML = `<html><body><section class="tgme_channel_history js-message_history">
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="fxbots/101" data-view="x">
  <div class="tgme_widget_message_text js-message_text" dir="auto">Weather update, nothing here</div>
  <a class="tgme_widget_message_date" href="https://t.me/fxbots/101"><time datetime="2026-11-20T09:00:00+00:00" class="time">09:00</time></a>
</div></div>
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="fxbots/102" data-view="x">
  <a class="tgme_widget_message_document_wrap" href="https://t.me/fxbots/102">
    <div class="tgme_widget_message_document_title accent_color" dir="auto">Gold_Scalper_v3.ex4</div>
    <div class="tgme_widget_message_document_extra" dir="auto">48.1 KB</div>
  </a>
  <div class="tgme_widget_message_text js-message_text" dir="auto"><b>NEW FREE EA</b> for MT4 &amp; gold<br/>Win rate 98% — never loses!<br/>Source: <a href="https://github.com/pipdev/gold-scalper" target="_blank">github.com/pipdev/gold-scalper</a></div>
  <a class="tgme_widget_message_date" href="https://t.me/fxbots/102"><time datetime="2026-11-21T10:30:00+00:00" class="time">10:30</time></a>
</div></div>
<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="fxbots/103" data-view="x">
  <div class="tgme_widget_message_text js-message_text" dir="auto">Grid EA source: <a href="https://files.example.com/eas/GridMaster.mq4">GridMaster.mq4</a></div>
  <a class="tgme_widget_message_date" href="https://t.me/fxbots/103"><time datetime="2026-11-22T11:00:00+00:00" class="time">11:00</time></a>
</div></div>
</section></body></html>`;

const REPO_SEARCH = {
  total_count: 2,
  items: [
    { full_name: "pipdev/gold-scalper", html_url: "https://github.com/pipdev/gold-scalper", owner: { login: "pipdev" }, description: "Gold scalper EA for MT4", pushed_at: "2026-11-21T10:00:00Z", default_branch: "main", stargazers_count: 12, license: { spdx_id: "MIT" }, private: false, fork: false },
    { full_name: "someone/fork", html_url: "https://github.com/someone/fork", owner: { login: "someone" }, pushed_at: "2026-11-22T10:00:00Z", default_branch: "master", fork: true },
  ],
};

const TREE = {
  sha: "abc",
  tree: [
    { path: "README.md", type: "blob", size: 900 },
    { path: "MQL4/Experts/GoldScalper.mq4", type: "blob", size: 4000 },
    { path: "MQL4/Include/utils.mqh", type: "blob", size: 1000 },
    { path: "bin/GoldScalper.ex4", type: "blob", size: 30000 },
    { path: "docs/notes.md", type: "blob", size: 100 },
    { path: "MQL4", type: "tree" },
    { path: "src/main.py", type: "blob", size: 10 },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("small helpers", () => {
  it("classifies files", () => {
    expect(fileKind("A.mq4")).toBe("source");
    expect(fileKind("b/C.MQ5")).toBe("source");
    expect(fileKind("x.mqh")).toBe("source");
    expect(fileKind("x.ex4")).toBe("compiled");
    expect(fileKind("README")).toBe("doc");
    expect(fileKind("a.exe")).toBeNull();
  });
  it("never lets compiled files or PDFs through the downloader", () => {
    expect(isDownloadable({ name: "a.ex4", kind: "compiled", url: "https://x/a.ex4", fetchable: true })).toBe(false);
    expect(isDownloadable({ name: "a.pdf", kind: "doc", url: "https://x/a.pdf", fetchable: true })).toBe(false);
    expect(isDownloadable({ name: "a.mq4", kind: "source", url: "http://x/a.mq4", fetchable: true })).toBe(false);
    expect(isDownloadable({ name: "a.mq4", kind: "source", url: "https://t.me/c/1", fetchable: false })).toBe(false);
    expect(isDownloadable({ name: "a.mq4", kind: "source", url: "https://x/a.mq4", fetchable: true })).toBe(true);
  });
  it("parses repo URLs and channel names", () => {
    expect(repoFromUrl("https://github.com/pipdev/gold-scalper/tree/main")).toBe("pipdev/gold-scalper");
    expect(repoFromUrl("https://github.com/topics/mql4")).toBeNull();
    expect(repoFromUrl("https://gitlab.com/a/b")).toBeNull();
    expect(validChannel("@fxbots")).toBe("fxbots");
    expect(validChannel("https://t.me/s/fxbots")).toBe("fxbots");
    expect(validChannel("+joinchatXYZ")).toBeNull();
  });
  it("quotes claims as found", () => {
    expect(extractClaims("Free EA.\nWin rate 98% — never loses!\nJoin now")).toEqual(["Win rate 98% — never loses!"]);
  });
  it("encodes raw URLs", () => {
    expect(rawUrl("a/b", "main", "My EA/x y.mq4")).toBe("https://raw.githubusercontent.com/a/b/main/My%20EA/x%20y.mq4");
  });
  it("decodes UTF-16 files with a BOM", () => {
    const s = "int start(){}";
    const bytes = new Uint8Array(2 + s.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < s.length; i++) bytes[2 + i * 2] = s.charCodeAt(i);
    expect(decodeText(bytes)).toBe(s);
  });
});

describe("GitHub parsers", () => {
  it("drops forks and private repos", () => {
    const repos = parseGithubRepoSearch(REPO_SEARCH);
    expect(repos.map((r) => r.fullName)).toEqual(["pipdev/gold-scalper"]);
    expect(repos[0]).toMatchObject({ owner: "pipdev", defaultBranch: "main", stars: 12, license: "MIT" });
    expect(parseGithubRepoSearch({ message: "bad" })).toEqual([]);
  });
  it("lists EA files from a tree and builds a candidate", () => {
    const entries = parseGithubTree(TREE);
    expect(entries.map((e) => e.path)).toEqual(["README.md", "MQL4/Experts/GoldScalper.mq4", "MQL4/Include/utils.mqh", "bin/GoldScalper.ex4"]);
    const c = repoToCandidate(parseGithubRepoSearch(REPO_SEARCH)[0], entries);
    expect(c.files[0]).toMatchObject({ name: "MQL4/Experts/GoldScalper.mq4", kind: "source", fetchable: true, url: "https://raw.githubusercontent.com/pipdev/gold-scalper/main/MQL4/Experts/GoldScalper.mq4" });
    expect(c.files.find((f) => f.kind === "compiled")?.fetchable).toBe(false);
    expect(c.developer).toBe("pipdev");
    expect(c.publishedAt).toBe("2026-11-21T10:00:00Z");
  });
  it("groups code-search hits by repo", () => {
    const hits = parseGithubCodeSearch({
      items: [
        { path: "a.mq4", html_url: "https://github.com/o/r/blob/x/a.mq4", repository: { full_name: "o/r" } },
        { path: "b.mq4", html_url: "https://github.com/o/r/blob/x/b.mq4", repository: { full_name: "o/r" } },
        { path: "c.mq4", html_url: "u", repository: { full_name: "p/q", private: true } },
      ],
    });
    const cands = codeHitsToCandidates(hits);
    expect(cands).toHaveLength(1);
    expect(cands[0].files.map((f) => f.url)).toEqual(["https://raw.githubusercontent.com/o/r/HEAD/a.mq4", "https://raw.githubusercontent.com/o/r/HEAD/b.mq4"]);
  });
  it("reads rate-limit headers", () => {
    const now = new Date("2026-11-25T00:00:00Z");
    expect(githubRetryAfter(200, new Headers({ "x-ratelimit-remaining": "5" }), now)).toBeNull();
    expect(githubRetryAfter(403, new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now.getTime() / 1000 + 600) }), now)).toBe("2026-11-25T00:10:00.000Z");
    expect(githubRetryAfter(429, new Headers({ "retry-after": "30" }), now)).toBe("2026-11-25T00:00:30.000Z");
  });
});

describe("Telegram public preview parser", () => {
  const posts = parseTelegramPreview(TG_HTML, "fxbots");
  it("reads id, date, text, links and document names", () => {
    expect(posts.map((p) => p.id)).toEqual([101, 102, 103]);
    const p = posts[1];
    expect(p.url).toBe("https://t.me/fxbots/102");
    expect(p.date).toBe("2026-11-21T10:30:00+00:00");
    expect(p.text).toContain("NEW FREE EA for MT4 & gold");
    expect(p.text.split("\n")).toHaveLength(3);
    expect(p.documents).toEqual(["Gold_Scalper_v3.ex4"]);
    expect(p.links).toEqual(["https://github.com/pipdev/gold-scalper"]);
  });
  it("turns EA posts into candidates with unverified claims; ignores chatter", () => {
    expect(postToCandidate(posts[0])).toBeNull();
    const c = postToCandidate(posts[1])!;
    expect(c.files).toEqual([{ name: "Gold_Scalper_v3.ex4", url: "https://t.me/fxbots/102", kind: "compiled", fetchable: false }]);
    expect(c.repos).toEqual(["pipdev/gold-scalper"]);
    expect(c.claims).toEqual(["Win rate 98% — never loses!"]);
    const g = postToCandidate(posts[2])!;
    expect(g.files[0]).toMatchObject({ name: "GridMaster.mq4", kind: "source", fetchable: true });
  });
});

describe("web page links", () => {
  it("keeps EA file links and repos, resolves relative URLs", () => {
    const html = `<title>Free EA &amp; more</title><a href="/dl/Robot.mq4">src</a><a href='https://cdn.x.com/Robot.ex4'>bin</a><a href="https://github.com/a/b">repo</a><a href="/about">about</a>`;
    const out = extractEaLinks(html, "https://blog.example.com/post/1");
    expect(out.title).toBe("Free EA & more");
    expect(out.files).toEqual([
      { name: "Robot.mq4", url: "https://blog.example.com/dl/Robot.mq4", kind: "source", fetchable: true },
      { name: "Robot.ex4", url: "https://cdn.x.com/Robot.ex4", kind: "compiled", fetchable: false },
    ]);
    expect(out.repos).toEqual(["a/b"]);
  });
});

describe("fetchers (stubbed fetch)", () => {
  const signal = new AbortController().signal;

  it("GitHub without a token: repository search + trees only", async () => {
    vi.stubEnv("JARVIS_GITHUB_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (url.includes("/search/repositories")) return Response.json(REPO_SEARCH, { headers: { "x-ratelimit-remaining": "9" } });
      if (url.includes("/git/trees/")) return Response.json(TREE);
      return new Response("nope", { status: 404 });
    });
    const r = await discoverGithub({ query: "mql4 expert advisor", since: "2026-11-01T00:00:00Z", maxRepos: 3, signal, now: new Date() });
    expect(urls[0]).toContain(encodeURIComponent("pushed:>=2026-11-01"));
    expect(urls.some((u) => u.includes("/search/code"))).toBe(false);
    expect(r.candidates).toHaveLength(1);
    expect(r.newestPushed).toBe("2026-11-21T10:00:00Z");
    expect(r.notes.join(" ")).toMatch(/code search skipped/);
  });

  it("GitHub rate limit stops early with retryAfter", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "4102444800" } }));
    const r = await discoverGithub({ query: "q", maxRepos: 3, signal, now: new Date("2026-11-25T00:00:00Z") });
    expect(r.retryAfter).toBe("2100-01-01T00:00:00.000Z");
    expect(r.candidates).toEqual([]);
  });

  it("Telegram respects the per-channel cursor", async () => {
    vi.stubGlobal("fetch", async (url: string) => (url === "https://t.me/s/fxbots" ? new Response(TG_HTML, { headers: { "content-type": "text/html" } }) : new Response("", { status: 404 })));
    const r = await discoverTelegram({ channels: ["fxbots", "bad name!"], cursors: { fxbots: 102 }, signal });
    expect(r.candidates.map((c) => c.sourceUrl)).toEqual(["https://t.me/fxbots/103"]);
    expect(r.cursors.fxbots).toBe(103);
    expect(r.notes.join(" ")).toMatch(/Skipped "bad name!"/);
  });

  it("web discovery keeps only pages that link EA files or repos", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "https://blog.example.com/a") return new Response(`<title>A</title><a href="/x.mq4">x</a>`, { headers: { "content-type": "text/html" } });
      return new Response(`<title>B</title><p>nothing</p>`, { headers: { "content-type": "text/html" } });
    });
    const r = await discoverWeb({
      queries: ["free mt4 ea"],
      search: async () => [
        { url: "https://blog.example.com/a", title: "A" },
        { url: "https://blog.example.com/b", title: "B" },
        { url: "https://github.com/o/r", title: "o/r" },
      ],
      seen: new Set(),
      maxPages: 5,
      signal,
    });
    expect(r.candidates.map((c) => c.sourceUrl)).toEqual(["https://blog.example.com/a", "https://github.com/o/r"]);
    expect(r.candidates[1].repos).toEqual(["o/r"]);
  });

  it("downloads only text sources under 1.5 MB, never compiled files", async () => {
    const fetchSpy = vi.fn(async (url: string) => (url.endsWith("big.mq4") ? new Response("x".repeat(1_600_000)) : new Response("int start(){return 0;}")));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await fetchSourceText({ name: "a.ex4", url: "https://x/a.ex4", kind: "compiled", fetchable: true }, signal)).toEqual({ ok: false, why: "compiled file — never downloaded" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await fetchSourceText({ name: "big.mq4", url: "https://x/big.mq4", kind: "source", fetchable: true }, signal)).toEqual({ ok: false, why: "over 1.5 MB" });
    expect(await fetchSourceText({ name: "a.mq4", url: "https://x/a.mq4", kind: "source", fetchable: true }, signal)).toEqual({ ok: true, text: "int start(){return 0;}" });
  });
});
