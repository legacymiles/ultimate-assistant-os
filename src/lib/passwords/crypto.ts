// ---------------------------------------------------------------------------
// The vault's cryptography.
//
// This reverses a decision this repo already made, deliberately and with the
// reason addressed. `src/lib/recall/legacyVault.ts` records why passwords were
// moved OUT of an encrypted vault and into the clear:
//
//   "if you forgot the master password, every saved login was gone for good"
//
// That is a real failure and encryption alone does not answer it. What answers
// it is ENVELOPE encryption: one random data key (the DEK) encrypts every
// secret, and that single DEK is wrapped twice — once under the master
// password, and once under a recovery key the owner exports before the vault
// will accept anything. Forgetting the password then costs a trip to the
// recovery key rather than every login you have.
//
// It also makes changing the master password cheap: re-wrap 32 bytes, rather
// than decrypt and re-encrypt every secret in the vault.
//
// TWO SALTS, not one. The obvious design salts the whole envelope once, and it
// is quietly broken: changing the master password wants a fresh salt, but the
// recovery wrapping was sealed under a key derived from the OLD salt, so
// re-salting silently destroys the recovery path — the exact thing this vault
// exists to protect. Each wrapping gets its own salt and each can be rolled
// without touching the other.
//
// What this does NOT claim. Anything running on this origin can read a secret
// while the vault is unlocked — that was true of the old vault too, and of
// every browser password manager. What it buys is specific and worth having:
// the owner's Supabase row, and any backup or dump of it, holds ciphertext
// instead of passwords.
// ---------------------------------------------------------------------------

/** Base64 of a ciphertext plus the IV it was made with. Same shape the retired vault used. */
export interface Cipher {
  iv: string;
  ct: string;
}

/**
 * PBKDF2 rounds for the master password.
 *
 * 600,000 — the current OWASP figure for PBKDF2-SHA256, and roughly double the
 * retired vault's 310,000. It costs a few hundred milliseconds once per unlock,
 * which nobody notices, and multiplies the cost of guessing by the same factor.
 */
export const ITERATIONS = 600_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    // Not a browser quirk worth hiding: WebCrypto is absent on plain HTTP, so
    // the honest answer names the cause rather than reporting a failure.
    throw new Error("This browser has no WebCrypto. It needs HTTPS or localhost.");
  }
  return c.subtle;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

// --- base64 ----------------------------------------------------------------

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

// --- the recovery key ------------------------------------------------------

/**
 * Crockford-style base32: no I, L, O or U.
 *
 * I and 1, O and 0 are the pairs people transcribe wrongly, and U is dropped so
 * accidental words cannot appear. A recovery key is read off paper and typed
 * back in by someone who is already having a bad day.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 32 random bytes as groups of five characters. 256 bits, in a form a person can copy. */
export function newRecoveryKey(bytes = randomBytes(KEY_BYTES)): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return (out.match(/.{1,5}/g) ?? []).join("-");
}

/**
 * Accept a recovery key however it was written down.
 *
 * Case, spaces, dashes and the characters people reliably mistype are all
 * normalised. A key rejected because someone wrote O for 0 is a key that did
 * not work at the one moment it was needed.
 */
export function normaliseRecoveryKey(key: string): string {
  return key
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V");
}

// --- key derivation --------------------------------------------------------

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const s = subtle();
  const material = await s.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return s.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * The recovery key is already 256 random bits, so it is stretched with HKDF
 * rather than PBKDF2.
 *
 * Stretching exists to make guessing a low-entropy human password expensive.
 * Applying 600,000 rounds to a value that is already unguessable buys nothing,
 * and only makes recovery — the path someone reaches for in a crisis — slower.
 */
async function hkdf(key: string, salt: Uint8Array): Promise<CryptoKey> {
  const s = subtle();
  const material = await s.importKey("raw", new TextEncoder().encode(normaliseRecoveryKey(key)), "HKDF", false, [
    "deriveKey",
  ]);
  return s.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: new TextEncoder().encode("jarvis-vault-recovery"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// --- sealing ---------------------------------------------------------------

async function seal(key: CryptoKey, plain: Uint8Array): Promise<Cipher> {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plain as BufferSource);
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

async function open(key: CryptoKey, cipher: Cipher): Promise<Uint8Array> {
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: fromB64(cipher.iv) as BufferSource },
    key,
    fromB64(cipher.ct) as BufferSource,
  );
  return new Uint8Array(plain);
}

// --- the envelope ----------------------------------------------------------

