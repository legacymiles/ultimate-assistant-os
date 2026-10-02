// ---------------------------------------------------------------------------
// Reading one Obsidian note.
//
// The vault is the source of truth, so this module is the only place that
// decides what a note *says*: its frontmatter, its body, the notes it points
// at, and the tags it files itself under. Everything downstream — the mirror
// rows, the graph edges, the ghost nodes — is derived from what comes out of
// here, which is why it is pure and heavily tested rather than clever.
//
// Three rules it keeps, each learned from how Obsidian itself behaves:
//
//   * A link inside a code block is not a link. Obsidian does not draw one,
//     and a README quoting `[[Example]]` must not invent an edge.
//   * A link names a note, not a path. `[[Ideas]]` resolves by name against
//     the whole vault (see ./resolve.ts) — this module only reports the name
//     it was given, stripped of the alias and anchor that are display-only.
//   * Nothing here hashes. The bridge hashes the file it just read, because
//     it is holding the bytes; re-deriving it from a parsed note would let the
//     two drift and make the sweep's hash gate lie. This module stays free of
//     node:crypto so it can be imported from the browser as well as the server.
// ---------------------------------------------------------------------------

/** A frontmatter value. Obsidian properties are scalars or lists of scalars. */
export type FrontValue = string | string[];

export type Frontmatter = Record<string, FrontValue>;

/** How a note pointed at another note. The kind is kept because an embed is a real edge but a different one. */
export type LinkKind = "wiki" | "embed" | "markdown";

export interface RawLink {
  /** The note as written — a name for wiki links, a relative path for markdown ones. Never includes the alias or anchor. */
  target: string;
  kind: LinkKind;
  /** `[[Note|what you see]]` — display only, kept so the inspector can show how a link was phrased. */
  alias?: string;
  /** `[[Note#Heading]]` or `[[Note#^block-id]]` — points inside the target, not at a different note. */
  anchor?: string;
}

export interface ParsedNote {
  frontmatter: Frontmatter;
  /** The note minus its frontmatter block. */
  body: string;
  /** frontmatter `title`, else the first `# heading`, else the filename without its extension. */
  title: string;
  /** Every outgoing link, in the order written, de-duplicated by target+kind. */
  links: RawLink[];
  /** `#tags` from the body plus a frontmatter `tags` list, normalised without the leading `#`. */
  tags: string[];
}

// --- paths -----------------------------------------------------------------

/**
 * One spelling for one file.
 *
 * `external_id` is a unique key in Postgres, so two spellings of one path is
 * not a cosmetic problem: a manifest containing both `Notes\A.md` and
 * `Notes/A.md` would make a single insert violate the index and take the whole
 * sweep down with it. Windows hands back backslashes, macOS hands back
 * decomposed Unicode, and a recursive scanner can easily emit a leading `./`.
 * All of it is flattened here, once.
 */
export function normalizePath(path: string): string {
  // Trimmed first: a path of nothing but whitespace is not a path, and letting
  // one through would index the vault root as if it were a note. Windows
  // forbids leading and trailing spaces in names anyway.
  const slashed = path.trim().replace(/\\/g, "/").normalize("NFC");
  // Collapse `//`, strip a leading `./` or `/`, and drop a trailing slash.
  return slashed
    .replace(/\/{2,}/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+$/, "");
}

/**
 * The comparison key for a path.
 *
 * Separate from `normalizePath` on purpose: Windows and macOS both treat
 * `Notes/A.md` and `notes/a.md` as one file, so they must collide when we
 * de-duplicate — but the *stored* path has to keep the owner's own casing,
 * because that is what `obsidian://open` and the file on disk actually use.
 */
export function pathKey(path: string): string {
  return normalizePath(path).toLowerCase();
}

/** The filename, with its folders removed. */
export function basename(path: string): string {
  const norm = normalizePath(path);
  const cut = norm.lastIndexOf("/");
  return cut === -1 ? norm : norm.slice(cut + 1);
}

/** The folder a path sits in, or `""` at the vault root. */
export function dirname(path: string): string {
  const norm = normalizePath(path);
  const cut = norm.lastIndexOf("/");
  return cut === -1 ? "" : norm.slice(0, cut);
}

