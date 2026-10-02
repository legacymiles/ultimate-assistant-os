import { describe, expect, it } from "vitest";
import {
  canAcceptSecrets,
  coerceVault,
  count,
  describeVault,
  emptyVault,
  markExported,
  planMigration,
  putSecret,
  recoverySheet,
  reissued,
  removeSecret,
  setEnvelope,
  vaultState,
  type Login,
  type VaultBlob,
} from "./vault";
import type { Cipher, Envelope } from "./crypto";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");

const envelope = (): Envelope => ({
  saltMaster: "c2FsdG1hc3Rlcg==",
  saltRecovery: "c2FsdHJlY292ZXJ5",
  iterations: 600_000,
  master: { iv: "aXY=", ct: "Y3Q=" },
  recovery: { iv: "aXYy", ct: "Y3Qy" },
});

const cipher = (n = 1): Cipher => ({ iv: `iv${n}`, ct: `ct${n}` });

/** A vault that is set up and confirmed. */
const ready = (): VaultBlob => markExported(setEnvelope(emptyVault(), envelope(), NOW), NOW);

const login = (id: string, patch: Partial<Login> = {}): Login => ({ id, title: id, ...patch });

describe("the gate — the reason encrypting is defensible at all", () => {
  it("refuses to store anything until the recovery key is written down", () => {
    // This repo already retired an encrypted vault because forgetting the
    // master password lost every login. A vault that fills up before the owner
    // has a way back is that same trap with a lock on it.
    const fresh = setEnvelope(emptyVault(), envelope(), NOW);
    expect(vaultState(fresh)).toBe("unconfirmed");
    expect(canAcceptSecrets(fresh)).toBe(false);

    const refused = putSecret(fresh, "item-1", cipher(), NOW);
    expect(refused.secrets).toEqual({});
    expect(count(refused)).toBe(0);
  });

  it("enforces it in putSecret, not only in the UI", () => {
    // A caller that forgot to check is exactly how a precondition quietly
    // becomes a suggestion.
    const fresh = setEnvelope(emptyVault(), envelope(), NOW);
    expect(putSecret(fresh, "a", cipher(), NOW)).toEqual(fresh);
  });

  it("opens once the key has been exported", () => {
    const v = ready();
    expect(vaultState(v)).toBe("ready");
    expect(count(putSecret(v, "item-1", cipher(), NOW))).toBe(1);
  });

  it("SHUTS AGAIN when a new recovery key is issued", () => {
    // Reissuing retires the old key immediately. Leaving the gate open would
    // leave the owner holding a vault whose only way back is a key they have
    // not written down yet.
    const full = putSecret(ready(), "item-1", cipher(), NOW);
    const after = reissued(full, envelope(), NOW);
    expect(vaultState(after)).toBe("unconfirmed");
    expect(canAcceptSecrets(after)).toBe(false);
    // And it does not throw away what was already in it.
    expect(count(after)).toBe(1);
  });
});

describe("the blob", () => {
  it("starts empty and says so", () => {
    expect(vaultState(emptyVault())).toBe("empty");
    expect(canAcceptSecrets(emptyVault())).toBe(false);
  });

  it("stores and removes a secret by the login's own id", () => {
    const v = putSecret(ready(), "item-1", cipher(7), NOW);
    expect(v.secrets["item-1"]).toEqual(cipher(7));
    expect(count(removeSecret(v, "item-1", NOW))).toBe(0);
  });

  it("ignores a removal of something that is not there", () => {
    const v = ready();
    expect(removeSecret(v, "nope", NOW)).toBe(v);
  });

  it("refuses a secret with no id, rather than storing one under an empty key", () => {
    expect(count(putSecret(ready(), "", cipher(), NOW))).toBe(0);
  });

  it("stores only the secret — never the site, username or URL", () => {
    // Those live on the Recall item, in the clear and deliberately searchable.
    // A second copy here would be a second copy to drift.
    const v = putSecret(ready(), "item-1", cipher(), NOW);
    expect(Object.keys(v)).toEqual(["version", "envelope", "recoveryExportedAt", "secrets", "updatedAt"]);
    expect(JSON.stringify(v.secrets)).not.toMatch(/http|@|\.com/);
  });
});

