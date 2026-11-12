import { describe, expect, it } from "vitest";

import { coerceScenarios, offlineFeatures, scenarioCriteria, scenariosOf, mergeScenarios, proofOf } from "./engine";
import { canBuild, fixMessage, isFailureCase, planCheck, planNotesBlock, planSummary, takesInput, vaguePhrase } from "./planCheck";
import { checkDeltas, deltaBlock, deltaLine, deltasFor, foldSpec, mustStillPass, specFrom, specMarkdown, untouched } from "./spec";
import type { BuilderProject, Feature, Scenario, Understanding } from "./types";

// ----- fixtures ------------------------------------------------------------

const sc = (id: string, when: string, then: string, extra: Partial<Scenario> = {}): Scenario => ({
  id,
  name: when.slice(0, 40),
  when,
  then,
  proof: "browser",
  ...extra,
});

const feature = (f: Partial<Feature> & { id: string }): Feature => ({
  title: `Feature ${f.id}`,
  detail: "It does the thing it says it does, concretely.",
  why: "Because the app needs it.",
  kind: "core",
  impact: 3,
  effort: "M",
  status: "accepted",
  source: "agent",
  ...f,
});

const understanding = (over: Partial<Understanding> = {}): Understanding => ({
  name: "Walkbook",
  oneLiner: "A walking diary",
  appType: "webapp",
  purpose: "Keep a record of walks",
  audience: "Walkers",
  endGoal: "Walkers keep a record without effort",
  beyond: "It keeps itself right",
  model: "Free",
  designSkill: "interactive-web-studio",
  designWhy: "the default",
  judge: ["A walk saved on a phone shows on a laptop", "No crash in a week of use"],
  ...over,
});

const project = (over: Partial<BuilderProject> = {}): BuilderProject => ({
  id: "ab_1",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  idea: "A walking diary",
  stage: "features",
  questions: [],
  answers: {},
  understanding: understanding(),
  features: [],
  chat: [],
  ...over,
});

// ----- part 1: scenarios ---------------------------------------------------

describe("coerceScenarios", () => {
  it("keeps a scenario with both halves and numbers it against its feature", () => {
    const out = coerceScenarios([{ name: "Valid submit", when: "a visitor submits the form", then: "they see a confirmation" }], "f3");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("f3.s1");
    expect(out[0].when).toBe("a visitor submits the form");
  });

  it("drops a half-written scenario", () => {
    const out = coerceScenarios(
      [
        { when: "a visitor submits the form", then: "ok" },
        { when: "yes", then: "they see a confirmation" },
        { then: "they see a confirmation" },
        { when: "a visitor submits the form", then: "they see a confirmation" },
      ],
      "f1",
    );
    expect(out.map((s) => s.id)).toEqual(["f1.s1"]);
  });

  it("caps at three and renumbers in order", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ when: `something happens number ${i}`, then: `something is shown number ${i}` }));
    expect(coerceScenarios(many, "f2").map((s) => s.id)).toEqual(["f2.s1", "f2.s2", "f2.s3"]);
  });

  it("guesses proof from the THEN when none is given", () => {
    expect(coerceScenarios([{ when: "a visitor submits the form", then: "they see a confirmation message" }], "f1")[0].proof).toBe("browser");
    expect(coerceScenarios([{ when: "the fee is applied to a sale", then: "the seller balance rises by the net amount" }], "f1")[0].proof).toBe("unit");
    expect(proofOf("they are redirected to the dashboard")).toBe("browser");
  });

  it("keeps an explicit proof and the owner's authorship", () => {
    const [s] = coerceScenarios([{ when: "a visitor submits the form", then: "an email arrives", proof: "manual", source: "you" }], "f1");
    expect(s.proof).toBe("manual");
    expect(s.source).toBe("you");
  });

  it("returns nothing for junk", () => {
    expect(coerceScenarios(null, "f1")).toEqual([]);
    expect(coerceScenarios(["nope"], "f1")).toEqual([]);
  });
});