/** `Ideas.md` → `Ideas`. Only strips a markdown extension, so `v1.2 notes` keeps its dot. */
export function stripExtension(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

/** The name a `[[wikilink]]` would use for this path. */
export function noteName(path: string): string {
  return stripExtension(basename(path));
}

// --- frontmatter -----------------------------------------------------------

/**
 * A deliberately small YAML subset: `key: value`, `key:` followed by `- item`
 * lines, and inline `[a, b]` lists. That is the whole of what Obsidian's
 * property editor writes.
 *
 * Anything richer (nested maps, multi-line scalars, anchors) is left in the
 * body rather than guessed at — a half-understood property is worse than an
 * absent one, because the graph would file the note under a value nobody typed.
 */
export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const text = raw.replace(/^﻿/, "");
  // The opening fence must be the very first line; `---` further down is a
  // horizontal rule, and treating it as frontmatter would eat half the note.
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { frontmatter: {}, body: text };

  const frontmatter: Frontmatter = {};
  const lines = match[1].split(/\r?\n/);
  let key = "";
  let list: string[] | null = null;

  const flush = () => {
    if (key && list) frontmatter[key] = list;
    list = null;
  };

  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const item = /^\s*-\s*(.*)$/.exec(line);
    if (item && key) {
      // A `- item` line belongs to the key above it, so the list is only
      // committed once we know no more items are coming.
      list = list ?? [];
      const value = unquote(item[1].trim());
      if (value) list.push(value);
      continue;
    }

    const pair = /^([A-Za-z0-9_][A-Za-z0-9_\- .]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    flush();
    key = pair[1].trim();
    const rest = pair[2].trim();
    if (!rest) {
      // `key:` with nothing after it — either an empty value or the head of a
      // `- item` list. Seed it empty so a list with zero items is still a list.
      frontmatter[key] = "";
      continue;
    }
    const inline = /^\[(.*)\]$/.exec(rest);
    if (inline) {
      frontmatter[key] = inline[1]
        .split(",")
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
      continue;
    }
    frontmatter[key] = unquote(rest);
  }
  flush();

  return { frontmatter, body: text.slice(match[0].length) };
}

