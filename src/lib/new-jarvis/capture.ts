"use client";

// ---------------------------------------------------------------------------
// Moving a value from a page into the Life Record without a model seeing it.
//
// This is the half of "save what you read" that keeps the owner's existing
// rule intact. Their Record was built so that sensitive values reach neither
// the model nor the server — and `record_set`, the tool the model can call,
// enforces that by refusing any key `isSensitive` flags, which is every key it
// does not explicitly know to be safe.
//
// So the model never carries these. The bridge reads the form and hands the
// VALUES back to this tab over loopback; the runner strips them before the
// step result is sent upstream (exactly as it strips a screenshot); the model
// is shown only keys, labels and masked previews, and decides WHICH field is
// worth keeping. Then this function does the writing, locally, from the copy
// the tab already held.
//
// The value's journey is: the owner's page → their own bridge → their own tab
// → their own Record. It never leaves the machine and it is never in a prompt.
// ---------------------------------------------------------------------------

import type { LifeRecord } from "@/lib/jarvis/record/types";

export interface CaptureRequest {
  /** Record field key → the value held in this tab for it. */
  values: Record<string, string>;
  /** Where it came from, shown in the Record beside each value. */
  origin: string;
}

export interface CaptureResult {
  written: string[];
  skipped: string[];
}

/**
 * Write held values into the Record.
 *
 * Uses `setField` directly rather than `record_set`, on purpose: `record_set`
 * refuses sensitive keys because its values arrive through a prompt. These did
 * not, so the reason for that refusal does not apply — but the storage is the
 * same store, in the same shape, with the same provenance trail, so the Record
 * tab cannot tell a captured value from a typed one except by its origin line.
 */
export async function captureToRecord({ values, origin }: CaptureRequest): Promise<CaptureResult> {
  const { getRecord, saveRecord, setField } = await import("@/lib/jarvis/record/store");

  let record: LifeRecord = getRecord();
  const written: string[] = [];
  const skipped: string[] = [];

  for (const [key, raw] of Object.entries(values)) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!key || !value) {
      skipped.push(key || "(no key)");
      continue;
    }
    const before = record;
    record = setField(record, key, value, "jarvis", origin);
    if (record !== before) written.push(key);
    else skipped.push(key);
  }

  if (written.length) saveRecord(record);
  return { written, skipped };
}

/**
 * The values a page handed this tab, for the life of the tab only.
 *
 * Never written into a block, never persisted, never sent upstream. A reload
 * loses them, which is correct: they are a page's contents, not the owner's
 * record, until they are deliberately captured into it.
 */
export class FieldStash {
  private held = new Map<string, string>();
  private at = 0;

  /** Keep what a `page_fields` call returned. Replaces any earlier page. */
  put(values: Record<string, string>): void {
    this.held.clear();
    for (const [k, v] of Object.entries(values ?? {})) {
      if (typeof v === "string" && v) this.held.set(k, v);
    }
    this.at = Date.now();
  }

  /** The keys currently held, for telling the model what it may name. */
  keys(): string[] {
    return [...this.held.keys()];
  }

  /**
   * Resolve the keys the model named into real values.
   *
   * A key it invented resolves to nothing rather than to an empty string, so a
   * hallucinated field cannot quietly overwrite a real one with blank.
   */
  take(keys: string[]): { values: Record<string, string>; missing: string[] } {
    const values: Record<string, string> = {};
    const missing: string[] = [];
    for (const k of keys) {
      const v = this.held.get(k);
      if (v) values[k] = v;
      else missing.push(k);
    }
    return { values, missing };
  }

  get size(): number {
    return this.held.size;
  }

  /** Whether anything is held, and how old it is — for the "nothing to capture" message. */
  get readAt(): number {
    return this.at;
  }

  clear(): void {
    this.held.clear();
    this.at = 0;
  }
}