describe("mergeScenarios", () => {
  it("keeps the owner's own scenario when the agent sends new ones", () => {
    const mine = sc("f1.s1", "a visitor submits with no email", "the field says an email is needed", { source: "you" });
    const theirs = sc("f1.s1", "a visitor submits the contact form", "they see a confirmation");
    const out = mergeScenarios([mine], [theirs], "f1");
    expect(out.map((s) => s.when)).toEqual([mine.when, theirs.when]);
    expect(out[0].source).toBe("you");
    expect(out.map((s) => s.id)).toEqual(["f1.s1", "f1.s2"]);
  });

  it("drops a duplicate WHEN", () => {
    const mine = sc("f1.s1", "a visitor submits the contact form", "they see a confirmation", { source: "you" });
    const dup = sc("f1.s1", "A visitor submits the contact form", "something else happens entirely");
    expect(mergeScenarios([mine], [dup], "f1")).toHaveLength(1);
  });
});

describe("offlineFeatures", () => {
  it("gives every feature at least one scenario, so the no-key list is buildable", () => {
    const list = offlineFeatures("a walking diary for my city", { audience: "Anyone", touches: "Accounts / sign-in" });
    expect(list.length).toBeGreaterThan(5);
    for (const f of list) expect((f.scenarios ?? []).length).toBeGreaterThan(0);
  });

  it("fills the app's name into its scenarios", () => {
    const list = offlineFeatures("a walking diary", { audience: "Just me / my team" });
    const text = scenariosOf(list, false)
      .map((s) => `${s.when} ${s.then}`)
      .join(" ");
    expect(text).not.toContain("{name}");
    expect(text).not.toContain("{purpose}");
  });

  it("passes its own plan check once accepted", () => {
    const features = offlineFeatures("a plumbing website with a contact form", { audience: "Anyone" }).map((f) => ({
      ...f,
      status: "accepted" as const,
    }));
    const blocks = planCheck(project({ features })).filter((f) => f.level === "block");
    expect(blocks).toEqual([]);
  });
});

// ----- part 2: the plan check ---------------------------------------------

describe("vaguePhrase", () => {
  it("catches the phrases nobody can check", () => {
    expect(vaguePhrase("the form works properly")).toBe("works properly");
    expect(vaguePhrase("it works smoothly on every device")).toBe("works smoothly");
    expect(vaguePhrase("the page is fast")).toBe("is fast");
    expect(vaguePhrase("the flow is intuitive")).toBe("intuitive");
  });

  it("prefers the longest match, so the message names the real problem", () => {
    expect(vaguePhrase("everything works well in the end")).toBe("everything works");
  });

  it("leaves a checkable THEN alone", () => {
    expect(vaguePhrase("they see “Thanks — we'll reply within a day” and the owner gets an email")).toBe("");
    expect(vaguePhrase("the network works out the shortest route and draws it")).toBe("");
    expect(vaguePhrase("the row appears at the top of the list")).toBe("");
  });
});

