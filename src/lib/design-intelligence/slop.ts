// ---------------------------------------------------------------------------
// Design Intelligence — the slop check.
//
// The owner's complaint, every time, was the same: the site worked and looked
// like every other AI site. Telling the builder "don't be generic" is what the
// skills already do, and the builder grading its own taste is the weakness, not
// the cure. So this file turns "generic" into things a machine can count:
// placeholder copy left in, the default stack of tells (Inter on white with a
// blue button), the same three-card grid four times down a page, a page with no
// standout at all, text you cannot read, a page that scrolls sideways on a
// phone.
//
// Two inputs, one rulebook:
//   scanSource(files)  — the code a build wrote (TSX, HTML, CSS), read as text
//   scanPage(snapshot) — what a real browser saw on the rendered page
// The bridge's `design-check.mjs` collects the snapshot with Playwright and
// calls scanPage, so the rules live here, once, with their tests beside them.
//
// Deliberately import-free and free of TypeScript-only runtime syntax: the
// bridge is plain Node and loads this file through Node's own type stripping.
// ---------------------------------------------------------------------------

export type Severity = "fail" | "warn";

export interface Finding {
  /** Stable id, e.g. "placeholder-copy". Tests and reports key on it. */
  rule: string;
  severity: Severity;
  /** File path or page URL (+ width) the finding is about. */
  where: string;
  /** Plain English: what is wrong. */
  message: string;
  /** Plain English: what to do instead. */
  fix: string;
}

export interface SourceFile {
  path: string;
  text: string;
}

/** What `design-check.mjs` measures in the browser. Every field is optional so an older collector still scans. */
export interface PageSnapshot {
  url: string;
  width: number;
  /** Visible text, trimmed. */
  text?: string;
  /** First family of every distinct computed font-family on visible text. */
  fonts?: string[];
  /** Distinct computed font sizes on visible text. */
  fontSizes?: number[];
  /** The page scrolls sideways. */
  overflowX?: boolean;
  consoleErrors?: string[];
  brokenImages?: number;
  imagesMissingAlt?: number;
  /** Values of every `data-standout` attribute on the page. */
  standouts?: string[];
  hasCanvas?: boolean;
  hasVideo?: boolean;
  /** Containers of ≥3 same-shaped children (the card grid), counted. */
  cardGrids?: number;
  /** Elements animating forever (infinite loops) once the page has settled. */
  animated?: number;
  /** Visible text elements below WCAG AA contrast. */
  lowContrast?: number;
  /** Visible text under 3:1 (2:1 for large type) — too faint to read at all. */
  unreadable?: number;
  /** Links/buttons under 24px tall at this width (WCAG 2.2 AA target size). */
  smallTargets?: number;
  /** Computed background colour of <body> (rgb string). */
  bodyBg?: string;
  /** Computed backgrounds of the visible buttons (rgb strings). */
  buttonBgs?: string[];
  h1Count?: number;
}

// ----- shared word lists ------------------------------------------------------------

/**
 * Copy that means nobody wrote the content.
 *
 * Two kinds. Phrases nobody writes on purpose (lorem ipsum, "insert text here")
 * match anywhere. Stand-in LABELS ("Your Company", "Feature 1", "John Doe")
 * match only when they ARE the text of an element or a string — never inside a
 * sentence, because "grow your company" and "Feature 1 of 3" are real copy.
 * Calibrated against stripe.com and linear.app, which must not fail on copy.
 */
const B = String.raw`(?:^|>|["'\x60])[ \t]*`; // start of a line, a tag's text or a string literal
const E = String.raw`[ \t]*(?:$|<|["'\x60]|©)`; // its end
const label = (body: string, flags = "") => new RegExp(`${B}(?:${body})${E}`, `m${flags}`);

