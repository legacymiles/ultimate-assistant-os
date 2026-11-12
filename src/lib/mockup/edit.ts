// ---------------------------------------------------------------------------
// Edit mockups — three takes on ONE change, painted onto the page as it is.
//
// A redesign asks "which look?"; an edit asks "did you understand what I
// meant?". So an edit's three lanes are not three design skills — the site
// already has a look — they are three readings of the same request:
//
//   faithful  — exactly what was asked, as if the site's own designer did it
//   polished  — what was asked, plus the part it touches brought up to a
//               premium standard
//   bold      — a braver take on the same request
//
// Every lane is drawn by Flux 2 Klein FROM A SCREENSHOT of the live page
// (WanGP's reference mode "KI": image 1 is the scene being changed). That is
// the whole difference from a text-only picture: the mockup is THIS site, with
// its real logo, nav and words, and only the asked-for part moved.
//
// No imports on purpose. The chat command (tools/mockup-edit) runs this file
// with Node's own TypeScript support, so the hub and the chat draw identical
// prompts — and the drawer's cache hands the same pictures to both.
// ---------------------------------------------------------------------------

export type EditLaneId = "faithful" | "polished" | "bold";

/** What is known about the site beyond the screenshot. All optional. */
export interface SiteFacts {
  name?: string;
  /** Brand colours as hex, most used first. */
  colors?: string[];
  /** Font families the site loads. */
  fonts?: string[];
  /** The page's section headings, top to bottom. */
  sections?: string[];
  nav?: string[];
  /** What the site does (pages, forms, checkout…). The edit must keep these working. */
  features?: string[];
}

export interface EditLane {
  id: EditLaneId;
  /** Shown on the lane. */
  label: string;
  /** One line on what this lane is doing. */
  note: string;
  /** The change, in words a builder can act on. */
  instruction: string;
  /** What Flux is told. */
  prompt: string;
}

/** A lane's text, when the caller (Claude in chat) has written its own. */
export interface CustomLane {
  label?: string;
  instruction: string;
}

/** What a pick carries to the build. */
export interface EditPick {
  lane: EditLaneId;
  label: string;
  /** The owner's or client's own words. */
  edit: string;
  /** This lane's reading of them. */
  instruction: string;
  /** "Make the button green" and so on, added after the first drawing. */
  tweaks: string[];
}

/** Same ceiling as the look-mode prompts: the drawer caps at 2000. */
export const EDIT_PROMPT_MAX = 1400;

const LANES: Record<EditLaneId, { label: string; note: string; style: string; keep: string }> = {
  faithful: {
    label: "As asked",
    note: "Exactly the change you asked for, in the site's own style.",
    style: "Make the change look native to the existing design, as if the site's own designer made it.",
    keep: "Keep the exact same layout, logo, navigation, text, fonts and brand colours everywhere else.",
  },
  polished: {
    label: "Polished",
    note: "Your change, and the part it touches brought up to a premium finish.",
    style:
      "Bring the part that changes up to a premium, award-winning standard: refined spacing, a clear type hierarchy and considered detail, in the site's own colours.",
    keep: "Keep the logo, navigation, brand colours and the rest of the page as they are.",
  },
  bold: {
    label: "Bold",
    note: "A braver take on the same change, for contrast.",
    style:
      "Take a bold, striking direction for the part that changes: a fresh composition with more visual impact and confident contrast.",
    keep: "Keep the brand name, logo, colour family and all the real text; the rest of the page stays recognisably the same site.",
  },
};

export const EDIT_LANE_IDS: EditLaneId[] = ["faithful", "polished", "bold"];

function one(text: unknown, max: number): string {
  const t = String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/"/g, "'")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
}

/** The request, tidied: one line, no trailing full stop, never empty. */
export function cleanEdit(text: unknown): string {
  return one(text, 600).replace(/[.\s]+$/, "");
}