describe("planCheck", () => {
  it("blocks an accepted feature with no scenario", () => {
    const p = project({ features: [feature({ id: "f1", title: "Saved searches" })] });
    const found = planCheck(p);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ level: "block", featureId: "f1" });
    expect(found[0].text).toContain("Saved searches");
    expect(canBuild(p)).toBe(false);
  });

  it("ignores features that are only proposed or already denied", () => {
    const p = project({
      features: [feature({ id: "f1", status: "proposed" }), feature({ id: "f2", status: "denied" })],
    });
    expect(planCheck(p).filter((f) => f.level === "block")).toEqual([]);
    expect(canBuild(p)).toBe(true);
  });

  it("blocks a vague THEN and names the phrase", () => {
    const p = project({
      features: [feature({ id: "f2", scenarios: [sc("f2.s1", "a visitor opens the page", "it works smoothly")] })],
    });
    const found = planCheck(p);
    expect(found[0]).toMatchObject({ level: "block", scenarioId: "f2.s1" });
    expect(found[0].text).toContain("works smoothly");
    expect(canBuild(p)).toBe(false);
  });

  it("warns, but does not block, when a form has no failure case", () => {
    const p = project({
      features: [
        feature({
          id: "f1",
          title: "Contact form",
          detail: "A form that sends an enquiry to the owner.",
          scenarios: [sc("f1.s1", "a visitor submits the contact form", "they see a confirmation and the owner gets an email")],
        }),
      ],
    });
    const found = planCheck(p);
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe("warn");
    expect(canBuild(p)).toBe(true);
  });

  it("is happy once the failure case is there", () => {
    const p = project({
      features: [
        feature({
          id: "f1",
          title: "Contact form",
          detail: "A form that sends an enquiry to the owner.",
          scenarios: [
            sc("f1.s1", "a visitor submits the contact form", "they see a confirmation and the owner gets an email"),
            sc("f1.s2", "a visitor submits it with an email that has no @", "the field says what is wrong and nothing is sent"),
          ],
        }),
      ],
    });
    expect(planCheck(p)).toEqual([]);
    expect(canBuild(p)).toBe(true);
  });

  it("warns when two features check the same moment", () => {
    const p = project({
      features: [
        feature({ id: "f1", scenarios: [sc("f1.s1", "a visitor submits the newsletter signup", "they are subscribed")] }),
        feature({ id: "f2", scenarios: [sc("f2.s1", "a visitor submits the newsletter signup", "a welcome email arrives")] }),
      ],
    });
    const warns = planCheck(p).filter((f) => f.level === "warn");
    expect(warns.some((w) => w.text.includes("same moment"))).toBe(true);
    expect(canBuild(p)).toBe(true);
  });

  it("blocks a redesign whose must-keep has no check", () => {
    const p = project({
      redesign: {
        url: "https://example.com",
        title: "Example",
        summary: "",
        nav: [],
        ctas: [],
        headings: [],
        colors: [],
        functionality: [{ kind: "form", label: "the newsletter signup", detail: "" }],
        ownSite: false,
        confidence: "high",
      },
      features: [feature({ id: "f1", title: "Keep: the newsletter signup", detail: "Works as it does live." })],
    });
    const blocks = planCheck(p).filter((f) => f.level === "block");
    expect(blocks.some((b) => b.text.includes("newsletter signup"))).toBe(true);
    expect(canBuild(p)).toBe(false);
  });

  it("warns on a thin judge for a new app but not for an edit", () => {
    const base = { features: [feature({ id: "f1", scenarios: [sc("f1.s1", "a visitor opens the page", "the list of walks shows")] })] };
    const thin = project({ ...base, understanding: understanding({ judge: ["Only one line"] }) });
    expect(planCheck(thin).some((f) => f.text.includes("judge"))).toBe(true);
    const asEdit = project({
      ...base,
      understanding: understanding({ judge: ["Only one line"] }),
      edit: {
        reviewId: "r1",
        batchId: "b1",
        siteName: "Site",
        clientName: "Client",
        fromVersion: "v1",
        fromUrl: "",
        version: "v2",
        versionId: "ver2",
        baseBranch: "main",
        branch: "edit/v2",
        brief: "",
        items: [],
      },
    });
    expect(planCheck(asEdit).some((f) => f.text.includes("judge"))).toBe(false);
  });

  it("counts what it found", () => {
    const p = project({
      features: [
        feature({ id: "f1", scenarios: [sc("f1.s1", "a visitor opens the page", "the list of walks shows")] }),
        feature({ id: "f2", title: "No checks here" }),
      ],
    });
    expect(planSummary(p)).toMatchObject({ blocks: 1, scenarios: 1, features: 2 });
  });
});

describe("fixMessage", () => {
  it("turns the findings into instructions the agent chat can act on", () => {
    const p = project({ features: [feature({ id: "f1", title: "Saved searches" })] });
    const msg = fixMessage(planCheck(p));
    expect(msg).toContain("f1");
    expect(msg).toContain("Saved searches");
    expect(msg).toContain("source \"you\"");
  });

  it("is empty when there is nothing to fix", () => {
    expect(fixMessage([])).toBe("");
  });
});

describe("planNotesBlock", () => {
  it("tells the build about the warnings the owner shipped with", () => {
    const p = project({
      features: [
        feature({
          id: "f1",
          title: "Contact form",
          detail: "A form that sends an enquiry.",
          scenarios: [sc("f1.s1", "a visitor submits the contact form", "they see a confirmation")],
        }),
      ],
    });
    const block = planNotesBlock(p);
    expect(block).toContain("<plan_notes>");
    expect(block).toContain("wrong-input");
  });

  it("says nothing when the plan is clean", () => {
    expect(planNotesBlock(project())).toBe("");
  });
});