describe("coerceVault", () => {
  it("repairs a half-written blob instead of throwing", () => {
    const v = coerceVault({
      envelope: envelope(),
      recoveryExportedAt: "2026-10-02T00:00:00Z",
      secrets: { good: { iv: "a", ct: "b" }, bad: { iv: 3 }, worse: null },
    });
    expect(Object.keys(v.secrets)).toEqual(["good"]);
  });

  it("survives nothing at all", () => {
    expect(coerceVault(undefined)).toEqual(emptyVault());
    expect(coerceVault("not an object")).toEqual(emptyVault());
  });

  it("drops a half-written envelope rather than pretending the vault exists", () => {
    expect(coerceVault({ envelope: { saltMaster: "a" } }).envelope).toBeNull();
  });

  it("throws away secrets that have no envelope to open them", () => {
    // Keeping them would be keeping rubbish that looks like data.
    const v = coerceVault({ envelope: null, secrets: { a: { iv: "x", ct: "y" } } });
    expect(v.secrets).toEqual({});
  });

  it("drops a corrupt export date, closing the gate rather than trusting it", () => {
    expect(coerceVault({ envelope: envelope(), recoveryExportedAt: "nonsense" }).recoveryExportedAt).toBeNull();
  });
});

describe("planMigration", () => {
  const logins = [
    login("a", { password: "hunter2" }),
    login("b", { password: "s3cret" }),
    login("c", { hasLegacySecret: true }),
    login("d"),
  ];

  it("separates the three states, because they need three different sentences", () => {
    const v = putSecret(ready(), "a", cipher(), NOW);
    const plan = planMigration(logins, v);
    expect(plan.done).toBe(1);
    expect(plan.toSeal.map((l) => l.id)).toEqual(["b"]);
    // Sealed under the RETIRED master password: a problem the new vault cannot
    // solve, and pretending otherwise would lose them.
    expect(plan.stranded.map((l) => l.id)).toEqual(["c"]);
  });

  it("ignores a login with no secret at all", () => {
    const plan = planMigration([login("d")], ready());
    expect(plan.toSeal).toEqual([]);
    expect(plan.stranded).toEqual([]);
  });

  it("treats a whitespace-only password as no password", () => {
    expect(planMigration([login("x", { password: "   " })], ready()).toSeal).toEqual([]);
  });
});

describe("describeVault", () => {
  const empty = { toSeal: [], done: 0, stranded: [] };

  it("is blunt about an unset vault, because that is the honest state", () => {
    expect(describeVault(emptyVault(), empty)).toContain("readable");
  });

  it("names the gate while it is shut", () => {
    expect(describeVault(setEnvelope(emptyVault(), envelope(), NOW), empty)).toContain("recovery key");
  });

  it("counts what is encrypted and what is not", () => {
    const v = putSecret(ready(), "a", cipher(), NOW);
    const line = describeVault(v, { toSeal: [login("b")], done: 1, stranded: [login("c")] });
    expect(line).toContain("1 encrypted");
    expect(line).toContain("1 still in the clear");
    expect(line).toContain("old master password");
  });
});

describe("recoverySheet", () => {
  it("contains the key and what to do with it, in plain text", () => {
    const sheet = recoverySheet("ABCDE-FGHJK", NOW);
    expect(sheet).toContain("ABCDE-FGHJK");
    expect(sheet).toContain("IF YOU LOSE BOTH");
    expect(sheet).toContain("not this computer");
  });

  it("says plainly that nobody holds a copy", () => {
    // The one sentence that stops "can you reset it for me" being asked later.
    expect(recoverySheet("X", NOW)).toContain("Nobody holds a copy");
  });
});
