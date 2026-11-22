import { describe, expect, it } from "vitest";
import {
  allBills,
  applyOverride,
  billsByDay,
  dueBills,
  filterByOwner,
  filterUnpaid,
  money,
  moneyShort,
  sortDueBills,
  totalsOf,
  whenLabel,
} from "./view";
import { paidKey, type Bill } from "./types";

const TODAY = "2026-11-22";

function bill(over: Partial<Bill> = {}): Bill {
  return {
    id: "b1",
    name: "Rent",
    amount: 1400,
    currency: "USD",
    cadence: "monthly",
    dayOfMonth: 1,
    weekday: null,
    monthOfYear: null,
    firstDue: "2026-11-01",
    endDate: null,
    autopay: false,
    paused: false,
    profileId: null,
    profileName: null,
    ownerId: null,
    ownerName: null,
    source: "typed",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("dueBills", () => {
  it("expands a monthly bill onto its day in each month", () => {
    const list = dueBills([bill()], "2026-11-01", "2027-01-31", {}, TODAY);
    expect(list.map((d) => d.due)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });

  it("puts a 31st bill on the last day of a short month", () => {
    const list = dueBills([bill({ dayOfMonth: 31, firstDue: "2027-01-31" })], "2027-01-01", "2027-02-28", {}, TODAY);
    expect(list.map((d) => d.due)).toEqual(["2027-01-31", "2027-02-28"]);
  });

  it("attaches the paid mark to one occurrence only", () => {
    const paid = { [paidKey("b1", "2026-11-01")]: "2026-11-01T10:00:00.000Z" };
    const list = dueBills([bill()], "2026-11-01", "2026-12-31", paid, TODAY);
    expect(list[0].paid).toBe(true);
    expect(list[0].paidAt).toBe("2026-11-01T10:00:00.000Z");
    expect(list[1].paid).toBe(false);
  });

  it("calls a bill overdue only when it is unpaid and the day has gone", () => {
    const list = dueBills([bill()], "2026-11-01", "2026-12-31", {}, TODAY);
    expect(list[0].overdue).toBe(true);
    expect(list[0].dueIn).toBe(-21);
    expect(list[1].overdue).toBe(false);
    const paid = dueBills([bill()], "2026-11-01", "2026-12-31", { [paidKey("b1", "2026-11-01")]: "x" }, TODAY);
    expect(paid[0].overdue).toBe(false);
  });

  it("leaves a paused bill out", () => {
    expect(dueBills([bill({ paused: true })], "2026-11-01", "2026-12-31", {}, TODAY)).toEqual([]);
  });

  it("shows the 1st of the month first, by date, biggest first on a tie", () => {
    const list = dueBills(
      [
        bill({ id: "b1", name: "Rent", dayOfMonth: 1, amount: 1400 }),
        bill({ id: "b2", name: "Phone", dayOfMonth: 1, amount: 85, firstDue: "2026-11-01" }),
        bill({ id: "b3", name: "Gym", dayOfMonth: 15, amount: 40, firstDue: "2026-11-15" }),
      ],
      "2026-11-01",
      "2026-11-30",
      {},
      TODAY,
    );
    expect(list.map((d) => d.bill.name)).toEqual(["Rent", "Phone", "Gym"]);
  });
});

describe("sorting and filtering", () => {
  const list = dueBills(
    [
      bill({ id: "b1", name: "Rent", amount: 1400, dayOfMonth: 1, ownerId: "me", ownerName: "My Profile" }),
      bill({ id: "b2", name: "Car insurance", amount: 245, dayOfMonth: 15, firstDue: "2026-11-15", ownerId: "gf", ownerName: "Girlfriend" }),
      bill({ id: "b3", name: "Gym", amount: 40, dayOfMonth: 20, firstDue: "2026-11-20" }),
    ],
    "2026-11-01",
    "2026-11-30",
    { [paidKey("b1", "2026-11-01")]: "x" },
    TODAY,
  );

  it("sorts highest first on request", () => {
    expect(sortDueBills(list, "amount").map((d) => d.amount)).toEqual([1400, 245, 40]);
  });

  it("sorts A-Z on request", () => {
    expect(sortDueBills(list, "name").map((d) => d.bill.name)).toEqual(["Car insurance", "Gym", "Rent"]);
  });

  it("filters to one profile", () => {
    expect(filterByOwner(list, "gf").map((d) => d.bill.name)).toEqual(["Car insurance"]);
  });

  it("filters to the bills that are in no profile", () => {
    expect(filterByOwner(list, "none").map((d) => d.bill.name)).toEqual(["Gym"]);
  });

  it("leaves everything in on 'all'", () => {
    expect(filterByOwner(list, "all")).toHaveLength(3);
  });

  it("can hide what is already paid", () => {
    expect(filterUnpaid(list, true).map((d) => d.bill.name)).toEqual(["Car insurance", "Gym"]);
    expect(filterUnpaid(list, false)).toHaveLength(3);
  });

  it("groups by day for the month grid", () => {
    const map = billsByDay(list);
    expect([...map.keys()]).toEqual(["2026-11-01", "2026-11-15", "2026-11-20"]);
    expect(map.get("2026-11-01")?.[0].bill.name).toBe("Rent");
  });

  it("totals what is due, paid, left and late", () => {
    expect(totalsOf(list)).toEqual({
      count: 3,
      total: 1685,
      paid: 1400,
      left: 285,
      // Both unpaid bills fell before today; the paid one never counts as late.
      overdue: 285,
      overdueCount: 2,
    });
  });
});

describe("corrections", () => {
  it("drops a row that was never really a bill", () => {
    expect(applyOverride(bill(), { dropped: true })).toBeNull();
  });

  it("lets the owner set the day Profiles could not know", () => {
    const fixed = applyOverride(bill({ dayGuessed: true }), { dayOfMonth: 9 })!;
    expect(fixed.dayOfMonth).toBe(9);
    expect(fixed.dayGuessed).toBeUndefined();
    expect(dueBills([fixed], "2026-11-01", "2026-11-30", {}, TODAY)[0].due).toBe("2026-11-09");
  });

  it("keeps profile bills and typed bills in one list", () => {
    const typed = [bill({ id: "t1", name: "Storage unit" })];
    const derived = [bill({ id: "profiles:x", name: "Car insurance", source: "profiles" })];
    expect(allBills(typed, derived, {}).map((b) => b.name)).toEqual(["Car insurance", "Storage unit"]);
    expect(allBills(typed, derived, { "profiles:x": { dropped: true } }).map((b) => b.name)).toEqual(["Storage unit"]);
  });
});

describe("words", () => {
  it("writes money the way it is read", () => {
    expect(money(39)).toBe("$39.00");
    expect(money(15.49)).toBe("$15.49");
    expect(money(1400)).toBe("$1,400.00");
  });

  it("drops the cents only where a calendar day has no room", () => {
    expect(moneyShort(1400)).toBe("$1,400");
    expect(moneyShort(79.99)).toBe("$79.99");
  });

  it("says when a bill is due in plain words", () => {
    const list = dueBills([bill({ dayOfMonth: 22, firstDue: "2026-11-22" })], "2026-11-01", "2026-11-30", {}, TODAY);
    expect(whenLabel(list[0])).toBe("due today");
    const late = dueBills([bill()], "2026-11-01", "2026-11-30", {}, TODAY);
    expect(whenLabel(late[0])).toBe("21 days late");
    const soon = dueBills([bill({ dayOfMonth: 23, firstDue: "2026-11-23" })], "2026-11-01", "2026-11-30", {}, TODAY);
    expect(whenLabel(soon[0])).toBe("due tomorrow");
  });
});
