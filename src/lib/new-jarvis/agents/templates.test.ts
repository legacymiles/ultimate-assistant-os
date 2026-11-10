import { describe, expect, it } from "vitest";

import { cleanEdits, cleanSendsTo } from "./agents";
import { AGENT_TEMPLATES, fillTemplate } from "./templates";

describe("agent templates", () => {
  it("the EA scout sends to EA World and repeats", () => {
    const t = AGENT_TEMPLATES.find((x) => x.id === "ea-scout")!;
    const f = fillTemplate(t, null);
    expect(f.sendsTo).toEqual(["app:ea-world"]);
    expect(f.goal).toMatch(/MT4 and MT5/);
    expect(f.repeat).not.toBe("once");
  });

  it("fills {app} with the name in words and the slug in wiring", () => {
    const t = AGENT_TEMPLATES.find((x) => x.id === "improver")!;
    const f = fillTemplate(t, { slug: "cook-connect", name: "Cook Connect" });
    expect(f.goal).toContain("Cook Connect");
    expect(f.goal).not.toContain("{app}");
    expect(f.edits).toEqual(["cook-connect"]);
  });

  it("drops {app} wiring when no app is picked rather than sending to nowhere", () => {
    const t = AGENT_TEMPLATES.find((x) => x.id === "marketer")!;
    expect(fillTemplate(t, null).sendsTo).toEqual([]);
  });

  it("every template's fixed wiring survives the store's cleaning", () => {
    for (const t of AGENT_TEMPLATES) {
      const f = fillTemplate(t, { slug: "jarvis", name: "Jarvis" });
      expect(cleanSendsTo(f.sendsTo)).toEqual(f.sendsTo);
      expect(cleanEdits(f.edits)).toEqual(f.edits);
    }
  });
});
