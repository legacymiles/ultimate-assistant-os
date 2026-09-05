// ---------------------------------------------------------------------------
// STD Safe — checks for the two pure modules.
//
// There is no test framework in this repo, so this runs the parser and the
// status derivation against fixture report text and asserts what they produce.
// Both are pure, so they can be exercised without a server or a browser.
//
//   node scripts/std-safe-check.mjs
//
// The fixtures are written to look like the real thing in the ways that break
// naive parsers: reference ranges printed beside every result, wrapped rows,
// combined CT/NG lines, and an interpretive footnote at the bottom containing
// the word "negative".
// ---------------------------------------------------------------------------

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-loader.mjs", pathToFileURL("./scripts/"));

const { parseReport, toIsoDate, outcomeFrom } = await import("../src/lib/stdsafe/parse.ts");
const { deriveStatus, tierFor, formatDay, daysSince } = await import("../src/lib/stdsafe/status.ts");

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
  }
}

function outcomeOf(draft, infection) {
  return draft.results.find((r) => r.infection === infection)?.outcome ?? "absent";
}

// ---------------------------------------------------------------------------

const QUEST = `
Quest Diagnostics Incorporated
Patient: DOE, JANE          DOB: 03/14/1994
Specimen Collected: 08/12/2026 09:41
Reported Date: 08/14/2026

TEST NAME                              RESULT           REFERENCE RANGE
HIV-1/2 Ag/Ab, 4th Generation          NON REACTIVE     Reference Range: Non Reactive
RPR (Syphilis), Qualitative            NON REACTIVE     Reference Range: Non Reactive
Hepatitis B Surface Ag                 REACTIVE (H)     Reference Range: Non Reactive
Hepatitis C Antibody                   NON REACTIVE     Reference Range: Non Reactive
Chlamydia trachomatis RNA, TMA         NOT DETECTED     Reference Range: Not Detected
Neisseria gonorrhoeae RNA, TMA         NOT DETECTED     Reference Range: Not Detected

Note: A negative result does not rule out infection during the window period.
`;

console.log("\nQuest-style report, reference ranges on every row");
const quest = parseReport(QUEST);
check("collection date, not the DOB or report date", quest.collectedAt, "2026-08-12");
check("report date kept separately", quest.reportedAt, "2026-08-14");
check("lab detected", quest.lab, "Quest Diagnostics");
check("HIV non-reactive reads negative", outcomeOf(quest, "hiv"), "negative");
check("syphilis non-reactive reads negative", outcomeOf(quest, "syphilis"), "negative");
// The row that catches naive parsers: its reference range says "Non Reactive".
check("REACTIVE hep B is positive, not its range", outcomeOf(quest, "hepb"), "positive");
check("hep C non-reactive reads negative", outcomeOf(quest, "hepc"), "negative");
check("chlamydia not detected reads negative", outcomeOf(quest, "chlamydia"), "negative");
check("gonorrhea not detected reads negative", outcomeOf(quest, "gonorrhea"), "negative");
check("six tests found, footnote did not add an eleventh", quest.results.length, 6);
check("untested infections are simply absent", outcomeOf(quest, "hsv2"), "absent");

// ---------------------------------------------------------------------------

const STDCHECK = `
STDcheck.com — 10 Test Panel
Date of Service: Jul 3, 2026

HIV (1 & 2) Antibody
    Negative
Herpes Simplex Virus 1 and 2, IgG
    Negative
CT/NG Amplification
    Negative
Trichomonas vaginalis
    Positive
Mycoplasma genitalium
    Equivocal
Syphilis (RPR)
    Negative
Hepatitis B
    Negative
Hepatitis C
    Negative
`;

console.log("\nSTDcheck-style report, results wrapped onto the next line");
const std = parseReport(STDCHECK);
check("month-name date", std.collectedAt, "2026-07-03");
check("lab detected", std.lab, "STDcheck.com");
check("panel detected", std.panelName, "10 Test Panel");
check("wrapped value is read", outcomeOf(std, "hiv"), "negative");
check("combined HSV line covers HSV-1", outcomeOf(std, "hsv1"), "negative");
check("combined HSV line covers HSV-2", outcomeOf(std, "hsv2"), "negative");
check("CT/NG covers chlamydia", outcomeOf(std, "chlamydia"), "negative");
check("CT/NG covers gonorrhea", outcomeOf(std, "gonorrhea"), "negative");
check("positive is read as positive", outcomeOf(std, "trich"), "positive");
check("equivocal is indeterminate, not negative", outcomeOf(std, "mgen"), "indeterminate");
check("all ten covered", std.results.length, 10);

// ---------------------------------------------------------------------------

console.log("\nUnreadable input");
const blank = parseReport("");
check("empty text yields no results", blank.results.length, 0);
check("empty text yields no date rather than today", blank.collectedAt, "");

const noOutcome = parseReport("Chlamydia trachomatis, TMA\nSpecimen quality acceptable\n");
check("a named test with no readable result is not guessed", noOutcome.results.length, 0);
check("...it is surfaced as ambiguous instead", noOutcome.ambiguous.length, 1);