function unquote(value: string): string {
  const quoted = /^(["'])([\s\S]*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
}

/** A frontmatter value as a list, whether it was written as one or not. */
export function asList(value: FrontValue | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
}

// --- links and tags --------------------------------------------------------

/**
 * Blank out fenced and inline code, keeping every character position.
 *
 * Replacing rather than removing matters: the offsets stay valid, so a later
 * pass can still point at where in the body a link was found. Fences are
 * matched before inline code, because a ``` block may legitimately contain
 * single backticks.
 */
function maskCode(body: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  return body
    .replace(/^(?: {4}|\t)[^\n]*$/gm, blank) // indented code blocks
    .replace(/```[\s\S]*?(?:```|$)/g, blank)
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, blank)
    .replace(/`[^`\n]*`/g, blank);
}

const WIKILINK = /(!?)\[\[([^\[\]\n]+)\]\]/g;
const MDLINK = /(?<!!)\[[^\]\n]*\]\(([^)\s]+)\)/g;

/**
 * Tags, by Obsidian's own rule: preceded by whitespace or the start of a line,
 * at least one non-numeric character, and `-_/` allowed inside.
 *
 * The non-numeric requirement is what keeps `#1`, `#2026` and a `#fff` colour
 * out, and the leading-boundary requirement is what keeps the fragment in
 * `example.com/#section` out. A `# Heading` is excluded by requiring no space.
 */
const TAG = /(^|[\s(])#([^\s#.,;:!?'"`\])}]+)/g;

/** Split `Note#Heading|Alias` into its three display-independent parts. */
export function splitLinkTarget(inside: string): { target: string; anchor?: string; alias?: string } {
  let rest = inside;
  let alias: string | undefined;
  let anchor: string | undefined;

  const pipe = rest.indexOf("|");
  if (pipe !== -1) {
    alias = rest.slice(pipe + 1).trim() || undefined;
    rest = rest.slice(0, pipe);
  }
  const hash = rest.indexOf("#");
  if (hash !== -1) {
    anchor = rest.slice(hash + 1).trim() || undefined;
    rest = rest.slice(0, hash);
  }
  return { target: rest.trim(), anchor, alias };
}

/**
 * Every outgoing link in a body, de-duplicated.
 *
 * `[[Note]]` appearing five times is one edge, not five — but `[[Note]]` and
 * `![[Note]]` are kept apart, because an embed says something different about
 * the relationship than a reference does.
 */
export function extractLinks(body: string): RawLink[] {
  const text = maskCode(body);
  const out: RawLink[] = [];
  const seen = new Set<string>();

  const add = (link: RawLink) => {
    if (!link.target) return;
    const key = `${link.kind}\u0000${link.target.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(link);
  };

  for (const m of text.matchAll(WIKILINK)) {
    const { target, anchor, alias } = splitLinkTarget(m[2]);
    // `[[#Heading]]` points inside this same note. It is not an edge.
    if (!target) continue;
    add({ target, kind: m[1] === "!" ? "embed" : "wiki", ...(alias ? { alias } : {}), ...(anchor ? { anchor } : {}) });
  }

  for (const m of text.matchAll(MDLINK)) {
    const href = m[1];
    // Only links to notes inside the vault. An http(s) link, a mailto and an
    // `obsidian://` URI all point outward and would clutter the graph with
    // nodes that have no content behind them.
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) continue;
    const decoded = safeDecode(href);
    const { target, anchor } = splitLinkTarget(decoded);
    if (!target || !/\.(md|markdown)$/i.test(target)) continue;
    add({ target, kind: "markdown", ...(anchor ? { anchor } : {}) });
  }

  return out;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A stray `%` is not worth losing the link over.
    return value;
  }
}

/** `#tags` in a body, lower-cased and without the `#`, in first-seen order. */
export function extractTags(body: string): string[] {
  const text = maskCode(body);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(TAG)) {
    const tag = m[2].replace(/\/+$/, "");
    if (!tag || !/[^\d/]/.test(tag)) continue; // `#2026` and `#1/2` are not tags
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** The first `# heading` in a body, if it has one. */
export function firstHeading(body: string): string {
  const m = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(maskCode(body));
  return m ? m[1].trim() : "";
}

// --- the whole note --------------------------------------------------------

/**
 * Read one note.
 *
 * `path` is only used for the title fallback, so this stays callable on a body
 * that has not been written to disk yet — which is exactly the case when a
 * note is captured on a phone and queued for the vault.
 */
export function parseNote(path: string, raw: string): ParsedNote {
  const { frontmatter, body } = parseFrontmatter(raw);

  const front = typeof frontmatter.title === "string" ? frontmatter.title.trim() : "";
  const title = front || firstHeading(body) || noteName(path) || "Untitled";

  // A frontmatter `tags` list is written with or without the `#`, and
  // sometimes as `[[wikilinks]]` by people who use tags as entities. Normalise
  // all three spellings to the bare tag, because the graph files by value.
  const fromFront = [...asList(frontmatter.tags), ...asList(frontmatter.tag)]
    .map((t) => t.trim().replace(/^#/, "").replace(/^\[\[|\]\]$/g, "").trim())
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...fromFront, ...extractTags(body)]) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }

  // Links written in frontmatter — `people: ["[[Robert Michaels]]"]` — are real
  // edges and the researched vault structure uses them heavily, so they count.
  const frontLinks: RawLink[] = [];
  for (const value of Object.values(frontmatter)) {
    for (const item of asList(value)) {
      for (const m of item.matchAll(WIKILINK)) {
        const { target, anchor, alias } = splitLinkTarget(m[2]);
        if (target) {
          frontLinks.push({ target, kind: "wiki", ...(alias ? { alias } : {}), ...(anchor ? { anchor } : {}) });
        }
      }
    }
  }

  const links: RawLink[] = [];
  const linkSeen = new Set<string>();
  for (const link of [...frontLinks, ...extractLinks(body)]) {
    const key = `${link.kind}\u0000${link.target.toLowerCase()}`;
    if (linkSeen.has(key)) continue;
    linkSeen.add(key);
    links.push(link);
  }

  return { frontmatter, body, title, links, tags };
}

/**
 * A short, readable excerpt — the first real prose in the note.
 *
 * Headings, list bullets, quote markers and images are stripped rather than
 * included, because an excerpt that reads "## Summary" tells the owner nothing
 * about which note they are looking at.
 */
export function excerpt(body: string, max = 280): string {
  const text = maskCode(body)
    .replace(/^#{1,6}[ \t]+.*$/gm, "")
    .replace(/^\s*[-*+>]\s+/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/!?\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]+))?\]\]/g, (_m, target, alias) => alias || target)
    .replace(/\[([^\]\n]*)\]\([^)\s]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