/** One short sentence of facts the picture can't show by itself. */
export function factsLine(facts?: SiteFacts): string {
  if (!facts) return "";
  const bits: string[] = [];
  const colors = (facts.colors ?? []).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)).slice(0, 4);
  if (colors.length) bits.push(`brand colours ${colors.join(", ")}`);
  const fonts = (facts.fonts ?? []).map((f) => one(f, 24)).filter(Boolean).slice(0, 2);
  if (fonts.length) bits.push(`typeface ${fonts.join(" and ")}`);
  return bits.length ? `The site uses ${bits.join("; ")}.` : "";
}

interface Ctx {
  siteName: string;
  facts?: SiteFacts;
  device?: "desktop" | "phone";
  /**
   * Set only when the picture of a LOCKED direction rides along as image 2
   * (site-context.ts lockedStyleLine). Absent everywhere else, so prompts
   * without a lock stay byte-identical to the hub's and share its cache.
   */
  styleRef?: string;
}

function subject(ctx: Ctx): string {
  const name = one(ctx.facts?.name || ctx.siteName, 40);
  return `a screenshot of ${name ? `the ${name}` : "a"} website${ctx.device === "phone" ? " on a phone" : ""}`;
}

const FINISH = "Crisp legible UI text, flat straight-on screenshot, pixel-perfect, no device frame, no hands, no watermark.";

/** What Flux is told for one lane. Ordered most-important first: Flux weighs the start hardest. */
export function editFluxPrompt(instruction: string, lane: EditLaneId, ctx: Ctx): string {
  const l = LANES[lane];
  const text = [
    `Edit image 1, ${subject(ctx)}.`,
    l.keep,
    `Change only this: ${one(instruction, 520)}.`,
    ctx.styleRef ? one(ctx.styleRef, 320) : "",
    l.style,
    factsLine(ctx.facts),
    FINISH,
  ]
    .filter(Boolean)
    .join(" ");
  return text.replace(/\s+/g, " ").slice(0, EDIT_PROMPT_MAX);
}

/**
 * The lane's reading of the request, when nobody wrote one.
 *
 * Deliberately close to the owner's words: the faithful lane IS their words,
 * and the other two add a clause rather than inventing a different change.
 * Claude in chat writes richer readings from the code and passes them in.
 */
function defaultInstruction(edit: string, lane: EditLaneId): string {
  if (lane === "faithful") return edit;
  // Measured on the first real board: "refined to match" painted almost the
  // same picture as the faithful lane. Flux follows concrete visual words, so
  // each reading names what it actually changes.
  if (lane === "polished") {
    return `${edit}; then give that section a premium finish — more generous spacing, a larger and tighter headline, refined buttons and one tasteful detail such as a soft glow, a glass card or hairline accents`;
  }
  return `${edit}, as a bold new composition for that section — for example a centred oversized headline over a large striking visual, stronger contrast and a clear focal point`;
}

/**
 * The seed each lane is painted with. Different per lane — the same seed
 * painted near-identical pictures for two different readings — and the same
 * everywhere, so the chat command and the hub ask the drawer for the same
 * picture and its cache answers the second one.
 */
export function laneSeed(lane: EditLaneId): number {
  return 7 + EDIT_LANE_IDS.indexOf(lane);
}

/** The three lanes for one request. `custom` replaces a lane's reading, by position. */
export function editLanes(edit: string, ctx: Ctx, custom: (CustomLane | undefined | null)[] = []): EditLane[] {
  const asked = cleanEdit(edit) || "Tidy this page";
  return EDIT_LANE_IDS.map((id, i) => {
    const own = custom[i];
    const instruction = own?.instruction?.trim() ? cleanEdit(own.instruction) : defaultInstruction(asked, id);
    return {
      id,
      label: own?.label?.trim() ? one(own.label, 32) : LANES[id].label,
      note: own?.instruction?.trim() ? one(own.instruction, 140) : LANES[id].note,
      instruction,
      prompt: editFluxPrompt(instruction, id, ctx),
    };
  });
}

