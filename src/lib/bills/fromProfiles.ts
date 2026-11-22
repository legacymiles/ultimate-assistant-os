// ---------------------------------------------------------------------------
// Bills, read out of the Profiles app.
//
// A bill filed in a profile — the girlfriend's car insurance, the DTF
// printer's payment — belongs on the Bills tab without being typed twice.
// So nothing is copied: this reads the Profiles blob every time and hands back
// bills. Edit the row in Profiles and the bill here changes with it; delete
// the row and the bill goes.
//
// What counts as a bill is deliberately narrow: a row needs an AMOUNT and a
// SCHEDULE. "Gildan 5000 x 144 - $431.28 - Oct 30" is a purchase that already
// happened and never appears here; "Shopify plan - $39.00 - Monthly" does.
// Guessing wrong in the other direction — a calendar full of things that are
// not bills — is the failure that would make the tab useless.
// ---------------------------------------------------------------------------

import { key, lastDayOfMonth, parts } from "@/lib/finance/dates";
import { live, pathTo } from "@/lib/profiles/tree";
import { ROOT } from "@/lib/profiles/seed";
import type { Item, ProfileNode, ProfilesData, Section } from "@/lib/profiles/types";
import type { Bill, Cadence, Day } from "./types";

/** Sections whose rows are bills unless they say otherwise. */
const BILL_SECTION = /bill|expense|payment|subscription|insurance|loan|rent|utilit|premium|finance/i;

/** Sections of things already bought or already received. Never bills. */
const SPENT_SECTION = /purchase|receipt|bought|sold|income|payout|earning|sale/i;

/** A row that is a bill whatever section it sits in. */
const BILL_KEY =
  /bill|payment|rent|mortgage|loan|lease|instalment|installment|insurance|premium|subscription|dues|utilit|internet|electric|water|phone plan|car note|finance|plan\b/i;

const CADENCES: [RegExp, Cadence][] = [
  [/fortnight|every (?:two|2) weeks|bi-?weekly/i, "fortnightly"],
  [/weekly|every week|a week\b|per week/i, "weekly"],
  [/quarter/i, "quarterly"],
  [/annual|yearly|every year|per year|a year\b/i, "annual"],
  [/month|per mo\b/i, "monthly"],
];

/** "/mo" and "/wk" written as a rate, which the patterns above would miss. */
const RATE_MONTH = /\/\s*mo\b/i;
const RATE_WEEK = /\/\s*wk\b/i;
const RATE_YEAR = /\/\s*yr\b/i;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Everything written on one row, for the patterns to read. */
function text(item: Item): string {
  return `${item.k} ${item.v} ${item.meta ?? ""}`;
}