const PLACEHOLDER_COPY: Array<[RegExp, string]> = [
  [/\blorem ipsum\b|\bdolor sit amet\b/i, "lorem ipsum"],
  [label("(?:Item|Feature|Service|Product|Card|Testimonial|Plan|Title|Heading|Label|Section) [1-9]", "i"), "a numbered stand-in"],
  [label("(?:Your|My) (?:Company|Brand|Logo|Business|Name)(?: (?:Name|Here|Inc\\.?|LLC))?|Company Name|Brand Name|Logo Here"), "a stand-in name"],
  [label("(?:John|Jane) Doe|Acme(?: (?:Corp|Inc|Co)\\.?)?"), "a stand-in person or company"],
  [/\b(insert|add) (your )?(text|content|image|copy) here\b|\bplaceholder text\b|\bsample text\b/i, "\"insert text here\""],
  [label("Coming soon\\.?", "i"), "\"coming soon\""],
  [/\b123 (main|fake) st(reet)?\b/i, "a fake address"],
  [/\(555\) ?\d{3}-\d{4}|\b555-01\d{2}\b/, "a 555 phone number"],
];

/** Image hosts that only ever serve stand-ins. */
const PLACEHOLDER_IMAGE = /\b(via\.placeholder\.com|placehold\.(co|it)|placekitten\.com|dummyimage\.com|fakeimg\.pl|picsum\.photos|source\.unsplash\.com\/random)\b/i;

/** Tailwind's default primary blues: the button every AI site ships. */
const DEFAULT_BLUE_CLASS = /\bbg-(blue|indigo)-(500|600)\b/;
const DEFAULT_BLUE_RGB = new Set(["rgb(59, 130, 246)", "rgb(37, 99, 235)", "rgb(99, 102, 241)", "rgb(79, 70, 229)"]);

/** The purple-to-pink "make it look modern" gradient. */
const AI_GRADIENT = /\bfrom-(purple|violet|indigo|fuchsia)-\d{3}\b[^"'`]{0,80}\bto-(pink|fuchsia|purple|blue|cyan)-\d{3}\b/;

/** Plain page backgrounds that read as "nobody chose a colour". */
const PLAIN_BG = new Set(["rgb(255, 255, 255)", "rgb(249, 250, 251)", "rgb(248, 250, 252)", "rgb(243, 244, 246)", "rgba(0, 0, 0, 0)"]);

/** Families that are the default when nobody picked type. */
const DEFAULT_FONTS = new Set(["inter", "arial", "helvetica", "helvetica neue", "system-ui", "-apple-system", "segoe ui", "roboto", "sans-serif", "ui-sans-serif", "times new roman", "times", "serif"]);

/** Emoji used as icons: an emoji directly inside a heading or a small icon slot. */
const EMOJI_IN_HEADING = /<h[1-4][^>]*>\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

const isCode = (p: string) => /\.(tsx|jsx|ts|js|html|vue|svelte|astro|mdx)$/i.test(p);
const isStyle = (p: string) => /\.(css|scss)$/i.test(p);
const skipPath = (p: string) => /(^|[\\/])(node_modules|\.next|dist|build|out|coverage|\.git)[\\/]|\.(test|spec)\.[tj]sx?$|(^|[\\/])(tests?|__tests__|fixtures|e2e)[\\/]/i.test(p);

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Strip comments so a rule explained in a comment is not a hit. */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre: string) => pre + " ".repeat(m.length - pre.length))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

// ----- source rules -----------------------------------------------------------------

/**
 * Read the code a build wrote and list the slop in it.
 *
 * Fails are things that should never reach a person: placeholder copy and
 * stand-in images. Warnings are tells — each one alone can be a choice, which
 * is why the combination is judged in `verdict`, not here.
 */
