// ---------------------------------------------------------------------------
// Which Life Record fields Jev may offer when filling a box — names only.
//
// The page sends this list with each agent call so Jev can pick "your saved
// email" for an Email box. It carries KEYS AND LABELS, never values: the value
// is typed in by the owner's own tab (hub/record_fill), so it never reaches a
// server or a model. Sensitive fields (ID numbers, accounts…) are left off the
// list entirely, so they can't be picked even by mistake.
// ---------------------------------------------------------------------------

import { FIELD_BY_KEY, isSensitive, type LifeRecord } from "@/lib/jarvis/record/types";
import type { SavedField } from "./browserFast";

const MAX = 120;

/** Filled, non-sensitive single fields, as {key, label}. */
export function savedFields(record: LifeRecord | null | undefined): SavedField[] {
  if (!record?.fields) return [];
  const out: SavedField[] = [];
  for (const [key, fv] of Object.entries(record.fields)) {
    const def = FIELD_BY_KEY.get(key);
    if (!def || isSensitive(key) || !fv?.value?.trim()) continue;
    out.push({ key, label: def.field.label });
    if (out.length >= MAX) break;
  }
  return out;
}

/** The same list as it arrives from a request: untrusted, so re-checked against the catalogue. */
export function cleanSaved(raw: unknown): SavedField[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedField[] = [];
  for (const r of raw.slice(0, MAX)) {
    const key = typeof (r as SavedField)?.key === "string" ? (r as SavedField).key : "";
    const def = FIELD_BY_KEY.get(key);
    if (!def || isSensitive(key)) continue;
    out.push({ key, label: def.field.label });
  }
  return out;
}
