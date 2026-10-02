// ---------------------------------------------------------------------------
// What is actually NEW.
//
// The whole point of pointing Jarvis at a screen is "save the things you do not
// already know". A scanner that proposes the owner's own name back to them on
// every single page is noise, and noise is how a confirm step turns into a
// button people click without reading.
//
// So every proposal is judged against the record first:
//
//   new       nothing is stored under that key. Offer it, pre-ticked.
//   same      the record already says this. Hide it behind a count.
//   adds      an entry it already has, gaining a detail. Safe, so pre-ticked.
//   conflict  the record says something DIFFERENT. Show it loudly, and never
//             pre-tick it — overwriting a fact the owner typed deserves a
//             deliberate yes, not a default.
//
// The hard part is "same", and it is the part that decides whether this feature
// is useful or infuriating. `(555) 123-4567` and `5551234567` are one phone
// number. `123 Main St` and `123 Main Street` are one address. `01/02/1990` and
// `1990-01-02` are one date. Compare them naïvely and every scan reports a
// screenful of conflicts, the owner stops reading, and the confirm step is
// worthless.
// ---------------------------------------------------------------------------

import type { EntryProposal, FieldProposal, Proposal } from "./extract";
import { FIELD_BY_KEY, groupById, type FieldDef, type GroupEntry, type LifeRecord } from "./types";

export type Verdict =
  /** Nothing is stored under that key. Offer it, pre-ticked. */
  | "new"
  /** The record already says this. Hide it behind a count. */
  | "same"
  /**
   * An entry the record already has, with a detail it does not.
   *
   * Kept apart from `conflict` deliberately: adding a start date to a job you
   * already have destroys nothing, so calling it a disagreement would make the
   * owner hesitate over something purely additive — and teach them that the
   * word "disagrees" does not mean what it says.
   */
  | "adds"
  /** The record says something DIFFERENT. Needs a deliberate yes. */
  | "conflict";

export interface Review {
  proposal: Proposal;
  verdict: Verdict;
  /** What the record holds now. Only set for a conflict. */
  current?: string;
  /** Ticked by default? New things yes; conflicts and knowns never. */
  chosen: boolean;
  /** For an entry: the id of the entry it matched, so accepting updates rather than duplicates. */
  matchedId?: string;
}

// --- normalising ------------------------------------------------------------

/** Spelled-out street words, so "St" and "Street" stop being two addresses. */
const STREET: Record<string, string> = {
  st: "street",
  str: "street",
  rd: "road",
  ave: "avenue",
  av: "avenue",
  blvd: "boulevard",
  dr: "drive",
  ln: "lane",
  ct: "court",
  pl: "place",
  sq: "square",
  hwy: "highway",
  pkwy: "parkway",
  apt: "apartment",
  ste: "suite",
  fl: "floor",
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
};

