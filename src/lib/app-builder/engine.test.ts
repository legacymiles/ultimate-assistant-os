import { describe, expect, it } from "vitest";
import {
  QUEUE_LIMIT,
  appTypeOf,
  applyOps,
  bestGuesses,
  coerceFeatures,
  coerceOps,
  coerceQuestions,
  coerceUnderstanding,
  designSkillFor,
  featureTickets,
  intakeQuestions,
  masterPrompt,
  mergeProjects,
  nameFrom,
  newProject,
  offlineFeatures,
  parseCommand,
  queueText,
  understand,
} from "./engine";
import type { BuilderProject, Feature } from "./types";

const IDEA = "build me an app called PawPal that helps dog walkers find clients and get paid";

function project(): BuilderProject {
  const p = newProject(IDEA, new Date("2026-10-19T10:00:00Z"), "ab_test");
  p.questions = intakeQuestions(IDEA);
  p.answers = bestGuesses(p.questions, { purpose: "Dog owners book a trusted walker in under a minute", touches: ["Accounts / sign-in", "Payments"] });
  p.understanding = understand(IDEA, p.answers);
  p.features = offlineFeatures(IDEA, p.answers, p.understanding);
  return p;
}

describe("reading the idea", () => {
  it("names the app from 'called X'", () => {
    expect(nameFrom(IDEA)).toBe("PawPal");
  });
  it("names it from the noun phrase when not called anything", () => {
    expect(nameFrom("make a habit tracker for students")).toBe("Habit Tracker");
  });
  it("never returns an empty name", () => {
    expect(nameFrom("hi")).toBe("Untitled App");
  });
  it("spots the kind of app", () => {
    expect(appTypeOf("a marketplace where sellers list vintage clothes")).toBe("marketplace");
    expect(appTypeOf("an iphone app for my gym")).toBe("mobile");
    expect(appTypeOf("a landing page for my bakery")).toBe("website");
    expect(appTypeOf("a puzzle game for kids")).toBe("game");
    expect(appTypeOf("something cool")).toBe("webapp");
  });
});

describe("the intake", () => {
  it("asks the end goal first", () => {
    expect(intakeQuestions(IDEA)[0].id).toBe("purpose");
  });
  it("best guesses fill only what's unanswered, with the recommended option", () => {
    const qs = intakeQuestions("a crm for plumbers");
    const a = bestGuesses(qs, { audience: "My clients" });
    expect(a.audience).toBe("My clients");
    expect(a.model).toBe(qs.find((q) => q.id === "model")!.options[0]);
    expect(a.success).toEqual([qs.find((q) => q.id === "success")!.options[0]]);
    expect(a.purpose).toBeUndefined();
  });
});

describe("design skill", () => {
  it("defaults to interactive-web-studio", () => {
    expect(designSkillFor("a crm for plumbers", "saas").skill).toBe("interactive-web-studio");
  });
  it("uses expo for phone apps and the redesigner for redesigns", () => {
    expect(designSkillFor("x", "mobile").skill).toBe("expo-native-ui");
    expect(designSkillFor("redesign my bakery site", "website").skill).toBe("website-redesigner");
  });
  it("never lets the AI pick a paid or unknown skill", () => {
    const u = coerceUnderstanding({ designSkill: "h3-scroll-world" }, understand(IDEA, {}));
    expect(u.designSkill).toBe("interactive-web-studio");
  });
});

describe("offline features", () => {
  it("proposes a substantial list tied to the purpose, best first, no duplicates", () => {
    const p = project();
    expect(p.features.length).toBeGreaterThanOrEqual(8);
    expect(p.features.length).toBeLessThanOrEqual(14);
    expect(p.features[0].impact).toBe(3);
    expect(new Set(p.features.map((f) => f.title)).size).toBe(p.features.length);
    expect(p.features.every((f) => f.status === "proposed" && f.source === "agent")).toBe(true);
    expect(p.features.some((f) => f.detail.includes("dog owners book a trusted walker"))).toBe(true);
  });
  it("adds sign-in when it touches accounts and payouts for a marketplace", () => {
    const titles = offlineFeatures("a marketplace for dog walkers", { touches: ["Accounts / sign-in"] }).map((f) => f.title);
    expect(titles.some((t) => /sign-in/i.test(t))).toBe(true);
    expect(titles.some((t) => /payouts/i.test(t))).toBe(true);
  });
});

