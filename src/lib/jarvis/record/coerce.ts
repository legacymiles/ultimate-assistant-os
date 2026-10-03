// ---------------------------------------------------------------------------
// Reading a stored record back, without trusting it.
//
// Split out of store.ts, which is a "use client" module, because the server
// needs this too: the Record tab posts its record to the snapshot route, and a
// route that trusted that body would be trusting the network. Same function,
// both ends, so a blob that is safe in the browser is safe on the server.
// ---------------------------------------------------------------------------

import { MAX_FILES, type FileHome, type RecordFile } from "./files";
import {
  emptyRecord,
  FIELD_BY_KEY,
  GROUPS,
  parseKey,
  type GroupEntry,
  type LifeRecord,
} from "./types";

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Coerce whatever is in storage into a record. A corrupt blob is not a crash. */
export function coerceRecord(v: unknown): LifeRecord {
  const raw = (v ?? {}) as Partial<LifeRecord>;
  const out = emptyRecord();

  if (raw.fields && typeof raw.fields === "object") {
    for (const [key, val] of Object.entries(raw.fields)) {
      if (!FIELD_BY_KEY.has(key)) continue; // A key we retired, or never had.
      const o = (val ?? {}) as Partial<LifeRecord["fields"][string]>;
      const value = typeof o.value === "string" ? o.value : "";
      if (!value.trim()) continue;
      out.fields[key] = {
        value,
        updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "",
        source: o.source === "document" || o.source === "jarvis" ? o.source : "you",
        origin: typeof o.origin === "string" ? o.origin : undefined,
      };
    }
  }

  if (raw.groups && typeof raw.groups === "object") {
    for (const group of GROUPS) {
      const rows = (raw.groups as Record<string, unknown>)[group.id];
      if (!Array.isArray(rows)) continue;
      out.groups[group.id] = rows.slice(0, 40).map((r) => {
        const o = (r ?? {}) as Partial<GroupEntry>;
        const values: Record<string, string> = {};
        if (o.values && typeof o.values === "object") {
          for (const f of group.fields) {
            const s = (o.values as Record<string, unknown>)[f.key];
            if (typeof s === "string" && s.trim()) values[f.key] = s;
          }
        }
        return {
          id: typeof o.id === "string" && o.id ? o.id : uid(),
          values,
          updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "",
          source: o.source === "document" || o.source === "jarvis" ? o.source : "you",
          origin: typeof o.origin === "string" ? o.origin : undefined,
        };
      });
    }
  }

  if (Array.isArray(raw.files)) {
    out.files = raw.files.slice(0, MAX_FILES).map(coerceFile).filter((f): f is RecordFile => f !== null);
  }

  out.updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : "";
  return out;
}

/**
 * One kept picture, or nothing.
 *
 * `sensitive` is the field worth being careful about. It is never recomputed
 * from the keys here and never defaulted to false: a stored true survives even
 * if the key list is unreadable, because the failure modes are not symmetric —
 * hiding a picture that did not need hiding costs a click, and revealing one
 * that did is the whole thing this flag exists to prevent.
 */
function coerceFile(v: unknown): RecordFile | null {
  const o = (v ?? {}) as Partial<RecordFile>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  if (typeof o.mime !== "string" || !o.mime.startsWith("image/")) return null;

  const keys = Array.isArray(o.evidenceFor)
    ? o.evidenceFor.filter((k): k is string => typeof k === "string" && parseKey(k) !== null)
    : [];

  return {
    id: o.id,
    label: typeof o.label === "string" && o.label.trim() ? o.label.trim() : "Document",
    mime: o.mime,
    bytes: typeof o.bytes === "number" && o.bytes > 0 ? Math.round(o.bytes) : 0,
    width: typeof o.width === "number" ? o.width : undefined,
    height: typeof o.height === "number" ? o.height : undefined,
    addedAt: typeof o.addedAt === "string" ? o.addedAt : "",
    source: o.source === "you" || o.source === "document" ? o.source : "jarvis",
    origin: typeof o.origin === "string" ? o.origin : undefined,
    evidenceFor: keys,
    sensitive: o.sensitive !== false,
    where: (o.where === "device" ? "device" : "synced") as FileHome,
  };
}
