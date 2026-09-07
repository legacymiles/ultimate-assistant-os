// ---------------------------------------------------------------------------
// Recall — the retired vault, read side only.
//
// Passwords used to be sealed with AES-GCM under a master password. That bought
// very little (anything running on this origin could read them the moment you
// unlocked it) and cost the one thing that mattered: if you forgot the master
// password, every saved login was gone for good. Passwords are now stored in
// the clear and recoverable from Settings.
//
// This module exists only so a device that still holds the old ciphertexts can
// import them once. Nothing here ever encrypts.
// ---------------------------------------------------------------------------

import type { Cipher } from "./types";
import { scopedKey } from "@/lib/sync/identity";

/** The app_state / localStorage key the old vault metadata lives under. */
export const KEY = "recall:vault:v1";
const ITERATIONS = 310_000;
const VERIFIER_PLAINTEXT = "recall-vault-ok";

interface VaultMeta {
  salt: string;
  verifier: Cipher;
  createdAt: string;
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
    throw new Error("This browser has no WebCrypto — importing needs HTTPS or localhost.");
  }
  return c.subtle;
}

function readMeta(): VaultMeta | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(scopedKey(KEY));
    return raw ? (JSON.parse(raw) as VaultMeta) : null;
  } catch {
    return null;
  }
}

/** True when this device still has old vault metadata sitting around. */
export function hasLegacyVault(): boolean {
  return readMeta() !== null;
}

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

async function decryptWith(key: CryptoKey, cipher: Cipher): Promise<string> {
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: fromB64(cipher.iv) as unknown as BufferSource },
    key,
    fromB64(cipher.ct) as unknown as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

/**
 * Decrypt every old ciphertext in one pass.
 * Throws on a wrong master password. A single item that will not decrypt is
 * skipped rather than failing the whole import — recovering nine of ten
 * passwords beats recovering none.
 */
export async function importAll(
  masterPassword: string,
  secrets: { id: string; cipher: Cipher }[],
): Promise<{ imported: { id: string; password: string }[]; failed: number }> {
  const meta = readMeta();
  if (!meta) throw new Error("Nothing to import on this device.");
  const key = await deriveKey(masterPassword, fromB64(meta.salt));
  try {
    if ((await decryptWith(key, meta.verifier)) !== VERIFIER_PLAINTEXT) throw new Error("wrong");
  } catch {
    throw new Error("Wrong master password.");
  }

  const imported: { id: string; password: string }[] = [];
  let failed = 0;
  for (const s of secrets) {
    try {
      imported.push({ id: s.id, password: await decryptWith(key, s.cipher) });
    } catch {
      failed++;
    }
  }
  return { imported, failed };
}

/** Forget the old metadata once there is nothing left sealed under it. */
export function forgetLegacyVault(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(scopedKey(KEY));
}
