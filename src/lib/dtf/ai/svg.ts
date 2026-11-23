// ---------------------------------------------------------------------------
// SVG the AI designer writes becomes a layer on a customer's garment, is drawn
// in their browser and is finally rasterised into a print file. So it is
// treated as hostile: parsed into tags, rebuilt from an ALLOW-list, never
// patched with a deny-list regex.
//
// What survives: plain vector shapes, groups, text, gradients, clip paths and
// masks, `<use>` pointing inside the same file. What never survives: scripts,
// event handlers, foreignObject, embedded or linked images, any href that
// leaves the document, CSS that can load something, and FILTERS — a blur or a
// feathered edge prints on DTF as a speckled half-transparent white underbase,
// so the effect is removed rather than flagged.
// ---------------------------------------------------------------------------

/** Hard cap on what we accept and what we emit. */
export const MAX_SVG_BYTES = 60 * 1024;

const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "use",
  "title",
]);

/** Elements whose text content is meaningful and kept. */
const TEXT_ELEMENTS = new Set(["text", "tspan", "title"]);

/** Canonical (case-correct) element names, keyed by lower case. */
const CANONICAL: Record<string, string> = {
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
  clippath: "clipPath",
};

/** Presentation + geometry attributes any allowed element may carry (lower case). */
const ALLOWED_ATTRS = new Set([
  "id",
  "class",
  "transform",
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "clip-path",
  "clip-rule",
  "mask",
  "style",
  "display",
  "visibility",
  "color",
  "paint-order",
  "vector-effect",
  "shape-rendering",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "fr",
  "width",
  "height",
  "d",
  "points",
  "pathlength",
  "viewbox",
  "preserveaspectratio",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientunits",
  "gradienttransform",
  "spreadmethod",
  "clippathunits",
  "maskunits",
  "maskcontentunits",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "letter-spacing",
  "word-spacing",
  "text-decoration",
  "dx",
  "dy",
  "rotate",
  "textlength",
  "lengthadjust",
  "href",
  "xml:space",
]);

/** Attributes that may hold a paint server / clip reference: only `url(#id)` is allowed in them. */
const URL_ATTRS = new Set(["fill", "stroke", "clip-path", "mask"]);

/** Elements on which an internal `#id` href is meaningful. */
const HREF_ELEMENTS = new Set(["use", "lineargradient", "radialgradient"]);

