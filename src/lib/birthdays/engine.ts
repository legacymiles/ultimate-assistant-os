// ---------------------------------------------------------------------------
// Birthdays — family and friends, in one list that feeds everything else.
//
// The owner's rule (Oct 2026): a birthday is typed ONCE — in onboarding, in
// the Birthdays sheet, or by telling the chat "add Mom's birthday, March 14" —
// and it shows up everywhere it should:
//
//   · the Calendar (tab + Dashboard widget) — every year, all day, derived
//     here, never copied into the calendar store, so editing or deleting the
//     birthday moves or removes every year of it at once (no duplicates)
//   · Dashboard notifications — ONLY from 2 days before: "in 2 days",
//     "tomorrow", "today". Never earlier (owner's rule)
//   · the chat's context, so "when is Mom's birthday?" just answers
//
// A birthday is month + day (+ an optional birth year for "turns 30"). It is
// never stored as an instant, for the same reason the calendar never is: a UTC
// timestamp moves the day for anyone west of Greenwich.
//
// Pure — no storage, no React — so tests pin every rule.
// ---------------------------------------------------------------------------

export type Circle = "family" | "friend";

export interface Birthday {
  id: string;
  name: string;
  /** "Mom", "best friend", "cousin" — optional, the owner's own word. */
  relation?: string;
  circle: Circle;
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
  /** Birth year when known, for "turns 30". */
  year?: number | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BirthdayInput {
  name: string;
  relation?: string;
  circle?: Circle | string;
  /** Anything a person types: "March 14", "3/14/1990", "1990-03-14", "14th of March". */
  date?: string;
  month?: number;
  day?: number;
  year?: number | null;
  notes?: string;
}

/** Notifications start this many days before, and not a day sooner. */
export const NOTIFY_DAYS = 2;

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_INDEX: Record<string, number> = {};
MONTHS.forEach((m, i) => {
  MONTH_INDEX[m.toLowerCase()] = i + 1;
  MONTH_INDEX[m.slice(0, 3).toLowerCase()] = i + 1;
});
MONTH_INDEX["sept"] = 9;

/** Words that say "family" when the owner gives a relation but no circle. */
const FAMILY_WORDS =
  /\b(mom|mum|mother|mama|dad|father|papa|pops|son|daughter|kid|child|brother|sister|bro|sis|sibling|wife|husband|spouse|grand\w*|aunt|auntie|uncle|cousin|niece|nephew|in-law|stepmom|stepdad|step\w*|baby|fianc\w*|family)\b/i;

export function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/** Real calendar day? Feb 29 counts (some people were born on it). */
export function validDay(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(month, 2000); // 2000 is a leap year
}

function validYear(year: unknown, now: Date): number | null {
  const y = Number(year);
  if (!Number.isInteger(y)) return null;
  return y >= 1900 && y <= now.getFullYear() ? y : null;
}

/** Two-digit years: "90" → 1990, "05" → 2005 (never in the future). */
function fullYear(raw: string, now: Date): number | null {
  if (raw.length === 4) return validYear(raw, now);
  if (raw.length !== 2) return null;
  const n = Number(raw);
  const century = n + 2000 <= now.getFullYear() ? 2000 : 1900;
  return validYear(century + n, now);
}

/**
 * Read a birthday out of anything a person would type. US order for slashes
 * (the owner is in Ohio): "3/14" is March 14. Returns null when it is not a
 * real day, rather than guessing.
 */
export function parseBirthdayDate(text: string, now: Date = new Date()): { month: number; day: number; year: number | null } | null {
  const t = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ");
  if (!t) return null;
  const ok = (month: number, day: number, year: number | null) => (validDay(month, day) ? { month, day, year } : null);

  // 1990-03-14 / 2026-03-14 (a year that is this year or later is not a birth year)
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return ok(Number(m[2]), Number(m[3]), validYear(m[1], now) !== null && Number(m[1]) < now.getFullYear() ? Number(m[1]) : null);

  // --03-14 / 03-14
  m = t.match(/^(?:--)?(\d{1,2})-(\d{1,2})$/);
  if (m) return ok(Number(m[1]), Number(m[2]), null);

  // 3/14, 3/14/1990, 3.14.90
  m = t.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/);
  if (m) return ok(Number(m[1]), Number(m[2]), m[3] ? fullYear(m[3], now) : null);

