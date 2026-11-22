import { describe, expect, it } from "vitest";
import { billsFromProfiles, profilesWithBills } from "./fromProfiles";
import { seedProfiles } from "@/lib/profiles/seed";
import type { Item, ProfileNode, ProfilesData, Section } from "@/lib/profiles/types";

const TODAY = "2026-11-22";

function item(k: string, v: string, extra: Partial<Item> = {}): Item {
  return { id: `i-${k.toLowerCase().replace(/\W+/g, "-")}`, k, v, ...extra };
}

function section(title: string, items: Item[]): Section {
  return { id: `s-${title.toLowerCase()}`, title, items };
}

function node(id: string, name: string, sections: Section[], extra: Partial<ProfileNode> = {}): ProfileNode {
  return {
    id,
    name,
    kind: "thing",
    label: "Business",
    sub: "",
    children: [],
    links: [],
    sections,
    media: [],
    ...extra,
  };
}

function profiles(nodes: ProfileNode[], rootChildren: string[]): ProfilesData {
  const map: Record<string, ProfileNode> = {
    root: node("root", "Profiles", [], { label: "Home", children: rootChildren }),
  };
  for (const n of nodes) map[n.id] = n;
  return { version: 1, nodes: map, memory: [], log: [], examples: false, settings: { mask: true, brain: "auto" } };
}

