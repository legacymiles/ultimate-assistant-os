import { describe, expect, it } from "vitest";
import {
  allKeyNames,
  CAPABILITIES,
  CATEGORY_LABEL,
  describeArmory,
  gapsForAudit,
  matches,
  read,
  readAll,
  summarise,
  type Capability,
  type Environment,
} from "./catalog";

const env = (keys: string[] = [], bridge: Environment["bridge"] = {}, bridgeUp = false): Environment => ({
  keys: Object.fromEntries(keys.map((k) => [k, true])),
  bridge,
  bridgeUp,
});

const byId = (id: string): Capability => CAPABILITIES.find((c) => c.id === id)!;

describe("the catalog itself", () => {
  it("gives every capability a name, a category and a sentence about what it LETS YOU DO", () => {
    // Not what it is. "OpenRouter API" is a key name; "every answer it gives"
    // is a reason to care.
    for (const c of CAPABILITIES) {
      expect(c.name.length).toBeGreaterThan(2);
      expect(c.what.length).toBeGreaterThan(10);
      expect(CATEGORY_LABEL[c.category]).toBeTruthy();
    }
  });

  it("has no duplicate ids", () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every key-based capability something to actually check", () => {
    for (const c of CAPABILITIES) {
      if (c.via !== "key") continue;
      const hasRoute = (c.needs?.length ?? 0) > 0 || (c.anyOf?.length ?? 0) > 0;
      expect(hasRoute, `${c.id} has no keys`).toBe(true);
    }
  });

  it("names every key it will ask the server about", () => {
    const names = allKeyNames();
    expect(names).toContain("OPENROUTER_API_KEY");
    expect(names).toContain("RETELL_API_KEY");
    expect(names.every((n) => /^[A-Z][A-Z0-9_]*$/.test(n))).toBe(true);
  });
});

describe("reading a key-based capability", () => {
  it("is off when nothing is set, and says exactly what is missing", () => {
    const r = read(byId("plaid"), env());
    expect(r.status).toBe("off");
    expect(r.missing).toEqual(["PLAID_CLIENT_ID", "PLAID_SECRET"]);
  });

  it("is PARTIAL when some are set — the most actionable state there is", () => {
    const r = read(byId("plaid"), env(["PLAID_CLIENT_ID"]));
    expect(r.status).toBe("partial");
    expect(r.have).toEqual(["PLAID_CLIENT_ID"]);
    expect(r.missing).toEqual(["PLAID_SECRET"]);
  });

  it("is live once every required key is set", () => {
    expect(read(byId("plaid"), env(["PLAID_CLIENT_ID", "PLAID_SECRET"])).status).toBe("live");
  });

  it("does not count an optional key as missing", () => {
    const r = read(byId("plaid"), env(["PLAID_CLIENT_ID", "PLAID_SECRET"]));
    expect(r.status).toBe("live");
    expect(r.missingOptional).toContain("PLAID_ENV");
  });
});

describe("capabilities with alternative providers", () => {
  it("is live on EITHER route", () => {
    expect(read(byId("openrouter"), env(["OPENROUTER_API_KEY"])).status).toBe("live");
    expect(read(byId("openrouter"), env(["AI_GATEWAY_API_KEY"])).status).toBe("live");
  });

  it("recommends the route already closest to done", () => {
    // Telling someone to go and open a Twilio account when they have two of
    // Retell's three keys set is advice that costs them money for no reason.
    const r = read(byId("calls"), env(["RETELL_API_KEY", "RETELL_AGENT_ID"]));
    expect(r.status).toBe("partial");
    expect(r.missing).toEqual(["RETELL_FROM_NUMBER"]);
    expect(r.missing.join()).not.toMatch(/TWILIO|VAPI/);
  });

  it("offers the shortest route when nothing at all is set", () => {
    const r = read(byId("calls"), env());
    expect(r.status).toBe("off");
    // Retell needs three; Twilio needs four. The shorter one is the advice.
    expect(r.missing).toHaveLength(3);
  });

  it("prefers more-set over equally-missing", () => {
    const r = read(byId("video-h3"), env(["RUNPOD_API_KEY"]));
    expect(r.have).toEqual(["RUNPOD_API_KEY"]);
    expect(r.missing).toEqual(["RUNPOD_ENDPOINT_ID"]);
  });
});

describe("capabilities that need the PC rather than a key", () => {
  it("says so, rather than pretending a key would fix it", () => {
    const r = read(byId("bridge-browser"), env());
    expect(r.status).toBe("needs-pc");
    expect(r.missing).toEqual([]);
  });

  it("is live when the bridge reports that capability", () => {
    expect(read(byId("bridge-browser"), env([], { browser: true }, true)).status).toBe("live");
  });

  it("is still needs-pc when the bridge is up but that one capability is not", () => {
    // "The agent is running" and "the agent can drive a browser" are different
    // facts, and Chromium not being downloaded is the usual reason.
    expect(read(byId("bridge-browser"), env([], { browser: false, shell: true }, true)).status).toBe("needs-pc");
  });
});

describe("built-in capabilities", () => {
  it("are always live, because there is nothing to configure", () => {
    expect(read(byId("listening"), env()).status).toBe("live");
  });
});

describe("summarising", () => {
  it("counts each state", () => {
    const readings = readAll(env(["OPENROUTER_API_KEY"], { shell: true }, true));
    const s = summarise(readings);
    expect(s.total).toBe(CAPABILITIES.length);
    expect(s.live).toBeGreaterThan(0);
    expect(s.live + s.partial + s.off + s.needsPc).toBe(s.total);
  });

  it("leads with how much works", () => {
    expect(describeArmory(summarise(readAll(env())))).toMatch(/^\d+ of \d+ working/);
  });
});

describe("what the self-audit is told", () => {
  it("puts the half-configured first, because they are cheapest to finish", () => {
    const readings = readAll(env(["RETELL_API_KEY", "RETELL_AGENT_ID"]));
    const gaps = gapsForAudit(readings);
    expect(gaps[0].name).toBe("RETELL_FROM_NUMBER");
  });

  it("describes each gap by what it unlocks, not by the key name alone", () => {
    for (const gap of gapsForAudit(readAll(env()))) {
      expect(gap.feature.length).toBeGreaterThan(10);
      expect(gap.name.length).toBeGreaterThan(0);
    }
  });

  it("does not report anything already working", () => {
    const everything = readAll(env(allKeyNames()));
    expect(gapsForAudit(everything)).toEqual([]);
  });

  it("stays short enough to be read", () => {
    expect(gapsForAudit(readAll(env())).length).toBeLessThanOrEqual(6);
  });
});

describe("search", () => {
  const readings = readAll(env());
  const find = (q: string) => readings.filter((r) => matches(r, q)).map((r) => r.capability.id);

  it("finds by name, by what it does, and by key name", () => {
    expect(find("phone")).toContain("calls");
    expect(find("bank")).toContain("plaid");
    expect(find("RETELL")).toContain("calls");
  });

  it("is case-insensitive and matches everything on an empty query", () => {
    expect(find("retell")).toContain("calls");
    expect(find("   ")).toHaveLength(readings.length);
  });

  it("returns nothing for a query nothing matches, rather than everything", () => {
    expect(find("quarterly revenue in norway")).toEqual([]);
  });
});

describe("the honesty rule", () => {
  it("never carries a key VALUE — only whether a name is set", () => {
    // The environment handed to this module is Record<string, boolean>. A
    // string there would be a secret on its way to a browser.
    const e = env(["OPENROUTER_API_KEY"]);
    for (const v of Object.values(e.keys)) expect(typeof v).toBe("boolean");
  });
});
