// ---------------------------------------------------------------------------
// The Board — a record built from a link.
//
// Paste a URL and get a whole entry: name, notes, pricing, openness, hosting,
// features. This module is the pure half — reading HTML, spotting the project's
// code/weights/paper links, the no-key fallback and the coercion of the
// model's answer. The fetching lives in readSite.ts (server only).
//
// Unlike "Auto-file this", the result is written straight onto the board: the
// user asked for the entry to be made for them. It opens in the record panel
// straight away, so every field is still one click from being corrected.
//
// Facts read from an API beat the model. A GitHub or Hugging Face licence is
// the answer to "is it open source", whatever a summary might imply.
// ---------------------------------------------------------------------------

import { htmlToText, metaTags, titleTag } from "@/lib/social-import/jsonld";
import { coerceSuggestion, heuristicSuggestion } from "./classify";
import type { Suggestion } from "./classify";

export interface SourceLinks {
  /** "owner/repo" */
  github: string[];
  /** "owner/model" */
  huggingface: string[];
  /** "owner/space" — a hosted demo */
  spaces: string[];
  /** "2609.08936" */
  arxiv: string[];
}

export interface RepoFacts {
  slug: string;
  description: string;
  stars: number;
  license?: string;
  topics: string[];
  homepage?: string;
  archived: boolean;
  readme: string;
}

export interface ModelFacts {
  slug: string;
  pipeline?: string;
  tags: string[];
  license?: string;
  likes?: number;
  readme: string;
}

export interface SiteRead {
  url: string;
  /** What was linked: an ordinary page, or a repo/model page read via its API. */
  source: "page" | "github" | "huggingface";
  /** False when nothing at all could be fetched — the entry rests on the URL. */
  readPage: boolean;
  name: string;
  title: string;
  description: string;
  text: string;
  pricing: string[];
  links: SourceLinks;
  repo: RepoFacts | null;
  model: ModelFacts | null;
}

export interface AnalyzedEntry extends Suggestion {
  name: string;
  url: string;
  notes: string;
}

export interface AnalyzeResult {
  entry: AnalyzedEntry;
  warning?: string;
}

// ----- reading a page ---------------------------------------------------------

/** First path segments that are GitHub's own pages, not an owner. */
const GITHUB_RESERVED = new Set([
  "about", "apps", "collections", "contact", "customer-stories", "enterprise",
  "explore", "features", "issues", "join", "login", "marketplace", "new",
  "notifications", "orgs", "pricing", "pulls", "readme", "search", "security",
  "settings", "signup", "site", "sponsors", "topics", "trending",
]);

const HF_RESERVED = new Set([
  "api", "blog", "collections", "datasets", "docs", "join", "learn", "login",
  "models", "papers", "posts", "pricing", "spaces", "tasks",
]);

function pushUnique(list: string[], value: string) {
  if (!list.some((v) => v.toLowerCase() === value.toLowerCase())) list.push(value);
}

function cleanSlugPart(s: string): string {
  return s.replace(/\.git$/i, "").replace(/[.]+$/, "");
}

/**
 * Code, weights, demo and paper links anywhere in a blob of text.
 *
 * Run over the HTML and, when that has none, over the page's own JS bundles —
 * a project page built as an SPA (auk-project.github.io is one) renders its
 * "Code / Model / Paper" buttons from script, so the HTML alone has no links.
 */
export function findSourceLinks(text: string): SourceLinks {
  const out: SourceLinks = { github: [], huggingface: [], spaces: [], arxiv: [] };

  for (const m of text.matchAll(/https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)/g)) {
    const repo = cleanSlugPart(m[2]);
    if (GITHUB_RESERVED.has(m[1].toLowerCase()) || !repo) continue;
    pushUnique(out.github, `${m[1]}/${repo}`);
  }

  for (const m of text.matchAll(
    /https?:\/\/(?:www\.)?huggingface\.co\/(spaces\/|datasets\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g,
  )) {
    const [, kind, owner, rawName] = m;
    const name = cleanSlugPart(rawName);
    if (kind === "datasets/" || !name) continue;
    if (kind === "spaces/") {
      pushUnique(out.spaces, `${owner}/${name}`);
    } else if (!HF_RESERVED.has(owner.toLowerCase())) {
      pushUnique(out.huggingface, `${owner}/${name}`);
    }
  }

  for (const m of text.matchAll(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/g)) pushUnique(out.arxiv, m[1]);

  return out;
}