describe("billsFromProfiles", () => {
  it("reads a monthly payment with a written due day", () => {
    const data = profiles(
      [node("gf", "Girlfriend", [section("Bills", [item("Car insurance", "$245.00", { money: 245, meta: "Monthly, due the 1st" })])], { label: "Person", kind: "person" })],
      ["gf"],
    );
    const [bill] = billsFromProfiles(data, { today: TODAY });
    expect(bill.name).toBe("Car insurance");
    expect(bill.amount).toBe(245);
    expect(bill.cadence).toBe("monthly");
    expect(bill.dayOfMonth).toBe(1);
    expect(bill.firstDue).toBe("2026-11-01");
    expect(bill.ownerId).toBe("gf");
    expect(bill.ownerName).toBe("Girlfriend");
    expect(bill.id).toBe("profiles:i-car-insurance");
    expect(bill.dayGuessed).toBeUndefined();
  });

  it("attributes a bill to the main profile and keeps the whole path", () => {
    const data = profiles(
      [
        node("biz", "My Businesses", [], { children: ["prints"] }),
        node("prints", "Northside Prints", [], { children: ["dtf"] }),
        node("dtf", "DTF Printer", [
          section("Payments", [item("DTF printer payment", "$189.00", { money: 189, meta: "Monthly, due the 12th" })]),
        ]),
      ],
      ["biz"],
    );
    const [bill] = billsFromProfiles(data, { today: TODAY });
    expect(bill.ownerId).toBe("biz");
    expect(bill.profileName).toBe("DTF Printer");
    expect(bill.where).toBe("My Businesses › Northside Prints › DTF Printer");
    expect(bill.dayOfMonth).toBe(12);
  });

  it("leaves purchases alone — a receipt is not a bill", () => {
    const data = profiles(
      [
        node("prints", "Northside Prints", [
          section("Purchases", [
            item("Gildan 5000 x 144", "$431.28", { money: 431.28, meta: "Oct 30" }),
            item("Teflon sheets", "$24.99", { money: 24.99, meta: "Sep 28" }),
          ]),
        ]),
      ],
      ["prints"],
    );
    expect(billsFromProfiles(data, { today: TODAY })).toEqual([]);
  });

  it("keeps a repeating row even in a purchases section", () => {
    const data = profiles(
      [node("prints", "Northside Prints", [section("Purchases", [item("Film roll", "$96.00", { money: 96, meta: "Monthly" })])])],
      ["prints"],
    );
    const bills = billsFromProfiles(data, { today: TODAY });
    expect(bills).toHaveLength(1);
    expect(bills[0].cadence).toBe("monthly");
  });

  it("needs a schedule: a one-off with no date is not a bill", () => {
    const data = profiles(
      [
        node("me", "My Profile", [
          section("Expenses", [
            item("Booth fee", "$120.00", { money: 120 }),
            item("Market stall", "$120.00", { money: 120, date: "2026-12-06" }),
          ]),
        ]),
      ],
      ["me"],
    );
    const bills = billsFromProfiles(data, { today: TODAY });
    expect(bills.map((b) => b.name)).toEqual(["Market stall"]);
    expect(bills[0].cadence).toBe("one_off");
    expect(bills[0].firstDue).toBe("2026-12-06");
  });

  it("takes a row named like a bill as monthly when nobody wrote the schedule", () => {
    const data = profiles(
      [
        node("dtf", "DTF Printer", [
          section("Details", [
            item("DTF printer payment", "$189.00", { money: 189 }),
            item("Ink", "CMYK + white, 250 ml"),
          ]),
        ]),
      ],
      ["dtf"],
    );
    const bills = billsFromProfiles(data, { today: TODAY });
    expect(bills.map((b) => b.name)).toEqual(["DTF printer payment"]);
    expect(bills[0].cadence).toBe("monthly");
    expect(bills[0].dayGuessed).toBe(true);
  });

  it("needs an amount", () => {
    const data = profiles(
      [node("me", "My Profile", [section("Bills", [item("Internet", "Monthly, Xfinity")])])],
      ["me"],
    );
    expect(billsFromProfiles(data, { today: TODAY })).toEqual([]);
  });

  it("says when the due day was assumed rather than written down", () => {
    const data = profiles(
      [node("me", "My Profile", [section("Expenses", [item("Shopify plan", "$39.00", { money: 39, meta: "Monthly" })])])],
      ["me"],
    );
    const [bill] = billsFromProfiles(data, { today: TODAY });
    expect(bill.dayGuessed).toBe(true);
    expect(bill.dayOfMonth).toBe(1);
  });

  it("understands the last day of the month, rates and weekdays", () => {
    const data = profiles(
      [
        node("me", "My Profile", [
          section("Bills", [
            item("Rent", "$1,400", { meta: "Due the last day of the month" }),
            item("Studio hire", "$80/wk", { meta: "Fridays" }),
            item("Domain", "$22/yr", { meta: "Every March" }),
          ]),
        ]),
      ],
      ["me"],
    );
    const bills = billsFromProfiles(data, { today: TODAY });
    const by = (name: string) => bills.find((b) => b.name === name)!;
    expect(by("Rent").amount).toBe(1400);
    expect(by("Rent").dayOfMonth).toBe(31);
    expect(by("Studio hire").cadence).toBe("weekly");
    expect(by("Studio hire").weekday).toBe(5);
    expect(by("Domain").cadence).toBe("annual");
    expect(by("Domain").monthOfYear).toBe(3);
  });

  it("marks autopay when the row says so", () => {
    const data = profiles(
      [node("me", "My Profile", [section("Bills", [item("Netflix", "$15.49", { money: 15.49, meta: "Monthly on the 8th, autopay" })])])],
      ["me"],
    );
    expect(billsFromProfiles(data, { today: TODAY })[0].autopay).toBe(true);
  });

  it("skips archived and hidden profiles", () => {
    const rows = [section("Bills", [item("Gym", "$40.00", { money: 40, meta: "Monthly on the 3rd" })])];
    const archived = profiles([node("old", "Old gym", rows, { archived: true })], ["old"]);
    const hidden = profiles([node("priv", "Private", rows, { hidden: true })], ["priv"]);
    expect(billsFromProfiles(archived, { today: TODAY })).toEqual([]);
    expect(billsFromProfiles(hidden, { today: TODAY })).toEqual([]);
  });

  it("lists the profiles that have bills in home-screen order", () => {
    const rows = (n: string) => [section("Bills", [item(n, "$10.00", { money: 10, meta: "Monthly on the 2nd" })])];
    const data = profiles(
      [node("gf", "Girlfriend", rows("Phone")), node("me", "My Profile", rows("Rent")), node("none", "Empty", [])],
      ["me", "gf", "none"],
    );
    const bills = billsFromProfiles(data, { today: TODAY });
    expect(profilesWithBills(data, bills)).toEqual([
      { id: "me", name: "My Profile", count: 1 },
      { id: "gf", name: "Girlfriend", count: 1 },
    ]);
  });

  it("reads the real Profiles examples without turning receipts into bills", () => {
    const bills = billsFromProfiles(seedProfiles(), { today: TODAY });
    const names = bills.map((b) => b.name);
    expect(names).toContain("Shopify plan");
    expect(names).not.toContain("Gildan 5000 × 144");
    expect(bills.every((b) => b.amount > 0)).toBe(true);
    expect(bills.every((b) => b.example)).toBe(true);
  });
});
