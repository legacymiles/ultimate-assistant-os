import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, newEncKey, sameDigest } from "./crypto";

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

  it("handles a long token", () => {
    const long = `access-sandbox-${"a".repeat(2000)}`;
    expect(decryptToken(encryptToken(long, KEY), KEY)).toBe(long);
  });
});

describe("sameDigest", () => {
  it("is true for equal strings", () => {
    expect(sameDigest("abc123", "abc123")).toBe(true);
  });
  it("is false for different strings of equal length", () => {
    expect(sameDigest("abc123", "abc124")).toBe(false);
  });
  it("is false for different lengths without throwing", () => {
    // timingSafeEqual throws on a length mismatch, so the guard matters.
    expect(sameDigest("abc", "abcd")).toBe(false);
  });
});
