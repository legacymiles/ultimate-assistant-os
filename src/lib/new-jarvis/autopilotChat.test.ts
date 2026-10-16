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