/** Dollars on the row: the stored number first, then a "$39.00" in the words. */
export function amountOf(item: Item): number | null {
  if (typeof item.money === "number" && Number.isFinite(item.money) && item.money > 0) {
    return item.money;
  }
  const m = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(`${item.v} ${item.meta ?? ""}`);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function cadenceOf(item: Item): Cadence {
  const s = text(item);
  if (RATE_WEEK.test(s)) return "weekly";
  if (RATE_YEAR.test(s)) return "annual";
  if (RATE_MONTH.test(s)) return "monthly";
  for (const [re, cadence] of CADENCES) if (re.test(s)) return cadence;
  return "one_off";
}

/** The day of the month it falls on, from the words. 31 means "the last day". */
export function dayOfMonthOf(item: Item): number | null {
  const s = text(item);
  if (/last day|end of (?:the )?month/i.test(s)) return 31;
  const m =
    /\b(?:due|on|every|the)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i.exec(s) ??
    /\b(\d{1,2})(?:st|nd|rd|th)\b/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 31 ? n : null;
}

function weekdayOf(item: Item): number | null {
  const s = text(item).toLowerCase();
  for (let i = 0; i < WEEKDAYS.length; i += 1) if (s.includes(WEEKDAYS[i])) return i;
  return null;
}

function monthOfYearOf(item: Item): number | null {
  const s = text(item).toLowerCase();
  for (let i = 0; i < MONTHS.length; i += 1) if (s.includes(MONTHS[i])) return i + 1;
  return null;
}

function looksLikeABill(section: Section, item: Item, cadence: Cadence): boolean {
  if (BILL_KEY.test(item.k)) return true;
  if (BILL_SECTION.test(section.title)) return true;
  // A row in "Purchases" is a bill only when it repeats: "film roll, monthly".
  if (SPENT_SECTION.test(section.title)) return cadence !== "one_off";
  return cadence !== "one_off";
}

/** A repeating bill with no day written down still has to land somewhere. */
function anchor(
  cadence: Cadence,
  day: number,
  weekday: number | null,
  month: number | null,
  today: Day,
): Day {
  const [y, m] = parts(today);
  if (cadence === "weekly" || cadence === "fortnightly") {
    // The first of this month, moved forward onto the right weekday.
    const first = new Date(y, m - 1, 1);
    const shift = weekday === null ? 0 : (weekday - first.getDay() + 7) % 7;
    return key(y, m, 1 + shift);
  }
  const anchorMonth = cadence === "annual" ? (month ?? m) : m;
  return key(y, anchorMonth, Math.min(day, lastDayOfMonth(y, anchorMonth)));
}

/** The main profile a row belongs to — what the filter chips are made of. */
function worldOf(
  data: ProfilesData,
  nodeId: string,
): { path: ProfileNode[]; owner: ProfileNode | null } {
  const ids = pathTo(data, nodeId).filter((id) => id !== ROOT);
  const path = ids.map((id) => data.nodes[id]).filter((n): n is ProfileNode => Boolean(n));
  return { path, owner: path[0] ?? null };
}

export interface FromProfilesOptions {
  /** Today, so a bill with no written date can be anchored. */
  today: Day;
}

/**
 * Every bill filed in the owner's profiles.
 *
 * Ids are `profiles:<item id>` and an item id is stable, so a paid mark made
 * last month still belongs to the same bill after the row is edited.
 */
export function billsFromProfiles(data: ProfilesData, opts: FromProfilesOptions): Bill[] {
  const out: Bill[] = [];
  if (!data?.nodes) return out;

  for (const node of Object.values(data.nodes)) {
    if (node.id === ROOT || node.archived || node.hidden) continue;
    if (!live(data, node.id)) continue;
    const { path, owner } = worldOf(data, node.id);
    const where = path.map((n) => n.name).join(" › ");

    for (const section of node.sections ?? []) {
      for (const item of section.items ?? []) {
        const amount = amountOf(item);
        if (amount === null) continue;
        const written = cadenceOf(item);
        if (!looksLikeABill(section, item, written)) continue;

        const day = dayOfMonthOf(item);
        const weekday = weekdayOf(item);
        const month = monthOfYearOf(item);
        // A row whose own name says bill, payment or rent, with an amount and
        // nothing about when, is a bill nobody wrote the schedule for — the
        // common case when one is added in a hurry. Taking it as monthly and
        // saying so beats dropping it: "day not set" is fixable on the tab,
        // a bill that never appeared is not.
        const named = BILL_KEY.test(item.k);
        const cadence: Cadence =
          written === "one_off" && !item.date && named ? "monthly" : written;
        // Otherwise: no schedule, no bill. A one-off needs a real date.
        if (cadence === "one_off" && !item.date) continue;

        const guessed = cadence !== "one_off" && !item.date && day === null;
        const firstDue = item.date ? item.date : anchor(cadence, day ?? 1, weekday, month, opts.today);
        const repeatsByDay = cadence === "weekly" || cadence === "fortnightly";

        out.push({
          id: `profiles:${item.id}`,
          name: item.k.trim() || node.name,
          amount,
          currency: "USD",
          cadence,
          dayOfMonth: repeatsByDay ? null : (day ?? parts(firstDue)[2]),
          weekday: repeatsByDay ? weekday : null,
          monthOfYear: cadence === "annual" ? (month ?? parts(firstDue)[1]) : null,
          firstDue,
          endDate: null,
          autopay: /autopay|auto-?pay|automatic/i.test(text(item)),
          paused: false,
          notes: item.meta && item.meta !== item.v ? item.meta : undefined,
          profileId: node.id,
          profileName: node.name,
          ownerId: owner?.id ?? null,
          ownerName: owner?.name ?? null,
          where,
          source: "profiles",
          sourceRef: item.id,
          dayGuessed: guessed || undefined,
          example: node.example || undefined,
          createdAt: "",
          updatedAt: "",
        });
      }
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** The main profiles that have bills, in the order the home screen shows them. */
export function profilesWithBills(
  data: ProfilesData,
  bills: Bill[],
): { id: string; name: string; count: number; hue?: number }[] {
  const counts = new Map<string, number>();
  for (const b of bills) {
    if (!b.ownerId) continue;
    counts.set(b.ownerId, (counts.get(b.ownerId) ?? 0) + 1);
  }
  const order = data.nodes?.[ROOT]?.children ?? [];
  const seen = new Set<string>();
  const out: { id: string; name: string; count: number; hue?: number }[] = [];
  const row = (id: string, count: number) => ({
    id,
    name: data.nodes[id]?.name ?? "Profile",
    count,
    hue: data.nodes[id]?.hue,
  });
  for (const id of order) {
    const n = counts.get(id);
    if (!n) continue;
    seen.add(id);
    out.push(row(id, n));
  }
  for (const [id, n] of counts) {
    if (seen.has(id)) continue;
    out.push(row(id, n));
  }
  return out;
}