/**
 * Change one lane's picture again — Stitch's "tweak this one".
 *
 * Drawn from that lane's CURRENT picture, not the original screenshot, so a
 * tweak stacks on what the owner is looking at instead of starting over.
 */
export function refineFluxPrompt(tweak: string, ctx: Ctx): string {
  const name = one(ctx.facts?.name || ctx.siteName, 40);
  return [
    `Edit image 1, a website mockup${name ? ` for ${name}` : ""}.`,
    "Keep everything exactly as it is — layout, logo, text and colours —",
    `except this: ${one(tweak, 400)}.`,
    FINISH,
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, EDIT_PROMPT_MAX);
}

/**
 * The words that go to the builder once a lane is picked.
 *
 * The finding that shaped this: a mockup panel is decoration unless the pick
 * REACHES the build. So the brief names the lane, restates the reading it
 * stands for, lists every tweak in order, and tells the builder to compare its
 * result against the picked mockup before reporting.
 */
export function editBrief(args: {
  siteName: string;
  url?: string;
  pick: EditPick;
  facts?: SiteFacts;
  /** The site's DESIGN.md / SITE.md (tools/mockup-edit/scan.mjs), when it was read. */
  designFile?: string;
  siteFile?: string;
  /** The direction locked for the whole site, when this page was painted in it. */
  lock?: { label: string; instruction: string; page: string };
}): string {
  const { pick } = args;
  const lines = [
    `Website edit — ${one(args.siteName, 60)}${args.url ? ` (${args.url})` : ""}`,
    "",
    `The owner was shown three Flux 2 mockups of this change and picked "${pick.label}".`,
    `What they asked for: ${cleanEdit(pick.edit)}.`,
    `Build exactly this version of it: ${cleanEdit(pick.instruction)}.`,
  ];
  if (pick.tweaks.length) {
    lines.push("Refined after the first drawing, in this order:");
    for (const t of pick.tweaks) lines.push(`- ${cleanEdit(t)}`);
  }
  const keep = (args.facts?.features ?? []).slice(0, 12);
  if (keep.length) {
    lines.push("", "Keep all of this working exactly as it does now:");
    for (const f of keep) lines.push(`- ${one(f, 120)}`);
  }
  if (args.lock) {
    lines.push(
      "",
      `This site has a locked direction, picked on ${one(args.lock.page, 60)} ("${one(args.lock.label, 40)}"): ${cleanEdit(args.lock.instruction)}. Build this page in it too.`,
    );
  }
  if (args.designFile || args.siteFile) {
    lines.push("", "Read before building — measured from the live site:");
    if (args.designFile) lines.push(`- design system: ${args.designFile}`);
    if (args.siteFile) lines.push(`- every page and what must keep working: ${args.siteFile}`);
  }
  lines.push(
    "",
    "Change only what the mockup changes; everything else on the page stays as it is.",
    "Before reporting, screenshot the result at desktop width and at 390 px and compare it with the picked mockup.",
  );
  return lines.join("\n");
}

/**
 * Several edits as the one request the lanes answer. Every surface joins them
 * the same way, so a pick made in Client Review can be recognised later as
 * belonging to the same batch (and an old pick never leaks into a new build).
 */
export function joinEdits(lines: string[]): string {
  return lines
    .map((l) => String(l ?? "").replace(/\s+/g, " ").trim().replace(/[.;\s]+$/, ""))
    .filter(Boolean)
    .join("; ");
}

/** Does this pick belong to this request? */
export function pickMatches(pick: EditPick | undefined | null, edit: string): boolean {
  return Boolean(pick) && cleanEdit(pick!.edit).toLowerCase() === cleanEdit(edit).toLowerCase();
}

/**
 * A pick sent by a browser, checked on the server (checklist S4): a known
 * lane, plain strings, bounded lengths. Null when it isn't one.
 */
