// ---------------------------------------------------------------------------
// STD Safe — deriving a status from records.
//
// Pure and client-safe on purpose. The owner's own card, the preview shown
// before approving a request, and the view the other person finally sees all
// call this same function. If they each derived their own verdict, the preview
// could promise something the shared page did not show.
//
// The central decision: status is per infection, not per record. Someone may
// have had HIV drawn two weeks ago and syphilis six months ago. Rolling those
// into one date and one badge hides exactly the thing the other person needs.
// ---------------------------------------------------------------------------

import {
  AGING_DAYS,
  FRESH_DAYS,
  INFECTIONS,
  type InfectionId,
  type Outcome,
  type TestRecord,
  type TreatmentContext,
  type Verification,
} from "./types";

export type FreshnessTier = "fresh" | "aging" | "stale";

export interface InfectionStatus {
  infection: InfectionId;
  tested: boolean;
  outcome?: Outcome;
  context?: TreatmentContext;
  /** ISO date of the sample behind this row. */
  collectedAt?: string;
  ageDays?: number;
  tier?: FreshnessTier;
  verification?: Verification;
  lab?: string;
  value?: string;
}

export type Verdict = "no-records" | "all-negative" | "positive" | "indeterminate";

export interface DerivedStatus {
  rows: InfectionStatus[];
  testedCount: number;
  totalCount: number;
  positives: InfectionStatus[];
  indeterminate: InfectionStatus[];
  untested: InfectionStatus[];
  verdict: Verdict;
  /** The headline sentence. Always carries coverage — never a bare verdict. */
  headline: string;
  /** Worst tier among tested rows; null when nothing has been tested. */
  tier: FreshnessTier | null;
  newestCollectedAt: string | null;
  oldestCollectedAt: string | null;
  /** True when at least one row is backed by a lab document. */
  anyDocument: boolean;
  /** True when every tested row is backed by a lab document. */
  allDocument: boolean;
}

export function daysSince(iso: string, now = Date.now()): number {
  const t = Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/**
 * Format a YYYY-MM-DD without letting the timezone move it.
 *
 * The shared formatDate() parses a date-only string as UTC midnight and then
 * prints it in local time, so west of Greenwich every collection date renders
 * a day early. That is the one field this whole app hangs on, so these are
 * built from the calendar parts directly and never round-tripped through UTC.
 */
export function formatDay(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const date = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function tierFor(ageDays: number): FreshnessTier {
  if (ageDays <= FRESH_DAYS) return "fresh";
  if (ageDays <= AGING_DAYS) return "aging";
  return "stale";
}

export const TIER_LABELS: Record<FreshnessTier, string> = {
  fresh: "Fresh",
  aging: "Aging",
  stale: "Stale",
};

export const TIER_NOTES: Record<FreshnessTier, string> = {
  fresh: `Sample taken within the last ${FRESH_DAYS} days.`,
  aging: `Sample is ${FRESH_DAYS + 1}–${AGING_DAYS} days old.`,
  stale: `Sample is over ${AGING_DAYS} days old.`,
};

const TIER_RANK: Record<FreshnessTier, number> = { fresh: 0, aging: 1, stale: 2 };

/**
 * Pick the record that speaks for one infection: the newest collection date
 * that actually tested it.
 *
 * Ties break toward a positive. Two samples drawn the same day where one found
 * something is not a coin flip — the finding wins.
 */
function latestFor(records: TestRecord[], id: InfectionId): { record: TestRecord; outcome: Outcome; context?: TreatmentContext; value?: string } | null {
  let best: { record: TestRecord; outcome: Outcome; context?: TreatmentContext; value?: string } | null = null;
  for (const record of records) {
    const hit = record.results.find((r) => r.infection === id);
    if (!hit) continue;
    if (!best) {
      best = { record, outcome: hit.outcome, context: hit.context, value: hit.value };
      continue;
    }
    const newer = record.collectedAt > best.record.collectedAt;
    const sameDay = record.collectedAt === best.record.collectedAt;
    const outranksOnTie = sameDay && hit.outcome === "positive" && best.outcome !== "positive";
    if (newer || outranksOnTie) {
      best = { record, outcome: hit.outcome, context: hit.context, value: hit.value };
    }
  }
  return best;
}

export function deriveStatus(records: TestRecord[], now = Date.now()): DerivedStatus {
  const rows: InfectionStatus[] = INFECTIONS.map((infection) => {
    const latest = latestFor(records, infection.id);
    if (!latest) return { infection: infection.id, tested: false };
    const ageDays = daysSince(latest.record.collectedAt, now);
    return {
      infection: infection.id,
      tested: true,
      outcome: latest.outcome,
      context: latest.context,
      collectedAt: latest.record.collectedAt,
      ageDays,
      tier: tierFor(ageDays),
      verification: latest.record.verification,
      lab: latest.record.lab,
      value: latest.value,
    };
  });

  const tested = rows.filter((r) => r.tested);
  const positives = tested.filter((r) => r.outcome === "positive");
  const indeterminate = tested.filter((r) => r.outcome === "indeterminate");
  const untested = rows.filter((r) => !r.tested);

  const dates = tested.map((r) => r.collectedAt!).sort();
  const tier = tested.length
    ? tested.map((r) => r.tier!).reduce((worst, t) => (TIER_RANK[t] > TIER_RANK[worst] ? t : worst), "fresh" as FreshnessTier)
    : null;

  let verdict: Verdict;
  if (!tested.length) verdict = "no-records";
  else if (positives.length) verdict = "positive";
  else if (indeterminate.length) verdict = "indeterminate";
  else verdict = "all-negative";

  return {
    rows,
    testedCount: tested.length,
    totalCount: rows.length,
    positives,
    indeterminate,
    untested,
    verdict,
    headline: headlineFor(verdict, tested.length, rows.length, positives.length),
    tier,
    newestCollectedAt: dates.length ? dates[dates.length - 1] : null,
    oldestCollectedAt: dates.length ? dates[0] : null,
    anyDocument: tested.some((r) => r.verification === "document"),
    allDocument: tested.length > 0 && tested.every((r) => r.verification === "document"),
  };
}

/**
 * The sentence at the top of every card.
 *
 * Coverage is always in it. "All negative" on its own would let a two-test
 * panel read exactly like a full ten-infection workup, which is the specific
 * lie this app exists to avoid telling.
 */
function headlineFor(verdict: Verdict, tested: number, total: number, positives: number): string {
  switch (verdict) {
    case "no-records":
      return "No results on file";
    case "positive":
      return `${positives} positive of ${tested} tested`;
    case "indeterminate":
      return `Inconclusive result — ${tested} of ${total} tested`;
    default:
      return `All negative on ${tested} of ${total}`;
  }
}

/** The caveat that rides along with every shared view, in one place. */
export const STANDING_CAVEATS = [
  "A result only speaks to exposure before its collection date — never to anything since.",
  "A report on file proves a document exists, not that the document is authentic.",
  "Window periods vary: some infections are undetectable for weeks after exposure.",
];
