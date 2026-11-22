// ---------------------------------------------------------------------------
// Bills — the shape of every bill Jarvis knows about.
//
// Two sources, one list:
//
//   "typed"    — entered on the Bills tab. Lives in this app's own blob.
//   "profiles" — DERIVED, every read, from a row in the Profiles app. Never
//                stored, so a bill edited in a profile is already right here;
//                its id is "profiles:<item id>" so the paid marks survive.
//
// Dates follow the convention the finance engine set and paid for in std-safe:
// a bill is due on a DAY, never at a moment, so every date here is a plain
// "YYYY-MM-DD" string and all arithmetic goes through lib/finance/dates.
// Amounts are positive when money leaves, same as lib/finance.
// ---------------------------------------------------------------------------

import type { Cadence, Day } from "@/lib/finance/types";

export type { Cadence, Day };

export type BillSource = "typed" | "profiles";

export interface Bill {
  id: string;
  name: string;
  /** Positive = money out. */
  amount: number;
  currency: string;
  cadence: Cadence;
  /** 1–31 for monthly/quarterly/annual. 31 means "the last day". */
  dayOfMonth: number | null;
  /** 0 = Sunday … 6 = Saturday, for weekly and fortnightly. */
  weekday: number | null;
  /** 1–12, for annual. */
  monthOfYear: number | null;
  firstDue: Day;
  endDate: Day | null;
  autopay: boolean;
  paused: boolean;
  notes?: string;
  /** The Profiles node this bill was found on ("DTF Printer"). */
  profileId: string | null;
  profileName: string | null;
  /** The main profile it belongs to — what the filter chips are. */
  ownerId: string | null;
  ownerName: string | null;
  /** "My Businesses › Northside Prints › DTF Printer". */
  where?: string;
  source: BillSource;
  /** The Profiles item id, so a re-read updates the same bill. */
  sourceRef?: string;
  /** True when no due day was written down and the 1st was assumed. */
  dayGuessed?: boolean;
  /** Read off one of Profiles' seeded examples, not the owner's own data. */
  example?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The owner's corrections to a bill Profiles wrote. Profiles owns the rest. */
export interface BillOverride {
  cadence?: Cadence;
  dayOfMonth?: number | null;
  amount?: number;
  paused?: boolean;
  /** Taken off the Bills tab entirely — it was not really a bill. */
  dropped?: boolean;
}

export interface BillsData {
  version: 1;
  /** Bills typed here. Profile bills are never in this list. */
  bills: Bill[];
  /** `${billId}|${due}` → when it was confirmed paid. One mark per occurrence. */
  paid: Record<string, string>;
  /** Keyed by a profile bill's id. */
  overrides: Record<string, BillOverride>;
}

export function emptyBills(): BillsData {
  return { version: 1, bills: [], paid: {}, overrides: {} };
}

/** One occurrence of one bill, on one day. What the tab and the grid draw. */
export interface DueBill {
  bill: Bill;
  due: Day;
  amount: number;
  paid: boolean;
  paidAt?: string;
  /** Unpaid and the day has gone. */
  overdue: boolean;
  /** Days from today; negative is in the past. */
  dueIn: number;
}

export type SortMode = "due" | "amount" | "name";

export const SORTS: { id: SortMode; label: string }[] = [
  { id: "due", label: "By date" },
  { id: "amount", label: "Highest first" },
  { id: "name", label: "A–Z" },
];

export const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "Weekly",
  fortnightly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Every 3 months",
  annual: "Yearly",
  one_off: "One off",
};

/** The key a paid mark is stored under. */
export function paidKey(billId: string, due: Day): string {
  return `${billId}|${due}`;
}
