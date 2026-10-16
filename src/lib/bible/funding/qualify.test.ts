import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE, qualify, type ClientProfile } from "./qualify";

const strong: ClientProfile = {
  ...EMPTY_PROFILE,
  score: 760,
  utilization: 6,
  availableCredit: 40000,
  seasonedCards: 4,
  avgAgeYears: 6,
  recentInquiries: 0,
  newAccounts: 0,
  tibMonths: 30,
  monthlyRevenue: 45000,
  bankBalance: 12000,
  state: "OH",
};

describe("qualify", () => {
  it("says incomplete until score, utilization and cards are entered", () => {
    expect(qualify(EMPTY_PROFILE).verdict).toBe("incomplete");
    expect(qualify(EMPTY_PROFILE).lenders).toEqual([]);
  });

  it("calls a clean, seasoned file ready and estimates 2–3× available credit", () => {
    const r = qualify(strong);
    expect(r.verdict).toBe("ready");
    expect(r.estimate).toEqual({ low: 80000, high: 120000, basis: "2–3× personal available credit" });
  });

  it("blocks on derogatories, lates, a bank flag or a sub-680 score", () => {
    expect(qualify({ ...strong, derogatories: true }).verdict).toBe("not-yet");
    expect(qualify({ ...strong, latesIn24: true }).verdict).toBe("not-yet");
    expect(qualify({ ...strong, bankFlag: true }).verdict).toBe("not-yet");
    expect(qualify({ ...strong, score: 650 }).verdict).toBe("not-yet");
    expect(qualify({ ...strong, score: 650 }).estimate).toBeNull();
  });

  it("downgrades to almost on warnings and discounts the estimate", () => {
    const r = qualify({ ...strong, utilization: 28, recentInquiries: 4 });
    expect(r.verdict).toBe("almost");
    expect(r.estimate!.high).toBeLessThan(120000);
    expect(r.checks.find((c) => c.id === "util")!.fix).toBeTruthy();
  });

  it("filters lenders by revenue, time in business and state footprint", () => {
    const ids = (p: ClientProfile) => qualify(p).lenders.map((m) => m.lender.id);
    expect(ids(strong)).toContain("bluevine"); // $40k/mo minimum
    expect(ids({ ...strong, monthlyRevenue: 10000 })).not.toContain("bluevine");
    expect(ids({ ...strong, tibMonths: 0 })).not.toContain("first-citizens");
    expect(ids({ ...strong, state: "TX" })).not.toContain("liberty-bank"); // CT/RI/MA only
    expect(ids({ ...strong, state: "CT" })).toContain("liberty-bank");
  });

  it("puts soft-pull lenders ahead of hard pulls", () => {
    const r = qualify(strong);
    const firstHard = r.lenders.findIndex((m) => m.lender.pull === "hard");
    const lastSoft = r.lenders.map((m) => m.lender.pull).lastIndexOf("soft-prequal");
    expect(firstHard).toBeGreaterThan(-1);
    expect(lastSoft).toBeLessThan(firstHard);
  });
});
