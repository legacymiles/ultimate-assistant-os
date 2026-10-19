import { describe, expect, it } from "vitest";
import { describeAction, localReply, parseActions, parseReply, systemPrompt, type AutopilotRequest } from "./autopilotChat";

const req = (text: string, selectedId: string | null = "p1"): AutopilotRequest => ({
  messages: [{ role: "user", content: text }],
  photos: [
    { id: "p1", title: "Now-playing screen", caption: "A song", where: "Inbox", tags: ["music"] },
    { id: "p2", title: "GitHub page", caption: "A repo", where: "Inbox", tags: ["code"] },
  ],
  selectedId,
  rules: [],
});

describe("parseActions — the trust boundary", () => {
  it("drops ids that are not in the queue", () => {
    const out = parseActions([{ type: "file", ids: ["p1", "nope"] }, { type: "reject", ids: ["ghost"] }], ["p1"]);
    expect(out).toEqual([{ type: "file", ids: ["p1"] }]);
  });

  it("drops malformed and unknown actions", () => {
    const out = parseActions(
      [{ type: "delete_everything" }, { type: "reroute", id: "p1" }, { type: "rule", text: "  " }, null, "x"],
      ["p1"],
    );
    expect(out).toEqual([]);
  });

  it("keeps a valid reroute and rule", () => {
    const out = parseActions(
      [
        { type: "reroute", id: "p1", instruction: "it's a song" },
        { type: "rule", text: "Songs go to the Classifier" },
      ],
      ["p1"],
    );
    expect(out).toHaveLength(2);
  });
});

describe("parseReply", () => {
  it("reads fenced JSON", () => {
    const r = parseReply('```json\n{"reply":"Sure.","actions":[{"type":"file","ids":["p2"]}]}\n```', ["p2"]);
    expect(r.reply).toBe("Sure.");
    expect(r.actions).toEqual([{ type: "file", ids: ["p2"] }]);
  });

  it("never invents actions from prose", () => {
    expect(parseReply("I would file it.", ["p1"]).actions).toEqual([]);
  });
});

describe("localReply — works with no AI key", () => {
  it("turns a general habit into a rule plus a reroute of the selected photo", () => {
    const r = localReply(req("Song images always go to my classifier"));
    expect(r.actions.map((a) => a.type)).toEqual(["rule", "reroute"]);
  });

  it("files everything on 'file all'", () => {
    const r = localReply(req("file all of them", null));
    expect(r.actions).toEqual([{ type: "file", ids: ["p1", "p2"] }]);
  });

  it("asks rather than guessing when nothing is selected and nothing matches", () => {
    expect(localReply(req("hmm", null)).actions).toEqual([]);
  });
});

describe("prompt + cards", () => {
  it("lists the queue and the owner's rules", () => {
    const p = systemPrompt({ ...req("x"), rules: ["Repos go to Folders › Repos"] });
    expect(p).toContain("id=p1");
    expect(p).toContain("Repos go to Folders › Repos");
    expect(p).toContain("never act on your own");
  });

  it("describes an action in plain words", () => {
    expect(describeAction({ type: "file", ids: ["p1", "p2"] }, () => "x")).toBe("File 2 photos where proposed");
  });
});

describe("tasks — jobs go to the super chat", () => {
  it("keeps a valid task and drops one for an unknown photo or with no words", () => {
    const out = parseActions(
      [
        { type: "task", id: "p2", task: "Find the Stirling PDF repo in the photo and add it as a skill" },
        { type: "task", id: "ghost", task: "x" },
        { type: "task", id: "p2", task: "   " },
      ],
      ["p1", "p2"],
    );
    expect(out).toEqual([{ type: "task", id: "p2", task: "Find the Stirling PDF repo in the photo and add it as a skill" }]);
  });

  it("the prompt offers tasks and forbids saying it can't build", () => {
    const p = systemPrompt(req("hi"));
    expect(p).toContain('"type":"task"');
    expect(p).toMatch(/Never say you can't build/);
  });

  it("the owner's real request becomes a task in simple mode, not a reroute", () => {
    const r = localReply(
      req("can u find this skill and add this skill to my jarvis and create a app in my plugins with an image converter and a document signer", "p2"),
    );
    expect(r.actions).toHaveLength(1);
    const a = r.actions[0];
    expect(a.type).toBe("task");
    if (a.type === "task") {
      expect(a.id).toBe("p2");
      expect(a.task).toContain("document signer");
      expect(a.task).toContain("attached photo");
    }
  });

  it("plain sorting still sorts", () => {
    expect(localReply(req("this is a song, put it in my classifier")).actions.map((a) => a.type)).toEqual(["rule", "reroute"]);
    expect(localReply(req("save this repo", "p2")).actions[0].type).toBe("reroute");
    expect(localReply(req("screenshots of websites go to Folders › Sites", "p2")).actions.map((a) => a.type)).not.toContain("task");
  });

  it("describes a task on its card", () => {
    expect(describeAction({ type: "task", id: "p1", task: "Build the app" }, () => "x")).toBe("Do it: Build the app");
  });
});
