// ---------------------------------------------------------------------------
// The vault's shape, and the one gate that makes encrypting defensible.
//
// Pure functions over a blob. No crypto here and no storage here — this is the
// state machine, so the rule that matters most can be asserted without a
// browser:
//
//   THE VAULT REFUSES ITS FIRST SECRET UNTIL THE RECOVERY KEY IS EXPORTED.
//
// That is not a nag. This repo already tried an encrypted vault and retired it,
// and `src/lib/recall/legacyVault.ts` records exactly why: "if you forgot the
// master password, every saved login was gone for good." Encryption without a
// way back is a trap with a lock on it. Making the export a precondition rather
// than a prompt is the whole difference between repeating that and not.
//
// What the vault stores, and what it deliberately does not:
//
//   stores      the encrypted secret, keyed by the Recall item's id
//   does NOT    the site, the username, the URL, the notes
//
// Those already live on the Recall item in the clear and are deliberately
// searchable (`src/lib/recall/search.ts` indexes them and pointedly does not
// index the password). Copying them in here would create a second copy to
// drift. One source of truth for what a login IS, one for its secret — and a
// login moved between folders keeps its password for free.
// ---------------------------------------------------------------------------

import type { Cipher, Envelope } from "./crypto";

export interface VaultBlob {
  version: 1;
  /** Null until the owner sets a master password. */
  envelope: Envelope | null;
  /**
   * When the recovery key was exported. Null means the gate below is shut.
   *
   * A flag in the owner's own blob, so it is a precondition rather than a
   * security boundary — there is nobody to defend it against. Its job is to
   * make it impossible to end up holding an encrypted vault you cannot open.
   */
  recoveryExportedAt: string | null;
  /** Recall item id → sealed secret. */
  secrets: Record<string, Cipher>;
  updatedAt: string;
}

export const VAULT_KEY = "jarvis-vault";

export function emptyVault(): VaultBlob {
  return { version: 1, envelope: null, recoveryExportedAt: null, secrets: {}, updatedAt: "" };
}

