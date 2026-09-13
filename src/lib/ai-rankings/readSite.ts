// ---------------------------------------------------------------------------
// The Board — fetching what a link says about itself. Server only.
//
// Every request goes through social-import's safeFetch, which refuses private
// addresses on every redirect hop: this route fetches whatever URL is pasted.
// Every failure is a missing piece, never an error — a page that blocks bots
// still gets an entry, built from the link and whatever the APIs answered.
// ---------------------------------------------------------------------------

import { fetchBytes, fetchJson, fetchText } from "@/lib/social-import/safeFetch";
import {
  digestHtml,
  findSourceLinks,
  markdownToText,
  parseRepoUrl,
  scriptSources,
} from "./analyzeLink";
import type { ModelFacts, RepoFacts, SiteRead, SourceLinks } from "./analyzeLink";

function mergeLinks(a: SourceLinks, b: SourceLinks): SourceLinks {
  const merge = (x: string[], y: string[]) =>
    [...x, ...y].filter((v, i, all) => all.findIndex((w) => w.toLowerCase() === v.toLowerCase()) === i);
  return {
    github: merge(a.github, b.github),
    huggingface: merge(a.huggingface, b.huggingface),
    spaces: merge(a.spaces, b.spaces),
    arxiv: merge(a.arxiv, b.arxiv),
  };
}

/** Of several repos a page links to, the one named like the product. */
function pick(slugs: string[], name: string): string | undefined {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    slugs.find((s) => s.split("/")[1].toLowerCase().replace(/[^a-z0-9]/g, "") === n) ??
    slugs.find((s) => n && s.toLowerCase().replace(/[^a-z0-9]/g, "").includes(n)) ??
    slugs[0]
  );
}

async function readGithub(slug: string): Promise<RepoFacts | null> {
  const [json, readme] = await Promise.all([
    fetchJson(`https://api.github.com/repos/${slug}`),
    fetchText(`https://raw.githubusercontent.com/${slug}/HEAD/README.md`, 300_000),
  ]);
  if (!json?.full_name) return null;
  const license = json.license?.spdx_id && json.license.spdx_id !== "NOASSERTION" ? json.license.spdx_id : undefined;
  return {
    slug: json.full_name,
    description: typeof json.description === "string" ? json.description : "",
    stars: Number(json.stargazers_count) || 0,
    license,
    topics: Array.isArray(json.topics) ? json.topics.map(String) : [],
    homepage: typeof json.homepage === "string" && json.homepage ? json.homepage : undefined,
    archived: json.archived === true,
    readme: readme ? markdownToText(readme) : "",
  };
}

async function readHuggingface(slug: string): Promise<ModelFacts | null> {
  const [json, readme] = await Promise.all([
    fetchJson(`https://huggingface.co/api/models/${slug}`),
    fetchText(`https://huggingface.co/${slug}/raw/main/README.md`, 300_000),
  ]);
  if (!json?.id) return null;
  const tags: string[] = Array.isArray(json.tags) ? json.tags.map(String) : [];
  const license =
    (typeof json.cardData?.license === "string" && json.cardData.license) ||
    tags.find((t) => t.startsWith("license:"))?.slice(8);
  return {
    slug: json.id,
    pipeline: typeof json.pipeline_tag === "string" ? json.pipeline_tag : undefined,
    tags: tags.filter((t) => !/^(license|region|arxiv|endpoints_compatible):?/.test(t)),
    license: license || undefined,
    likes: typeof json.likes === "number" ? json.likes : undefined,
    readme: readme ? markdownToText(readme) : "",
  };
}

const NO_LINKS: SourceLinks = { github: [], huggingface: [], spaces: [], arxiv: [] };

export async function readSite(url: URL): Promise<SiteRead> {
  const direct = parseRepoUrl(url);

  // A repo or model page is read through its API: GitHub's HTML is megabytes of
  // chrome around the one sentence the API returns directly.
  if (direct) {
    const repo = direct.kind === "github" ? await readGithub(direct.slug) : null;
    const model = direct.kind === "huggingface" ? await readHuggingface(direct.slug) : null;
    const readme = repo?.readme ?? model?.readme ?? "";
    const links = findSourceLinks(readme ? `${readme}` : "");
    return {
      url: url.href,
      source: direct.kind,
      readPage: Boolean(repo || model),
      name: repo?.slug ?? model?.slug ?? direct.slug,
      title: repo?.slug ?? model?.slug ?? direct.slug,
      description: repo?.description ?? "",
      text: readme,
      pricing: [],
      links,
      repo,
      model,
    };
  }

  const html = await fetchText(url.href, 1_500_000);
  if (!html) {
    const host = url.hostname.replace(/^www\./, "");
    return {
      url: url.href,
      source: "page",
      readPage: false,
      name: host,
      title: "",
      description: "",
      text: "",
      pricing: [],
      links: NO_LINKS,
      repo: null,
      model: null,
    };
  }

  const page = digestHtml(html, url);
  let links = page.links;

  // No project links in the HTML usually means the page draws them from script.
  if (!links.github.length && !links.huggingface.length) {
    const bundles = await Promise.all(
      scriptSources(html, url).map((src) =>
        fetchBytes(src, { maxBytes: 3_000_000, truncate: true, accept: "*/*" }),
      ),
    );
    for (const b of bundles) if (b) links = mergeLinks(links, findSourceLinks(b.bytes.toString("utf8")));
  }

  const repoSlug = pick(links.github, page.name);
  const modelSlug = pick(links.huggingface, page.name);
  const [repo, model] = await Promise.all([
    repoSlug ? readGithub(repoSlug) : null,
    modelSlug ? readHuggingface(modelSlug) : null,
  ]);

  return {
    url: url.href,
    source: "page",
    readPage: true,
    ...page,
    links,
    repo,
    model,
  };
}
