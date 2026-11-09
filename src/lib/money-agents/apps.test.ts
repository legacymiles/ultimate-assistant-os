import { describe, expect, it } from "vitest";
import { ROOMS } from "@/lib/bible/rooms";
import { STUDIO_APPS, appBadge, appStat, studioApp, type StudioAppId, type StudioCounts } from "./apps";

const EMPTY: StudioCounts = {
  plays: 0,
  catches: 0,
  waiting: 0,
  inFlight: 0,
  agents: 0,
  campaigns: 0,
  paidThisMonth: 0,
};

const BUSY: StudioCounts = {
  plays: 9,
  catches: 2,
  waiting: 3,
  inFlight: 7,
  agents: 4,
  campaigns: 2,
  paidThisMonth: 1240,
};

const ALL = STUDIO_APPS.map((a) => a.id);

describe("the studio's apps", () => {
  it("keeps the ids `?tab=` has always used, once each", () => {
    expect(ALL).toEqual(["radar", "approve", "pipeline", "agents", "campaigns", "earnings", "bible"]);
    expect(new Set(ALL).size).toBe(ALL.length);
  });

  it("gives every app a name and a one-line what-it-does", () => {
    for (const app of STUDIO_APPS) {
      expect(app.name.length).toBeGreaterThan(2);
      expect(app.what.length).toBeGreaterThan(20);
      // One line: a sentence on a tile, not a paragraph.
      expect(app.what.length).toBeLessThan(110);
      expect(app.what).not.toContain("\n");
    }
  });

  it("finds an app by id", () => {
    expect(studioApp("bible").name).toBe("Financial Bible");
    expect(studioApp("radar").accent).toBe("mint");
  });
});

describe("the live line on a tile", () => {
  it("says something honest for every app, empty or busy", () => {
    for (const id of ALL) {
      for (const c of [EMPTY, BUSY]) {
        const s = appStat(id, c);
        expect(s.value.length).toBeGreaterThan(0);
        expect(s.label.length).toBeGreaterThan(0);
        // Short enough for a tile.
        expect(`${s.value} ${s.label}`.length).toBeLessThan(26);
      }
    }
  });

  it("never dresses an empty app up as news", () => {
    expect(appStat("radar", EMPTY)).toEqual({ value: "—", label: "scanning", hot: false });
    expect(appStat("approve", EMPTY)).toEqual({ value: "0", label: "all clear", hot: false });
    expect(appStat("pipeline", EMPTY).label).toBe("nothing in flight");
    expect(appStat("agents", EMPTY).label).toBe("none yet");
    expect(appStat("campaigns", EMPTY).label).toBe("none joined");
  });

  it("counts the work where it is", () => {
    expect(appStat("approve", BUSY)).toEqual({ value: "3", label: "waiting on you", hot: true });
    expect(appStat("pipeline", BUSY).value).toBe("7");
    expect(appStat("radar", BUSY).value).toBe("9");
    expect(appStat("campaigns", BUSY).value).toBe("2");
  });

  it("shows the month's money as money", () => {
    expect(appStat("earnings", BUSY)).toEqual({ value: "$1,240", label: "this month", hot: false });
    expect(appStat("earnings", EMPTY).value).toBe("$0");
  });

  it("counts one agent in the singular", () => {
    expect(appStat("agents", { ...EMPTY, agents: 1 }).label).toBe("running");
    expect(appStat("agents", { ...EMPTY, agents: 2 }).label).toBe("agents running");
    expect(appStat("campaigns", { ...EMPTY, campaigns: 1 }).label).toBe("campaign");
  });

  it("names the Bible's own rooms", () => {
    expect(appStat("bible", EMPTY).value).toBe(String(ROOMS.length));
  });

  it("goes hot only when something is actually waiting", () => {
    const hot = ALL.filter((id) => appStat(id, BUSY).hot);
    expect(hot).toEqual(["radar", "approve"]);
    expect(ALL.filter((id) => appStat(id, EMPTY).hot)).toEqual([]);
  });
});

describe("the number in a tile's corner", () => {
  it("is only ever work waiting or a move caught today", () => {
    expect(appBadge("approve", BUSY)).toBe(3);
    expect(appBadge("radar", BUSY)).toBe(2);
    const quiet: StudioAppId[] = ["pipeline", "agents", "campaigns", "earnings", "bible"];
    for (const id of quiet) expect(appBadge(id, BUSY)).toBe(0);
  });

  it("is nothing at all when the board is empty", () => {
    for (const id of ALL) expect(appBadge(id, EMPTY)).toBe(0);
  });
});