export interface Envelope {
  /** Salt for the master-password derivation. Public by design. */
  saltMaster: string;
  /** Salt for the recovery derivation. Separate, so either can be rolled alone. */
  saltRecovery: string;
  iterations: number;
  /** The DEK, wrapped under the master password. */
  master: Cipher;
  /** The same DEK, wrapped under the recovery key. */
  recovery: Cipher;
}

/** An open vault: the key that decrypts secrets, and the raw bytes needed only to re-wrap it. */
export interface Opened {
  dek: CryptoKey;
  /**
   * The data key as bytes.
   *
   * Kept beside the CryptoKey rather than making the key extractable: the
   * normal path never touches it, and a password change is the only thing that
   * needs it. (The distinction is hygiene, not a barrier — anything that can
   * reach this can already decrypt everything.)
   */
  raw: Uint8Array;
}

export interface NewVault extends Opened {
  envelope: Envelope;
  /** Shown once, then never again. Nothing stores it. */
  recoveryKey: string;
}

async function importDek(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey("raw", raw as BufferSource, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Make a vault: one random data key, wrapped twice, under two separate salts. */
export async function createEnvelope(password: string): Promise<NewVault> {
  const saltMaster = randomBytes(SALT_BYTES);
  const saltRecovery = randomBytes(SALT_BYTES);
  const raw = randomBytes(KEY_BYTES);
  const recoveryKey = newRecoveryKey();

  const [kekMaster, kekRecovery] = await Promise.all([
    pbkdf2(password, saltMaster, ITERATIONS),
    hkdf(recoveryKey, saltRecovery),
  ]);
  const [master, recovery] = await Promise.all([seal(kekMaster, raw), seal(kekRecovery, raw)]);

  return {
    envelope: {
      saltMaster: toB64(saltMaster),
      saltRecovery: toB64(saltRecovery),
      iterations: ITERATIONS,
      master,
      recovery,
    },
    recoveryKey,
    dek: await importDek(raw),
    raw,
  };
}

/**
 * Open the envelope with the master password.
 *
 * No separate verifier blob is stored — AES-GCM's own authentication tag fails
 * on a wrong key, which is the same check with one less thing to keep
 * consistent. Returns null on a wrong password rather than throwing, because a
 * wrong password is an ordinary event, not an error.
 */
export async function unlockWithPassword(envelope: Envelope, password: string): Promise<Opened | null> {
  try {
    const kek = await pbkdf2(password, fromB64(envelope.saltMaster), envelope.iterations || ITERATIONS);
    const raw = await open(kek, envelope.master);
    return { dek: await importDek(raw), raw };
  } catch {
    return null;
  }
}

/** Open the envelope with the recovery key. The path that makes forgetting survivable. */
export async function unlockWithRecovery(envelope: Envelope, recoveryKey: string): Promise<Opened | null> {
  try {
    const kek = await hkdf(recoveryKey, fromB64(envelope.saltRecovery));
    const raw = await open(kek, envelope.recovery);
    return { dek: await importDek(raw), raw };
  } catch {
    return null;
  }
}

/**
 * Set a new master password on an open vault.
 *
 * Re-wraps the data key under a fresh master salt and touches nothing else —
 * every stored secret and the entire recovery path are untouched, which is the
 * whole point of two salts.
 */
export async function changePassword(envelope: Envelope, raw: Uint8Array, password: string): Promise<Envelope> {
  const saltMaster = randomBytes(SALT_BYTES);
  const kek = await pbkdf2(password, saltMaster, ITERATIONS);
  return { ...envelope, saltMaster: toB64(saltMaster), iterations: ITERATIONS, master: await seal(kek, raw) };
}

/**
 * Issue a new recovery key, retiring the old one.
 *
 * Touches only the recovery wrapping, so the master password keeps working —
 * and the previous recovery key stops working the moment this lands, which is
 * what makes "I think someone saw it" actionable.
 */
export async function reissueRecovery(
  envelope: Envelope,
  raw: Uint8Array,
): Promise<{ envelope: Envelope; recoveryKey: string }> {
  const saltRecovery = randomBytes(SALT_BYTES);
  const recoveryKey = newRecoveryKey();
  const kek = await hkdf(recoveryKey, saltRecovery);
  return {
    envelope: { ...envelope, saltRecovery: toB64(saltRecovery), recovery: await seal(kek, raw) },
    recoveryKey,
  };
}

// --- secrets ---------------------------------------------------------------

export async function encryptSecret(dek: CryptoKey, secret: string): Promise<Cipher> {
  return seal(dek, new TextEncoder().encode(secret));
}

export async function decryptSecret(dek: CryptoKey, cipher: Cipher): Promise<string | null> {
  try {
    return new TextDecoder().decode(await open(dek, cipher));
  } catch {
    return null;
  }
}