/** Repair a half-written or older blob rather than throwing. */
export function coerceVault(raw: unknown): VaultBlob {
  const r = (raw ?? {}) as Partial<VaultBlob>;
  const secrets: Record<string, Cipher> = {};
  if (r.secrets && typeof r.secrets === "object") {
    for (const [id, c] of Object.entries(r.secrets)) {
      const cipher = c as Partial<Cipher>;
      if (typeof cipher?.iv === "string" && typeof cipher?.ct === "string") secrets[id] = { iv: cipher.iv, ct: cipher.ct };
    }
  }
  const e = r.envelope as Partial<Envelope> | null | undefined;
  const envelope =
    e && typeof e.saltMaster === "string" && typeof e.saltRecovery === "string" && e.master && e.recovery
      ? (e as Envelope)
      : null;

  return {
    version: 1,
    envelope,
    recoveryExportedAt:
      typeof r.recoveryExportedAt === "string" && !Number.isNaN(Date.parse(r.recoveryExportedAt))
        ? r.recoveryExportedAt
        : null,
    // Secrets with no envelope to open them are unreadable by definition, and
    // keeping them would be keeping rubbish that looks like data.
    secrets: envelope ? secrets : {},
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
}

export type VaultState =
  /** No master password has ever been set. */
  | "empty"
  /** Set up, but the recovery key has not been written down. Nothing may be stored yet. */
  | "unconfirmed"
  /** Set up and ready. */
  | "ready";

export function vaultState(blob: VaultBlob): VaultState {
  if (!blob.envelope) return "empty";
  return blob.recoveryExportedAt ? "ready" : "unconfirmed";
}

/**
 * The gate.
 *
 * Checked by `putSecret` rather than only by the UI, so no code path can get
 * round it — a second caller that forgot to check is exactly how a precondition
 * quietly becomes a suggestion.
 */
export function canAcceptSecrets(blob: VaultBlob): boolean {
  return vaultState(blob) === "ready";
}

export function markExported(blob: VaultBlob, now = Date.now()): VaultBlob {
  return { ...blob, recoveryExportedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
}

/** Store a sealed secret. Refuses while the recovery key is unconfirmed. */
export function putSecret(blob: VaultBlob, id: string, cipher: Cipher, now = Date.now()): VaultBlob {
  if (!canAcceptSecrets(blob) || !id) return blob;
  return {
    ...blob,
    secrets: { ...blob.secrets, [id]: cipher },
    updatedAt: new Date(now).toISOString(),
  };
}

export function removeSecret(blob: VaultBlob, id: string, now = Date.now()): VaultBlob {
  if (!(id in blob.secrets)) return blob;
  const { [id]: _gone, ...rest } = blob.secrets;
  return { ...blob, secrets: rest, updatedAt: new Date(now).toISOString() };
}

/** Replace the envelope — after a password change or a recovery-key reissue. */
export function setEnvelope(blob: VaultBlob, envelope: Envelope, now = Date.now()): VaultBlob {
  return { ...blob, envelope, updatedAt: new Date(now).toISOString() };
}

/**
 * A reissued recovery key shuts the gate again until the new one is written down.
 *
 * The old key stops working the moment it is reissued, so leaving the gate open
 * would leave the owner holding a vault whose only way back is a key they have
 * not got.
 */
export function reissued(blob: VaultBlob, envelope: Envelope, now = Date.now()): VaultBlob {
  return { ...blob, envelope, recoveryExportedAt: null, updatedAt: new Date(now).toISOString() };
}

export function count(blob: VaultBlob): number {
  return Object.keys(blob.secrets).length;
}

// --- bringing the existing logins in ---------------------------------------

/** A saved login as Recall holds it, reduced to what the vault cares about. */
export interface Login {
  id: string;
  title: string;
  /** The readable password, while one is still stored in the clear. */
  password?: string | null;
  /** Still sealed under the RETIRED master password, from before it was dropped. */
  hasLegacySecret?: boolean;
}

export interface MigrationPlan {
  /** Logins whose plaintext password should be sealed and then cleared. */
  toSeal: Login[];
  /** Already in the vault. */
  done: number;
  /** Sealed under the retired vault, which only its own master password can open. */
  stranded: Login[];
}

/**
 * What moving to the vault would involve.
 *
 * Deliberately separates the three states, because they need three different
 * sentences. "12 to encrypt" is work. "3 still sealed under the old master
 * password" is a different problem the new vault cannot solve, and pretending
 * otherwise would lose them.
 */
export function planMigration(logins: Login[], blob: VaultBlob): MigrationPlan {
  const toSeal: Login[] = [];
  const stranded: Login[] = [];
  let done = 0;

  for (const login of logins) {
    if (blob.secrets[login.id]) {
      done += 1;
      continue;
    }
    if (login.password?.trim()) toSeal.push(login);
    else if (login.hasLegacySecret) stranded.push(login);
  }

  return { toSeal, done, stranded };
}

/** One honest line about where the vault stands. */
export function describeVault(blob: VaultBlob, plan: MigrationPlan): string {
  switch (vaultState(blob)) {
    case "empty":
      return "Not set up. Your saved passwords are readable to anything that can reach this browser or your Supabase row.";
    case "unconfirmed":
      return "Write down the recovery key before anything goes in. Until then the vault will not accept a password.";
    default: {
      const parts = [`${count(blob)} encrypted`];
      if (plan.toSeal.length) parts.push(`${plan.toSeal.length} still in the clear`);
      if (plan.stranded.length) parts.push(`${plan.stranded.length} sealed under the old master password`);
      return `${parts.join(", ")}.`;
    }
  }
}

/** The file the owner saves. Plain text, because it has to be readable in ten years with no app. */
export function recoverySheet(recoveryKey: string, now = Date.now()): string {
  return [
    "JARVIS PASSWORD VAULT — RECOVERY KEY",
    "",
    recoveryKey,
    "",
    `Issued ${new Date(now).toISOString()}`,
    "",
    "WHAT THIS IS",
    "The only way into your vault if you forget the master password. It opens",
    "the vault on its own — you do not need the password as well.",
    "",
    "WHERE TO PUT IT",
    "Somewhere that is not this computer and not your password manager. Printed",
    "and in a drawer is a perfectly good answer. A photo of it in your camera",
    "roll is not, because that syncs to the same places everything else does.",
    "",
    "IF YOU LOSE BOTH",
    "There is no way in. Nobody holds a copy of this — that is the point of it",
    "being encrypted, and it is why this file exists.",
    "",
  ].join("\n");
}
