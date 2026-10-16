// ---------------------------------------------------------------------------
// Financial Bible · Funding knowledge base — the shapes.
//
// Everything the Funding room shows lives in this folder as plain data, so the
// UI can be torn up and rebuilt without anyone re-reading the course. The
// Projects Timeline also reads this folder (see ./timeline.ts) and files it as
// knowledge entries on the Financial Bible project.
//
// Source: the owner's 6 Figure Funder member library, read lesson by lesson in
// October 2026. Every fact is paraphrased; `src` points back at the lesson it
// came from so a number can be checked against the video. Bank rules drift —
// treat every figure as "what the course said", and confirm with the bank.
// ---------------------------------------------------------------------------

export type Bureau = "EX" | "TU" | "EQ" | "EX-BIZ" | "D&B";
export type Pull = "soft" | "hard" | "soft-prequal";
export type Docs = "none" | "low" | "full";
export type Side = "personal" | "business";

export type ProductKind =
  | "card"
  | "charge-card"
  | "loc"
  | "loan"
  | "auto"
  | "secured"
  | "builder";

export interface Product {
  kind: ProductKind;
  side: Side;
  /** Typical or maximum amount the course quoted, in dollars. */
  max?: number;
  docs?: Docs;
  note?: string;
}

export type LenderKind = "bank" | "credit-union" | "fintech" | "alt-lender" | "issuer";

export interface Lender {
  id: string;
  name: string;
  kind: LenderKind;
  products: Product[];
  /** Bureaus pulled, most common first. Empty = not stated in the course. */
  bureaus: Bureau[];
  pull?: Pull;
  minScore?: number;
  /** Minimum time in business, months. */
  minTibMonths?: number;
  /** Minimum monthly revenue, dollars. */
  minMonthlyRevenue?: number;
  /** Two-letter states where it lends or has branches; empty = nationwide / not restricted. */
  states?: string[];
  /** How a non-local person gets in (credit unions mostly). */
  membership?: string;
  /** Velocity and exposure rules — how many, how often, how much. */
  rules?: string[];
  tips?: string[];
  /** What it pays a broker who refers, when the course said. */
  commission?: string;
  /** Course lesson refs, e.g. "6FF L30". */
  src: string[];
  /** Course flagged it as unverified, or it has changed since. */
  verify?: string;
}

export interface Tip {
  id: string;
  title: string;
  body: string;
  /** "credit" = credit secrets, "biz" = business hacks, "bank" = banking/relationship, "sales" = getting & keeping clients. */
  area: "credit" | "biz" | "bank" | "sales" | "ops";
  src: string[];
}

export interface Mistake {
  id: string;
  title: string;
  /** What happens. */
  cost: string;
  /** What to do instead. */
  fix: string;
  src: string[];
}

export interface CheatRow {
  k: string;
  v: string;
}

export interface CheatSheet {
  id: string;
  title: string;
  /** One line on when to reach for it. */
  use: string;
  rows: CheatRow[];
  src: string[];
}

export interface SequenceStep {
  title: string;
  detail: string;
}

export interface Sequence {
  id: string;
  title: string;
  /** Who it is for. */
  fits: string;
  steps: SequenceStep[];
  src: string[];
}

export interface Script {
  id: string;
  title: string;
  use: string;
  lines: string[];
  src: string[];
}

/** Something the course teaches that this playbook deliberately does not carry, and why. */
export interface LeftOut {
  id: string;
  what: string;
  why: string;
  src: string[];
}

export type CourseId = "6ff" | "secrets" | "corp" | "webinar";

export interface Lesson {
  course: CourseId;
  n: number;
  title: string;
  module: string;
  /** False when the page had no written notes — the knowledge is only in the video. */
  written: boolean;
  links?: string[];
  files?: string[];
}

export interface Resource {
  id: string;
  title: string;
  kind: "doc" | "sheet" | "deck" | "recording" | "file" | "site";
  url?: string;
  note: string;
  src: string[];
}