export function scanSource(files: SourceFile[]): Finding[] {
  const out: Finding[] = [];
  const code = files.filter((f) => !skipPath(f.path) && (isCode(f.path) || isStyle(f.path)));
  let blueButtons = 0;
  let gradients = 0;
  let fontDeclared = false;
  let cardGridFiles = 0;

  for (const f of code) {
    const text = withoutComments(f.text);
    if (isCode(f.path)) {
      for (const [re, label] of PLACEHOLDER_COPY) {
        const m = re.exec(text);
        if (m) {
          out.push({
            rule: "placeholder-copy",
            severity: "fail",
            where: `${f.path}:${lineOf(text, m.index)}`,
            message: `Placeholder copy left in: ${label} ("${m[0]}").`,
            fix: "Write the real words for this project — from the brief, the client's site or plausible real data. Never ship stand-in text.",
          });
        }
      }
      const img = PLACEHOLDER_IMAGE.exec(text);
      if (img) {
        out.push({
          rule: "placeholder-image",
          severity: "fail",
          where: `${f.path}:${lineOf(text, img.index)}`,
          message: `Stand-in image service used (${img[0]}).`,
          fix: "Use the project's real imagery, a generated image (Flux 2 on WanGP), or a designed graphic. A grey box from a placeholder service reads as unfinished.",
        });
      }
      const emoji = EMOJI_IN_HEADING.exec(text);
      if (emoji) {
        out.push({
          rule: "emoji-icons",
          severity: "warn",
          where: `${f.path}:${lineOf(text, emoji.index)}`,
          message: "An emoji is doing an icon's job in a heading.",
          fix: "Use a real icon set (lucide-react is already common) or a drawn mark that fits the direction.",
        });
      }
      if (DEFAULT_BLUE_CLASS.test(text)) blueButtons++;
      if (AI_GRADIENT.test(text)) gradients++;
      // Three or more sibling cards built from one map with the same rounded+shadow box.
      if (/\.map\([^)]*\)\s*=>\s*\(?\s*<(div|article|li)[^>]*className="[^"]*\brounded(-\w+)?\b[^"]*\bshadow(-\w+)?\b/.test(text)) cardGridFiles++;
    }
    if (/font-family\s*:|next\/font|@font-face|--font-|fontFamily\s*:/.test(text)) fontDeclared = true;
  }

  if (blueButtons > 0) {
    out.push({
      rule: "default-blue",
      severity: "warn",
      where: `${blueButtons} file${blueButtons === 1 ? "" : "s"}`,
      message: "Tailwind's default blue/indigo (500/600) is used — the primary button every AI site ships.",
      fix: "Take the accent from the chosen direction's palette and define it once as a token.",
    });
  }
  if (gradients > 0) {
    out.push({
      rule: "ai-gradient",
      severity: "warn",
      where: `${gradients} file${gradients === 1 ? "" : "s"}`,
      message: "The purple-to-pink gradient is here — the shorthand for \"make it look modern\".",
      fix: "Gradients are not a direction. Use colour the direction calls for, or none.",
    });
  }
  if (code.length > 0 && !fontDeclared) {
    out.push({
      rule: "no-type-choice",
      severity: "warn",
      where: "project",
      message: "No font is declared anywhere, so the page is in the browser default.",
      fix: "Pick a display face and a text face for this direction and load them (next/font/local or @font-face).",
    });
  }
  if (cardGridFiles >= 3) {
    out.push({
      rule: "card-grid-everywhere",
      severity: "warn",
      where: `${cardGridFiles} files`,
      message: "The same rounded, shadowed card is mapped out in several places — the template look.",
      fix: "Give each section a layout for its content: a list, a table, an editorial spread, a timeline, one big feature. Cards only where the content is cards.",
    });
  }
  return out;
}

// ----- page rules -------------------------------------------------------------------

const firstFamily = (f: string) => f.split(",")[0].trim().replace(/^['"]|['"]$/g, "").toLowerCase();

/**
 * Judge one rendered page.
 *
 * `important` marks a page that must carry a standout (the home page, a
 * landing page, a redesign's hero) — the One-Standout Rule. Other pages are
 * only checked for slop and breakage.
 */
export function scanPage(s: PageSnapshot, opts: { important?: boolean } = {}): Finding[] {
  const out: Finding[] = [];
  const where = `${s.url} @ ${s.width}px`;
  const text = s.text ?? "";

  for (const [re, label] of PLACEHOLDER_COPY) {
    const m = re.exec(text);
    if (m) {
      out.push({
        rule: "placeholder-copy",
        severity: "fail",
        where,
        message: `Placeholder copy on the page: ${label} ("${m[0]}").`,
        fix: "Replace it with real content for this project.",
      });
    }
  }
  if (s.overflowX) {
    out.push({
      rule: "sideways-scroll",
      severity: "fail",
      where,
      message: "The page scrolls sideways at this width.",
      fix: "Find the element wider than the screen (fixed widths, long words, wide images, 100vw inside padding) and let it shrink or wrap.",
    });
  }
  const noise = /favicon|DevTools|Download the React DevTools/i;
  // A resource the network refused (often a third party turning away a headless
  // browser, as vercel.com does) is not the page's own code failing. Broken
  // images are judged on their own below; a missing script throws a real error.
  const resource = /^Failed to load resource/i;
  const all = (s.consoleErrors ?? []).filter((e) => !noise.test(e));
  const errors = all.filter((e) => !resource.test(e));
  const refused = all.filter((e) => resource.test(e));
  if (errors.length) {
    out.push({
      rule: "console-errors",
      severity: "fail",
      where,
      message: `${errors.length} console error${errors.length === 1 ? "" : "s"}: ${errors[0].slice(0, 160)}`,
      fix: "Fix the error at its source; a page that errors in the console is not finished.",
    });
  }
  if (refused.length) {
    out.push({
      rule: "resource-errors",
      severity: "warn",
      where,
      message: `${refused.length} request${refused.length === 1 ? "" : "s"} failed: ${refused[0].slice(0, 120)}`,
      fix: "Check each failed request: a missing file of your own is a bug; a third party refusing a headless browser is not.",
    });
  }
  if ((s.brokenImages ?? 0) > 0) {
    out.push({
      rule: "broken-images",
      severity: "fail",
      where,
      message: `${s.brokenImages} image${s.brokenImages === 1 ? "" : "s"} failed to load.`,
      fix: "Point each one at a file that exists, or remove it.",
    });
  }
  if ((s.imagesMissingAlt ?? 0) > 0) {
    out.push({
      rule: "missing-alt",
      severity: "warn",
      where,
      message: `${s.imagesMissingAlt} image${s.imagesMissingAlt === 1 ? " has" : "s have"} no alt text.`,
      fix: "Describe what each image shows; use alt=\"\" only for pure decoration.",
    });
  }
  // Two bars, calibrated on linear.app: its tertiary grey sits at 3.4:1 — below
  // AA, readable, a choice. Text under 3:1 is a different thing: people cannot read it.
  if ((s.unreadable ?? 0) >= 3) {
    out.push({
      rule: "unreadable-text",
      severity: "fail",
      where,
      message: `${s.unreadable} pieces of text are under 3:1 contrast — too faint to read.`,
      fix: "Raise the contrast of that text against its background to at least 4.5:1 (3:1 for large type).",
    });
  } else if ((s.lowContrast ?? 0) >= 3) {
    out.push({
      rule: "low-contrast",
      severity: "warn",
      where,
      message: `${s.lowContrast} pieces of text are below WCAG AA contrast.`,
      fix: "Darken or lighten the text against its background until it reads at 4.5:1 (3:1 for large type).",
    });
  }
  if ((s.smallTargets ?? 0) >= 5 && s.width <= 480) {
    out.push({
      rule: "small-tap-targets",
      severity: "warn",
      where,
      message: `${s.smallTargets} links or buttons are under 24px tall on a phone.`,
      fix: "Give every tap target at least 44px of height including padding.",
    });
  }
  if ((s.h1Count ?? 1) === 0) {
    out.push({
      rule: "no-h1",
      severity: "warn",
      where,
      message: "The page has no main heading (h1).",
      fix: "Give every page one h1 that says what it is.",
    });
  }

  // The template look: the same card grid section after section.
  const grids = s.cardGrids ?? 0;
  if (grids >= 3) {
    out.push({
      rule: "card-grid-everywhere",
      severity: grids >= 4 ? "fail" : "warn",
      where,
      message: `${grids} sections are the same grid of look-alike cards.`,
      fix: "Vary the layouts to suit the content — editorial spreads, lists, tables, one oversized feature, a timeline. At most one or two card grids on a page.",
    });
  }

  // The default stack of tells, judged together: each alone can be a choice.
  const fonts = (s.fonts ?? []).map(firstFamily).filter(Boolean);
  const allDefaultType = fonts.length > 0 && fonts.every((f) => DEFAULT_FONTS.has(f));
  const plainBg = s.bodyBg ? PLAIN_BG.has(s.bodyBg) : false;
  const blue = (s.buttonBgs ?? []).some((b) => DEFAULT_BLUE_RGB.has(b));
  const tells = [allDefaultType, plainBg, blue].filter(Boolean).length;
  if (tells >= 2) {
    out.push({
      rule: "default-look",
      severity: tells === 3 ? "fail" : "warn",
      where,
      message: `It looks like the default AI site: ${[allDefaultType && "default type only", plainBg && "a plain white/grey page", blue && "the stock blue button"].filter(Boolean).join(", ")}.`,
      fix: "Commit to the chosen direction — its own type pairing, its own surface colour and accent. This combination is the first thing people read as generic.",
    });
  }
  if ((s.fontSizes ?? []).length > 0 && (s.fontSizes ?? []).length < 3) {
    out.push({
      rule: "flat-hierarchy",
      severity: "warn",
      where,
      message: `Only ${(s.fontSizes ?? []).length} text size${(s.fontSizes ?? []).length === 1 ? "" : "s"} on the page, so nothing leads the eye.`,
      fix: "Build a real type scale with a clear display size.",
    });
  }
  if (new Set(fonts).size > 3) {
    out.push({
      rule: "too-many-fonts",
      severity: "warn",
      where,
      message: `${new Set(fonts).size} font families on one page.`,
      fix: "Two families (three at most, one being mono) read as designed; more reads as collected.",
    });
  }

  // Motion: none at all reads dead; motion on everything reads like decoration.
  if ((s.animated ?? 0) > 12) {
    out.push({
      rule: "motion-everywhere",
      severity: "warn",
      where,
      message: `${s.animated} elements never stop moving.`,
      fix: "Motion should mean something — keep it for the standout and for state changes. Everything moving is noise.",
    });
  }

  // The One-Standout Rule.
  if (opts.important) {
    const marked = (s.standouts ?? []).filter((v) => v.trim());
    if (marked.length === 0) {
      out.push({
        rule: "no-standout",
        severity: "fail",
        where,
        message: "This page has no marked standout — nothing a visitor would remember or describe to a friend.",
        fix: "Give it one memorable visual or interactive moment that fits the direction, and mark its root element with data-standout=\"<what it is>\". One, done well.",
      });
    } else if (marked.length > 2) {
      out.push({
        rule: "too-many-standouts",
        severity: "warn",
        where,
        message: `${marked.length} standouts on one page (${marked.join(", ")}) — they compete.`,
        fix: "Keep the strongest one or two; let the rest be quiet, well-made sections.",
      });
    }
  }
  return out;
}

// ----- the verdict ------------------------------------------------------------------

export interface Verdict {
  pass: boolean;
  /** 0–10. Starts at 10, −2.5 per fail, −0.5 per warning, floor 0. A guide for the report, never the gate. */
  score: number;
  fails: Finding[];
  warnings: Finding[];
}

/** Any fail fails the check. The score is for reading, not for passing. */
export function verdict(findings: Finding[]): Verdict {
  const fails = findings.filter((f) => f.severity === "fail");
  const warnings = findings.filter((f) => f.severity === "warn");
  const score = Math.max(0, Math.round((10 - fails.length * 2.5 - warnings.length * 0.5) * 10) / 10);
  return { pass: fails.length === 0, score, fails, warnings };
}

/** The findings as plain text a builder can act on in one pass. */
export function report(v: Verdict): string {
  const line = (f: Finding) => `- [${f.rule}] ${f.where} — ${f.message} Fix: ${f.fix}`;
  return [
    `Design check: ${v.pass ? "PASS" : "FAIL"} · score ${v.score}/10 · ${v.fails.length} fail${v.fails.length === 1 ? "" : "s"}, ${v.warnings.length} warning${v.warnings.length === 1 ? "" : "s"}`,
    ...(v.fails.length ? ["Must fix:", ...v.fails.map(line)] : []),
    ...(v.warnings.length ? ["Should fix:", ...v.warnings.map(line)] : []),
  ].join("\n");
}
