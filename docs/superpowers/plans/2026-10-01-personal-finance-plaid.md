# Personal Finance — Plaid Provider Implementation Plan (2 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Connect a real bank through Plaid and turn its payloads into the `Account` and `Txn`
shapes the engines already consume — including the credit-card dates the owner asked never to
have to type.

**Architecture:** One `BankProvider` interface with honest capability flags, and Plaid behind it.
Everything that can be a pure function is one — the payload mapping and the webhook verification
are both tested offline against fixtures and a locally generated keypair. Only the HTTP client and
the sync loop touch the network, and they are thin.

**Tech Stack:** TypeScript, vitest, Node's built-in `crypto`. **No new npm dependencies** — Plaid's
REST API is plain JSON POST, and ES256 JWT verification is `createPublicKey({format:"jwk"})` plus
`crypto.verify`.

**Spec:** `docs/superpowers/specs/2026-09-30-personal-finance-design.md` §5, §7, §10.
**Status: Tasks 1–6 COMPLETE** — 224 tests passing across 13 files, typecheck clean.
Routes and Supabase persistence remain (see the last section); they need the migration run and
the owner's Plaid keys.

**Depends on:** plan 1 (`src/lib/finance/`), complete at commit `dbcd7eb`, 146 tests.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/finance/crypto.ts` | AES-256-GCM for access tokens at rest. Nothing else. |
| `src/lib/finance/crypto.test.ts` | Round-trip, tamper detection, key errors. |
| `src/lib/finance/providers/types.ts` | `BankProvider`, `ProviderCapabilities` and the payload-neutral shapes. No logic. |
| `src/lib/finance/providers/plaid/map.ts` | Plaid JSON → our types. **Pure.** The file most likely to be subtly wrong. |
| `src/lib/finance/providers/plaid/map.test.ts` | Against committed fixtures, no network. |
| `src/lib/finance/providers/plaid/webhook.ts` | Signature verification. Pure given a key fetcher. |
| `src/lib/finance/providers/plaid/webhook.test.ts` | Locally generated ES256 keypair; every rejection path. |
| `src/lib/finance/providers/plaid/client.ts` | `configured()` + the fetch wrapper. The only file that knows a URL. |
| `src/lib/finance/providers/plaid/index.ts` | Assembles the `BankProvider`. |
| `src/lib/finance/providers/plaid/fixtures/*.json` | Recorded sandbox payloads. |

---

## Task 1: Token encryption

**Files:** Create `src/lib/finance/crypto.ts`, `src/lib/finance/crypto.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, newEncKey } from "./crypto";

const KEY = newEncKey();

describe("encryptToken", () => {
  it("round-trips", () => {
    expect(decryptToken(encryptToken("access-sandbox-123", KEY), KEY)).toBe("access-sandbox-123");
  });

  it("produces different ciphertext each time", () => {
    // A fixed IV would leak that two connections share a token.
    expect(encryptToken("same", KEY)).not.toBe(encryptToken("same", KEY));
  });

  it("never contains the plaintext", () => {
    expect(encryptToken("access-sandbox-123", KEY)).not.toContain("access-sandbox");
  });

  it("refuses a tampered ciphertext", () => {
    const blob = encryptToken("access-sandbox-123", KEY);
    const [iv, tag, body] = blob.split(".");
    const flipped = Buffer.from(body, "base64");
    flipped[0] ^= 0xff;
    expect(() => decryptToken(`${iv}.${tag}.${flipped.toString("base64")}`, KEY)).toThrow();
  });

  it("refuses the wrong key", () => {
    expect(() => decryptToken(encryptToken("x", KEY), newEncKey())).toThrow();
  });

  it("says plainly when the key is missing", () => {
    expect(() => encryptToken("x", undefined)).toThrow(/FINANCE_ENC_KEY/);
  });

  it("says plainly when the key is the wrong length", () => {
    expect(() => encryptToken("x", Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("refuses a malformed blob rather than returning rubbish", () => {
    expect(() => decryptToken("not-a-blob", KEY)).toThrow();
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/finance/crypto.test.ts`
Expected: FAIL — cannot resolve `./crypto`.

- [x] **Step 3: Implement**

```ts
// ---------------------------------------------------------------------------
// Personal Finance — access tokens at rest.
//
// A Plaid access token is a long-lived key to someone's bank feed. It is
// encrypted before it touches the database and decrypted only inside the node
// runtime; no API route returns one, or any prefix of one.
//
// AES-256-GCM rather than CBC because GCM authenticates: a tampered ciphertext
// throws instead of decrypting to rubbish that then gets sent to Plaid.
//
// This module throws loudly when the key is missing. That is deliberate and is
// the one place the "degrade visibly, never 500" rule does not apply: callers
// check `configured()` BEFORE getting here, so reaching this code without a key
// means the alternative would be storing a bank token in the clear.
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM's standard nonce length.

/** A fresh base64 key, for the setup instructions and for tests. */
export function newEncKey(): string {
  return randomBytes(32).toString("base64");
}