/** A link that IS a repo or a model, which is better read through its API. */
export function parseRepoUrl(url: URL): { kind: "github" | "huggingface"; slug: string } | null {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const [owner, name] = url.pathname.split("/").filter(Boolean);
  if (!owner || !name) return null;
  if (host === "github.com" && !GITHUB_RESERVED.has(owner.toLowerCase())) {
    return { kind: "github", slug: `${owner}/${cleanSlugPart(name)}` };
  }
  if (host === "huggingface.co" && !HF_RESERVED.has(owner.toLowerCase())) {
    return { kind: "huggingface", slug: `${owner}/${cleanSlugPart(name)}` };
  }
  return null;
}

/**
 * The product's short name. "AuK — An Open-Source Foundational Model…" is AuK:
 * a page title is nearly always "Name — tagline", and the tagline is what the
 * summary is for.
 */
export function guessName(meta: Record<string, string>, title: string, url: URL): string {
  const site = meta["og:site_name"]?.trim();
  if (site && site.length <= 40) return site;

  const full = (title || meta["og:title"] || "").trim();
  const head = full.split(/\s+[—–|·-]\s+|:\s+/)[0]?.trim();
  if (head && head.length <= 48) return head;

  const host = url.hostname.replace(/^www\./, "");
  const label = /\.github\.io$/i.test(host) ? host.split(".")[0] : host.split(".").slice(0, -1).join(".") || host;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Lines that talk about money — what "free / freemium / paid" is decided on. */
export function pricingLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (l.length < 4 || l.length > 200) continue;
    if (/[$€£]\s?\d|\/\s?mo(nth)?\b|per month|free (plan|tier|trial)|pricing|subscription|credits?\b/i.test(l)) {
      pushUnique(out, l);
      if (out.length >= 8) break;
    }
  }
  return out;
}

export function digestHtml(html: string, url: URL) {
  const meta = metaTags(html);
  const title = titleTag(html);
  const text = htmlToText(html, 8_000);
  return {
    name: guessName(meta, title, url),
    title,
    description: (meta["description"] || meta["og:description"] || "").trim(),
    text,
    pricing: pricingLines(text),
    links: findSourceLinks(html),
  };
}

/** Same-origin script bundles worth scanning for links, at most three. */
export function scriptSources(html: string, base: URL): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.origin === base.origin) pushUnique(out, u.href);
    } catch {
      /* a malformed src is just skipped */
    }
    if (out.length >= 3) break;
  }
  return out;
}

/** A README as plain prose: no front matter, badges, images or markup. */
export function markdownToText(md: string, max = 6_000): string {
  return md
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^```.*$/gm, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`>|]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, max);
}

// ----- building the entry -----------------------------------------------------

function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/**
 * The project's links, written into the notes by code rather than by the
 * model, so a URL on the record is one that was actually found on the page.
 */
export function linksBlock(site: SiteRead): string {
  const lines: string[] = [];
  const repo = site.repo?.slug ?? site.links.github[0];
  if (repo) {
    const bits = [`Code: https://github.com/${repo}`];
    if (site.repo) bits.push(`★ ${compact(site.repo.stars)}`);
    if (site.repo?.license) bits.push(site.repo.license);
    if (site.repo?.archived) bits.push("archived");
    lines.push(bits.join(" · "));
  }
  const model = site.model?.slug ?? site.links.huggingface[0];
  if (model) {
    const bits = [`Weights: https://huggingface.co/${model}`];
    if (site.model?.license) bits.push(site.model.license);
    lines.push(bits.join(" · "));
  }
  if (site.links.spaces[0]) lines.push(`Demo: https://huggingface.co/spaces/${site.links.spaces[0]}`);
  if (site.links.arxiv[0]) lines.push(`Paper: https://arxiv.org/abs/${site.links.arxiv[0]}`);
  if (site.source !== "page" && site.repo?.homepage) lines.push(`Site: ${site.repo.homepage}`);
  return lines.length ? `Links\n${lines.join("\n")}` : "";
}

