// ---------------------------------------------------------------------------
// STD Safe — reading a lab report.
//
// Pure string work, no node: imports, so the check script can exercise it
// directly. Whoever calls this has already turned a PDF into text.
//
// This parser is deliberately conservative. Everything it produces lands on a
// review screen where the user confirms each row before anything is saved, so
// the failure mode to avoid is not "missed a result" — that is visible and
// fixable — but "confidently wrote down the wrong result", which someone would
// scroll past. When a line is not clearly readable it goes to `ambiguous`
// rather than being guessed at.
//
// The single biggest trap in real reports is the reference range. Every result
// line on a Quest or LabCorp report carries an expected value beside it:
//
//     HIV-1/2 Ag/Ab, 4th Gen        NON REACTIVE     Reference Range: Non Reactive
//     Hepatitis B Surface Ag        REACTIVE   (H)   Reference Range: Non Reactive
//
// Read the whole line and both come out "non reactive" — including the one that
// is actually positive. So the range is cut off before the outcome is read.
// ---------------------------------------------------------------------------

import { INFECTIONS, type InfectionId, type Outcome, type Result } from "./types";

export type DraftSource = "pdf" | "vision" | "manual";

export interface ParsedDraft {
  lab: string;
  panelName: string;
  /** ISO date, or "" when the report did not state one we could read. */
  collectedAt: string;
  reportedAt?: string;
  results: Result[];
  /** Lines that named a test but whose outcome could not be read. Shown to the user. */
  ambiguous: string[];
  source: DraftSource;
}

// ----- labs ----------------------------------------------------------------

const LAB_SIGNATURES: [RegExp, string][] = [
  [/stdcheck|std check/i, "STDcheck.com"],
  [/quest\s*diagnostics|questdiagnostics/i, "Quest Diagnostics"],
  [/labcorp|laboratory corporation of america/i, "Labcorp"],
  [/mychart|epic systems/i, "MyChart"],
  [/planned parenthood/i, "Planned Parenthood"],
  [/sonora quest/i, "Sonora Quest"],
  [/bioreference|bio-reference/i, "BioReference"],
  [/health ?labs|healthlabs/i, "HealthLabs"],
];

function detectLab(text: string): string {
  for (const [pattern, name] of LAB_SIGNATURES) if (pattern.test(text)) return name;
  return "";
}

const PANEL_PATTERNS: RegExp[] = [
  /\b((?:comprehensive|complete|standard|basic|expanded|full|premium|10[- ]test|8[- ]test)[\w ]*panel)\b/i,
  /\b(std panel|sti panel|sexual health panel|hiv panel)\b/i,
];

function detectPanel(text: string): string {
  for (const pattern of PANEL_PATTERNS) {
    const hit = text.match(pattern);
    if (hit) return titleCase(hit[1].trim());
  }
  return "";
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

// ----- dates ---------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Read one date out of a fragment.
 *
 * US month-first is assumed for numeric dates, because every lab in
 * LAB_SIGNATURES is American. That assumption is wrong for a report from
 * anywhere else, which is exactly why the collection date is an editable field
 * on the review screen rather than a silent one.
 */
export function toIsoDate(fragment: string): string {
  const iso = fragment.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const named = fragment.match(/\b(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{4})\b/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) return `${named[3]}-${pad(month)}-${pad(Number(named[1]))}`;
  }

  const monthFirst = fragment.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].slice(0, 3).toLowerCase()];
    if (month) return `${monthFirst[3]}-${pad(month)}-${pad(Number(monthFirst[2]))}`;
  }

  const numeric = fragment.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (numeric) {
    const year = Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    return `${year}-${pad(Number(numeric[1]))}-${pad(Number(numeric[2]))}`;
  }

  return "";
}

const COLLECTED_LABELS =
  /(collect(?:ed|ion)?(?:\s*date)?|specimen\s*(?:collected|date)|date\s*(?:of\s*)?(?:service|drawn)|drawn|sample\s*date)\s*[:\-]?\s*/i;
const REPORTED_LABELS =
  /(report(?:ed)?(?:\s*date)?|result(?:ed|s)?\s*date|released|final\s*report)\s*[:\-]?\s*/i;

function findLabelledDate(lines: string[], label: RegExp): string {
  for (let i = 0; i < lines.length; i++) {
    if (!label.test(lines[i])) continue;
    const after = lines[i].slice(lines[i].search(label));
    const here = toIsoDate(after);
    if (here) return here;
    // Labs routinely put the label on one line and the value on the next.
    if (i + 1 < lines.length) {
      const next = toIsoDate(lines[i + 1]);
      if (next) return next;
    }
  }
  return "";
}

// ----- outcomes ------------------------------------------------------------

