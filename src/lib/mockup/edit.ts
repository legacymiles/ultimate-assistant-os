// ---------------------------------------------------------------------------
// Edit mockups — three takes on ONE change, made on the page as it is.
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
// Every lane is written by Claude as a real HTML page (coded.ts) that
// recreates the live page from its markup and screenshot, with only the
// asked-for part changed. Until 18 Nov 2026 they were Flux 2 paintings.
//
// No imports on purpose. The chat command (tools/mockup-edit) runs this file
// with Node's own TypeScript support, so the hub and the chat share the lane
// names, the briefs and the pick checks.
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

const LANES: Record<EditLaneId, { label: string; note: string }> = {
  faithful: {
    label: "As asked",
    note: "Exactly the change you asked for, in the site's own style.",
  },
  polished: {
    label: "Polished",
    note: "Your change, and the part it touches brought up to a premium finish.",
  },
  bold: {
    label: "Bold",
    note: "A braver take on the same change, for contrast.",
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

/** One short sentence of the site's colours and type. */
export function factsLine(facts?: SiteFacts): string {
  if (!facts) return "";
  const bits: string[] = [];
  const colors = (facts.colors ?? []).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)).slice(0, 4);
  if (colors.length) bits.push(`brand colours ${colors.join(", ")}`);
  const fonts = (facts.fonts ?? []).map((f) => one(f, 24)).filter(Boolean).slice(0, 2);
  if (fonts.length) bits.push(`typeface ${fonts.join(" and ")}`);
  return bits.length ? `The site uses ${bits.join("; ")}.` : "";
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
  // Each reading names what it actually changes: "refined to match" made
  // almost the same mockup as the faithful lane.
  if (lane === "polished") {
    return `${edit}; then give that section a premium finish — more generous spacing, a larger and tighter headline, refined buttons and one tasteful detail such as a soft glow, a glass card or hairline accents`;
  }
  return `${edit}, as a bold new composition for that section — for example a centred oversized headline over a large striking visual, stronger contrast and a clear focal point`;
}

/** The three lanes for one request. `custom` replaces a lane's reading, by position. */
export function editLanes(edit: string, custom: (CustomLane | undefined | null)[] = []): EditLane[] {
  const asked = cleanEdit(edit) || "Tidy this page";
  return EDIT_LANE_IDS.map((id, i) => {
    const own = custom[i];
    const instruction = own?.instruction?.trim() ? cleanEdit(own.instruction) : defaultInstruction(asked, id);
    return {
      id,
      label: own?.label?.trim() ? one(own.label, 32) : LANES[id].label,
      note: own?.instruction?.trim() ? one(own.instruction, 140) : LANES[id].note,
      instruction,
    };
  });
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
  /** The direction locked for the whole site, when this page was mocked up in it. */
  lock?: { label: string; instruction: string; page: string };
}): string {
  const { pick } = args;
  const lines = [
    `Website edit — ${one(args.siteName, 60)}${args.url ? ` (${args.url})` : ""}`,
    "",
    `The owner was shown three coded mockups of this change (real HTML pages written by Claude) and picked "${pick.label}".`,
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
 * Redesigner both name a site this way, so their mockups match.
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