describe("feature ops", () => {
  const base = (): Feature[] => project().features;

  it("accepts, denies, resets and edits by id", () => {
    const { features, changes } = applyOps(base(), [
      { op: "accept", id: "f1" },
      { op: "deny", id: "f2" },
      { op: "edit", id: "f3", detail: "voice-first: say it and it's done" },
    ]);
    expect(features.find((f) => f.id === "f1")!.status).toBe("accepted");
    expect(features.find((f) => f.id === "f2")!.status).toBe("denied");
    const f3 = features.find((f) => f.id === "f3")!;
    expect(f3.detail).toBe("voice-first: say it and it's done");
    expect(f3.edited).toBe(true);
    expect(f3.status).toBe("accepted");
    expect(changes).toHaveLength(3);
  });
  it("adding never duplicates and gets the next id", () => {
    const list = base();
    const n = list.length;
    const once = applyOps(list, [{ op: "add", feature: { title: "Waitlist page" } }]).features;
    const twice = applyOps(once, [{ op: "add", feature: { title: "waitlist page" } }]).features;
    expect(twice).toHaveLength(n + 1);
    expect(twice[n].id).toBe(`f${n + 1}`);
    expect(twice[n].source).toBe("you");
    expect(twice[n].status).toBe("accepted");
  });
  it("accept all / deny the rest only touch open ones", () => {
    const one = applyOps(base(), [{ op: "deny", id: "f1" }, { op: "acceptAll" }]).features;
    expect(one[0].status).toBe("denied");
    expect(one.slice(1).every((f) => f.status === "accepted")).toBe(true);
  });
  it("does nothing for an unknown id or an empty edit", () => {
    const list = base();
    const { changes } = applyOps(list, [{ op: "accept", id: "f99" }, { op: "edit", id: "f1" }]);
    expect(changes).toEqual([]);
  });
  it("drops model ops that point at features that don't exist", () => {
    const ops = coerceOps([{ op: "accept", id: "f1" }, { op: "deny", id: "zz" }, { op: "explode" }, { op: "add", title: "Dark mode" }], base());
    expect(ops).toEqual([
      { op: "accept", id: "f1" },
      expect.objectContaining({ op: "add", feature: expect.objectContaining({ title: "Dark mode" }) }),
    ]);
  });
});

describe("typed commands", () => {
  const list = project().features;
  it("understands accept / deny with numbers", () => {
    expect(parseCommand("accept 1, 3", list)!.ops).toEqual([{ op: "accept", id: "f1" }, { op: "accept", id: "f3" }]);
    expect(parseCommand("deny f2", list)!.ops).toEqual([{ op: "deny", id: "f2" }]);
    expect(parseCommand("reject #4 and 5", list)!.ops).toEqual([{ op: "deny", id: "f4" }, { op: "deny", id: "f5" }]);
  });
  it("edits and renames", () => {
    expect(parseCommand("edit 4: make it voice first", list)!.ops).toEqual([{ op: "edit", id: "f4", detail: "make it voice first" }]);
    expect(parseCommand("rename 2 to Smart Inbox", list)!.ops).toEqual([{ op: "edit", id: "f2", title: "Smart Inbox" }]);
  });
  it("adds a new feature, but 'add 3' accepts feature 3", () => {
    expect(parseCommand("add a waitlist page", list)!.ops[0]).toMatchObject({ op: "add", feature: { title: "Waitlist Page" } });
    expect(parseCommand("add 3", list)!.ops).toEqual([{ op: "accept", id: "f3" }]);
  });
  it("accept all and deny the rest", () => {
    expect(parseCommand("accept all", list)!.ops).toEqual([{ op: "acceptAll" }]);
    expect(parseCommand("deny the rest", list)!.ops).toEqual([{ op: "denyRest" }]);
  });
  it("leaves free-form chat to the AI", () => {
    expect(parseCommand("what would make walkers trust the app more?", list)).toBeNull();
  });
});

