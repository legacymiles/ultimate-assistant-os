import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { persistence as docPersistence, readDoc, writeDoc } from "@/lib/server/docStore";
import { dataDir } from "./dataDir";
import { deriveKey } from "./passwords";

// ---------------------------------------------------------------------------
// Where Recall's app password actually lives.
//
// It started as the RECALL_PASSWORD env var, which cannot be changed from
// inside a running app — so a stored, writable secret replaces it. The env var
// stays as a bootstrap: it is what you log in with until you set a real one.
//
// Only a salted PBKDF2 hash is ever written. The plaintext is never stored.
//
// Persistence depends on where this runs, and the UI is told which:
//   · long-lived Node host (local dev, a VPS) → the file persists. Good.
//   · Vercel serverless → the filesystem is ephemeral and per-instance, so a
//     change would not survive there. With SUPABASE_SERVICE_ROLE_KEY set the
//     hash goes to public.server_docs instead and does persist; without it,
//     `status()` reports persistent:false and the Security dialog says so
//     rather than pretending it saved.
// ---------------------------------------------------------------------------

/** Document name, not a path. See lib/server/docStore. */
const DOC = ".recall-gate.json";

interface StoredSecret {
  version: 1;
  salt: string;
  hash: string;
  updatedAt: string;
}

export type GateSource = "store" | "env" | "none";

export interface GateStatus {
  /** Whether a password is required at all. */
  gated: boolean;
  source: GateSource;
  /** False when a change would not survive (read-only / ephemeral filesystem). */
  persistent: boolean;
  updatedAt?: string;
}

async function readStored(): Promise<StoredSecret | null> {
  const parsed = await readDoc<StoredSecret>(DOC, dataDir());
  return parsed?.salt && parsed?.hash ? parsed : null;
}

// Parameters live in ./passwords so the gate and Lists members cannot drift.
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return deriveKey(password, salt);
}

/** Can we actually write next to the project? Probes rather than guesses. */
async function canPersist(): Promise<boolean> {
  return (await docPersistence(dataDir())).persistent;
}

const envPassword = () => process.env.RECALL_PASSWORD ?? "";

export async function status(): Promise<GateStatus> {
  const stored = await readStored();
  if (stored) {
    return {
      gated: true,
      source: "store",
      persistent: await canPersist(),
      updatedAt: stored.updatedAt,
    };
  }
  if (envPassword()) {
    return { gated: true, source: "env", persistent: await canPersist() };
  }
  return { gated: false, source: "none", persistent: await canPersist() };
}

/** Verify a candidate password against the stored hash, or the env bootstrap. */
export async function verify(candidate: string): Promise<boolean> {
  const stored = await readStored();
  if (stored) {
    const expected = Buffer.from(stored.hash, "base64");
    const actual = await derive(candidate, Buffer.from(stored.salt, "base64"));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  const env = envPassword();
  if (!env) return true; // Not gated at all.
  const a = Buffer.from(candidate);
  const b = Buffer.from(env);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Write a new password. Throws with a readable reason when it cannot. */
export async function setPassword(next: string): Promise<StoredSecret> {
  if (next.length < 8) throw new Error("Use at least 8 characters.");
  const salt = randomBytes(16);
  const hash = await derive(next, salt);
  const record: StoredSecret = {
    version: 1,
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
    updatedAt: new Date().toISOString(),
  };
  if (!(await writeDoc(DOC, dataDir(), record))) {
    throw new Error(
      "This deployment has no writable storage, so the password cannot be saved here. " +
        "Set SUPABASE_SERVICE_ROLE_KEY to store it in the database, or change " +
        "RECALL_PASSWORD in your hosting environment instead.",
    );
  }
  return record;
}

/** Remove the stored password, falling back to the env var (or open). */
export async function clearPassword(): Promise<void> {
  // An empty document reads back as "no salt/hash", which readStored() already
  // treats as nothing stored — the same outcome deleting the file had.
  await writeDoc(DOC, dataDir(), {});
}

/**
 * The value put in the session cookie.
 * Derived from the CURRENT secret, so changing the password invalidates every
 * existing session — including on other devices — which is what you want from
 * a password change.
 */
export async function sessionToken(): Promise<string> {
  const stored = await readStored();
  const material = stored ? `store:${stored.hash}` : `env:${envPassword()}`;
  return createHash("sha256").update(`recall-gate-v1:${material}`).digest("hex");
}

export function tokenMatches(cookie: string, expected: string): boolean {
  if (!cookie || cookie.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(cookie), Buffer.from(expected));
}
