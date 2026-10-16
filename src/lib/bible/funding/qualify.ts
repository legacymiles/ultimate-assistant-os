// ---------------------------------------------------------------------------
// Funding room · the qualifier.
//
// Takes the handful of numbers you read off a client's credit report and bank
// account and answers the three questions every intake call is about: are they
// ready, roughly how much, and which lenders fit. Pure functions over the data
// in src/lib/seed-content/financial-bible, so the UI can change freely and the
// rules stay tested.
// ---------------------------------------------------------------------------

import { LENDERS } from "@/lib/seed-content/financial-bible/lenders";
import type { Bureau, Lender } from "@/lib/seed-content/financial-bible/types";

export interface ClientProfile {
  /** Lowest of the three FICO scores. */
  score: number | null;
  /** Overall revolving utilization, percent 0–100. */
  utilization: number | null;
  /** Total open revolving limits in the client's own name (personal available credit), dollars. */
  availableCredit: number | null;
  /** Major-bank cards in their own name that are 2+ years old with $2,500+ limits. */
  seasonedCards: number | null;
  /** Average age of accounts, years. */
  avgAgeYears: number | null;
  /** Hard inquiries in the last 6 months, all bureaus. */
  recentInquiries: number | null;
  /** New personal accounts opened in the last 6 months. */
  newAccounts: number | null;
  latesIn24: boolean;
  /** Any bankruptcy, collection or charge-off. */
  derogatories: boolean;
  /** Months the business has existed. 0 = not formed yet. */
  tibMonths: number | null;
  /** Average monthly business deposits, dollars. */
  monthlyRevenue: number | null;
  /** 90-day average business checking balance, dollars. */
  bankBalance: number | null;
  /** ChexSystems / Early Warning flag. */
  bankFlag: boolean;
  /** Two-letter state the business is in. */
  state: string;
}

export const EMPTY_PROFILE: ClientProfile = {
  score: null,
  utilization: null,
  availableCredit: null,
  seasonedCards: null,
  avgAgeYears: null,
  recentInquiries: null,
  newAccounts: null,
  latesIn24: false,
  derogatories: false,
  tibMonths: null,
  monthlyRevenue: null,
  bankBalance: null,
  bankFlag: false,
  state: "",
};

export type CheckState = "pass" | "warn" | "fail" | "unknown";

export interface Check {
  id: string;
  label: string;
  state: CheckState;
  /** What the number is against what it needs to be. */
  detail: string;
  /** What to do about it, when it isn't a pass. */
  fix?: string;
  /** A fail here blocks funding; a warn only shrinks it. */
  blocking: boolean;
}

export type Verdict = "ready" | "almost" | "not-yet" | "incomplete";

export interface Estimate {
  low: number;
  high: number;
  basis: string;
}

export interface LenderMatch {
  lender: Lender;
  /** Why it fits, in a few words. */
  why: string;
  /** Lower sorts first. */
  rank: number;
}

export interface QualifyResult {
  verdict: Verdict;
  checks: Check[];
  estimate: Estimate | null;
  lenders: LenderMatch[];
  /** Which bureaus the shortlist leans on — spread a sequence across them. */
  bureauSpread: Record<"EX" | "TU" | "EQ", number>;
}

const money = (n: number) =>
  n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;

function check(
  id: string,
  label: string,
  value: number | null,
  test: (v: number) => CheckState,
  detail: (v: number) => string,
  fix: string,
  blocking: boolean,
): Check {
  if (value === null || Number.isNaN(value)) {
    return { id, label, state: "unknown", detail: "Not entered", blocking };
  }
  const state = test(value);
  return { id, label, state, detail: detail(value), fix: state === "pass" ? undefined : fix, blocking };
}

export function readinessChecks(p: ClientProfile): Check[] {
  const checks: Check[] = [
    check(
      "score",
      "Lowest FICO",
      p.score,
      (v) => (v >= 700 ? "pass" : v >= 680 ? "warn" : "fail"),
      (v) => `${v} · needs 680+, 700+ for no-doc`,
      "Credit repair on any errors, pay utilization down, add a seasoned AU tradeline. Re-pull in 30–45 days.",
      true,
    ),
    check(
      "util",
      "Utilization",
      p.utilization,
      (v) => (v <= 15 ? "pass" : v <= 35 ? "warn" : "fail"),
      (v) => `${v}% · under 35% to qualify, ≤15% for Chase, ~1–10% best`,
      "Pay before statement dates, move card balances into a soft-pull personal loan, or add high-limit AU lines.",
      true,
    ),
    check(
      "available",
      "Personal available credit",
      p.availableCredit,
      (v) => (v >= 25000 ? "pass" : v >= 15000 ? "warn" : "fail"),
      (v) => `${money(v)} · target $25–50k`,
      "Grow limits first: CU cards (PenFed, NASA, Dover), limit-increase requests, AU tradelines.",
      false,
    ),
    check(
      "cards",
      "Seasoned major-bank cards",
      p.seasonedCards,
      (v) => (v >= 2 ? "pass" : v === 1 ? "warn" : "fail"),
      (v) => `${v} · needs 2+ cards, 2+ yrs old, $2,500+ each`,
      "Open or upgrade primary cards and let them age, or bring in a credit partner as guarantor.",
      true,
    ),
    check(
      "age",
      "Average credit age",
      p.avgAgeYears,
      (v) => (v >= 4 ? "pass" : v >= 2 ? "warn" : "fail"),
      (v) => `${v} yrs · aim for 4+`,
      "A seasoned authorized-user tradeline raises average age fastest.",
      false,
    ),
    check(
      "inq",
      "Hard inquiries, last 6 months",
      p.recentInquiries,
      (v) => (v <= 2 ? "pass" : v <= 5 ? "warn" : "fail"),
      (v) => `${v} · keep near zero; 0–6 months old hurt most`,
      "Wait until the newest inquiries pass 6 months, then run the sequence in a single short window.",
      false,
    ),
    check(
      "new",
      "New accounts, last 6 months",
      p.newAccounts,
      (v) => (v === 0 ? "pass" : v <= 2 ? "warn" : "fail"),
      (v) => `${v} · banks read new accounts as overextension`,
      "Let new accounts age past 6 months before big business funding.",
      false,
    ),
  ];

  checks.push({
    id: "lates",
    label: "Late payments, 24 months",
    state: p.latesIn24 ? "fail" : "pass",
    detail: p.latesIn24 ? "Has lates" : "None",
    fix: p.latesIn24 ? "Goodwill letters / disputes on errors; most prime lenders want 24 clean months." : undefined,
    blocking: true,
  });
  checks.push({
    id: "derogs",
    label: "Bankruptcy, collections, charge-offs",
    state: p.derogatories ? "fail" : "pass",
    detail: p.derogatories ? "Present" : "None",
    fix: p.derogatories ? "Dispute inaccurate items; otherwise a credit partner or credit-builder path first." : undefined,
    blocking: true,
  });
  checks.push({
    id: "bankflag",
    label: "ChexSystems / Early Warning",
    state: p.bankFlag ? "fail" : "pass",
    detail: p.bankFlag ? "Flagged" : "Clear",
    fix: p.bankFlag ? "Clear the flag or use a second-chance bank before opening target accounts." : undefined,
    blocking: true,
  });
  checks.push(
    check(
      "balance",
      "Business 90-day average balance",
      p.bankBalance,
      (v) => (v >= 10000 ? "pass" : v >= 3000 ? "warn" : "fail"),
      (v) => `${money(v)} · $3k minimum, $10k+ for the best rating`,
      "Deposit and leave it 30–90 days before applying.",
      false,
    ),
  );
  return checks;
}

