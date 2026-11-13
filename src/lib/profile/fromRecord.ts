// ---------------------------------------------------------------------------
// The life record, folded into the folder tree.
//
// New Jarvis made the 47-field Life Record *be* the Profile ("Record is gone.
// Its 47-field life record IS the Profile"). That framing is right; the form
// is the limit. A fixed catalogue of 47 fields cannot hold a DTF printer, a
// vendor, a friend's birthday or a domain renewal, which is the whole reason
// the folder tree exists.
//
// So the record is not replaced and not thrown away — it is IMPORTED. Every
// value lands in the folder it belongs to, keeping:
//
//   its provenance — `you` and `document` values arrive confirmed, because the
//     owner already stood behind them; only Jarvis's own guesses go to the
//     confirm queue. Flattening all 47 to "unconfirmed" would hand someone a
//     queue of their own answers on day one.
//
//   its sensitivity — `isSensitive()` decides what becomes a `secret` field,
//     so an SSN or a licence number is vault-held from the moment it arrives
//     rather than sitting in plain text until someone notices.
//
// The record store itself is untouched. This reads it; nothing here writes
// back, so RecordTab keeps working exactly as before.
// ---------------------------------------------------------------------------

import { getRecord } from "@/lib/jarvis/record/store";
import {
  FIELD_BY_KEY, GROUPS, entryTitle, groupById, groupField, isSensitive,
  type FieldDef, type FieldType, type LifeRecord, type ValueSource,
} from "@/lib/jarvis/record/types";
import type { Basics, Draft, FieldKind, Source } from "./types";

/** Record field types → Profile field kinds. `choice` is just text once chosen. */
const KIND_OF: Record<FieldType, FieldKind> = {
  text: "text",
  longtext: "multiline",
  date: "date",
  money: "money",
  phone: "phone",
  email: "email",
  choice: "text",
};

/**
 * Record provenance → Profile provenance.
 *
 * `document` becomes "import" rather than "you": the owner did not type it,
 * but they did hand over the document it was read off, so it is not a guess
 * either. Only `jarvis` lands as "ai" and therefore unconfirmed.
 */
const SOURCE_OF: Record<ValueSource, Source> = {
  you: "you",
  document: "import",
  jarvis: "ai",
};

/** Which folder each record section empties into. */
const SECTION_PATH: Record<string, { path: string[]; pack: string }> = {
  identity: { path: ["Me", "Identity & Documents"], pack: "" },
  contact: { path: ["Me", "Contact"], pack: "" },
  household: { path: ["Money", "Household"], pack: "" },
  work: { path: ["Work", "Preferences"], pack: "" },
  health: { path: ["Me", "Health"], pack: "health" },
};

/** Which folder each repeating group empties into, one child per entry. */
const GROUP_PATH: Record<string, { path: string[]; pack: string }> = {
  jobs: { path: ["Work", "Old Jobs"], pack: "job" },
  education: { path: ["Work", "Resume", "Education"], pack: "" },
  references: { path: ["People", "Work & Professional"], pack: "person" },
  documents: { path: ["Legal & Docs"], pack: "id-document" },
};

/**
 * Keys that belong in `basics` instead of a folder.
 *
 * They are the ones the Profile header shows, and a value in two places is a
 * conflict waiting to be raised by `buildQueue` — so these are claimed here
 * and skipped below.
 */
const BASICS_KEYS = new Set(["preferred_name", "legal_first", "legal_last", "dob", "email", "phone_mobile", "city", "state"]);

/** The street address, assembled from the pieces the record stores separately. */
function streetAddress(r: LifeRecord): string {
  const get = (k: string) => r.fields[k]?.value?.trim() ?? "";
  const line = [get("address_line1"), get("address_line2")].filter(Boolean).join(", ");
  const town = [get("city"), get("state")].filter(Boolean).join(", ");
  return [line, town, get("postal_code")].filter(Boolean).join(" ").trim();
}

export function basicsFromRecord(r: LifeRecord, current: Basics): Basics {
  const get = (k: string) => r.fields[k]?.value?.trim() ?? "";
  const legal = [get("legal_first"), get("legal_last")].filter(Boolean).join(" ");
  const town = [get("city"), get("state")].filter(Boolean).join(", ");
  // Never overwrite something the owner has already put in the header — an
  // import fills blanks, it does not take over.
  return {
    ...current,
    name: current.name || get("preferred_name") || legal,
    birthday: current.birthday || get("dob"),
    email: current.email || get("email"),
    phone: current.phone || get("phone_mobile"),
    location: current.location || town,
  };
}

function kindFor(def: FieldDef, key: string, groupId?: string): FieldKind {
  return isSensitive(key, groupId) || def.sensitive ? "secret" : KIND_OF[def.type] ?? "text";
}

/**
 * Turn a life record into drafts. Pure, so the mapping is testable without a
 * browser and without the store.
 */
export function draftsFromRecord(r: LifeRecord): Draft[] {
  const drafts: Draft[] = [];
  const push = (path: string[], pack: string, fields: Draft["fields"]) => {
    if (fields.length) drafts.push({ path, pack, fields });
  };

  // --- the flat sections -----------------------------------------------
  const bySection = new Map<string, Draft["fields"]>();
  for (const [key, held] of Object.entries(r.fields)) {
    const value = held?.value?.trim();
    if (!value || BASICS_KEYS.has(key)) continue;
    const found = FIELD_BY_KEY.get(key);
    // A key the catalogue no longer knows is kept rather than dropped: the
    // owner typed it once, and silently losing it is worse than an odd label.
    const label = found?.field.label ?? key.replace(/_/g, " ");
    const section = found?.section.id ?? "identity";
    const def = found?.field;
    bySection.set(section, [
      ...(bySection.get(section) ?? []),
      {
        label,
        kind: def ? kindFor(def, key) : "text",
        value,
        source: SOURCE_OF[held.source] ?? "import",
      },
    ]);
  }
  for (const [section, fields] of bySection) {
    const where = SECTION_PATH[section] ?? SECTION_PATH.identity;
    push(where.path, where.pack, fields);
  }

  // --- the address, as a place rather than five loose fields -------------
  const address = streetAddress(r);
  if (address) {
    push(["Home", "Property"], "property", [
      { label: "Address", kind: "address", value: address, source: SOURCE_OF[r.fields.address_line1?.source ?? "you"] },
    ]);
  }

  // --- the repeating groups ---------------------------------------------
  for (const group of GROUPS) {
    const entries = r.groups[group.id] ?? [];
    const where = GROUP_PATH[group.id];
    if (!where || !entries.length) continue;

    entries.forEach((entry, i) => {
      const fields: Draft["fields"] = [];
      for (const [key, raw] of Object.entries(entry.values)) {
        const value = String(raw ?? "").trim();
        if (!value) continue;
        const def = groupField(group.id, key);
        fields.push({
          label: def?.label ?? key.replace(/_/g, " "),
          kind: def ? kindFor(def, key, group.id) : "text",
          value,
          source: SOURCE_OF[entry.source] ?? "import",
        });
      }
      if (!fields.length) return;
      // `entryTitle` is what the Record UI itself calls this row, so the
      // folder is named the same thing the owner already recognises.
      const def = groupById(group.id);
      const title = (def ? entryTitle(def, entry) : "").trim() || `${group.singular} ${i + 1}`;
      push([...where.path, title], where.pack, fields);
    });
  }

  return drafts;
}

/** Read the live record out of its own store. Separated so tests stay pure. */
export function readRecordDrafts(): { drafts: Draft[]; record: LifeRecord } {
  const record = getRecord();
  return { drafts: draftsFromRecord(record), record };
}
