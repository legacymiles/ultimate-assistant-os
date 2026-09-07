// ---------------------------------------------------------------------------
// Recall — the vault.
// Passwords are encrypted with AES-GCM under a key derived from a master
// password (PBKDF2-SHA256). Only ciphertext ever reaches localStorage; the
// derived key lives in module memory and is dropped on lock / idle / reload.
//
// Honest limits, stated in the UI too: this protects your saved passwords from
// anyone reading the stored JSON. It cannot protect you from malicious script
// running on this origin while the vault is unlocked. For crown-jewel accounts
// use a dedicated manager (1Password, Bitwarden) and keep only a pointer here.
// ---------------------------------------------------------------------------

import { saveSynced } from "@/lib/sync/appState";
import type { Cipher } from "./types";
import { scopedKey } from "@/lib/sync/identity";

/**
 * Also the app_state sync key. Only ciphertext and the KDF parameters are ever
 * stored under it, so syncing the vault moves encrypted bytes and nothing else:
 * the derived key never leaves the memory of the device that unlocked it.
 */
export const KEY = "recall:vault:v1";
const ITERATIONS = 310_000;
/** Auto-lock after this long without a vault interaction. */
export const IDLE_LOCK_MS = 5 * 60 * 1000;

interface VaultMeta {
  /** base64 PBKDF2 salt. */
  salt: string;
  /** Encrypted known plaintext — decrypting it proves the password. */
  verifier: Cipher;
  createdAt: string;
}

const VERIFIER_PLAINTEXT = "recall-vault-ok";

// In-memory only. Never persisted, never logged.
let liveKey: CryptoKey | null = null;
let lastTouch = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ----- encoding helpers ----------------------------------------------------

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto {
  const c = typeof window !== "undefined" ? window.crypto : undefined;
  if (!c?.subtle) {
    throw new Error("This browser has no WebCrypto — the vault needs HTTPS or localhost.");
  }
  return c.subtle;
}

// ----- meta persistence ----------------------------------------------------

function readMeta(): VaultMeta | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(scopedKey(KEY));
    return raw ? (JSON.parse(raw) as VaultMeta) : null;
  } catch {
    return null;
  }
}

function writeMeta(meta: VaultMeta): void {
  saveSynced(KEY, meta);
}

export function vaultExists(): boolean {
  return readMeta() !== null;
}

/**
 * Pure read — safe to call during a React render.
 * It reports a stale key as locked but does NOT clear it; clearing here would
 * fire subscribers mid-render and set state on other components.
 */
export function isUnlocked(): boolean {
  if (!liveKey) return false;
  return Date.now() - lastTouch <= IDLE_LOCK_MS;
}

/** Actually drop a stale key. Call from a timer or an event handler. */
export function enforceIdleLock(): void {
  if (liveKey && Date.now() - lastTouch > IDLE_LOCK_MS) lock();
}

/** Milliseconds until auto-lock, or 0 when locked. */
export function msUntilLock(): number {
  if (!liveKey) return 0;
  return Math.max(0, IDLE_LOCK_MS - (Date.now() - lastTouch));
}

export function touch(): void {
  if (liveKey) lastTouch = Date.now();
}

export function lock(): void {
  liveKey = null;
  lastTouch = 0;
  notify();
}

// ----- key derivation ------------------------------------------------------

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const s = subtle();
  const material = await s.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return s.deriveKey(
    // BufferSource typing drifts across TS lib versions — the bytes are what matter.
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptWith(key: CryptoKey, plain: string): Promise<Cipher> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plain),
  );
  return { iv: toB64(iv), ct: toB64(ct) };
}

async function decryptWith(key: CryptoKey, cipher: Cipher): Promise<string> {
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: fromB64(cipher.iv) as unknown as BufferSource },
    key,
    fromB64(cipher.ct) as unknown as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

// ----- public API ----------------------------------------------------------

/** First-time setup. Throws if a vault already exists. */
export async function createVault(masterPassword: string): Promise<void> {
  if (vaultExists()) throw new Error("A vault already exists on this device.");
  if (masterPassword.length < 8) throw new Error("Use at least 8 characters.");
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(masterPassword, salt);
  const verifier = await encryptWith(key, VERIFIER_PLAINTEXT);
  writeMeta({ salt: toB64(salt), verifier, createdAt: new Date().toISOString() });
  liveKey = key;
  lastTouch = Date.now();
  notify();
}

/** Returns true on success, false on a wrong password. */
export async function unlock(masterPassword: string): Promise<boolean> {
  const meta = readMeta();
  if (!meta) throw new Error("No vault on this device yet.");
  const key = await deriveKey(masterPassword, fromB64(meta.salt));
  try {
    if ((await decryptWith(key, meta.verifier)) !== VERIFIER_PLAINTEXT) return false;
  } catch {
    return false;
  }
  liveKey = key;
  lastTouch = Date.now();
  notify();
  return true;
}

export async function encryptSecret(plain: string): Promise<Cipher> {
  enforceIdleLock();
  if (!isUnlocked() || !liveKey) throw new Error("Vault is locked.");
  touch();
  return encryptWith(liveKey, plain);
}

export async function decryptSecret(cipher: Cipher): Promise<string> {
  enforceIdleLock();
  if (!isUnlocked() || !liveKey) throw new Error("Vault is locked.");
  touch();
  return decryptWith(liveKey, cipher);
}

/**
 * Re-key every stored secret under a new master password.
 * Caller hands in the ciphertexts and gets re-encrypted ones back.
 */
export async function changeMasterPassword(
  currentPassword: string,
  nextPassword: string,
  secrets: { id: string; cipher: Cipher }[],
): Promise<{ id: string; cipher: Cipher }[]> {
  const meta = readMeta();
  if (!meta) throw new Error("No vault on this device yet.");
  if (nextPassword.length < 8) throw new Error("Use at least 8 characters.");
  const oldKey = await deriveKey(currentPassword, fromB64(meta.salt));
  try {
    if ((await decryptWith(oldKey, meta.verifier)) !== VERIFIER_PLAINTEXT) {
      throw new Error("wrong");
    }
  } catch {
    throw new Error("Current master password is wrong.");
  }

  const plains: { id: string; plain: string }[] = [];
  for (const s of secrets) plains.push({ id: s.id, plain: await decryptWith(oldKey, s.cipher) });

  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const newKey = await deriveKey(nextPassword, salt);
  const verifier = await encryptWith(newKey, VERIFIER_PLAINTEXT);

  const out: { id: string; cipher: Cipher }[] = [];
  for (const p of plains) out.push({ id: p.id, cipher: await encryptWith(newKey, p.plain) });

  writeMeta({ salt: toB64(salt), verifier, createdAt: meta.createdAt });
  liveKey = newKey;
  lastTouch = Date.now();
  notify();
  return out;
}

/** Nuke the vault metadata. Caller clears the ciphertexts. */
export function destroyVault(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(scopedKey(KEY));
  lock();
}

/** Copy to clipboard, then wipe it so a password does not linger there. */
export async function copyEphemeral(text: string, ms = 30_000): Promise<void> {
  await navigator.clipboard.writeText(text);
  window.setTimeout(() => {
    // Only clear if the clipboard still holds what we put there.
    navigator.clipboard
      .readText()
      .then((cur) => {
        if (cur === text) void navigator.clipboard.writeText("");
      })
      .catch(() => {
        /* clipboard-read not permitted — leave it rather than clobbering */
      });
  }, ms);
}
