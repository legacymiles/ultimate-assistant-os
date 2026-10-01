import { describe, expect, it } from "vitest";
import { matchesAny, normalizeMerchant } from "./merchant";

describe("normalizeMerchant", () => {
  it("lowercases and trims", () => {
    expect(normalizeMerchant("  SPOTIFY  ")).toBe("spotify");
  });
  it("strips a card-network prefix", () => {
    expect(normalizeMerchant("SQ *BLUE BOTTLE")).toBe("blue bottle");
    expect(normalizeMerchant("PAYPAL *STEAM GAMES")).toBe("steam games");
    expect(normalizeMerchant("POS DEBIT TESCO")).toBe("tesco");
  });
  it("strips a trailing store or reference number", () => {
    expect(normalizeMerchant("TESCO STORES 3614")).toBe("tesco stores");
    expect(normalizeMerchant("SHELL 00412783")).toBe("shell");
  });
  it("strips punctuation and collapses whitespace", () => {
    expect(normalizeMerchant("AMAZON.CO.UK*MK1AB2CD3")).toBe("amazon co uk");
  });
  it("keeps a bare name intact", () => {
    expect(normalizeMerchant("Netflix")).toBe("netflix");
  });
  // Two different Starbucks branches are the same payee for matching.
  it("brings two branches of one chain to the same name", () => {
    expect(normalizeMerchant("STARBUCKS 0471")).toBe(normalizeMerchant("STARBUCKS 9920"));
  });
  it("does not reduce a name to nothing", () => {
    // All-numeric descriptors exist; returning "" would match every bill.
    expect(normalizeMerchant("00412783")).toBe("00412783");
  });
});

describe("matchesAny", () => {
  it("matches a substring", () => {
    expect(matchesAny("spotify ab", ["spotify"])).toBe(true);
  });
  it("normalizes the matchers too, so a typed matcher with caps still works", () => {
    expect(matchesAny("spotify ab", ["Spotify"])).toBe(true);
  });
  it("does not match an unrelated payee", () => {
    expect(matchesAny("tesco stores", ["spotify"])).toBe(false);
  });
  it("is false for no matchers", () => {
    expect(matchesAny("spotify", [])).toBe(false);
  });
  it("ignores an empty matcher rather than matching everything", () => {
    expect(matchesAny("spotify", [""])).toBe(false);
  });
});
