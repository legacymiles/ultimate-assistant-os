// ---------------------------------------------------------------------------
// The picture behind the facts.
//
// Reading a screen produces values; this is what keeps the thing they were
// read FROM. The point is narrow and worth stating, because "save screenshots"
// would be a different and much worse feature:
//
//   A kept picture is EVIDENCE, not an album. It exists so "where did this
//   member ID come from?" has an answer you can look at, and so the card
//   itself is on your phone at the clinic desk — which is the moment the
//   whole Record was built for.
//
// So two rules run through this file.
//
//   1. ONLY DOCUMENTS ARE OFFERED. A scan of a tab full of nothing proposes
//      no picture at all. Hoarding every frame would turn the profile into a
//      camera roll nobody opens, and a store of unreviewed screenshots of the
//      owner's screen is a liability rather than a feature.
//   2. THE PICTURE INHERITS THE WORST SECRET ON IT. An insurance card shows a
//      member ID, which the Record marks sensitive and masks. A photograph of
//      that card that rendered openly beside the masked field would make the
//      masking theatre. If any value read off it is sensitive, the picture is.
//
// The BYTES ARE NOT IN HERE and are not in the record blob. The record syncs
// through app_state, which is whole-blob last-write-wins — a few hundred
// kilobytes of base64 per card would slow every save of a store that also
// holds a Social Security number, and lose a race besides. This file holds the
// metadata; fileStore.ts puts the bytes somewhere that can hold bytes.
// ---------------------------------------------------------------------------

import { FIELD_BY_KEY, isSensitive, labelForKey, parseKey, type LifeRecord, type ValueSource } from "./types";

/** Past this, the oldest is dropped. A profile is not a camera roll. */
export const MAX_FILES = 24;

/** Bigger than a 1800px JPEG of a card has any reason to be. */
export const MAX_BYTES = 6_000_000;

/** Where the bytes actually landed. Said plainly, never guessed at. */
export type FileHome = "synced" | "device";

export interface RecordFile {
  /** Also the storage key. */
  id: string;
  /** What it is: "Insurance card". Never a filename. */
  label: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  addedAt: string;
  source: ValueSource;
  /** How it was taken: "read off your screen". */
  origin?: string;
  /** The record keys this picture is the proof of. */
  evidenceFor: string[];
  /** Shows something the Record masks. Hidden until asked for. */
  sensitive: boolean;
  where: FileHome;
}

// --- what a scan was looking at --------------------------------------------

/**
 * The documents worth keeping, and the keys that give one away.
 *
 * Ordered most specific first, because a card that yields both a member ID and
 * a blood type is an insurance card, not a "medical record" — the first match
 * wins and the order is the whole ranking.
 */
const DOCUMENTS: { label: string; keys: string[]; needs?: number; must?: string }[] = [
  { label: "Insurance card", keys: ["insurance_carrier", "insurance_member_id", "insurance_group", "insurance_plan"] },
  { label: "Medicaid card", keys: ["medicaid_id"] },
  { label: "Social Security card", keys: ["ssn"] },
  { label: "Driver's licence", keys: ["license_number", "license_state", "drivers_license"], needs: 2 },
  { label: "Pay stub", keys: ["monthly_gross", "pay_frequency", "household_monthly_gross"], needs: 2 },
  { label: "Medical record", keys: ["blood_type", "allergies", "medications", "conditions", "gp_name"], needs: 2 },
  { label: "Benefits letter", keys: ["household_size", "tax_filing", "current_insurance", "county"], needs: 2 },
  // `must` and not just a count: a name and a date of birth are on nearly
  // every page the owner will ever scan, so counting alone would offer to keep
  // a picture of most of them. Place of birth is what a passport or a birth
  // certificate shows and an ordinary form does not ask for.
  { label: "Identity document", keys: ["legal_first", "legal_last", "dob", "birthplace", "other_names", "citizenship"], needs: 3, must: "birthplace" },
];

export interface DocumentGuess {
  label: string;
  /** True when the Record would mask at least one value read off it. */
  sensitive: boolean;
  /** The keys that made this a document, for `evidenceFor`. */
  keys: string[];
}

/**
 * What document those keys came off, or nothing.
 *
 * Nothing is the common and correct answer. A scan of an ordinary web page
 * yields a name and an email, which is not a document, and offering to keep a
 * picture of it is how this feature would turn into clutter.
 *
 * `needs` exists because one field is not a document: a lone `blood_type` is a
 * sentence on a page, while a blood type and an allergy list together are a
 * medical record. The single-key entries are the ones where that one key only
 * ever appears on the card itself.
 */
export function looksLikeDocument(keys: string[]): DocumentGuess | null {
  const seen = new Set(keys.map((k) => parseKey(k)?.field ?? k));
  for (const doc of DOCUMENTS) {
    if (doc.must && !seen.has(doc.must)) continue;
    const hit = doc.keys.filter((k) => seen.has(k));
    if (hit.length < (doc.needs ?? 1)) continue;
    // Everything the scan found belongs to the picture, not just the keys that
    // identified it — the card shows the lot.
    const evidence = keys.filter((k) => FIELD_BY_KEY.has(parseKey(k)?.field ?? k) || parseKey(k));
    return { label: doc.label, sensitive: anySensitive(evidence), keys: evidence };
  }
  return null;
}

/** True when the Record masks any of these keys. An unknown key counts as yes. */
export function anySensitive(keys: string[]): boolean {
  return keys.some((key) => {
    const parsed = parseKey(key);
    return parsed ? isSensitive(parsed.field, parsed.groupId) : true;
  });
}

// --- the record ------------------------------------------------------------

export function addFile(record: LifeRecord, file: RecordFile): LifeRecord {
  const files = [file, ...(record.files ?? []).filter((f) => f.id !== file.id)].slice(0, MAX_FILES);
  return { ...record, files };
}

export function removeFile(record: LifeRecord, id: string): LifeRecord {
  const files = (record.files ?? []).filter((f) => f.id !== id);
  return { ...record, files };
}

export function fileById(record: LifeRecord, id: string): RecordFile | undefined {
  return (record.files ?? []).find((f) => f.id === id);
}

/** Every picture that proves a given field — the answer to "says who?". */
export function evidenceFor(record: LifeRecord, key: string): RecordFile[] {
  return (record.files ?? []).filter((f) => f.evidenceFor.includes(key));
}

/** The files that fell off the end of MAX_FILES, so their bytes can be reaped. */
export function droppedBy(before: LifeRecord, after: LifeRecord): RecordFile[] {
  const kept = new Set((after.files ?? []).map((f) => f.id));
  return (before.files ?? []).filter((f) => !kept.has(f.id));
}

// --- words -----------------------------------------------------------------

/** What it proves, in the Record's own words: "Member ID, Group number". */
export function provesWhat(file: RecordFile, max = 4): string {
  const names = file.evidenceFor.map((k) => labelForKey(k)).filter((v): v is string => Boolean(v));
  if (!names.length) return "";
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const HOME_LABEL: Record<FileHome, string> = {
  synced: "on your account",
  device: "this device only",
};

/** One line under the thumbnail. Says where it is, because it varies. */
export function describeFile(file: RecordFile): string {
  const parts = [formatBytes(file.bytes), HOME_LABEL[file.where]];
  if (file.origin) parts.unshift(file.origin);
  return parts.join(" · ");
}

/** Roughly how big the stored bytes are, from a data URL, without decoding it. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const b64 = dataUrl.length - comma - 1;
  const pad = dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64 * 3) / 4) - pad);
}
