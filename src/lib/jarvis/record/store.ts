"use client";

// ---------------------------------------------------------------------------
// Where the Life Record lives.
//
// Same storage contract as every other app in the hub: localStorage is the
// read path, the Supabase `app_state` row is a second home for the same bytes
// (src/lib/sync/appState.ts). It gets its own key rather than riding inside
// the main `jarvis` blob for one reason — this is the one store in the app
// that holds a Social Security number, and a store you may one day want to
// wipe or keep off a device has to be wipeable and keepable on its own.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { coerceRecord } from "./coerce";
import {
  entryTitle,
  FIELD_BY_KEY,
  GROUPS,
  groupById,
  groupField,
  SECTIONS,
  type FieldDef,
  type GroupEntry,
  type LifeRecord,
  type Need,
  type ValueSource,
} from "./types";

export const RECORD_KEY = "jarvis-record";

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function getRecord(): LifeRecord {
  return coerceRecord(loadLocal<unknown>(RECORD_KEY, null));
}

export function saveRecord(record: LifeRecord): LifeRecord {
  const next = { ...record, updatedAt: new Date().toISOString() };
  saveSynced(RECORD_KEY, next);
  return next;
}

/** A value the owner cleared is removed, not stored as "". */
export function setField(
  record: LifeRecord,
  key: string,
  value: string,
  source: ValueSource = "you",
  origin?: string,
): LifeRecord {
  if (!FIELD_BY_KEY.has(key)) return record;
  const fields = { ...record.fields };
  if (!value.trim()) delete fields[key];
  else fields[key] = { value: value.trim(), updatedAt: new Date().toISOString(), source, origin };
  return { ...record, fields };
}

export function setFields(
  record: LifeRecord,
  values: Record<string, string>,
  source: ValueSource,
  origin?: string,
): LifeRecord {
  let next = record;
  for (const [key, value] of Object.entries(values)) next = setField(next, key, value, source, origin);
  return next;
}

export function addEntry(
  record: LifeRecord,
  groupId: string,
  values: Record<string, string>,
  source: ValueSource = "you",
  origin?: string,
): LifeRecord {
  const group = groupById(groupId);
  if (!group) return record;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (groupField(groupId, k) && typeof v === "string" && v.trim()) clean[k] = v.trim();
  }
  const entry: GroupEntry = { id: uid(), values: clean, updatedAt: new Date().toISOString(), source, origin };
  const rows = [...(record.groups[groupId] ?? []), entry].slice(0, 40);
  return { ...record, groups: { ...record.groups, [groupId]: rows } };
}

export function updateEntry(
  record: LifeRecord,
  groupId: string,
  entryId: string,
  values: Record<string, string>,
): LifeRecord {
  const rows = record.groups[groupId];
  if (!rows) return record;
  return {
    ...record,
    groups: {
      ...record.groups,
      [groupId]: rows.map((e) => {
        if (e.id !== entryId) return e;
        const merged = { ...e.values };
        for (const [k, v] of Object.entries(values)) {
          if (!groupField(groupId, k)) continue;
          if (v.trim()) merged[k] = v.trim();
          else delete merged[k];
        }
        return { ...e, values: merged, updatedAt: new Date().toISOString(), source: "you" as ValueSource };
      }),
    },
  };
}

export function removeEntry(record: LifeRecord, groupId: string, entryId: string): LifeRecord {
  const rows = record.groups[groupId];
  if (!rows) return record;
  return { ...record, groups: { ...record.groups, [groupId]: rows.filter((e) => e.id !== entryId) } };
}

export interface Gap {
  key: string;
  label: string;
  section: string;
  need: Need;
}

/**
 * What is still missing, for a given kind of application.
 *
 * `optional` fields are never gaps — a gap is something a form WILL stop on,
 * and calling a nice-to-have a gap is how a to-do list becomes noise. A group
 * with no entries counts as one gap named after the group, not one per field:
 * "no work history yet" is the useful sentence, not ten empty employer fields.
 */
export function gaps(record: LifeRecord, scope: Need | "all" = "all"): Gap[] {
  const wants = (n: Need) => n !== "optional" && (scope === "all" || n === "core" || n === scope);
  const out: Gap[] = [];
  for (const section of SECTIONS) {
    for (const f of section.fields) {
      if (!wants(f.need)) continue;
      if (record.fields[f.key]?.value) continue;
      out.push({ key: f.key, label: f.label, section: section.label, need: f.need });
    }
  }
  for (const g of GROUPS) {
    if (!wants(g.need)) continue;
    if ((record.groups[g.id] ?? []).length) continue;
    out.push({ key: g.id, label: `No ${g.label.toLowerCase()} recorded`, section: g.label, need: g.need });
  }
  return out;
}

export interface Completeness {
  filled: number;
  total: number;
  percent: number;
}

/** How full the record is for a scope. Groups count as one slot each. */
export function completeness(record: LifeRecord, scope: Need | "all" = "all"): Completeness {
  const wants = (n: Need) => n !== "optional" && (scope === "all" || n === "core" || n === scope);
  let filled = 0;
  let total = 0;
  for (const section of SECTIONS) {
    for (const f of section.fields) {
      if (!wants(f.need)) continue;
      total += 1;
      if (record.fields[f.key]?.value) filled += 1;
    }
  }
  for (const g of GROUPS) {
    if (!wants(g.need)) continue;
    total += 1;
    if ((record.groups[g.id] ?? []).length) filled += 1;
  }
  return { filled, total, percent: total ? Math.round((filled / total) * 100) : 0 };
}

/** Masked for display: the last four of an SSN, nothing of anything else. */
export function maskValue(def: FieldDef, value: string): string {
  if (!def.sensitive || !value) return value;
  const tail = value.replace(/\D/g, "").slice(-4);
  return tail ? `••• •• ${tail}` : "•".repeat(Math.min(12, value.length));
}

export { entryTitle, coerceRecord };