// Only the text AFTER the test name decides the outcome. A sentence that leads
// with the word is prose, not a result row, and reading it would let a footnote
// ("a negative result does not rule out...") answer for a test.
const prose = parseReport("Collected: 2026-01-05\nPatient tested negative for gonorrhea today.");
check("a result word before the test name does not decide it", outcomeOf(prose, "gonorrhea"), "absent");
check("...the line is surfaced for the user instead", prose.ambiguous.length, 1);
check("a labelled date is still read from prose", prose.collectedAt, "2026-01-05");

console.log("\nDate and outcome primitives");
check("US numeric date is month-first", toIsoDate("08/12/2026"), "2026-08-12");
check("ISO passes through", toIsoDate("2026-08-12"), "2026-08-12");
check("day-month-year with a name", toIsoDate("12-Aug-2026"), "2026-08-12");
check("two-digit year", toIsoDate("3/9/26"), "2026-03-09");
check("no date is empty, never today", toIsoDate("no date here"), "");
check("non-reactive beats the reactive inside it", outcomeFrom("NON REACTIVE")?.outcome, "negative");
check("bare reactive is positive", outcomeFrom("REACTIVE")?.outcome, "positive");
check("range is cut before reading", outcomeFrom("REACTIVE Reference Range: Non Reactive")?.outcome, "positive");
check("nothing readable returns null", outcomeFrom("see attached"), null);

// ---------------------------------------------------------------------------

console.log("\nStatus derivation");
const DAY = 86_400_000;
const now = Date.parse("2026-08-31T12:00:00Z");
const iso = (daysAgo) => new Date(now - daysAgo * DAY).toISOString().slice(0, 10);

const partial = deriveStatus(
  [
    {
      id: "r1",
      userId: "u1",
      collectedAt: iso(10),
      lab: "Quest",
      panelName: "Basic",
      verification: "document",
      results: [
        { infection: "hiv", outcome: "negative" },
        { infection: "chlamydia", outcome: "negative" },
      ],
      createdAt: "",
    },
  ],
  now,
);
check("coverage is in the headline", partial.headline, "All negative on 2 of 10");
check("eight rows remain untested", partial.untested.length, 8);
check("all ten rows still render", partial.rows.length, 10);
check("recent sample is fresh", partial.tier, "fresh");
check("backed by a document", partial.allDocument, true);

const mixed = deriveStatus(
  [
    {
      id: "r1",
      userId: "u1",
      collectedAt: iso(200),
      lab: "Labcorp",
      panelName: "Full",
      verification: "self",
      results: [
        { infection: "hiv", outcome: "negative" },
        { infection: "syphilis", outcome: "negative" },
      ],
      createdAt: "",
    },
    {
      id: "r2",
      userId: "u1",
      collectedAt: iso(5),
      lab: "Quest",
      panelName: "Recheck",
      verification: "document",
      results: [{ infection: "hiv", outcome: "positive", context: "managed-undetectable" }],
      createdAt: "",
    },
  ],
  now,
);
// The point of per-infection derivation: one stale row and one fresh row.
check("newer record wins for HIV", mixed.rows.find((r) => r.infection === "hiv").outcome, "positive");
check("HIV row is fresh", mixed.rows.find((r) => r.infection === "hiv").tier, "fresh");
check("syphilis row is still stale", mixed.rows.find((r) => r.infection === "syphilis").tier, "stale");
check("overall tier is the worst row", mixed.tier, "stale");
check("treatment context is carried", mixed.positives[0].context, "managed-undetectable");
check("headline counts positives", mixed.headline, "1 positive of 2 tested");
check("mixed provenance is not all-document", mixed.allDocument, false);
check("...but is some-document", mixed.anyDocument, true);

const sameDay = deriveStatus(
  [
    {
      id: "a", userId: "u1", collectedAt: iso(3), lab: "A", panelName: "P", verification: "self",
      results: [{ infection: "trich", outcome: "negative" }], createdAt: "",
    },
    {
      id: "b", userId: "u1", collectedAt: iso(3), lab: "B", panelName: "P", verification: "self",
      results: [{ infection: "trich", outcome: "positive" }], createdAt: "",
    },
  ],
  now,
);
check("a same-day positive outranks a negative", sameDay.rows.find((r) => r.infection === "trich").outcome, "positive");

const empty = deriveStatus([], now);
check("no records says so", empty.headline, "No results on file");
check("no records has no tier", empty.tier, null);

// The shared formatDate() reads a date-only string as UTC midnight and prints
// it locally, so west of Greenwich every collection date came out a day early.
console.log("\nDates render as the day they say");
check("a date-only string keeps its day", formatDay("2026-08-12").includes("12"), true);
check("...and does not slip to the day before", formatDay("2026-08-12").includes("11"), false);
check("first of the month does not slip a month", formatDay("2026-03-01").includes("Mar"), true);
check("a garbage date renders as nothing, not as today", formatDay("not a date"), "");
check("age is measured from the sample date", daysSince("2026-08-12", Date.parse("2026-08-31T12:00:00Z")), 19);

check("30 days is still fresh", tierFor(30), "fresh");
check("31 days is aging", tierFor(31), "aging");
check("91 days is stale", tierFor(91), "stale");

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