describe("coercing model output", () => {
  it("cleans features and keeps only real checklist codes", () => {
    const f = coerceFeatures([
      { title: "  Live map  ", detail: "see the walk", kind: "experience", impact: 3, effort: "S", checklist: ["U1", "ZZ9"] },
      { title: "live map" },
      { title: "", detail: "nothing" },
      { title: "Weird", kind: "lasers", impact: 9, effort: "XL" },
    ]);
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ id: "f1", title: "Live map", checklist: ["U1"] });
    expect(f[1]).toMatchObject({ id: "f2", kind: "core", impact: 2, effort: "M" });
  });
  it("keeps the end-goal question even if the model forgot it", () => {
    const qs = coerceQuestions([{ label: "Who walks?", options: ["Pros", "Neighbours"] }, { label: "Cities?", options: [] }], intakeQuestions(IDEA));
    expect(qs[0].id).toBe("purpose");
    expect(qs.find((q) => q.label === "Cities?")!.free).toBe(true);
  });
});

describe("the hand-off", () => {
  function decided(): BuilderProject {
    const p = project();
    p.features = applyOps(p.features, [{ op: "acceptAll" }, { op: "deny", id: "f2" }]).features;
    p.features = applyOps(p.features, [{ op: "deny", id: "f2" }]).features;
    return p;
  }

  it("the master prompt carries the goal, the features, the declined ones and the whole skill pipeline", () => {
    const p = project();
    p.features = applyOps(p.features, [{ op: "accept", id: "f1" }, { op: "deny", id: "f2" }]).features;
    const prompt = masterPrompt(p);
    for (const tag of ["<goal>", "<features>", "<declined>", "<skills_pipeline>", "<standard>", "<success_criteria>"]) expect(prompt).toContain(tag);
    for (const skill of ["felix", "prompt-enhancer", "interactive-web-studio", "software-factory", "claude-security", "website-build-checklist"]) {
      expect(prompt).toContain(skill);
    }
    expect(prompt).toContain(p.features[0].title);
    expect(prompt).toContain("L1"); // accounts → sign-in rule
  });

  it("the queue text always fits In Queue, even with a huge list", () => {
    const p = decided();
    for (let i = 0; i < 30; i++) {
      p.features.push({ ...p.features[0], id: `x${i}`, title: `Extra feature ${i}`, detail: "word ".repeat(80), status: "accepted" });
    }
    const t = queueText(p);
    expect(t.length).toBeLessThanOrEqual(QUEUE_LIMIT);
    expect(t).toContain("felix → prompt-enhancer");
    expect(t).toContain("claude-security");
  });

  it("makes one Felix card per accepted feature, money cards flagged for the owner", () => {
    const p = decided();
    const tickets = featureTickets(p);
    expect(tickets).toHaveLength(p.features.filter((f) => f.status === "accepted").length);
    for (const t of tickets) {
      expect(t.title.length).toBeLessThanOrEqual(70);
      expect(t.body).toContain("## Acceptance Criteria");
      expect(t.labels).toContain("felix");
    }
    const money = tickets.find((t) => t.labels.includes("money"));
    expect(money?.body).toContain("Medium");
  });
});

describe("projects", () => {
  it("merge keeps the newest copy of each and sorts newest first", () => {
    const a = newProject("one", new Date("2026-10-01T00:00:00Z"), "a");
    const b = newProject("two", new Date("2026-10-02T00:00:00Z"), "b");
    const a2 = { ...a, idea: "one, edited", updatedAt: "2026-10-03T00:00:00.000Z" };
    const merged = mergeProjects([a, b, a2]);
    expect(merged.map((p) => p.id)).toEqual(["a", "b"]);
    expect(merged[0].idea).toBe("one, edited");
  });
});

describe("saved features from the browser", () => {
  it("keeps ids and decisions, drops junk and duplicates", async () => {
    const { coerceSavedFeatures } = await import("./engine");
    const f = coerceSavedFeatures([
      { id: "f7", title: "Live map", status: "accepted", source: "you", edited: true, impact: 3 },
      { id: "f7", title: "Second with same id", status: "denied" },
      { id: "<script>", title: "Live map" },
      { title: "" },
      "nope",
    ]);
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ id: "f7", status: "accepted", source: "you", edited: true, impact: 3 });
    expect(f[1]).toMatchObject({ id: "f8", status: "denied", source: "agent" });
  });
});