const NEGATIVE = /\b(negative|non[\s-]?reactive|nonreactive|not\s*detected|undetected|no[\s-]?growth|absent|nr\b)/i;
const POSITIVE = /\b(positive|reactive|detected|abnormal|present|repeatedly\s*reactive)\b/i;
const INDETERMINATE = /\b(equivocal|indeterminate|borderline|inconclusive|invalid|insufficient|pending|not\s*performed|cancel+ed|qns)\b/i;

/**
 * Everything from the reference range onward is what the result SHOULD be, not
 * what it was. Cut it off before reading an outcome — see the header comment.
 */
const RANGE_MARKER = /(reference\s*(range|interval)|ref\.?\s*range|expected\s*(value|result)|normal\s*range|\bnormal:\s)/i;

function stripRange(line: string): string {
  const at = line.search(RANGE_MARKER);
  return at === -1 ? line : line.slice(0, at);
}

export function outcomeFrom(segment: string): { outcome: Outcome; value: string } | null {
  const text = stripRange(segment);
  // Indeterminate is tested first: "equivocal" reports often also print the
  // reference word "negative" in the same cell.
  const indet = text.match(INDETERMINATE);
  if (indet) return { outcome: "indeterminate", value: titleCase(indet[0]) };
  const neg = text.match(NEGATIVE);
  const pos = text.match(POSITIVE);
  // "non-reactive" contains "reactive", so a negative match that starts at or
  // before the positive match wins.
  if (neg && (!pos || neg.index! <= pos.index!)) return { outcome: "negative", value: titleCase(neg[0]) };
  if (pos) return { outcome: "positive", value: titleCase(pos[0]) };
  return null;
}

// ----- infections on a line ------------------------------------------------

/** Every infection named in a line, with where the last mention ends. */
function infectionsOn(line: string): { ids: InfectionId[]; endsAt: number } {
  const lower = line.toLowerCase();
  const ids: InfectionId[] = [];
  let endsAt = 0;
  for (const infection of INFECTIONS) {
    for (const term of infection.aka) {
      const at = lower.indexOf(term);
      if (at === -1) continue;
      if (!ids.includes(infection.id)) ids.push(infection.id);
      endsAt = Math.max(endsAt, at + term.length);
      break;
    }
  }
  // "CT/NG" and "Chlamydia/Gonorrhea RNA" are one line covering two infections.
  if (/\bct\s*\/\s*ng\b|\bng\s*\/\s*ct\b/i.test(line)) {
    for (const id of ["chlamydia", "gonorrhea"] as InfectionId[]) if (!ids.includes(id)) ids.push(id);
  }
  // "Herpes Simplex Virus 1 and 2, IgG" — one line, both types.
  if (/herpes.*\b1\s*(and|&|\/|,)\s*2\b|hsv.*\b1\s*(and|&|\/)\s*2\b/i.test(line)) {
    for (const id of ["hsv1", "hsv2"] as InfectionId[]) if (!ids.includes(id)) ids.push(id);
  }
  return { ids, endsAt };
}

// ----- the parser ----------------------------------------------------------

export function parseReport(rawText: string, source: DraftSource = "pdf"): ParsedDraft {
  const text = rawText.replace(/\r/g, "");
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const results: Result[] = [];
  const ambiguous: string[] = [];
  const claimed = new Set<InfectionId>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const { ids, endsAt } = infectionsOn(line);
    if (!ids.length) continue;

    // Read only what follows the test name. A line that begins "Negative for
    // HIV..." is prose, not a result row, and reading the whole line would let
    // the leading word decide the answer.
    let found = outcomeFrom(line.slice(endsAt));

    // Wrapped rows: the value sits on the next line. Only follow it when that
    // line is not itself a different test.
    if (!found && i + 1 < lines.length && !infectionsOn(lines[i + 1]).ids.length) {
      found = outcomeFrom(lines[i + 1]);
    }

    if (!found) {
      ambiguous.push(line);
      continue;
    }

    for (const id of ids) {
      // First reading wins. Later mentions are usually the interpretive
      // footnote ("A negative result does not rule out...").
      if (claimed.has(id)) continue;
      claimed.add(id);
      results.push({ infection: id, outcome: found.outcome, value: found.value });
    }
  }

  const collectedAt = findLabelledDate(lines, COLLECTED_LABELS);
  const reportedAt = findLabelledDate(lines, REPORTED_LABELS);

  return {
    lab: detectLab(text),
    panelName: detectPanel(text),
    // An unlabelled date is not assumed to be the collection date — a report
    // carries a date of birth and a print date too, and picking the wrong one
    // silently would misdate the whole record.
    collectedAt,
    reportedAt: reportedAt && reportedAt !== collectedAt ? reportedAt : undefined,
    results,
    ambiguous: ambiguous.slice(0, 12),
    source,
  };
}

/** An empty draft, for manual entry and for a file we could not read. */
export function emptyDraft(source: DraftSource = "manual"): ParsedDraft {
  return { lab: "", panelName: "", collectedAt: "", results: [], ambiguous: [], source };
}