export function cleanPick(raw: unknown): EditPick | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const lane = o.lane;
  if (lane !== "faithful" && lane !== "polished" && lane !== "bold") return null;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const edit = str(o.edit, 1200);
  const instruction = str(o.instruction, 1200);
  if (!edit || !instruction) return null;
  const tweaks = Array.isArray(o.tweaks) ? o.tweaks.map((t) => str(t, 300)).filter(Boolean).slice(0, 6) : [];
  return { lane, label: str(o.label, 40) || LANES[lane].label, edit, instruction, tweaks };
}

/**
 * A site's name from its address, when nobody gave one:
 * "https://bloom-florist.co.uk" → "Bloom Florist". The chat command and the
 * Redesigner both name a site this way, which keeps their prompts — and so
 * the drawer's cached pictures — identical.
 */
export function nameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return "This site";
    const base = host.split(".")[0] ?? host;
    return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "This site";
  }
}

// ----- readings written by a model that looked at the page ------------------
// Measured on the owner's PC: generic readings ("a bold new composition")
// painted three near-identical pictures, because Flux holds the screenshot
// tightly and only moves what it is told about in concrete visual words. A
// reading that names the page's own elements, positions and colours moved the
// layout for real. So when nobody (Claude in chat) has written the readings,
// the hub asks its vision model to — looking at the same screenshot Flux will
// paint onto.

/** The instructions for the model that writes the three readings. */
export const READINGS_SYSTEM = `You write three readings of one requested website change. Each reading is an instruction for an image-editing model (Flux 2) that repaints a screenshot of the page, so it must be CONCRETE and VISUAL.

Rules:
- Look at the screenshot. Name real elements by what they say or where they are ("the headline 'Financial infrastructure…'", "the purple Get started button", "the logo strip under the hero"). Never invent sections that aren't there.
- Say exactly how things change: layout and position, sizes, colours as hex, type weight, spacing, shapes.
- Never rewrite the page's words unless the change asks for it. Quote only text that is on the page.
- One sentence each, at most 60 words. No "improve", "modernise" or "make it pop" without saying what that means visually.
- Reading 1 "faithful": exactly what was asked, in the site's existing style.
- Reading 2 "polished": what was asked, plus two or three specific premium refinements to the same section.
- Reading 3 "bold": what was asked, as a clearly different composition of that section (say the new layout).
- Each gets a 1-3 word label naming its idea ("Navy hero", "Glass card hero", "Centred orb").
- When a page outline is given, use it: it lists the page's real sections top to bottom, the colours and fonts the browser rendered, and what must keep working. Never drop a form, nav link or button it lists. When it names a LOCKED DIRECTION, all three readings stay inside that direction and differ only in how they apply it.

Reply with JSON only: {"lanes":[{"label":"","instruction":""},{"label":"","instruction":""},{"label":"","instruction":""}]}`;

/** The user turn for that model: the request, the site, and what the page says. */
export function readingsUser(args: { edit: string; siteName: string; url?: string; pageText?: string; outline?: string }): string {
  return [
    `Site: ${one(args.siteName, 60)}${args.url ? ` (${args.url})` : ""}`,
    `Requested change: ${cleanEdit(args.edit)}`,
    args.outline ? `Page outline, read from the rendered page:\n${String(args.outline).slice(0, 2500)}` : "",
    args.pageText ? `Text on the page (for reference, top to bottom):\n${String(args.pageText).slice(0, 2500)}` : "",
    "The screenshot of the page as it is now is attached.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The model's answer, checked: exactly three usable lanes, or null. */
export function coerceReadings(raw: unknown): CustomLane[] | null {
  const lanes = (raw as { lanes?: unknown } | null)?.lanes;
  if (!Array.isArray(lanes)) return null;
  const out: CustomLane[] = [];
  for (const l of lanes.slice(0, 3)) {
    const o = (l ?? {}) as Record<string, unknown>;
    const instruction = typeof o.instruction === "string" ? cleanEdit(o.instruction).slice(0, 520) : "";
    const label = typeof o.label === "string" ? one(o.label, 32) : "";
    if (instruction.length < 12) return null;
    out.push({ label, instruction });
  }
  return out.length === 3 ? out : null;
}
