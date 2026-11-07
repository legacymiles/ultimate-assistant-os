// ---------------------------------------------------------------------------
// Projects Timeline › what the repo says about each app.
//
// Every app has a doc in docs/apps/<slug>.md (template: docs/apps/_TEMPLATE.md)
// listing its features, how it looks, where its code is and the owner's rules.
// Those docs are what any AI tool reads before changing an app, so they are the
// in-depth record. scripts/apps-index.mjs copies them into app-docs.json; this
// file parses one into parts the timeline can show and the Super Prompt can use.
//
// Pure, and read-only: the docs change through commits, never from the page.
// ---------------------------------------------------------------------------

export interface DocFeature {
  /** Bold sub-label the feature sits under in the doc, if any ("Spades", "Feed"…). */
  group: string;
  title: string;
  text: string;
  /** Code paths named on the line, in order. */
  files: string[];
}

export interface AppDoc {
  slug: string;
  title: string;
  /** Route · category · status · shows as — the line under the title. */
  meta: string;
  tag: string;
  overview: string;
  /** `/look/<slug>.jpg` when the doc points at a screenshot. */
  screenshot: string | null;
  features: DocFeature[];
  look: string[];
  code: { part: string; path: string }[];
  rules: string[];
  missing: string[];
  /** The doc exactly as committed, for the Super Prompt and the repo brief. */
  markdown: string;
}

const NONE = /^(none( found)?\.?|—|-|n\/a)$/i;

/** `##` sections of a markdown doc, keyed by lower-cased heading. */
function sections(md: string): { head: string[]; byName: Map<string, string[]> } {
  const head: string[] = [];
  const byName = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      current = [];
      byName.set(h[1].toLowerCase(), current);
      continue;
    }
    (current ?? head).push(line);
  }
  return { head, byName };
}

function find(byName: Map<string, string[]>, prefix: string): string[] {
  for (const [name, lines] of byName) if (name.startsWith(prefix)) return lines;
  return [];
}

/** Top-level bullets, with indented continuation lines folded in. */
function bullets(lines: string[]): { text: string; group: string }[] {
  const out: { text: string; group: string }[] = [];
  let group = "";
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const label = line.match(/^(?:\*\*|###\s+)(.+?)(?:\*\*)?:?\s*$/);
    if (label && !line.startsWith("- ")) {
      group = label[1].replace(/\*\*/g, "").replace(/:$/, "").trim();
      continue;
    }
    const b = line.match(/^[-*]\s+(.*)$/);
    if (b) {
      out.push({ text: b[1].trim(), group });
      continue;
    }
    if (/^\s{2,}\S/.test(line) && out.length) {
      out[out.length - 1].text += " " + line.trim().replace(/^[-*]\s+/, "");
    }
  }
  return out.filter((b) => b.text && !NONE.test(b.text));
}

const paths = (s: string): string[] =>
  [...s.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]).filter((p) => /[/.]/.test(p) && !/^https?:/.test(p));

export function parseFeature(text: string, group = ""): DocFeature {
  const m = text.match(/^\*\*(.+?)\*\*\s*[—–:-]?\s*(.*)$/);
  const title = (m ? m[1] : text.split(/\s[—–]\s/)[0]).trim();
  const rest = (m ? m[2] : text.slice(title.length).replace(/^\s*[—–:-]\s*/, "")).trim();
  const files = paths(text);
  return { group, title, text: withoutPaths(rest, files), files };
}

/** The sentence with its file paths taken out — they are shown on their own line. */
function withoutPaths(text: string, files: string[]): string {
  return text
    .replace(/`([^`\s]+)`/g, (whole, p: string) => (files.includes(p) ? "\u0000" : whole))
    .replace(/\(\s*(?:\u0000[\s,+·&/]*(?:and\s*)?)+\)/g, "") // "(a, b)" made only of paths
    .replace(/(?:\s*(?:,|\+|·|&|\/|and|in|at|see|via|—|–|-|:)?\s*\u0000)+/g, "") // trailing or listed paths
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/[,;:\s—–-]+([.)]?)$/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseAppDoc(slug: string, markdown: string): AppDoc {
  const { head, byName } = sections(markdown);
  const title = (head.find((l) => /^#\s/.test(l)) ?? `# ${slug}`).replace(/^#\s+/, "").trim();
  const meta = head.find((l) => /^`?\/|·/.test(l.trim()) && !l.startsWith("#") && !l.startsWith(">"))?.trim() ?? "";
  const tag = head.find((l) => l.startsWith(">"))?.replace(/^>\s*/, "").trim() ?? "";
  const shot = markdown.match(/!\[[^\]]*\]\(([^)]*?look\/([a-z0-9-]+)\.jpg)\)/i);
  const overview = head
    .filter((l) => l.trim() && !/^#\s/.test(l) && !l.startsWith(">") && !l.startsWith("![") && l.trim() !== meta)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const code: AppDoc["code"] = [];
  for (const line of find(byName, "where the code")) {
    const row = line.match(/^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (!row || /^-+$/.test(row[1].replace(/[:\s]/g, "")) || row[1].toLowerCase() === "part") continue;
    code.push({ part: row[1].trim(), path: row[2].trim() });
  }

  return {
    slug,
    title,
    meta,
    tag,
    overview,
    screenshot: shot ? `/look/${shot[2]}.jpg` : null,
    features: bullets(find(byName, "features")).map((b) => parseFeature(b.text, b.group)),
    look: bullets(find(byName, "how it looks")).map((b) => b.text),
    code,
    rules: bullets(find(byName, "owner")).map((b) => b.text),
    missing: bullets(find(byName, "described but not found")).map((b) => b.text),
    markdown: markdown.replace(/\r\n/g, "\n"),
  };
}

/** Plain text for a doc line: drop markdown bold and code ticks. */
export const plain = (s: string): string => s.replace(/\*\*/g, "").replace(/`/g, "");

let cache: Promise<Record<string, string>> | null = null;

/** Loads the committed docs on first use; split out of the main bundle. */
export async function loadAppDoc(slug: string | undefined): Promise<AppDoc | null> {
  if (!slug) return null;
  cache ??= import("./app-docs.json").then((m) => (m.default ?? m) as Record<string, string>);
  const all = await cache;
  return all[slug] ? parseAppDoc(slug, all[slug]) : null;
}
