// ---------------------------------------------------------------------------
// Jarvis on the web, from the website itself — no PC needed.
//
// The owner's rule: Jarvis should work like Claude Code, not stop and say
// "this needs your PC". Looking something up and reading a page are the two
// things a job most often needs, so the server does them:
//
//   web_search  DuckDuckGo's HTML results (no key, so it works for every user)
//   web_read    a public page, fetched here and turned into readable text
//
// Pure helpers live here (tested); the fetching is in
// src/app/api/new-jarvis/web/route.ts.
// ---------------------------------------------------------------------------

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
  "#x2F": "/",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#?[a-z0-9]+);/gi, (m, name: string) => {
    if (ENTITIES[name] !== undefined) return ENTITIES[name];
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return m;
  });
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** DuckDuckGo wraps result links in a redirect; this returns the real address. */
export function unwrapDdgLink(href: string): string | null {
  const raw = decodeEntities(href.trim());
  try {
    const u = new URL(raw.startsWith("//") ? `https:${raw}` : raw, "https://duckduckgo.com");
    if (/duckduckgo\.com$/.test(u.hostname) && u.pathname.startsWith("/l/")) {
      const real = u.searchParams.get("uddg");
      return real && /^https?:\/\//.test(real) ? real : null;
    }
    // Ads go through y.js; never hand those back as results.
    if (/duckduckgo\.com$/.test(u.hostname)) return null;
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Results from html.duckduckgo.com/html, newest layout first, the lite page as a fallback. */
export function parseDdgResults(html: string, max = 8): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  // html.duckduckgo.com: <a class="result__a" href="…">title</a> … <a class="result__snippet" …>snippet</a>
  const block = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*result__a|$)/gi;
  for (const m of html.matchAll(block)) {
    const url = unwrapDdgLink(m[1]);
    if (!url || seen.has(url)) continue;
    const snip = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(m[3]);
    seen.add(url);
    hits.push({ title: stripTags(m[2]), url, snippet: snip ? stripTags(snip[1]) : "" });
    if (hits.length >= max) return hits;
  }
  if (hits.length) return hits;

  // lite.duckduckgo.com: <a class="result-link" href="…">title</a> … <td class="result-snippet">…</td>
  const lite = /<a[^>]+href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>|<a[^>]+class=['"]result-link['"][^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [...html.matchAll(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi)].map((s) => stripTags(s[1]));
  let i = 0;
  for (const m of html.matchAll(lite)) {
    const url = unwrapDdgLink(m[1] ?? m[3] ?? "");
    const title = stripTags(m[2] ?? m[4] ?? "");
    const snippet = snippets[i++] ?? "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    hits.push({ title, url, snippet });
    if (hits.length >= max) break;
  }
  return hits;
}

/** The readable part of a page: title + text, scripts/styles/nav chrome gone, links kept as "text (url)". */
export function htmlToText(html: string, base?: string, max = 14_000): { title: string; text: string } {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  let body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  // Prefer the article when the page marks one.
  const main = /<(main|article)[^>]*>([\s\S]*?)<\/\1>/i.exec(body);
  if (main && main[2].length > 600) body = main[2];
  body = body
    .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|aside)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<a[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const label = stripTags(inner);
      if (!label) return " ";
      let abs = decodeEntities(href);
      try {
        abs = new URL(abs, base).toString();
      } catch {
        /* keep as written */
      }
      return /^https?:/.test(abs) ? ` ${label} (${abs}) ` : ` ${label} `;
    })
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<h([1-6])[^>]*>/gi, "\n\n");
  const text = decodeEntities(body.replace(/<[^>]*>/g, " "))
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return { title, text: text.length > max ? `${text.slice(0, max)}\n…(page continues)` : text };
}

/** True for an address that is plainly not on the public internet. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "0.0.0.0" || h === "::" || h === "::1") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (h.includes(":")) {
    return h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:");
  }
  return false;
}

/** A URL the server may fetch for the owner, or why not (in plain words). */
export function checkPublicUrl(raw: string): { ok: true; url: URL } | { ok: false; why: string } {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return { ok: false, why: "That isn't a web address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, why: "Only web pages (http or https) can be read." };
  if (url.username || url.password) return { ok: false, why: "Addresses with a login built in can't be read." };
  if (isPrivateHost(url.hostname)) {
    return { ok: false, why: "That address is on a private network (like a PC or router), so the website can't reach it." };
  }
  return { ok: true, url };
}
