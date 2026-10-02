"use client";

// ---------------------------------------------------------------------------
// The vault, alive.
//
// The crypto and the state machine are pure and tested next door. This is the
// untestable half: storage, the in-memory key, the idle lock, and the migration
// that takes passwords out of the clear.
//
// Two rules the rest of the feature rests on:
//
//   THE DATA KEY NEVER LEAVES MEMORY. Not localStorage, not sessionStorage,
//   not the synced blob. Closing the tab locks the vault, because the only copy
//   of the key was in the tab. Anything else would be a vault whose key is
//   stored next to the lock.
//
//   MIGRATING CLEARS THE PLAINTEXT. Sealing a password and leaving the readable
//   copy in `recall:v1` would be theatre — the whole point is that the owner's
//   Supabase row stops containing passwords. The clear-down is part of the same
//   step, and a failure to seal means nothing is cleared.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { allCredentials, setItemPassword } from "@/lib/recall/store";
import {
  changePassword as rewrap,
  createEnvelope,
  decryptSecret,
  encryptSecret,
  reissueRecovery,
  unlockWithPassword,
  unlockWithRecovery,
  type Opened,
} from "./crypto";
import {
  canAcceptSecrets,
  coerceVault,
  count,
  describeVault,
  emptyVault,
  markExported,
  planMigration,
  putSecret,
  reissued,
  removeSecret,
  setEnvelope,
  VAULT_KEY,
  vaultState,
  type Login,
  type MigrationPlan,
  type VaultBlob,
  type VaultState,
} from "./vault";

/**
 * How long an unlocked vault stays unlocked without being touched.
 *
 * A vault that stays open until the tab closes is a plaintext vault with extra
 * steps — this surface lives in a tab that is open all day.
 */
export const IDLE_LOCK_MS = 15 * 60_000;

export interface UsePasswordVault {
  blob: VaultBlob;
  state: VaultState;
  /** True while the data key is in memory. */
  unlocked: boolean;
  /** Every saved login across every folder, with whether its secret is sealed yet. */
  logins: (Login & { sealed: boolean })[];
  plan: MigrationPlan;
  summary: string;
  busy: string;
  error: string;
  /** Set once, immediately after creation or a reissue. Shown once, then dropped. */
  freshRecoveryKey: string | null;

  create: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  recover: (recoveryKey: string) => Promise<boolean>;
  lock: () => void;
  confirmExported: () => void;
  changePassword: (next: string) => Promise<boolean>;
  newRecoveryKey: () => Promise<void>;
  /** Seal every plaintext password and clear the readable copies. */
  migrate: () => Promise<number>;
  reveal: (id: string) => Promise<string | null>;
  put: (id: string, secret: string) => Promise<boolean>;
  forget: (id: string) => void;
  dismissRecoveryKey: () => void;
}