  const monthOf = (w: string) => MONTH_INDEX[w.replace(/\.$/, "")] ?? 0;

  // March 14, Mar 14 1990
  m = t.match(/^([a-z]+\.?) (\d{1,2})(?: (\d{4}|'?\d{2}))?$/);
  if (m && monthOf(m[1])) return ok(monthOf(m[1]), Number(m[2]), m[3] ? fullYear(m[3].replace("'", ""), now) : null);

  // 14 March, 14 of March 1990
  m = t.match(/^(\d{1,2}) (?:of )?([a-z]+\.?)(?: (\d{4}|'?\d{2}))?$/);
  if (m && monthOf(m[2])) return ok(monthOf(m[2]), Number(m[1]), m[3] ? fullYear(m[3].replace("'", ""), now) : null);

  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" for a local Date. */
export function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The day this birthday falls on in a given year. Feb 29 → Feb 28 in a non-leap year. */
export function dayIn(b: Pick<Birthday, "month" | "day">, year: number): Date {
  const day = Math.min(b.day, daysInMonth(b.month, year));
  return new Date(year, b.month - 1, day);
}

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The next time it comes round — today counts. Local midnight. */
export function nextOccurrence(b: Pick<Birthday, "month" | "day">, now: Date = new Date()): Date {
  const today = midnight(now);
  const thisYear = dayIn(b, today.getFullYear());
  return thisYear.getTime() >= today.getTime() ? thisYear : dayIn(b, today.getFullYear() + 1);
}

/** Whole days until the next birthday: 0 = today. DST-safe (rounds). */
export function daysUntil(b: Pick<Birthday, "month" | "day">, now: Date = new Date()): number {
  return Math.round((nextOccurrence(b, now).getTime() - midnight(now).getTime()) / 86_400_000);
}

/** The age they turn on their next birthday, when the birth year is known. */
export function turning(b: Pick<Birthday, "month" | "day" | "year">, now: Date = new Date()): number | null {
  if (!b.year) return null;
  const age = nextOccurrence(b, now).getFullYear() - b.year;
  return age > 0 && age < 130 ? age : null;
}

/** "March 14" / "March 14, 1990". */
export function formatBirthday(b: Pick<Birthday, "month" | "day" | "year">): string {
  return `${MONTHS[b.month - 1] ?? "?"} ${b.day}${b.year ? `, ${b.year}` : ""}`;
}

/** "Mom's" / "James'" */
export function possessive(name: string): string {
  const n = name.trim();
  return /s$/i.test(n) ? `${n}'` : `${n}'s`;
}

/** "in 2 days" / "tomorrow" / "today" / "in 40 days". */
export function whenPhrase(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function guessCircle(relation: string | undefined, name: string): Circle {
  return FAMILY_WORDS.test(`${relation ?? ""} ${name}`) ? "family" : "friend";
}

function normCircle(c: unknown, relation: string | undefined, name: string): Circle {
  const s = String(c ?? "").toLowerCase();
  if (s.startsWith("fam")) return "family";
  if (s.startsWith("fri")) return "friend";
  return guessCircle(relation, name);
}

/** Name-blind-to-case-and-punctuation key, for "no duplicates". */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9]+/g, "");
}

/** Turn whatever was typed into a date, or say plainly why not. */
export function resolveInput(input: BirthdayInput, now: Date = new Date()): { month: number; day: number; year: number | null } | { error: string } {
  if (input.month && input.day) {
    if (!validDay(Number(input.month), Number(input.day))) return { error: "That isn't a real day of the year." };
    return { month: Number(input.month), day: Number(input.day), year: validYear(input.year, now) };
  }
  const parsed = parseBirthdayDate(input.date ?? "", now);
  if (!parsed) return { error: `I couldn't read "${input.date ?? ""}" as a birthday — try "March 14" or "3/14/1990".` };
  return { ...parsed, year: parsed.year ?? validYear(input.year, now) };
}

export interface UpsertResult {
  list: Birthday[];
  birthday: Birthday;
  /** "added" for a new person, "updated" when they were already there. */
  outcome: "added" | "updated";
}

/**
 * Add a birthday — or, when that person is already on the list, update theirs.
 * Same name = same person (no duplicates, the owner's rule). Newest first.
 */
export function upsertBirthday(
  list: Birthday[],
  input: BirthdayInput,
  opts: { now?: Date; id?: () => string } = {},
): UpsertResult | { error: string } {
  const now = opts.now ?? new Date();
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) return { error: "Whose birthday is it? A name is needed." };
  const date = resolveInput(input, now);
  if ("error" in date) return date;
  const relation = String(input.relation ?? "").trim().slice(0, 40) || undefined;
  const notes = String(input.notes ?? "").trim().slice(0, 300) || undefined;
  const ts = now.toISOString();
  const key = nameKey(name);
  const existing = list.find((b) => nameKey(b.name) === key);
  if (existing) {
    const birthday: Birthday = {
      ...existing,
      name,
      relation: relation ?? existing.relation,
      circle: input.circle ? normCircle(input.circle, relation ?? existing.relation, name) : existing.circle,
      month: date.month,
      day: date.day,
      year: date.year ?? (existing.month === date.month && existing.day === date.day ? existing.year : null),
      notes: notes ?? existing.notes,
      updatedAt: ts,
    };
    return { list: [birthday, ...list.filter((b) => b.id !== existing.id)], birthday, outcome: "updated" };
  }
  const birthday: Birthday = {
    id: opts.id ? opts.id() : `bday_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
    name,
    relation,
    circle: normCircle(input.circle, relation, name),
    month: date.month,
    day: date.day,
    year: date.year,
    notes,
    createdAt: ts,
    updatedAt: ts,
  };
  return { list: [birthday, ...list], birthday, outcome: "added" };
}

/** Remove by id, or by name ("forget Tyler's birthday"). */
export function removeBirthday(list: Birthday[], idOrName: string): { list: Birthday[]; removed: Birthday | null } {
  const key = nameKey(idOrName);
  const hit = list.find((b) => b.id === idOrName) ?? list.find((b) => nameKey(b.name) === key);
  return hit ? { list: list.filter((b) => b.id !== hit.id), removed: hit } : { list, removed: null };
}

/** Repair whatever came out of storage. */
export function coerceBirthdays(raw: unknown): Birthday[] {
  const arr = Array.isArray((raw as { people?: unknown })?.people)
    ? (raw as { people: unknown[] }).people
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  const out: Birthday[] = [];
  const seen = new Set<string>();
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const b = r as Partial<Birthday>;
    const name = typeof b.name === "string" ? b.name.trim() : "";
    const month = Number(b.month);
    const day = Number(b.day);
    if (!name || !validDay(month, day) || seen.has(nameKey(name))) continue;
    seen.add(nameKey(name));
    out.push({
      id: typeof b.id === "string" && b.id ? b.id : `bday_${nameKey(name)}`,
      name,
      relation: typeof b.relation === "string" && b.relation.trim() ? b.relation.trim() : undefined,
      circle: b.circle === "family" ? "family" : b.circle === "friend" ? "friend" : guessCircle(b.relation, name),
      month,
      day,
      year: Number.isInteger(b.year) ? (b.year as number) : null,
      notes: typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : undefined,
      createdAt: typeof b.createdAt === "string" ? b.createdAt : "",
      updatedAt: typeof b.updatedAt === "string" ? b.updatedAt : "",
    });
  }
  return out;
}

/** Soonest first, everyone. */
export function bySoonest(list: Birthday[], now: Date = new Date()): { b: Birthday; days: number; turns: number | null }[] {
  return list
    .map((b) => ({ b, days: daysUntil(b, now), turns: turning(b, now) }))
    .sort((x, y) => x.days - y.days || x.b.name.localeCompare(y.b.name));
}

/** Calendar title: "🎂 Mom's birthday (turns 60)". */
export function eventTitle(b: Birthday, year: number): string {
  const age = b.year ? year - b.year : null;
  return `🎂 ${possessive(b.name)} birthday${age && age > 0 && age < 130 ? ` (turns ${age})` : ""}`;
}

export interface BirthdayEvent {
  /** Stable per person per year, so the calendar never doubles it. */
  id: string;
  birthdayId: string;
  title: string;
  date: string;
  notes?: string;
}

/**
 * Every birthday in a date range, as all-day calendar events. Derived on the
 * fly: the calendar store never holds a copy, so there is nothing to keep in
 * step and nothing to duplicate.
 */
export function birthdayEvents(list: Birthday[], from: Date, to: Date): BirthdayEvent[] {
  const out: BirthdayEvent[] = [];
  const start = midnight(from).getTime();
  const end = midnight(to).getTime();
  for (let y = from.getFullYear(); y <= to.getFullYear(); y += 1) {
    for (const b of list) {
      const d = dayIn(b, y);
      const t = d.getTime();
      if (t < start || t > end) continue;
      out.push({
        id: `bday:${b.id}:${y}`,
        birthdayId: b.id,
        title: eventTitle(b, y),
        date: dayKeyOf(d),
        notes: [b.relation, b.circle === "family" ? "Family" : "Friend", b.notes].filter(Boolean).join(" · "),
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export interface BirthdayNotice {
  /** Changes each day of the countdown, so each day gets its own pop-up once. */
  id: string;
  birthdayId: string;
  title: string;
  detail: string;
  /** ISO — when this row became news (local midnight of the day it opened). */
  at: string;
  /** ISO — the birthday itself, so it sorts with what is coming up. */
  startsAt: string;
  when: string;
  days: number;
}

/**
 * The notification rows. A birthday is news ONLY from 2 days out — 2 days,
 * tomorrow, today — and is gone the day after. Never earlier.
 */
export function birthdayNotices(list: Birthday[], now: Date = new Date(), lead: number = NOTIFY_DAYS): BirthdayNotice[] {
  const out: BirthdayNotice[] = [];
  const today = midnight(now);
  for (const b of list) {
    const days = daysUntil(b, now);
    if (days > lead) continue;
    const on = nextOccurrence(b, now);
    const age = turning(b, now);
    const who = b.relation && nameKey(b.relation) !== nameKey(b.name) ? `${b.name} (${b.relation})` : b.name;
    out.push({
      id: `birthdays:${b.id}:${on.getFullYear()}:${days}`,
      birthdayId: b.id,
      title: days === 0 ? `🎂 It's ${possessive(who)} birthday today` : `🎂 ${possessive(who)} birthday is ${whenPhrase(days)}`,
      detail: [age ? `turns ${age}` : "", days === 0 ? "send a message or call" : days === 1 ? "last day to get a card or gift" : "time to plan a gift"]
        .filter(Boolean)
        .join(" · "),
      at: today.toISOString(),
      startsAt: on.toISOString(),
      when: days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days}d`,
      days,
    });
  }
  return out.sort((a, b) => a.days - b.days || a.title.localeCompare(b.title));
}

/** One compact block for the chat's context, so it can answer and avoid duplicates. */
export function birthdayDigest(list: Birthday[], now: Date = new Date()): string {
  if (!list.length) return "";
  const rows = bySoonest(list, now)
    .slice(0, 60)
    .map(({ b, days, turns }) =>
      `- ${b.name}${b.relation ? ` (${b.relation})` : ""}, ${b.circle}: ${formatBirthday(b)} — ${whenPhrase(days)}${turns ? `, turns ${turns}` : ""}`,
    );
  return `BIRTHDAYS ON FILE (family & friends; add or change with birthday_add, remove with birthday_remove):\n${rows.join("\n")}`;
}
