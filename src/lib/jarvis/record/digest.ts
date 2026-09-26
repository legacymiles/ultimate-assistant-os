// ---------------------------------------------------------------------------
// The Life Record as Jarvis sees it — and the one thing he never sees.
//
// A Social Security number has no business in a prompt. It does not need to be
// there: filling a form is a substitution problem, not a reasoning problem. So
// the digest tells Jarvis the number EXISTS and tells him to write `{{ssn}}`
// where it goes, and `fillTokens` swaps the real value in on this device when
// the owner copies the answer out. The model drafts the whole application and
// never once holds the number.
//
// That is why this file is plain functions with no client hooks: the digest
// half runs wherever the record is read, and the substitution half has to run
// in the browser, where the record actually lives.
// ---------------------------------------------------------------------------

import {
  entryTitle,
  FIELD_BY_KEY,
  GROUPS,
  SECTIONS,
  type GroupDef,
  type LifeRecord,
} from "./types";
import { gaps } from "./store";

/** `{{ssn}}` or `{{jobs.2.pay}}` — what Jarvis writes instead of a value. */
function token(key: string, groupId?: string, index?: number): string {
  return groupId ? `{{${groupId}.${(index ?? 0) + 1}.${key}}}` : `{{${key}}}`;
}

function entryLines(group: GroupDef, record: LifeRecord): string[] {
  const rows = record.groups[group.id] ?? [];
  return rows.map((entry, i) => {
    const bits = group.fields
      .map((f) => {
        const v = entry.values[f.key];
        if (!v) return "";
        return `${f.label}: ${f.sensitive ? `${token(f.key, group.id, i)} (on file, hidden from you)` : v}`;
      })
      .filter(Boolean);
    return `  ${i + 1}. ${entryTitle(group, entry)} — ${bits.join("; ")}`;
  });
}

/**
 * The record as a prompt block.
 *
 * Empty fields are listed too, and deliberately: the point of this store is
 * that Jarvis asks for what is missing instead of inventing it, and he cannot
 * ask for a field he was never told exists.
 */
export function recordDigest(record: LifeRecord): string {
  const out: string[] = [];
  let known = 0;

  for (const section of SECTIONS) {
    const lines: string[] = [];
    for (const f of section.fields) {
      const v = record.fields[f.key]?.value;
      if (!v) continue;
      known += 1;
      lines.push(`- ${f.label} [${f.key}]: ${f.sensitive ? `${token(f.key)} — on file, deliberately hidden from you` : v}`);
    }
    if (lines.length) out.push(`${section.label.toUpperCase()}\n${lines.join("\n")}`);
  }

  for (const group of GROUPS) {
    const lines = entryLines(group, record);
    if (!lines.length) continue;
    known += lines.length;
    out.push(`${group.label.toUpperCase()} (${lines.length})\n${lines.join("\n")}`);
  }

  if (!known) {
    return (
      "THE OWNER'S LIFE RECORD is empty. It is the store that holds the facts an application asks " +
      "for — legal name, date of birth, address, household, income, work history. Nothing has been " +
      "put in it yet. If they ask you to fill in a form or an application, say plainly that the " +
      "record is empty, and offer to fill it by asking them a few questions or by reading a " +
      "document they upload on the Record tab. Never invent any of these facts."
    );
  }

  const missing = gaps(record).slice(0, 24);
  const missingBlock = missing.length
    ? `\n\nSTILL MISSING FROM THE RECORD (ask for these one at a time, never guess them):\n${missing
        .map((g) => `- ${g.label} (${g.section})`)
        .join("\n")}`
    : "\n\nNothing required is missing from the record.";

  return (
    "THE OWNER'S LIFE RECORD — the verified facts an application asks for. They entered these " +
    "themselves or confirmed them off their own documents, so use them verbatim; do not rephrase a " +
    "legal name, round a figure or reformat a date.\n\n" +
    out.join("\n\n") +
    missingBlock +
    "\n\nHOW TO USE IT\n" +
    "- Filling a form, a cover letter or an application: take every answer from the record above.\n" +
    "- A value shown as {{something}} is a real value this device is holding back from you on " +
    "purpose — a Social Security number, a licence number, a member ID. Write the {{token}} " +
    "exactly as shown, in the place the real value goes. The owner's device substitutes it when " +
    "they copy the answer out. Never ask them to type such a number into the chat, and never " +
    "guess one.\n" +
    "- A field that is missing is missing. Write `[missing: what you need]` in that answer's place " +
    "and list what you need at the end. An invented date of birth on a benefits form is a false " +
    "statement on a sworn document, so this rule does not bend.\n" +
    "- You prepare applications; you never submit one. Say so when it matters."
  ).slice(0, 9000);
}

const TOKEN = /\{\{\s*([a-z0-9_]+)(?:\.(\d+)\.([a-z0-9_]+))?\s*\}\}/gi;

export interface FilledText {
  text: string;
  /** Tokens that were replaced, by label, for the "filled in N values" line. */
  filled: string[];
  /** Tokens with nothing behind them — shown so nothing silently stays a stub. */
  unresolved: string[];
}

/**
 * Put the real values back. Runs on the owner's device only.
 *
 * Unknown tokens are left standing rather than blanked: a form with a visible
 * `{{medicaid_id}}` in it is obviously unfinished, and a form with a silent
 * empty space where the ID should be is not.
 */
export function fillTokens(text: string, record: LifeRecord): FilledText {
  const filled: string[] = [];
  const unresolved: string[] = [];

  const out = text.replace(TOKEN, (whole, a: string, n: string | undefined, b: string | undefined) => {
    if (n && b) {
      const group = GROUPS.find((g) => g.id === a);
      const entry = (record.groups[a] ?? [])[Number(n) - 1];
      const value = entry?.values[b];
      if (group && value) {
        filled.push(`${group.singular} ${n} — ${group.fields.find((f) => f.key === b)?.label ?? b}`);
        return value;
      }
      unresolved.push(whole);
      return whole;
    }
    const value = record.fields[a]?.value;
    if (value) {
      filled.push(FIELD_BY_KEY.get(a)?.field.label ?? a);
      return value;
    }
    unresolved.push(whole);
    return whole;
  });

  return { text: out, filled, unresolved };
}

/** True when the text has anything left to substitute. Drives the copy button. */
export function hasTokens(text: string): boolean {
  TOKEN.lastIndex = 0;
  return TOKEN.test(text);
}
