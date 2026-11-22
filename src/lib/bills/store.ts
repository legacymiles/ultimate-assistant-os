// ---------------------------------------------------------------------------
// Bills — the store.
//
// Same shape as the calendar's own store (lib/recall/calendar/store.ts):
// localStorage is the read path, every write also pushes to the owner's
// app_state row, so the bills follow the account onto the phone.
//
// Its OWN key, not folded into the calendar blob: bills are written from a
// different surface and a shared blob would make every tick of a checkmark
// re-push every event under last-write-wins.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { nowIso, uid } from "@/lib/utils";
import { emptyBills, paidKey, type Bill, type BillOverride, type BillsData, type Day } from "./types";

export const BILLS_KEY = "jarvis-bills:v1";

/** Fill in fields added after a bill was first written. */
function normalize(b: Bill): Bill {
  return {
    ...b,
    currency: b.currency || "USD",
    cadence: b.cadence ?? "monthly",
    dayOfMonth: b.dayOfMonth ?? null,
    weekday: b.weekday ?? null,
    monthOfYear: b.monthOfYear ?? null,
    endDate: b.endDate ?? null,
    autopay: b.autopay === true,
    paused: b.paused === true,
    profileId: b.profileId ?? null,
    profileName: b.profileName ?? null,
    ownerId: b.ownerId ?? null,
    ownerName: b.ownerName ?? null,
    source: b.source === "profiles" ? "profiles" : "typed",
  };
}

export function load(): BillsData {
  const got = loadLocal<BillsData | null>(BILLS_KEY, null);
  if (!got || got.version !== 1 || !Array.isArray(got.bills)) return emptyBills();
  return {
    version: 1,
    bills: got.bills.map(normalize),
    paid: got.paid && typeof got.paid === "object" ? got.paid : {},
    overrides: got.overrides && typeof got.overrides === "object" ? got.overrides : {},
  };
}

function save(data: BillsData): BillsData {
  saveSynced(BILLS_KEY, data);
  return data;
}

export interface BillInput {
  name: string;
  amount: number;
  cadence: Bill["cadence"];
  dayOfMonth?: number | null;
  weekday?: number | null;
  monthOfYear?: number | null;
  firstDue: Day;
  endDate?: Day | null;
  currency?: string;
  autopay?: boolean;
  notes?: string;
  profileId?: string | null;
  profileName?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  where?: string;
}

export function createBill(input: BillInput): BillsData {
  const data = load();
  const at = nowIso();
  const bill: Bill = normalize({
    id: uid("bill"),
    name: input.name.trim() || "Untitled bill",
    amount: Number(input.amount) || 0,
    currency: input.currency ?? "USD",
    cadence: input.cadence,
    dayOfMonth: input.dayOfMonth ?? null,
    weekday: input.weekday ?? null,
    monthOfYear: input.monthOfYear ?? null,
    firstDue: input.firstDue,
    endDate: input.endDate ?? null,
    autopay: input.autopay === true,
    paused: false,
    notes: input.notes,
    profileId: input.profileId ?? null,
    profileName: input.profileName ?? null,
    ownerId: input.ownerId ?? null,
    ownerName: input.ownerName ?? null,
    where: input.where,
    source: "typed",
    createdAt: at,
    updatedAt: at,
  });
  return save({ ...data, bills: [...data.bills, bill] });
}

export function updateBill(id: string, patch: Partial<Bill>): BillsData {
  const data = load();
  return save({
    ...data,
    bills: data.bills.map((b) => (b.id === id ? normalize({ ...b, ...patch, id: b.id, updatedAt: nowIso() }) : b)),
  });
}

/** Removes a typed bill. A profile bill is dropped with an override instead. */
export function removeBill(id: string): BillsData {
  const data = load();
  const paid = { ...data.paid };
  for (const k of Object.keys(paid)) if (k.startsWith(`${id}|`)) delete paid[k];
  return save({ ...data, bills: data.bills.filter((b) => b.id !== id), paid });
}

/**
 * Confirm (or un-confirm) one occurrence as paid. Per occurrence, not per
 * bill: October's rent being paid says nothing about November's.
 */
export function setPaid(id: string, due: Day, paid: boolean): BillsData {
  const data = load();
  const next = { ...data.paid };
  if (paid) next[paidKey(id, due)] = nowIso();
  else delete next[paidKey(id, due)];
  return save({ ...data, paid: next });
}

export function setOverride(id: string, patch: BillOverride): BillsData {
  const data = load();
  const current = data.overrides[id] ?? {};
  const merged = { ...current, ...patch };
  const overrides = { ...data.overrides, [id]: merged };
  // An override with nothing left in it is noise in the blob.
  if (Object.values(merged).every((v) => v === undefined)) delete overrides[id];
  return save({ ...data, overrides });
}

export function clearOverride(id: string): BillsData {
  const data = load();
  const overrides = { ...data.overrides };
  delete overrides[id];
  return save({ ...data, overrides });
}