describe("reverse engineering a recording", () => {
  it("tells recreate from change", async () => {
    const { modeOf } = await import("./engine");
    expect(modeOf("rebuild the app in this video")).toBe("recreate");
    expect(modeOf("make this workflow but for roofers instead")).toBe("change");
    expect(modeOf("anything", "Recreate it as it works")).toBe("recreate");
    expect(modeOf("anything", "make it voice-first")).toBe("change");
  });
  it("asks recreate-or-change instead of the look when a recording is attached", () => {
    const qs = intakeQuestions("rebuild this app", true);
    expect(qs.some((q) => q.id === "mode")).toBe(true);
    expect(qs.some((q) => q.id === "look")).toBe(false);
  });
  it("cleans the teardown and turns it into features, the owner's changes accepted", async () => {
    const { coerceTeardown, teardownFeatures, teardownText } = await import("./engine");
    expect(coerceTeardown({}, "recreate")).toBeNull();
    const t = coerceTeardown(
      {
        summary: "A booking flow: pick a service, a time, then pay.",
        screens: [{ name: "Service picker", purpose: "choose what to book", elements: ["cards", "prices"] }, { nope: 1 }],
        flow: ["Open the app", "Pick a service", "Pick a time", "Pay"],
        behaviours: ["Times already booked are greyed out"],
        changes: ["Add SMS reminders"],
        mode: "lasers",
      },
      "change",
    )!;
    expect(t.mode).toBe("change");
    expect(t.screens).toHaveLength(1);
    const f = teardownFeatures(t);
    expect(f[0]).toMatchObject({ title: "Add SMS reminders", source: "you", status: "accepted" });
    expect(f.find((x) => x.title === "Service picker")!.status).toBe("proposed");
    expect(teardownText(t)).toContain("Pick a time");
  });
  it("puts video-analyzer and rea first in the pipeline and the prompt when there's a recording", async () => {
    const { coerceTeardown } = await import("./engine");
    const p = project();
    p.teardown = coerceTeardown({ summary: "A CRM pipeline board", flow: ["drag a deal"] }, "recreate")!;
    p.sources = [{ id: "s1", kind: "video", name: "crm.mp4", thumb: "", frames: 10, at: "2026-10-19T00:00:00Z" }];
    p.features = applyOps(p.features, [{ op: "acceptAll" }]).features;
    const prompt = masterPrompt(p);
    expect(prompt).toContain("<reverse_engineered>");
    expect(prompt.indexOf("video-analyzer")).toBeLessThan(prompt.indexOf("1. felix") === -1 ? Infinity : prompt.indexOf("felix —"));
    expect(prompt).toContain("reverse-engineer-anything");
    expect(prompt).toContain("no copied branding");
    const q = queueText(p);
    expect(q).toContain("video-analyzer → reverse-engineer-anything (rea)");
    expect(q.length).toBeLessThanOrEqual(QUEUE_LIMIT);
  });
});

describe("a recording the AI couldn't watch", () => {
  it("still tells the build to watch it with video-analyzer and take it apart with rea", () => {
    const p = project();
    p.idea = "recreate this booking app but add SMS reminders";
    p.sources = [{ id: "s1", kind: "video", name: "app.webm", thumb: "", frames: 12, at: "2026-10-19T00:00:00Z" }];
    p.features = applyOps(p.features, [{ op: "accept", id: "f1" }]).features;
    const prompt = masterPrompt(p);
    expect(prompt).toContain("hasn't been watched yet");
    expect(prompt).toContain("1. video-analyzer");
    expect(prompt).toContain("rebuild it with the owner's changes");
    expect(queueText(p)).toContain("video-analyzer → reverse-engineer-anything (rea)");
  });
});

describe("names", () => {
  it("prefers the thing being built over who it's for", () => {
    expect(nameFrom("Recreate this booking app for my barber client, but add SMS reminders")).toBe("Booking App");
  });
});