/** The first sentence, or a clean cut, for a one-line summary. */
export function oneLine(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  const sentence = t.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? t;
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

function hasCode(site: SiteRead): boolean {
  return Boolean(site.repo || site.model || site.links.github.length || site.links.huggingface.length);
}

/** Licence facts from an API override whatever was guessed. */
function applyFacts(s: Suggestion, site: SiteRead): Suggestion {
  const licensed = Boolean(site.repo?.license || site.model?.license);
  const openSource = licensed || s.openSource;
  const tags = openSource && !s.tags.includes("open-source") ? [...s.tags, "open-source"].slice(0, 8) : s.tags;
  return { ...s, openSource, tags };
}

function joinNotes(prose: string, site: SiteRead): string {
  return [prose.trim(), linksBlock(site)].filter(Boolean).join("\n\n");
}

/** The name the record is filed by. A repo link keeps its canonical owner/repo. */
function canonicalName(site: SiteRead, proposed: string): string {
  if (site.source === "github" && site.repo) return site.repo.slug;
  if (site.source === "huggingface" && site.model) return site.model.slug;
  return proposed.trim() || site.name;
}

/**
 * The entry with no AI key. Filing reads only the page's own description of
 * itself — a full page of text mentions "assistant" or "chat" somewhere and
 * would file a speech model as an LLM — while tags and features read it all.
 */
export function heuristicEntry(site: SiteRead): AnalyzedEntry {
  const codeLinks = [
    ...site.links.github.map((s) => `https://github.com/${s}`),
    ...site.links.huggingface.map((s) => `https://huggingface.co/${s}`),
  ].join(" ");
  const facts = [
    site.repo?.license,
    site.model?.license,
    site.model?.pipeline,
    ...(site.repo?.topics ?? []),
    ...(site.model?.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  const filing = heuristicSuggestion({
    name: site.name,
    url: site.url,
    summary: `${site.title} ${site.description}`,
    notes: facts,
  });
  const wide = heuristicSuggestion({
    name: site.name,
    url: `${site.url} ${codeLinks}`,
    summary: site.description,
    notes: `${facts} ${site.text.slice(0, 4_000)} ${site.repo?.readme.slice(0, 2_000) ?? ""} ${site.pricing.join(" ")}`,
  });

  let s: Suggestion = {
    ...wide,
    group: filing.group,
    category: filing.category,
    summary: oneLine(site.description || site.repo?.description || site.title),
  };

  // Code you can download and no price anywhere on the page: free, and it runs
  // on your machine. A price next to a repo means a hosted tier as well.
  if (hasCode(site)) {
    if (!site.pricing.length) {
      s = { ...s, access: "free", hosting: s.hosting === "hosted" ? "self-host" : s.hosting };
    } else if (s.hosting === "hosted") {
      s = { ...s, hosting: "both" };
    }
  }
  s = applyFacts(s, site);

  const prose = [site.description, site.repo?.description]
    .filter((d, i, all): d is string => Boolean(d) && all.indexOf(d) === i)
    .join("\n");

  return {
    ...s,
    name: canonicalName(site, site.name),
    url: site.url,
    notes: joinNotes(prose, site),
  };
}

/** Trust the model's shape only as far as it matches ours. */
export function coerceEntry(raw: unknown, fallback: AnalyzedEntry, site: SiteRead): AnalyzedEntry {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = applyFacts(coerceSuggestion(raw, fallback), site);
  const name = typeof r.name === "string" ? r.name.slice(0, 80) : "";
  const prose = typeof r.notes === "string" && r.notes.trim() ? r.notes.slice(0, 1_500) : "";
  return {
    ...s,
    name: canonicalName(site, name || fallback.name),
    url: site.url,
    notes: prose ? joinNotes(prose, site) : fallback.notes,
  };
}

/** What the model is shown about the link. */
export function describeSite(site: SiteRead): string {
  const parts: string[] = [`Link: ${site.url}`];
  if (!site.readPage) parts.push("(The page could not be fetched — work from the link and what you know.)");
  if (site.title) parts.push(`Page title: ${site.title}`);
  if (site.description) parts.push(`Page description: ${site.description}`);
  parts.push(`Name detected from the page: ${site.name}`);
  if (site.repo) {
    parts.push(
      `GitHub repo ${site.repo.slug}: ${site.repo.description || "(no description)"} · ` +
        `${site.repo.stars} stars · licence ${site.repo.license ?? "none stated"}` +
        (site.repo.topics.length ? ` · topics ${site.repo.topics.join(", ")}` : "") +
        (site.repo.archived ? " · ARCHIVED" : ""),
    );
  }
  if (site.model) {
    parts.push(
      `Hugging Face model ${site.model.slug}: task ${site.model.pipeline ?? "unknown"} · ` +
        `licence ${site.model.license ?? "none stated"} · tags ${site.model.tags.slice(0, 20).join(", ")}`,
    );
  }
  if (site.links.spaces.length) parts.push(`Hosted demo: huggingface.co/spaces/${site.links.spaces[0]}`);
  if (site.links.arxiv.length) parts.push(`Paper: arxiv.org/abs/${site.links.arxiv[0]}`);
  if (site.pricing.length) parts.push(`Lines about pricing:\n${site.pricing.join("\n")}`);
  if (site.text) parts.push(`Page text (excerpt):\n"""\n${site.text.slice(0, 5_000)}\n"""`);
  const readme = site.repo?.readme || site.model?.readme;
  if (readme) parts.push(`README (excerpt):\n"""\n${readme.slice(0, 3_000)}\n"""`);
  return parts.join("\n");
}
