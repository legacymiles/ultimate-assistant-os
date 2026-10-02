import { describe, expect, it } from "vitest";
import {
  changePassword,
  createEnvelope,
  decryptSecret,
  encryptSecret,
  fromB64,
  ITERATIONS,
  newRecoveryKey,
  normaliseRecoveryKey,
  reissueRecovery,
  toB64,
  unlockWithPassword,
  unlockWithRecovery,
} from "./crypto";

// A vault with 600,000 PBKDF2 rounds takes a few hundred ms to open, and these
// tests open several. Generous, and still a fraction of what a real unlock
// feels like.
const SLOW = 30_000;

describe("base64", () => {
  it("round-trips arbitrary bytes, including the high ones", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 200, 254, 255]);
    expect([...fromB64(toB64(bytes))]).toEqual([...bytes]);
  });
});

describe("the recovery key", () => {
  it("is 256 bits, written in groups a person can copy off paper", () => {
    const key = newRecoveryKey();
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{1,5})+$/);
    expect(key.replace(/-/g, "")).toHaveLength(52);
  });

  it("never contains the characters people transcribe wrongly", () => {
    // I/1, O/0 and U are the ones that come back wrong off a handwritten note.
    for (let i = 0; i < 40; i += 1) expect(newRecoveryKey()).not.toMatch(/[ILOU]/);
  });

  it("is different every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => newRecoveryKey()));
    expect(seen.size).toBe(50);
  });

  it("forgives every way a person might type it back", () => {
    // A key rejected because someone wrote O for 0 is a key that did not work
    // at the one moment it was needed.
    const key = "A1B2C-D3E4F";
    const written = ["a1b2c-d3e4f", "A1B2C D3E4F", "A1B2CD3E4F", "A1B2C--D3E4F", " a1b2c-d3e4f "];
    for (const w of written) expect(normaliseRecoveryKey(w)).toBe(normaliseRecoveryKey(key));
  });

  it("maps the confusable characters onto their real counterparts", () => {
    expect(normaliseRecoveryKey("O0")).toBe("00");
    expect(normaliseRecoveryKey("I1L")).toBe("111");
    expect(normaliseRecoveryKey("U")).toBe("V");
  });
});

describe("making a vault", () => {
  it(
    "opens with the password it was made with, and not with another",
    async () => {
      const made = await createEnvelope("correct horse battery staple");
      expect(await unlockWithPassword(made.envelope, "correct horse battery staple")).not.toBeNull();
      expect(await unlockWithPassword(made.envelope, "correct horse battery stapl")).toBeNull();
      expect(await unlockWithPassword(made.envelope, "")).toBeNull();
    },
    SLOW,
  );

  it(
    "uses two separate salts, so either wrapping can be rolled alone",
    async () => {
      const made = await createEnvelope("pw");
      expect(made.envelope.saltMaster).not.toBe(made.envelope.saltRecovery);
      expect(made.envelope.iterations).toBe(ITERATIONS);
    },
    SLOW,
  );

  it(
    "stores no plaintext anywhere in the envelope",
    async () => {
      // The whole point: the owner's Supabase row holds ciphertext.
      const made = await createEnvelope("a-very-memorable-password");
      const blob = JSON.stringify(made.envelope);
      expect(blob).not.toContain("a-very-memorable-password");
      expect(blob).not.toContain(made.recoveryKey);
      expect(blob).not.toContain(toB64(made.raw));
    },
    SLOW,
  );
});

describe("the recovery path — the reason this vault is allowed to exist", () => {
  it(
    "opens the SAME data key as the password does",
    async () => {
      // Forgetting the master password used to cost every login. It now costs
      // a trip to the recovery key, and both routes reach the same secrets.
      const made = await createEnvelope("forgotten-already");
      const secret = await encryptSecret(made.dek, "hunter2");

      const viaRecovery = await unlockWithRecovery(made.envelope, made.recoveryKey);
      expect(viaRecovery).not.toBeNull();
      expect(await decryptSecret(viaRecovery!.dek, secret)).toBe("hunter2");
      expect([...viaRecovery!.raw]).toEqual([...made.raw]);
    },
    SLOW,
  );

  it(
    "accepts the recovery key typed back carelessly",
    async () => {
      const made = await createEnvelope("pw");
      const sloppy = made.recoveryKey.toLowerCase().replace(/-/g, " ");
      expect(await unlockWithRecovery(made.envelope, sloppy)).not.toBeNull();
    },
    SLOW,
  );

  it(
    "refuses a recovery key from a different vault",
    async () => {
      const [a, b] = await Promise.all([createEnvelope("pw"), createEnvelope("pw")]);
      expect(await unlockWithRecovery(a.envelope, b.recoveryKey)).toBeNull();
    },
    SLOW,
  );
});