function keyOf(raw: string | undefined): Buffer {
  if (!raw) {
    throw new Error("FINANCE_ENC_KEY is not set, so a bank token cannot be stored safely.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`FINANCE_ENC_KEY must decode to 32 bytes, got ${key.length}.`);
  }
  return key;
}

/** "<iv>.<tag>.<ciphertext>", all base64. */
export function encryptToken(plain: string, encKey = process.env.FINANCE_ENC_KEY): string {
  const key = keyOf(encKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptToken(blob: string, encKey = process.env.FINANCE_ENC_KEY): string {
  const key = keyOf(encKey);
  const [ivB64, tagB64, bodyB64] = blob.split(".");
  if (!ivB64 || !tagB64 || !bodyB64) throw new Error("Stored token is malformed.");
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(bodyB64, "base64")), decipher.final()]).toString("utf8");
}

/** Constant-time string equality, for comparing digests. */
export function sameDigest(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
```

- [x] **Step 4: Run it and watch it pass** — `npx vitest run src/lib/finance/crypto.test.ts`, 8 tests.
- [x] **Step 5: Commit** — `git commit -m "Finance: encrypt bank tokens at rest with AES-256-GCM"`

---

## Task 2: The provider interface

**Files:** Create `src/lib/finance/providers/types.ts`

- [x] **Step 1: Write it** (no test — types only; Task 4 exercises every field)

```ts
// ---------------------------------------------------------------------------
// Personal Finance — one interface, several banks' worth of reality behind it.
//
// `capabilities` exists because the providers genuinely differ and the UI must
// say so rather than papering over it. Plaid publishes credit-card statement
// dates; UK/EU open banking publishes none. Plaid pushes webhooks; GoCardless
// must be polled, expires consent at 90 days, and some banks allow as few as
// four calls per account per day. A missing capability is shown to the owner,
// never hidden behind a guess.
// ---------------------------------------------------------------------------

import type { Account, Day, Txn } from "../types";

export interface ProviderCapabilities {
  /** Can this provider publish a card's due date and statement closing date? */
  cardStatements: boolean;
  sync: "webhook" | "poll";
  /** Days a consent lasts before re-authentication. Null = no fixed expiry. */
  consentDays: number | null;
  /** Hard ceiling on syncs per account per day. Null = none worth modelling. */
  maxCallsPerDay: number | null;
  regions: string[];
}

/** An account as the provider describes it, before it is given our ids. */
export type ProviderAccount = Omit<Account, "id"> & { providerAccountId: string };

/** A transaction as the provider describes it, before it is given our ids. */
export type ProviderTxn = Omit<Txn, "id" | "accountId"> & {
  providerTxnId: string;
  providerAccountId: string;
};

/** The card fields that make the "no typing" promise, where published. */
export interface ProviderCardTerms {
  providerAccountId: string;
  lastStatementBalance: number | null;
  statementLastClosed: Day | null;
  nextDueDate: Day | null;
  minimumPayment: number | null;
  isOverdue: boolean;
  aprPurchase: number | null;
  creditLimit: number | null;
}

export interface TxnPage {
  added: ProviderTxn[];
  modified: ProviderTxn[];
  /** Provider ids to mark `removed_at`, not to delete. */
  removed: string[];
  cursor: string | null;
  hasMore: boolean;
}

export interface Connection {
  id: string;
  accessToken: string;
  cursor: string | null;
}

export interface BankProvider {
  id: "plaid" | "gocardless" | "manual";
  label: string;
  capabilities: ProviderCapabilities;
  /** Why this provider cannot be used right now, for the owner to read. */
  configured(): { ok: boolean; reason: string };
  fetchAccounts(conn: Connection): Promise<ProviderAccount[]>;
  fetchTransactions(conn: Connection): Promise<TxnPage>;
  /** Only present where capabilities.cardStatements is true. */
  fetchCardTerms?(conn: Connection): Promise<ProviderCardTerms[]>;
}
```

- [x] **Step 2: Commit** — `git commit -m "Finance: the provider interface, with capabilities the UI can show"`

---

## Task 3: Fixtures

**Files:** Create `src/lib/finance/providers/plaid/fixtures/{accounts,sync,liabilities}.json`

Recorded shapes from Plaid's sandbox. They are committed so the mapper tests never touch the
network and so a future change to our mapping is checked against the real payload shape.

- [x] **Step 1: Write the three fixtures** — see the files written by this plan's execution; each
  is a trimmed but structurally faithful Plaid response including the awkward cases: a credit card
  and a current account, a pending charge with its posted twin, a transaction with `merchant_name`
  null so the `name` fallback is exercised, and a credit account that has **no** liabilities record.

- [x] **Step 2: Commit**

---

## Task 4: The mapper

**Files:** Create `src/lib/finance/providers/plaid/map.ts`, `map.test.ts`

The rules that must hold, each with a test:

1. **Sign convention passes through untouched.** Plaid is already positive-when-money-leaves, which
   is why our types chose it. A mapper that "helpfully" flips signs would invert every spend figure.
2. **`pending_transaction_id` survives onto `pendingTxnId`.** If this is dropped, `fold` cannot do
   its job and every purchase becomes a double charge.
3. **Merchant falls back `merchant_name` → `name`.** `merchant_name` is frequently null.
4. **Currency falls back `iso_currency_code` → `unofficial_currency_code`.**
5. **`personal_finance_category.detailed` becomes `category`**, because the transfer rule reads it.
6. **Only `depository` and `credit` accounts are mapped**; loans and investments are out of scope
   and must be dropped rather than mis-typed.
7. **`countInSpend` defaults true for credit, false for depository.**
8. **Liabilities land on the matching account and set `datesSource: "bank"`.**
9. **A credit account with no liabilities record keeps `datesSource: "typed"`** — the honest
   outcome outside Plaid's US-first coverage.
10. **Next closing date is only produced when a cycle length is known**, and is always flagged
    estimated. Nobody publishes it.

- [x] **Steps 1–5:** test, fail, implement, pass, commit — as written during execution.

---

## Task 5: Webhook verification

**Files:** Create `src/lib/finance/providers/plaid/webhook.ts`, `webhook.test.ts`

An unverified webhook endpoint lets anyone who finds the URL write into the owner's ledger, and
the ledger is what every duplicate-charge alert is computed from. Every check below is required:

1. `plaid-verification` header present (HTTP headers are case-insensitive).
2. JWT header `alg` is exactly `ES256` — reject anything else, including `none` and `HS256`.
   Accepting `alg` from the token without pinning it is the classic JWT forgery.
3. `kid` fetches the JWK from `/webhook_verification_key/get`.
4. Signature verifies. **`dsaEncoding: "ieee-p1363"` is required** — a JWT's ES256 signature is raw
   `r||s`, while Node's `crypto.verify` defaults to DER, so without this every genuine webhook is
   rejected and the tempting "fix" is to stop verifying.
5. `iat` is within 5 minutes, against replay.
6. `request_body_sha256` equals the SHA-256 of the **raw** body as received — not a re-serialized
   copy, whose whitespace would differ — compared in constant time.

- [x] **Steps 1–5:** test (with a locally generated P-256 keypair, so no network and no secrets),
  fail, implement, pass, commit.

---

## Task 6: Client and provider assembly

**Files:** Create `src/lib/finance/providers/plaid/client.ts`, `index.ts`

- [x] `configured()` returns `{ok:false, reason}` naming the missing variable when
  `PLAID_CLIENT_ID` or `PLAID_SECRET` is absent, so the Connect panel can say so and the rest of
  the app keeps working on the declared-bills ledger. This is the no-keys rule.
- [x] `plaidFetch` posts JSON to `https://{env}.plaid.com{path}` with the id and secret in the body
  (Plaid's convention), and turns a non-2xx into an Error carrying `error_code` and
  `display_message` — the parts worth showing the owner.
- [x] `fetchTransactions` drives `/transactions/sync` and returns one page plus the new cursor.
  **The caller advances the stored cursor only after the page is durably written**, so a crash
  re-fetches rather than skips.
- [x] Commit.

---

## Remaining after this plan

Routes (`/api/finance/link/token`, `/link/exchange`, `/webhook/plaid`, `/sync`) and the Supabase
persistence they drive. They are listed here rather than smuggled in: they need the migration to
have been run, and they are the first part that cannot be verified without the owner's Plaid keys.
