// ---------------------------------------------------------------------------
// Reading the machine-readable parts of an HTML page: schema.org JSON-LD,
// Open Graph / meta tags, and a plain-text fallback.
//
// JSON-LD matters most. Recipe blogs (and the pages creators link from their
// captions) publish a schema.org `Recipe` with exact amounts — far more
// reliable than anything inferred from a 40-second video.
//
// Regex, not a DOM parser, on purpose: these run on the server over pages we
// only skim, and a parser dependency buys nothing for four tag shapes.
// ---------------------------------------------------------------------------

export function extractJsonLd(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collect(JSON.parse(m[1].trim()), out);
    } catch {
      // Malformed JSON-LD is common; one bad block must not hide the others.
    }
  }
  return out;
}

function collect(node: unknown, out: any[]) {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out);
  } else if (node && typeof node === "object") {
    out.push(node);
    const graph = (node as any)["@graph"];
    if (Array.isArray(graph)) collect(graph, out);
  }
}

export function hasType(node: any, type: string): boolean {
  const t = node?.["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

export function findByType(nodes: any[], type: string): any | null {
  return nodes.find((n) => hasType(n, type)) ?? null;
}

/** Meta tags keyed by lowercased property/name, first occurrence wins. */
export function metaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0];
    const key = attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop");
    const content = attr(tag, "content");
    if (key && content != null && !(key.toLowerCase() in out)) out[key.toLowerCase()] = decodeEntities(content);
  }
  return out;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[1] ?? m[2]) : null;
}

export function titleTag(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? decodeEntities(m[1]).trim() : "";
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[e.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html: string, max = 12_000): string {
  const body = html
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(p|div|li|h[1-6]|br|tr|section|article|ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(body)
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, max);
}