describe("changing the master password", () => {
  it(
    "keeps every secret readable, because only 32 bytes are re-wrapped",
    async () => {
      const made = await createEnvelope("old-password");
      const secret = await encryptSecret(made.dek, "s3cret");

      const next = await changePassword(made.envelope, made.raw, "new-password");
      const opened = await unlockWithPassword(next, "new-password");
      expect(opened).not.toBeNull();
      expect(await decryptSecret(opened!.dek, secret)).toBe("s3cret");
    },
    SLOW,
  );

  it(
    "stops the old password working",
    async () => {
      const made = await createEnvelope("old-password");
      const next = await changePassword(made.envelope, made.raw, "new-password");
      expect(await unlockWithPassword(next, "old-password")).toBeNull();
    },
    SLOW,
  );

  it(
    "DOES NOT BREAK THE RECOVERY KEY",
    async () => {
      // The bug two salts exist to prevent. With one shared salt, re-salting on
      // a password change silently destroys the recovery wrapping — and nobody
      // finds out until the day they need it.
      const made = await createEnvelope("old-password");
      const secret = await encryptSecret(made.dek, "still-here");
      const next = await changePassword(made.envelope, made.raw, "new-password");

      const viaRecovery = await unlockWithRecovery(next, made.recoveryKey);
      expect(viaRecovery).not.toBeNull();
      expect(await decryptSecret(viaRecovery!.dek, secret)).toBe("still-here");
    },
    SLOW,
  );
});

describe("reissuing the recovery key", () => {
  it(
    "retires the old key and keeps the password working",
    async () => {
      const made = await createEnvelope("pw");
      const secret = await encryptSecret(made.dek, "value");
      const { envelope, recoveryKey } = await reissueRecovery(made.envelope, made.raw);

      expect(await unlockWithRecovery(envelope, made.recoveryKey)).toBeNull();
      const fresh = await unlockWithRecovery(envelope, recoveryKey);
      expect(fresh).not.toBeNull();
      expect(await decryptSecret(fresh!.dek, secret)).toBe("value");
      expect(await unlockWithPassword(envelope, "pw")).not.toBeNull();
    },
    SLOW,
  );
});

describe("secrets", () => {
  it(
    "round-trip, including the characters that break naive encoding",
    async () => {
      const made = await createEnvelope("pw");
      for (const secret of ["hunter2", "", "p@ss w/ spaces", "emoji 🔐 and ünïcode", "a".repeat(5000), '{"json":true}']) {
        const sealed = await encryptSecret(made.dek, secret);
        expect(await decryptSecret(made.dek, sealed)).toBe(secret);
      }
    },
    SLOW,
  );

  it(
    "never produce the same ciphertext twice for the same secret",
    async () => {
      // A fresh IV each time, or an observer learns which of two logins share
      // a password just by looking at the stored blob.
      const made = await createEnvelope("pw");
      const a = await encryptSecret(made.dek, "same");
      const b = await encryptSecret(made.dek, "same");
      expect(a.ct).not.toBe(b.ct);
      expect(a.iv).not.toBe(b.iv);
    },
    SLOW,
  );

  it(
    "refuse to decrypt under a different vault's key, rather than returning rubbish",
    async () => {
      const [a, b] = await Promise.all([createEnvelope("pw"), createEnvelope("pw")]);
      const sealed = await encryptSecret(a.dek, "hunter2");
      expect(await decryptSecret(b.dek, sealed)).toBeNull();
    },
    SLOW,
  );

  it(
    "detect a tampered ciphertext instead of trusting it",
    async () => {
      // AES-GCM is authenticated; a flipped byte must fail, not decode to
      // something plausible.
      const made = await createEnvelope("pw");
      const sealed = await encryptSecret(made.dek, "hunter2");
      const bytes = fromB64(sealed.ct);
      bytes[0] ^= 0xff;
      expect(await decryptSecret(made.dek, { iv: sealed.iv, ct: toB64(bytes) })).toBeNull();
    },
    SLOW,
  );
});