export function usePasswordVault(): UsePasswordVault {
  const [blob, setBlob] = useState<VaultBlob>(emptyVault);
  const [logins, setLogins] = useState<(Login & { sealed: boolean })[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [freshRecoveryKey, setFresh] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  // The only copy of the data key, for as long as the tab lives.
  const opened = useRef<Opened | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readLogins = useCallback((current: VaultBlob) => {
    const rows = allCredentials().map((item) => ({
      id: item.id,
      title: item.title,
      password: item.password ?? null,
      hasLegacySecret: Boolean(item.secret),
      sealed: Boolean(current.secrets[item.id]),
    }));
    setLogins(rows);
  }, []);

  const reload = useCallback(() => {
    const next = coerceVault(loadLocal<unknown>(VAULT_KEY, emptyVault()));
    setBlob(next);
    readLogins(next);
  }, [readLogins]);

  useEffect(reload, [reload]);
  useRemotePull(VAULT_KEY, reload);

  const commit = useCallback(
    (next: VaultBlob) => {
      setBlob(next);
      saveSynced(VAULT_KEY, next);
      readLogins(next);
      return next;
    },
    [readLogins],
  );

  // --- the idle lock -------------------------------------------------------

  const lock = useCallback(() => {
    opened.current = null;
    setUnlocked(false);
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
  }, []);

  const touch = useCallback(() => {
    if (!opened.current) return;
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(lock, IDLE_LOCK_MS);
  }, [lock]);

  useEffect(() => {
    if (!unlocked) return;
    const on = () => touch();
    window.addEventListener("pointerdown", on);
    window.addEventListener("keydown", on);
    touch();
    return () => {
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
    };
  }, [touch, unlocked]);

  // The key is in memory only, so a closed tab is a locked vault. Explicit
  // anyway, so nothing can keep a reference alive past unmount.
  useEffect(() => () => lock(), [lock]);

  // --- setting up and opening ---------------------------------------------

  const create = useCallback(
    async (password: string) => {
      setError("");
      setBusy("Making the vault…");
      try {
        const made = await createEnvelope(password);
        opened.current = { dek: made.dek, raw: made.raw };
        setUnlocked(true);
        // The gate starts SHUT: setEnvelope without markExported. Nothing can
        // go in until the recovery key has been written down.
        commit(setEnvelope(coerceVault(loadLocal<unknown>(VAULT_KEY, emptyVault())), made.envelope));
        setFresh(made.recoveryKey);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The vault could not be made.");
      } finally {
        setBusy("");
      }
    },
    [commit],
  );

  const unlock = useCallback(
    async (password: string) => {
      setError("");
      if (!blob.envelope) return false;
      setBusy("Unlocking…");
      try {
        const result = await unlockWithPassword(blob.envelope, password);
        if (!result) {
          setError("That is not the master password.");
          return false;
        }
        opened.current = result;
        setUnlocked(true);
        return true;
      } finally {
        setBusy("");
      }
    },
    [blob.envelope],
  );

  const recover = useCallback(
    async (recoveryKey: string) => {
      setError("");
      if (!blob.envelope) return false;
      setBusy("Checking the recovery key…");
      try {
        const result = await unlockWithRecovery(blob.envelope, recoveryKey);
        if (!result) {
          setError("That recovery key does not open this vault.");
          return false;
        }
        opened.current = result;
        setUnlocked(true);
        return true;
      } finally {
        setBusy("");
      }
    },
    [blob.envelope],
  );

  const confirmExported = useCallback(() => {
    commit(markExported(blob));
    setFresh(null);
  }, [blob, commit]);

  const changePassword = useCallback(
    async (next: string) => {
      const live = opened.current;
      if (!live || !blob.envelope) return false;
      setBusy("Changing the master password…");
      try {
        commit(setEnvelope(blob, await rewrap(blob.envelope, live.raw, next)));
        return true;
      } finally {
        setBusy("");
      }
    },
    [blob, commit],
  );

  const newRecoveryKey = useCallback(async () => {
    const live = opened.current;
    if (!live || !blob.envelope) return;
    setBusy("Issuing a new recovery key…");
    try {
      const { envelope, recoveryKey } = await reissueRecovery(blob.envelope, live.raw);
      // Shuts the gate: the old key stopped working just now, so nothing new
      // goes in until this one is written down.
      commit(reissued(blob, envelope));
      setFresh(recoveryKey);
    } finally {
      setBusy("");
    }
  }, [blob, commit]);

  // --- secrets -------------------------------------------------------------

  const put = useCallback(
    async (id: string, secret: string) => {
      const live = opened.current;
      if (!live || !canAcceptSecrets(blob)) return false;
      commit(putSecret(blob, id, await encryptSecret(live.dek, secret)));
      return true;
    },
    [blob, commit],
  );

  const reveal = useCallback(
    async (id: string) => {
      const live = opened.current;
      const sealed = blob.secrets[id];
      if (!live || !sealed) return null;
      touch();
      return decryptSecret(live.dek, sealed);
    },
    [blob.secrets, touch],
  );

  const forget = useCallback((id: string) => commit(removeSecret(blob, id)), [blob, commit]);

  // --- taking the plaintext out of circulation -----------------------------

  const plan = useMemo(() => planMigration(logins, blob), [blob, logins]);

  const migrate = useCallback(async () => {
    const live = opened.current;
    if (!live || !canAcceptSecrets(blob)) return 0;

    setBusy("Encrypting…");
    setError("");
    let next = blob;
    let moved = 0;
    try {
      for (const login of plan.toSeal) {
        const secret = login.password?.trim();
        if (!secret) continue;
        // Seal FIRST, and only clear the readable copy once the sealed one is
        // in hand. The other order loses a password on any failure.
        next = putSecret(next, login.id, await encryptSecret(live.dek, secret));
        setItemPassword(login.id, null);
        moved += 1;
      }
      commit(next);
      return moved;
    } catch (e) {
      // Whatever was sealed before the failure is still committed, so a retry
      // picks up where it stopped rather than starting over.
      commit(next);
      setError(e instanceof Error ? e.message : "Some passwords could not be encrypted.");
      return moved;
    } finally {
      setBusy("");
    }
  }, [blob, commit, plan.toSeal]);

  return {
    blob,
    state: vaultState(blob),
    unlocked,
    logins,
    plan,
    summary: describeVault(blob, plan),
    busy,
    error,
    freshRecoveryKey,
    create,
    unlock,
    recover,
    lock,
    confirmExported,
    changePassword,
    newRecoveryKey,
    migrate,
    reveal,
    put,
    forget,
    dismissRecoveryKey: () => setFresh(null),
  };
}

export { count as vaultCount };