const INTERNAL_REF = /^#[A-Za-z_][\w.:-]*$/;
const URL_INTERNAL_ONLY = /^url\(\s*['"]?#[A-Za-z_][\w.:-]*['"]?\s*\)/i;
const DANGEROUS_VALUE = /javascript:|vbscript:|data:|expression\s*\(|@import|behavior\s*:|-moz-binding/i;

export interface SanitizedSvg {
  svg: string;
  /** width / height of the viewBox. */
  aspect: number;
}

interface Attr {
  name: string;
  value: string;
}

// `<name attrs... /?>` at the current position. Attribute values may be quoted
// either way or bare; anything else is not a tag and is treated as text.
const TAG_RE = /<([A-Za-z][\w:.-]*)((?:\s+[^\s=/>"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const CLOSE_RE = /<\/([A-Za-z][\w:.-]*)\s*>/y;
const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

function parseAttrs(src: string): Attr[] {
  const out: Attr[] = [];
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(src))) {
    let value = m[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out.push({ name: m[1], value: decodeEntities(value) });
  }
  return out;
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decode the five XML entities and numeric references; unknown entities are dropped. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      // Control characters never belong in artwork.
      if (code < 0x20 && code !== 0x9 && code !== 0xa && code !== 0xd) return "";
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? "";
  });
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

/** Clean one `style="..."` value, or return null to drop it. */
function cleanStyle(style: string): string | null {
  if (/url\s*\(|@import/i.test(style) || DANGEROUS_VALUE.test(style)) return null;
  const kept = style
    .split(";")
    .map((d) => d.trim())
    .filter((d) => {
      if (!d) return false;
      const prop = d.split(":")[0]?.trim().toLowerCase() ?? "";
      // Filters and backdrop effects print badly on DTF; positioning tricks have no place in artwork.
      return !/^(filter|backdrop-filter|-webkit-filter|mix-blend-mode|position|content|cursor|pointer-events)$/.test(prop);
    });
  return kept.length ? kept.join(";") : null;
}

/** Clean one attribute; null drops it. */
function cleanAttr(element: string, attr: Attr): Attr | null {
  let name = attr.name;
  let lower = name.toLowerCase();
  // SVG 2 `href` replaces `xlink:href`; normalising means no xlink namespace is needed.
  if (lower === "xlink:href") {
    name = "href";
    lower = "href";
  }
  if (lower.startsWith("on")) return null;
  if (lower === "xmlns" || lower.startsWith("xmlns:")) return null; // re-added on the root only
  if (!ALLOWED_ATTRS.has(lower)) return null;
  const value = attr.value.trim();
  if (value.length > 20_000) return null;

  if (lower === "href") {
    if (!HREF_ELEMENTS.has(element) || !INTERNAL_REF.test(value)) return null;
    return { name, value };
  }
  if (lower === "style") {
    const style = cleanStyle(value);
    return style ? { name, value: style } : null;
  }
  if (DANGEROUS_VALUE.test(value)) return null;
  if (/url\s*\(/i.test(value)) {
    if (!URL_ATTRS.has(lower) || !URL_INTERNAL_ONLY.test(value)) return null;
  }
  return { name, value };
}

/** Parse "0 0 100 50" (commas allowed) into four finite numbers. */
function parseViewBox(v: string | undefined): [number, number, number, number] | null {
  if (!v) return null;
  const parts = v
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  if (parts[2] <= 0 || parts[3] <= 0) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

/** A plain length ("120", "120px") as a number; percentages and other units give null. */
function plainLength(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

/** Strip comments, CDATA, processing instructions and doctypes before tokenising. */
function preclean(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>/gi, "")
    .replace(/<![^>]*>/g, "");
}

/**
 * Sanitise an SVG string. Returns the rebuilt document and its aspect ratio,
 * or null when nothing safe and drawable remains (no <svg> root, no usable
 * viewBox, too big).
 */
export function sanitizeSvg(input: unknown): SanitizedSvg | null {
  if (typeof input !== "string") return null;
  if (input.length > MAX_SVG_BYTES) return null;
  const src = preclean(input);

  const out: string[] = [];
  // Open elements we are emitting (lower-case names) — used to close correctly.
  const stack: string[] = [];
  // When > 0 we are inside a dropped element and emit nothing until it closes.
  let skipDepth = 0;
  let rootDone = false;
  let rootAttrs: Attr[] | null = null;
  let rootIndex = -1;
  let i = 0;

  const textAllowed = () => stack.length > 0 && TEXT_ELEMENTS.has(stack[stack.length - 1]);

  while (i < src.length && !rootDone) {
    const lt = src.indexOf("<", i);
    const textEnd = lt === -1 ? src.length : lt;
    if (textEnd > i) {
      const text = src.slice(i, textEnd);
      if (skipDepth === 0 && textAllowed()) out.push(escapeText(decodeEntities(text)));
      i = textEnd;
      continue;
    }

    CLOSE_RE.lastIndex = i;
    const close = CLOSE_RE.exec(src);
    if (close) {
      i = CLOSE_RE.lastIndex;
      const name = close[1].toLowerCase();
      if (skipDepth > 0) {
        skipDepth--;
        continue;
      }
      // Close the nearest matching open element; stray closers are ignored.
      const at = stack.lastIndexOf(name);
      if (at === -1) continue;
      while (stack.length > at) {
        const n = stack.pop() as string;
        out.push(`</${CANONICAL[n] ?? n}>`);
      }
      if (stack.length === 0) rootDone = true;
      continue;
    }

    TAG_RE.lastIndex = i;
    const open = TAG_RE.exec(src);
    if (!open) {
      // A bare "<" that is not a tag: text, escaped (or dropped outside text).
      if (skipDepth === 0 && textAllowed()) out.push("&lt;");
      i = lt + 1;
      continue;
    }
    i = TAG_RE.lastIndex;
    const rawName = open[1];
    const name = rawName.toLowerCase();
    const selfClosing = open[3] === "/";

    if (skipDepth > 0) {
      if (!selfClosing) skipDepth++;
      continue;
    }
    // Before the root, only <svg> starts the document; anything else is ignored with its content.
    if (stack.length === 0 && name !== "svg") {
      if (!selfClosing) skipDepth = 1;
      continue;
    }
    if (!ALLOWED_ELEMENTS.has(name)) {
      if (!selfClosing) skipDepth = 1;
      continue;
    }

    const attrs = parseAttrs(open[2])
      .map((a) => cleanAttr(name, a))
      .filter((a): a is Attr => a !== null);
    // Duplicate attributes are invalid XML; keep the first.
    const seen = new Set<string>();
    const unique = attrs.filter((a) => {
      const k = a.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const tag = CANONICAL[name] ?? name;
    if (stack.length === 0) {
      rootAttrs = unique;
      rootIndex = out.length;
      out.push(""); // placeholder, filled once the root's attributes are final
      if (selfClosing) {
        rootDone = true;
        continue;
      }
      stack.push(name);
      continue;
    }
    const attrText = unique.map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join("");
    if (selfClosing) out.push(`<${tag}${attrText}/>`);
    else {
      out.push(`<${tag}${attrText}>`);
      stack.push(name);
    }
  }

  if (!rootAttrs || rootIndex === -1) return null;
  // Close anything the input left open.
  while (stack.length) {
    const n = stack.pop() as string;
    out.push(`</${CANONICAL[n] ?? n}>`);
  }
  if (!out[out.length - 1]?.startsWith("</svg")) out.push("</svg>");

  // Root: force xmlns, a viewBox, and width/height.
  const get = (n: string) => rootAttrs?.find((a) => a.name.toLowerCase() === n)?.value;
  let vb = parseViewBox(get("viewbox"));
  const w = plainLength(get("width"));
  const h = plainLength(get("height"));
  if (!vb) {
    if (w && h) vb = [0, 0, w, h];
    else return null;
  }
  const keep = rootAttrs.filter((a) => !["viewbox", "width", "height", "x", "y"].includes(a.name.toLowerCase()));
  const width = w ?? vb[2];
  const height = h ?? vb[3];
  const rootAttrText = [
    ` xmlns="http://www.w3.org/2000/svg"`,
    ` viewBox="${vb.join(" ")}"`,
    ` width="${width}"`,
    ` height="${height}"`,
    ...keep.map((a) => ` ${a.name}="${escapeAttr(a.value)}"`),
  ].join("");
  out[rootIndex] = `<svg${rootAttrText}>`;

  const svg = out.join("");
  if (svg.length > MAX_SVG_BYTES) return null;
  return { svg, aspect: vb[2] / vb[3] };
}
