import { describe, expect, it } from "vitest";

import { masterPrompt, pipeline } from "./engine";
import { buildBrief } from "./build";
import {
  hostOf,
  keepFeatures,
  normalizeSiteUrl,
  plainFunctions,
  redesignProject,
  redesignQuestions,
  redesignSource,
  redesignText,
  redesignUpgrades,
  settleRedesign,
  type SiteRead,
} from "./redesign";
import { specFromProject } from "@/lib/mockup/spec";
import { renderMockup } from "@/lib/mockup/render";
import { directionsFor } from "@/lib/mockup/directions";

const READ: SiteRead = {
  title: "Joe's Plumbing | 24/7 Emergency Plumbers",
  summary: "Family plumbers serving Austin since 1998.",
  navItems: ["Home", "Services", "Reviews", "Contact"],
  ctas: ["Book a plumber", "Call now"],
  headings: ["Plumbing done right, first time", "Emergency repairs", "Water heaters", "Drain cleaning"],
  colors: ["#003366", "#ffcc00"],
  functionality: [
    { kind: "form", label: "Booking form", detail: "Name, phone and a time slot" },
    { kind: "link", label: "Click to call", detail: "tel: link in the header" },
  ],
  confidence: "high",
};

describe("redesign → App Builder project", () => {
  it("normalizes what the owner pasted", () => {
    expect(normalizeSiteUrl("joesplumbing.com")).toBe("https://joesplumbing.com/");
    expect(normalizeSiteUrl("not a url")).toBe("");
    expect(hostOf("https://www.joesplumbing.com/x")).toBe("joesplumbing.com");
  });

  it("starts as a pending website project carrying the site", () => {
    const p = redesignProject(redesignSource(READ, { url: "joesplumbing.com", note: "more premium", skills: ["soft-skill"] }));
    expect(p.pending).toBe(true);
    expect(p.origin).toBe("redesign");
    expect(p.stage).toBe("idea");
    expect(p.understanding?.appType).toBe("website");
    expect(p.understanding?.designSkill).toBe("soft-skill");
    expect(p.teardown?.mode).toBe("change");
    expect(p.idea).toContain("keep everything it does");
    expect(p.redesign?.note).toBe("more premium");
    expect(p.understanding?.name).toBe("Joe's Plumbing");
    const rooter = redesignProject(redesignSource({ ...READ, title: "Plumbing & Drain Cleaning You Can Trust | Mr. Rooter Plumbing" }, { url: "mrrooter.com" }));
    expect(rooter.understanding?.name).toBe("Mr. Rooter Plumbing");
  });

  it("puts every existing function on the list, accepted, as the owner's own", () => {
    const keeps = keepFeatures(redesignSource(READ, { url: "joesplumbing.com" }));
    expect(keeps.map((f) => f.title)).toEqual(
      expect.arrayContaining(["Every page and its content kept", "Keep: Booking form", "Keep: Click to call", "Same calls to action, clearer"]),
    );
    expect(keeps.every((f) => f.status === "accepted" && f.source === "you")).toBe(true);
  });

  it("keeps the site's name and a real UI skill whatever the agent guessed", () => {
    const r = redesignSource(READ, { url: "joesplumbing.com" });
    const prev = redesignProject(r).understanding!;
    const guessed = { ...prev, name: "Fresh", appType: "webapp" as const, designSkill: "website-redesigner" };
    const settled = settleRedesign(guessed, prev, r);
    expect(settled.name).toBe(prev.name);
    expect(settled.appType).toBe("website");
    expect(settled.designSkill).toBe("interactive-web-studio");
    const pinned = settleRedesign(guessed, prev, { ...r, skills: ["brutalist-skill"] });
    expect(pinned.designSkill).toBe("brutalist-skill");
  });

  it("asks redesign questions and offers agency upgrades when offline", () => {
    expect(redesignQuestions().map((q) => q.id)).toEqual(["purpose", "audience", "keep", "success", "look"]);
    const ups = redesignUpgrades(redesignSource(READ, { url: "joesplumbing.com" }), 5);
    expect(ups[0].id).toBe("f5");
    expect(ups.every((f) => f.status === "proposed")).toBe(true);
  });

  it("names numbered forms in plain words and lists each once", () => {
    const fns = plainFunctions([
      { kind: "form", label: "Form 1", detail: "fields: Enter ZIP Code" },
      { kind: "form", label: "Form 3", detail: "fields: text, text, email, text" },
      { kind: "form", label: "Form 5", detail: "fields: text, text, email, text" },
      { kind: "nav", label: "Primary navigation", detail: "Book Online, Call Us, Book Online" },
    ]);
    expect(fns.map((f) => f.label)).toEqual(['the "Enter ZIP Code" box', "the enquiry form", "Primary navigation"]);
    expect(fns[2].detail).toBe("Book Online, Call Us");
  });

  it("drops the repeats a page's header and footer make", () => {
    const r = redesignSource({ ...READ, navItems: ["Book Online", "Call Us", "Book Online", "call us"] }, { url: "x.com" });
    expect(r.nav).toEqual(["Book Online", "Call Us"]);
  });

  it("tells the agent the site's real content", () => {
    const text = redesignText(redesignSource(READ, { url: "joesplumbing.com" }));
    expect(text).toContain("Booking form");
    expect(text).toContain("Book a plumber");
    expect(text).toContain("Someone else's site");
  });

  it("writes a redesign brief, not a recording brief, and runs the redesign skills first", () => {
    const base = redesignProject(redesignSource(READ, { url: "joesplumbing.com" }));
    const p = { ...base, stage: "features" as const, features: keepFeatures(base.redesign!) };
    const brief = masterPrompt(p);
    expect(brief).toContain("<redesign>");
    expect(brief).not.toContain("<reverse_engineered>");
    const skills = pipeline(p.understanding!, p.teardown, false, false, "commercial", p.redesign).map((s) => s.skill);
    expect(skills.slice(0, 2)).toEqual(["website-redesigner", "redesign-skill"]);
    expect(skills).not.toContain("video-analyzer");
    expect(skills).toContain("software-factory");
  });

  it("lands an own-site redesign in the site's own repo as a pull request", () => {
    const base = redesignProject(redesignSource(READ, { url: "joesplumbing.com", ownSite: true, sourcePath: "legacymiles/joes" }));
    const brief = buildBrief({ ...base, features: keepFeatures(base.redesign!) });
    expect(brief).toContain("legacymiles/joes");
    expect(brief).toContain("pull request");
    expect(brief).not.toContain("You are in an empty folder that is already a git repository on its own `main` branch — this is");
  });

  it("draws the mockup as the site itself — its nav, headline and buttons", () => {
    const base = redesignProject(redesignSource(READ, { url: "joesplumbing.com" }));
    const spec = specFromProject({ ...base, features: keepFeatures(base.redesign!) });
    expect(spec.site?.headline).toBe("Plumbing done right, first time");
    expect(spec.nav).toEqual(["Home", "Services", "Reviews", "Contact"]);
    const html = renderMockup(spec, directionsFor("interactive-web-studio")[0]);
    expect(html).toContain('class="site');
    expect(html).toContain("Book a plumber");
    expect(html).not.toContain('class="rail"');
    expect(html).not.toContain("<script");
  });
});