/** Digits only. A phone number is its digits; everything else is punctuation. */
function digits(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * A date as `YYYY-MM-DD` when it can be read unambiguously, else the raw text.
 *
 * Deliberately refuses to guess between `03/04/1990` and `04/03/1990`. Calling
 * an ambiguous pair "the same" would silently approve a wrong date of birth,
 * and calling it a conflict merely asks the owner — which is the right way round.
 */
export function normaliseDate(value: string): string {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    // Only when one of the two cannot be a month is the order certain.
    if (a > 12 && b <= 12) return `${slash[3]}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
    if (b > 12 && a <= 12) return `${slash[3]}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
    return text.toLowerCase();
  }

  const named = /^(\d{1,2})\s+([a-z]{3,})\s+(\d{4})$/i.exec(text);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  if (named) {
    const m = months.indexOf(named[2].slice(0, 3).toLowerCase());
    if (m >= 0) return `${named[3]}-${String(m + 1).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
  }
  const namedFirst = /^([a-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/i.exec(text);
  if (namedFirst) {
    const m = months.indexOf(namedFirst[1].slice(0, 3).toLowerCase());
    if (m >= 0) return `${namedFirst[3]}-${String(m + 1).padStart(2, "0")}-${namedFirst[2].padStart(2, "0")}`;
  }

  return text.toLowerCase();
}

/** `$1,240.00` and `1240` are one amount. A trailing `.00` is not a difference. */
export function normaliseMoney(value: string): string {
  const n = Number(value.replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : value.trim().toLowerCase();
}

/** Lower-case, collapse whitespace, drop edge punctuation, expand street words. */
export function normaliseText(value: string): string {
  const words = value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => STREET[w] ?? w);
  return words.join(" ");
}

/** The comparison form of a value, by what kind of field it is. */
export function normalise(value: string, def?: FieldDef): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  switch (def?.type) {
    case "phone":
      // Compared on the last ten digits, so a country code or a leading 1 is
      // not a different number.
      return digits(text).slice(-10);
    case "date":
      return normaliseDate(text);
    case "money":
      return normaliseMoney(text);
    case "email":
      return text.toLowerCase();
    case "choice":
      return text.toLowerCase();
    default:
      return normaliseText(text);
  }
}

/** True when two values mean the same thing for this field. */
export function sameValue(a: string, b: string, def?: FieldDef): boolean {
  const left = normalise(a, def);
  const right = normalise(b, def);
  if (!left || !right) return false;
  if (left === right) return true;
  // A government number is compared on its digits whatever its punctuation.
  if (def?.sensitive && digits(a) && digits(a) === digits(b)) return true;
  return false;
}

// --- entries ----------------------------------------------------------------

/**
 * Which fields decide that two entries are the same thing.
 *
 * A job is the same job if it is the same employer and title, whatever else
 * changed — otherwise re-scanning a résumé adds a second copy of every job the
 * owner already has, which is the single most annoying failure this feature
 * could have.
 */
const ENTRY_IDENTITY: Record<string, string[]> = {
  jobs: ["employer", "title"],
  household_members: ["name"],
  education: ["school"],
  references: ["name"],
  income_other: ["kind", "whose"],
  documents: ["kind"],
};

/** The existing entry a proposed one refers to, or null when it is new. */
export function matchEntry(groupId: string, values: Record<string, string>, existing: GroupEntry[]): GroupEntry | null {
  const keys = ENTRY_IDENTITY[groupId];
  const group = groupById(groupId);
  if (!keys || !group) return null;

  for (const entry of existing) {
    let matched = 0;
    let compared = 0;
    for (const key of keys) {
      const proposed = values[key];
      const held = entry.values[key];
      if (!proposed || !held) continue;
      compared += 1;
      const def = group.fields.find((f) => f.key === key);
      if (sameValue(proposed, held, def)) matched += 1;
    }
    if (compared > 0 && matched === compared) return entry;
  }
  return null;
}

/**
 * How a proposed entry relates to one the record already holds.
 *
 *   same      every value it carries is already there, equivalently written
 *   adds      it carries something extra, and contradicts nothing
 *   conflict  it contradicts a value the entry already has
 *
 * The distinction between the last two is the whole reason this is not a
 * boolean: one is free, and one destroys something.
 */
export function compareEntry(
  groupId: string,
  values: Record<string, string>,
  entry: GroupEntry,
): "same" | "adds" | "conflict" {
  const group = groupById(groupId);
  let extra = false;
  for (const [key, value] of Object.entries(values)) {
    if (!value?.trim()) continue;
    const held = entry.values[key];
    if (!held?.trim()) {
      extra = true;
      continue;
    }
    const def = group?.fields.find((f) => f.key === key);
    if (!sameValue(value, held, def)) return "conflict";
  }
  return extra ? "adds" : "same";
}

// --- the review -------------------------------------------------------------

/**
 * Judge every proposal against the record.
 *
 * Order is deliberate: conflicts first, because they are the ones that need a
 * decision; then new values; then the things it already knew, which are only
 * kept at all so the count can be shown honestly.
 */
export function review(proposals: Proposal[], record: LifeRecord): Review[] {
  const out: Review[] = [];

  for (const proposal of proposals) {
    if (proposal.kind === "field") {
      out.push(reviewField(proposal, record));
    } else {
      out.push(reviewEntry(proposal, record));
    }
  }

  // Worst first: the one needing a decision, then the two that are safe to
  // accept, then the ones kept only so the count can be stated.
  const rank: Record<Verdict, number> = { conflict: 0, new: 1, adds: 2, same: 3 };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict]);
}

function reviewField(proposal: FieldProposal, record: LifeRecord): Review {
  const def = FIELD_BY_KEY.get(proposal.key)?.field;
  const held = record.fields[proposal.key]?.value ?? "";

  if (!held.trim()) return { proposal, verdict: "new", chosen: true };
  if (sameValue(proposal.value, held, def)) return { proposal, verdict: "same", chosen: false };
  // Never pre-ticked. Overwriting something the owner typed is a decision.
  return { proposal, verdict: "conflict", current: held, chosen: false };
}

function reviewEntry(proposal: EntryProposal, record: LifeRecord): Review {
  const existing = record.groups[proposal.group] ?? [];
  const match = matchEntry(proposal.group, proposal.values, existing);

  if (!match) return { proposal, verdict: "new", chosen: true };

  const how = compareEntry(proposal.group, proposal.values, match);
  if (how === "same") return { proposal, verdict: "same", chosen: false, matchedId: match.id };
  if (how === "adds") {
    // Purely additive — a job it has, with a start date it does not. Nothing
    // is lost by accepting it, so it is pre-ticked like anything else new.
    return { proposal, verdict: "adds", chosen: true, matchedId: match.id, current: describeEntry(match) };
  }
  return { proposal, verdict: "conflict", chosen: false, matchedId: match.id, current: describeEntry(match) };
}

/** A one-line description of an existing entry, for the conflict row. */
export function describeEntry(entry: GroupEntry): string {
  return Object.values(entry.values).filter(Boolean).slice(0, 3).join(" · ");
}

// --- summary ----------------------------------------------------------------

export interface ReviewSummary {
  fresh: number;
  /** Entries it already has, gaining a detail. */
  additions: number;
  conflicts: number;
  known: number;
  /** Everything worth the owner's attention. */
  toShow: Review[];
  /** What it already knew, kept only so the count can be stated. */
  hidden: Review[];
}

export function summarise(reviews: Review[]): ReviewSummary {
  const toShow = reviews.filter((r) => r.verdict !== "same");
  const hidden = reviews.filter((r) => r.verdict === "same");
  return {
    fresh: reviews.filter((r) => r.verdict === "new").length,
    additions: reviews.filter((r) => r.verdict === "adds").length,
    conflicts: reviews.filter((r) => r.verdict === "conflict").length,
    known: hidden.length,
    toShow,
    hidden,
  };
}

/** One honest sentence for the top of the sheet. */
export function describeReview(summary: ReviewSummary): string {
  const { fresh, additions, conflicts, known } = summary;
  if (!fresh && !conflicts && !additions) {
    return known
      ? `Nothing new — it already knew all ${known} of the things on that screen.`
      : "Nothing on that screen matched anything it keeps.";
  }
  const parts: string[] = [];
  if (fresh) parts.push(`${fresh} new`);
  if (additions) parts.push(`${additions} filling in something it half had`);
  if (conflicts) parts.push(`${conflicts} that ${conflicts === 1 ? "disagrees" : "disagree"} with what it has`);
  let line = parts.join(", ");
  if (known) line += `. It already knew ${known} other${known === 1 ? "" : "s"}`;
  return `${line}.`;
}
