import { describe, expect, it } from "vitest";
import { toAccount, toBill, toSettings, toTxn } from "./rows";

describe("toAccount", () => {
  // PostgREST serialises numeric columns as STRINGS. "9.99" > 10 is false and
  // "9.99" + 1 is "9.991", so a string reaching the engines is a silent wrong
  // answer rather than a crash.
  it("turns numeric strings into numbers", () => {
    const a = toAccount({
      id: "a1",
      type: "credit",
      balance_current: "420.75",
      credit_limit: "2000.00",
      minimum_payment: "25.00",
      last_statement_balance: "410.00",
    });
    expect(a.balanceCurrent).toBe(420.75);
    expect(a.creditLimit).toBe(2000);
    expect(a.minimumPayment).toBe(25);
    expect(a.lastStatementBalance).toBe(410);
  });

  it("keeps a null balance null rather than turning it into zero", () => {
    // Zero would read as "nothing owed", which is a different claim.
    expect(toAccount({ id: "a1", balance_current: null }).balanceCurrent).toBeNull();
  });

  it("defaults countInSpend from the account type when the column is absent", () => {
    expect(toAccount({ id: "a", type: "credit" }).countInSpend).toBe(true);
    expect(toAccount({ id: "a", type: "depository" }).countInSpend).toBe(false);
  });

  it("honours an explicit countInSpend over the default", () => {
    expect(toAccount({ id: "a", type: "credit", count_in_spend: false }).countInSpend).toBe(false);
  });

  it("falls back to typed for an unknown dates_source", () => {
    expect(toAccount({ id: "a", dates_source: "nonsense" }).datesSource).toBe("typed");
    expect(toAccount({ id: "a", dates_source: "bank" }).datesSource).toBe("bank");
  });

  it("treats an unknown type as depository rather than inventing a card", () => {
    expect(toAccount({ id: "a", type: "loan" }).type).toBe("depository");
  });
});

describe("toBill", () => {
  it("reads a full row", () => {
    const b = toBill({
      id: "b1",
      name: "Spotify",
      merchant_matchers: ["spotify"],
      amount_expected: "9.99",
      amount_tolerance: "1.00",
      amount_tolerance_pct: "5.00",
      currency: "GBP",
      account_id: "a1",
      autopay: true,
      cadence: "monthly",
      day_of_month: 12,
      first_due: "2026-01-12",
      grace_days: 3,
      reminders: [1440, 60],
      paused: false,
      origin: "typed",
    });
    expect(b.amountExpected).toBe(9.99);
    expect(b.amountTolerancePct).toBe(5);
    expect(b.reminders).toEqual([1440, 60]);
    expect(b.cadence).toBe("monthly");
  });

  it("falls back to monthly for an unknown cadence", () => {
    expect(toBill({ id: "b", cadence: "fortnightly" }).cadence).toBe("fortnightly");
    expect(toBill({ id: "b", cadence: "whenever" }).cadence).toBe("monthly");
  });

  it("tolerates missing arrays", () => {
    const b = toBill({ id: "b" });
    expect(b.matchers).toEqual([]);
    expect(b.reminders).toEqual([]);
  });

  it("keeps a null account id null", () => {
    expect(toBill({ id: "b", account_id: null }).accountId).toBeNull();
  });
});

describe("toTxn", () => {
  it("turns the amount string into a number, sign intact", () => {
    expect(toTxn({ id: "t", amount: "-24.99" }).amount).toBe(-24.99);
    expect(toTxn({ id: "t", amount: "58.50" }).amount).toBe(58.5);
  });

  it("keeps the pending link, which fold depends on", () => {
    expect(toTxn({ id: "t", pending_txn_id: "p1" }).pendingTxnId).toBe("p1");
    expect(toTxn({ id: "t", pending_txn_id: null }).pendingTxnId).toBeNull();
  });

  // Normalization has already changed once this session. A stored value from
  // before the change would quietly stop matching its bill.
  it("recomputes the normalized merchant when the column is empty", () => {
    expect(toTxn({ id: "t", merchant_raw: "TESCO STORES 3614", merchant_norm: "" }).merchantNorm).toBe(
      "tesco stores",
    );
  });

  it("uses the stored normalized merchant when present", () => {
    expect(
      toTxn({ id: "t", merchant_raw: "TESCO STORES 3614", merchant_norm: "tesco" }).merchantNorm,
    ).toBe("tesco");
  });

  it("reads removed_at, so a removed row stays recognisable", () => {
    expect(toTxn({ id: "t", removed_at: "2026-09-30T10:00:00Z" }).removedAt).toBe(
      "2026-09-30T10:00:00Z",
    );
  });
});

describe("toSettings", () => {
  it("returns the defaults for no row at all", () => {
    const s = toSettings(null);
    expect(s.leadDays).toEqual([7, 3, 1]);
    expect(s.weekStartsOn).toBe(1);
  });

  it("reads a stored row", () => {
    const s = toSettings({
      lead_days: [14, 2],
      duplicate_min_amount: "5.00",
      duplicate_window_days: 2,
      multi_charge_payees: ["tesco"],
      week_starts_on: 0,
      currency_display: "GBP",
    });
    expect(s.leadDays).toEqual([14, 2]);
    expect(s.duplicateMinAmount).toBe(5);
    expect(s.multiChargePayees).toEqual(["tesco"]);
    expect(s.weekStartsOn).toBe(0);
    expect(s.currencyDisplay).toBe("GBP");
  });

  // The column was added after the first migration shipped, so a row written
  // before it must not produce NaN.
  it("falls back for a column the stored row predates", () => {
    expect(toSettings({ lead_days: [7] }).recurringMinAmount).toBe(3);
  });

  it("ignores an empty lead_days rather than silencing every reminder", () => {
    expect(toSettings({ lead_days: [] }).leadDays).toEqual([7, 3, 1]);
  });
});
