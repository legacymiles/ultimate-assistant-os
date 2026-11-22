"use client";

// ---------------------------------------------------------------------------
// The Bills tab's one hook.
//
// It holds two things that change independently: the bills blob (typed bills,
// paid marks, corrections) and the Profiles blob (where most bills actually
// live). Profiles is re-read rather than copied, and re-read again whenever
// another tab writes it, so a bill added to a profile shows up here without
// anything being synced by hand.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadLocal } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { scopedKey } from "@/lib/sync/identity";
import { seedProfiles } from "@/lib/profiles/seed";
import { STORE_KEY as PROFILES_KEY } from "@/lib/profiles/useProfiles";
import type { ProfilesData } from "@/lib/profiles/types";
import { billsFromProfiles, profilesWithBills } from "./fromProfiles";
import {
  BILLS_KEY,
  createBill,
  load,
  removeBill,
  setOverride,
  setPaid,
  updateBill,
  type BillInput,
} from "./store";
import { allBills } from "./view";
import type { Bill, BillOverride, BillsData, Day } from "./types";

function loadProfiles(): ProfilesData {
  const got = loadLocal<ProfilesData | null>(PROFILES_KEY, null);
  return got && got.version === 1 && got.nodes?.root ? got : seedProfiles();
}

export interface BillsStore {
  data: BillsData;
  /** Typed and profile bills as one list, corrections applied. */
  bills: Bill[];
  /** The main profiles that have bills — the filter chips. */
  profiles: { id: string; name: string; count: number; hue?: number }[];
  /** False until the saved copy has replaced the first render's seed. */
  ready: boolean;
  add: (input: BillInput) => void;
  update: (id: string, patch: Partial<Bill>) => void;
  remove: (bill: Bill) => void;
  confirmPaid: (id: string, due: Day, paid: boolean) => void;
  correct: (id: string, patch: BillOverride) => void;
  refresh: () => void;
}

export function useBills(today: Day): BillsStore {
  // The server and the first client frame must render the same markup, so the
  // saved copy is read in an effect rather than during the first render.
  const [data, setData] = useState<BillsData>(() => ({ version: 1, bills: [], paid: {}, overrides: {} }));
  const [profilesData, setProfilesData] = useState<ProfilesData>(() => seedProfiles());
  const [ready, setReady] = useState(false);

  const refresh = useCallback(() => {
    setData(load());
    setProfilesData(loadProfiles());
    setReady(true);
  }, []);

  useEffect(refresh, [refresh]);

  // A bill typed on the phone, or a profile edited in another tab.
  useRemotePull(BILLS_KEY, refresh);
  useRemotePull(PROFILES_KEY, refresh);

  useEffect(() => {
    const keys = new Set([scopedKey(BILLS_KEY), scopedKey(PROFILES_KEY)]);
    const onStorage = (e: StorageEvent) => {
      if (!e.key || keys.has(e.key)) refresh();
    };
    const onFocus = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    // Profiles fires this after every save it makes.
    window.addEventListener("jarvis:record-changed", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("jarvis:record-changed", onFocus);
    };
  }, [refresh]);

  const fromProfiles = useMemo(
    () => billsFromProfiles(profilesData, { today }),
    [profilesData, today],
  );

  const bills = useMemo(
    () => allBills(data.bills, fromProfiles, data.overrides),
    [data.bills, data.overrides, fromProfiles],
  );

  const profiles = useMemo(() => profilesWithBills(profilesData, bills), [profilesData, bills]);

  return {
    data,
    bills,
    profiles,
    ready,
    add: useCallback((input: BillInput) => setData(createBill(input)), []),
    update: useCallback((id: string, patch: Partial<Bill>) => setData(updateBill(id, patch)), []),
    remove: useCallback((bill: Bill) => {
      // A bill Profiles owns cannot be deleted from here — the row is still in
      // the profile. It is taken off the tab instead, and can come back.
      setData(bill.source === "profiles" ? setOverride(bill.id, { dropped: true }) : removeBill(bill.id));
    }, []),
    confirmPaid: useCallback((id: string, due: Day, paid: boolean) => setData(setPaid(id, due, paid)), []),
    correct: useCallback((id: string, patch: BillOverride) => setData(setOverride(id, patch)), []),
    refresh,
  };
}