describe("takesInput / isFailureCase", () => {
  it("spots a feature that takes input", () => {
    expect(takesInput(feature({ id: "f1", title: "Contact form", detail: "An enquiry form." }))).toBe(true);
    expect(takesInput(feature({ id: "f2", title: "Dark mode", detail: "A colour scheme that follows the system." }))).toBe(false);
  });

  it("spots a failure scenario", () => {
    expect(isFailureCase(sc("f1.s1", "they submit an empty form", "the field says it is needed"))).toBe(true);
    expect(isFailureCase(sc("f1.s1", "they submit a valid form", "they see a confirmation"))).toBe(false);
  });
});

// ----- part 3: what the build is told ------------------------------------

describe("scenarioCriteria", () => {
  it("demands a test named with each scenario id, and a table", () => {
    const p = project({
      features: [
        feature({
          id: "f1",
          scenarios: [sc("f1.s1", "a visitor opens the page", "the list of walks shows"), sc("f1.s2", "the fee applies", "the balance rises", { proof: "unit" })],
        }),
      ],
    });
    const text = scenarioCriteria(p);
    expect(text).toContain("f1.s1");
    expect(text).toContain("NAMES ITS ID");
    expect(text).toContain("pass/fail");
    expect(text).toContain("Vitest");
    expect(text).toContain("Playwright");
  });

  it("falls back to a plain line when nothing has scenarios", () => {
    expect(scenarioCriteria(project())).toContain("Typecheck and tests pass");
  });
});

// ----- part 4: spec and deltas -------------------------------------------

const shipped = (): BuilderProject =>
  project({
    features: [
      feature({
        id: "f1",
        title: "Contact form",
        detail: "Sends an enquiry to the owner.",
        scenarios: [sc("f1.s1", "a visitor submits the contact form", "they see a confirmation and the owner gets an email")],
      }),
      feature({
        id: "f2",
        title: "Live chat",
        detail: "An Intercom widget in the corner.",
        scenarios: [sc("f2.s1", "a visitor opens the chat widget", "the Intercom panel opens")],
      }),
      feature({ id: "f3", title: "Rejected idea", status: "denied" }),
    ],
  });

describe("specFrom / foldSpec", () => {
  it("freezes only the accepted features", () => {
    const spec = specFrom(shipped(), "2026-11-12T00:00:00.000Z");
    expect(spec.features.map((f) => f.title)).toEqual(["Contact form", "Live chat"]);
    expect(spec.at).toBe("2026-11-12T00:00:00.000Z");
  });

  it("a new app's spec is simply what it shipped", () => {
    const p = shipped();
    expect(foldSpec(p, "2026-11-12T00:00:00.000Z").features).toHaveLength(2);
  });

  it("folds an edit into the spec it was written against", () => {
    const spec = specFrom(shipped(), "2026-11-01T00:00:00.000Z");
    const edit = project({
      spec,
      edit: {
        reviewId: "r1",
        batchId: "b1",
        siteName: "Site",
        clientName: "Client",
        fromVersion: "v1",
        fromUrl: "",
        version: "v2",
        versionId: "ver2",
        baseBranch: "main",
        branch: "edit/v2",
        brief: "",
        items: [],
      },
      features: [
        feature({
          id: "f1",
          title: "Gallery lightbox",
          detail: "Photos open full screen.",
          scenarios: [sc("f1.s1", "a visitor taps a photo", "it opens full screen with a close button")],
        }),
        feature({ id: "f2", title: "Live chat", status: "denied", why: "The client cancelled Intercom." }),
      ],
    });
    const folded = foldSpec(edit, "2026-11-12T00:00:00.000Z");
    const titles = folded.features.map((f) => f.title);
    expect(titles).toContain("Contact form");
    expect(titles).toContain("Gallery lightbox");
    expect(titles).not.toContain("Live chat");
    // Ids and scenario ids are renumbered together, so a report's id is never
    // pointing at a different feature than the spec's.
    folded.features.forEach((f, i) => {
      expect(f.id).toBe(`f${i + 1}`);
      (f.scenarios ?? []).forEach((s, j) => expect(s.id).toBe(`f${i + 1}.s${j + 1}`));
    });
  });
});

