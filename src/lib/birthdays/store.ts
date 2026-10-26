"use client";

// ---------------------------------------------------------------------------
// Birthdays — the one place they live (synced key `jarvis-birthdays:v1`).
//
// localStorage is the read path and saveSynced pushes a copy to app_state, so
// a birthday added on the phone is on the laptop's calendar too. Everything
// else (Calendar tab, Calendar widget, notifications, chat context) DERIVES
// from this list — see engine.ts — so there is never a second copy to drift.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { coerceBirthdays, removeBirthday, upsertBirthday, type Birthday, type BirthdayInput, type UpsertResult } from "./engine";

export const BIRTHDAYS_KEY = "jarvis-birthdays:v1";
export const BIRTHDAYS_CHANGED = "jarvis-birthdays-changed";

export function getBirthdays(): Birthday[] {
  return coerceBirthdays(loadLocal<unknown>(BIRTHDAYS_KEY, { people: [] }));
}

function save(list: Birthday[]): Birthday[] {
  saveSynced(BIRTHDAYS_KEY, { people: list });
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BIRTHDAYS_CHANGED));
  return list;
}

/** Add someone's birthday, or update it if they're already on the list. */
export function addBirthday(input: BirthdayInput): UpsertResult | { error: string } {
  const out = upsertBirthday(getBirthdays(), input);
  if ("error" in out) return out;
  save(out.list);
  return out;
}

export function deleteBirthday(idOrName: string): Birthday | null {
  const out = removeBirthday(getBirthdays(), idOrName);
  if (out.removed) save(out.list);
  return out.removed;
}

/** Put a removed birthday back exactly as it was (Undo). */
export function restoreBirthday(b: Birthday): void {
  const list = getBirthdays().filter((x) => x.id !== b.id);
  save([b, ...list]);
}

/** The live list, for any component. Follows other tabs and other devices. */
export function useBirthdays(): { list: Birthday[]; refresh: () => void } {
  const [list, setList] = useState<Birthday[]>([]);
  const refresh = useCallback(() => setList(getBirthdays()), []);
  useEffect(() => {
    refresh();
    window.addEventListener(BIRTHDAYS_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(BIRTHDAYS_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);
  useRemotePull(BIRTHDAYS_KEY, refresh);
  return { list, refresh };
}