export function verdictOf(checks: Check[]): Verdict {
  const core = ["score", "util", "cards"];
  if (core.some((id) => checks.find((c) => c.id === id)?.state === "unknown")) return "incomplete";
  if (checks.some((c) => c.blocking && c.state === "fail")) return "not-yet";
  if (checks.some((c) => c.state === "fail" || c.state === "warn")) return "almost";
  return "ready";
}

/** Business funding typically lands at 2–3× personal available credit. */
export function estimate(p: ClientProfile, verdict: Verdict): Estimate | null {
  if (verdict === "not-yet" || verdict === "incomplete") return null;
  const avail = p.availableCredit ?? 0;
  if (avail <= 0) return null;
  const scale = verdict === "ready" ? 1 : 0.6;
  return {
    low: Math.round((avail * 2 * scale) / 1000) * 1000,
    high: Math.round((avail * 3 * scale) / 1000) * 1000,
    basis:
      verdict === "ready"
        ? "2–3× personal available credit"
        : "2–3× personal available credit, discounted until the warnings are fixed",
  };
}

const softFirst = (l: Lender) => (l.pull === "soft" || l.pull === "soft-prequal" ? 0 : 1);

export function matchLenders(p: ClientProfile): LenderMatch[] {
  const score = p.score ?? 0;
  const tib = p.tibMonths ?? 0;
  const rev = p.monthlyRevenue ?? 0;
  const state = p.state.trim().toUpperCase();
  const out: LenderMatch[] = [];

  for (const l of LENDERS) {
    if (l.minScore && score < l.minScore) continue;
    if (!l.minScore && score < 680) {
      // Unstated minimum: the course's floor for bank products is 680.
      if (l.kind === "bank" || l.kind === "issuer") continue;
    }
    if (l.states?.length && state && !l.states.includes(state)) continue;

    const needsBusiness = l.products.every((pr) => pr.side === "business");
    if (needsBusiness && tib === 0) continue;
    if (l.minTibMonths && tib < l.minTibMonths) continue;
    if (l.minMonthlyRevenue && rev < l.minMonthlyRevenue) continue;

    const why: string[] = [];
    if (l.pull === "soft" || l.pull === "soft-prequal") why.push("soft-pull first");
    if (l.minMonthlyRevenue) why.push(`revenue ≥ ${money(l.minMonthlyRevenue)}/mo`);
    if (l.products.some((pr) => pr.docs === "none")) why.push("no-doc option");
    if (l.states?.length) why.push(state ? `in-footprint (${state})` : `only ${l.states.join("/")}`);
    if (l.rules?.some((r) => /one (hard )?pull|1 hard (pull|inquiry)|on one/i.test(r))) why.push("several products, one pull");

    const rank =
      softFirst(l) * 10 +
      (l.kind === "credit-union" ? 0 : l.kind === "fintech" ? 1 : l.kind === "bank" ? 2 : 3) +
      (l.verify ? 5 : 0);
    out.push({ lender: l, why: why.join(" · ") || "meets stated minimums", rank });
  }
  return out.sort((a, b) => a.rank - b.rank || a.lender.name.localeCompare(b.lender.name));
}

export function qualify(p: ClientProfile): QualifyResult {
  const checks = readinessChecks(p);
  const verdict = verdictOf(checks);
  const lenders = verdict === "not-yet" || verdict === "incomplete" ? [] : matchLenders(p);
  const spread = { EX: 0, TU: 0, EQ: 0 };
  for (const m of lenders) {
    const first = m.lender.bureaus.find((b): b is Extract<Bureau, "EX" | "TU" | "EQ"> =>
      b === "EX" || b === "TU" || b === "EQ",
    );
    if (first) spread[first] += 1;
  }
  return { verdict, checks, estimate: estimate(p, verdict), lenders, bureauSpread: spread };
}