describe("deltasFor", () => {
  const withSpec = (features: Feature[]) =>
    project({
      spec: specFrom(shipped(), "2026-11-01T00:00:00.000Z"),
      edit: {
        reviewId: "r1",
        batchId: "b1",
        siteName: "Site",
        clientName: "Client",
        fromVersion: "v1",
        fromUrl: "",
        version: "v2",
        versionId: "ver2",
        baseBranch: "main",
        branch: "edit/v2",
        brief: "",
        items: [],
      },
      features,
    });

  it("reads a brand-new feature as ADDED", () => {
    const d = deltasFor(withSpec([feature({ id: "f1", title: "Gallery lightbox", scenarios: [sc("f1.s1", "a visitor taps a photo", "it opens full screen")] })]));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ kind: "added", title: "Gallery lightbox" });
  });

  it("reads a changed scenario on an existing feature as MODIFIED", () => {
    const d = deltasFor(
      withSpec([
        feature({
          id: "f1",
          title: "Contact form",
          detail: "Sends an enquiry to the owner.",
          scenarios: [sc("f1.s1", "a visitor submits the contact form", "a WhatsApp link shows under the form")],
        }),
      ]),
    );
    expect(d[0]).toMatchObject({ kind: "modified", title: "Contact form", featureId: "f1" });
    expect(d[0].scenarios).toEqual(["f1.s1"]);
  });

  it("reads a denied spec feature as REMOVED and carries its reason", () => {
    const d = deltasFor(withSpec([feature({ id: "f1", title: "Live chat", status: "denied", why: "The client cancelled Intercom." })]));
    expect(d[0]).toMatchObject({ kind: "removed", title: "Live chat", reason: "The client cancelled Intercom." });
  });

  it("says nothing changed when the feature is identical", () => {
    const d = deltasFor(
      withSpec([
        feature({
          id: "f1",
          title: "Contact form",
          detail: "Sends an enquiry to the owner.",
          scenarios: [sc("f1.s1", "a visitor submits the contact form", "they see a confirmation and the owner gets an email")],
        }),
      ]),
    );
    expect(d).toEqual([]);
  });

  it("has nothing to say with no spec", () => {
    expect(deltasFor(shipped())).toEqual([]);
  });

  it("blocks a removal with no reason", () => {
    const p = withSpec([feature({ id: "f1", title: "Live chat", status: "denied", why: "" })]);
    expect(checkDeltas(p)[0]).toContain("Live chat");
    expect(canBuild(p)).toBe(false);
    const withReason = withSpec([feature({ id: "f1", title: "Live chat", status: "denied", why: "Client cancelled it." })]);
    expect(checkDeltas(withReason)).toEqual([]);
  });

  it("lists the untouched checks as the ones that must still pass", () => {
    const p = withSpec([feature({ id: "f1", title: "Gallery lightbox", scenarios: [sc("f1.s1", "a visitor taps a photo", "it opens full screen")] })]);
    expect(untouched(p).map((f) => f.title)).toEqual(["Contact form", "Live chat"]);
    expect(mustStillPass(p).map((s) => s.id)).toEqual(["f1.s1", "f2.s1"]);
  });

  it("writes both halves into the brief", () => {
    const p = withSpec([
      feature({ id: "f1", title: "Gallery lightbox", scenarios: [sc("f1.s1", "a visitor taps a photo", "it opens full screen")] }),
      feature({ id: "f2", title: "Live chat", status: "denied", why: "Client cancelled it." }),
    ]);
    const block = deltaBlock(p);
    expect(block).toContain("ADDED");
    expect(block).toContain("REMOVED");
    expect(block).toContain("reason: Client cancelled it.");
    expect(block).toContain("must STILL pass");
    expect(deltaLine(p)).toContain("1 added");
    expect(deltaLine(p)).toContain("1 removed");
  });
});

describe("specMarkdown", () => {
  it("writes the spec as a docs section", () => {
    const md = specMarkdown(specFrom(shipped(), "2026-11-12T00:00:00.000Z"), "Walkbook");
    expect(md).toContain("## Scenarios");
    expect(md).toContain("Walkbook");
    expect(md).toContain("**f1.s1**");
    expect(md).toContain("WHEN a visitor submits the contact form");
  });
});
