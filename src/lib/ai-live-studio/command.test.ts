import { describe, expect, it } from "vitest";
import {
  ackFor, fromAlex, matchViewers, parseDirectAnswer, typedCommand, numberFrom, parseCommand, resolveDirectives, sanitizeDirectives, splitClauses, stripLead, targetFrom,
  type ChatRef, type CommandContext, type Directive,
} from "./command";

const comments: ChatRef[] = [
  { id: "c1", handle: "mike23", user: "Mike", text: "are you a real person?", waiting: true },
  { id: "c2", handle: "sarah.k", user: "Sarah K", text: "hi from Ohio", waiting: false },
  { id: "c3", handle: "jen_b", user: "Jen", text: "what do you think about politics", waiting: true },
];
const ctx: CommandContext = { name: "Alex", comments, focusId: "c3", topic: "what do you think about politics" };
const parse = (t: string) => parseCommand(t, ctx);
const only = (t: string): Directive => {
  const p = parse(t);
  expect(p.leftover).toEqual([]);
  expect(p.directives).toHaveLength(1);
  return p.directives[0];
};

describe("splitting and cleaning", () => {
  it("splits sentences and verb-led 'and' clauses, not 'but' clauses", () => {
    expect(splitClauses("Respond to Mike next. Tell him that's a ridiculous question.")).toEqual([
      "Respond to Mike next",
      "Tell him that's a ridiculous question",
    ]);
    expect(splitClauses("Stop talking about that subject and ask everyone where they're from")).toHaveLength(2);
    expect(splitClauses("Sound slightly annoyed, but keep it playful.")).toHaveLength(1);
    expect(splitClauses("thanks to mike.23 for that")).toHaveLength(1);
  });
  it("strips the name and polite lead-ins", () => {
    expect(stripLead("Alex, be more energetic", "Alex")).toBe("be more energetic");
    expect(stripLead("hey alex can you slow down please", "Alex")).toBe("slow down");
    expect(stripLead("okay so I want you to respond to Sarah", "Alex")).toBe("respond to Sarah");
  });
  it("turns the director's message into Alex's point of view", () => {
    expect(fromAlex("I disagree")).toBe("you disagree");
    expect(fromAlex("my answer is no and I'm sure")).toBe("your answer is no and you're sure");
  });
  it("reads numbers said as words", () => {
    expect(numberFrom("five")).toBe(5);
    expect(numberFrom("12")).toBe(12);
    expect(numberFrom("a few")).toBe(3);
    expect(numberFrom("banana")).toBeNull();
  });
  it("reads targets", () => {
    expect(targetFrom("that question")).toEqual({ by: "focus" });
    expect(targetFrom("that person")).toEqual({ by: "focus" });
    expect(targetFrom("Mike next")).toEqual({ by: "name", name: "Mike" });
    expect(targetFrom("@mike23")).toEqual({ by: "name", name: "mike23" });
    expect(targetFrom("Mike's question")).toEqual({ by: "name", name: "Mike" });
    expect(targetFrom("everyone")).toBeNull();
    expect(targetFrom("the chat")).toBeNull();
  });
});

describe("every example from the brief", () => {
  it("Alex, be more energetic", () => {
    expect(only("Alex, be more energetic.")).toEqual({ type: "tune", energy: 2 });
  });
  it("Alex, be a little more sarcastic", () => {
    expect(only("Alex, be a little more sarcastic.")).toEqual({ type: "act", emotion: "sarcastic", scope: "standing" });
  });
  it("Make your next response funny", () => {
    expect(only("Make your next response funny.")).toEqual({ type: "note", scope: "next", text: "Make your next response funny" });
  });
  it("Respond to Sarah", () => {
    expect(only("Respond to Sarah.")).toEqual({ type: "reply", target: { by: "name", name: "Sarah" }, instruction: "", promote: true });
  });
  it("Respond to Mike next. Tell him that's a ridiculous question.", () => {
    expect(only("Respond to Mike next. Tell him that's a ridiculous question.")).toEqual({
      type: "reply", target: { by: "name", name: "Mike" }, instruction: "Tell them that's a ridiculous question", promote: true,
    });
  });
  it("Don't answer that question", () => {
    expect(only("Don't answer that question.")).toEqual({ type: "skip", target: { by: "focus" } });
  });
  it("keeps 'that' when it's part of the message", () => {
    expect(only("Respond to Sarah next. Tell her that is a ridiculous question.")).toMatchObject({
      type: "reply", target: { by: "name", name: "Sarah" }, instruction: "Tell them that is a ridiculous question",
    });
  });
  it("Tell Mike I disagree", () => {

    expect(only("Tell Mike I disagree.")).toEqual({ type: "reply", target: { by: "name", name: "Mike" }, instruction: "Tell them you disagree", promote: true });
  });
  it("Ask everyone what city they're from", () => {
    expect(only("Ask everyone what city they're from.")).toEqual({ type: "cue", kind: "audience", intent: "Ask everyone what city they're from" });
  });
  it("Stop talking about politics", () => {
    expect(only("Stop talking about politics.")).toEqual({ type: "avoid", topic: "politics" });
  });
  it("Stop talking about that subject and ask everyone where they're from", () => {
    const p = parse("Stop talking about that subject and ask everyone where they're from");
    expect(p.leftover).toEqual([]);
    expect(p.directives[0]).toMatchObject({ type: "note", scope: "next" });
    expect((p.directives[0] as { text: string }).text).toContain("politics");
    expect(p.directives[1]).toMatchObject({ type: "cue", kind: "audience" });
  });
  it("Give that person a shoutout", () => {
    expect(only("Give that person a shoutout.")).toMatchObject({ type: "cue", kind: "shoutout", target: { by: "focus" } });
  });
  it("Laugh after your next joke", () => {
    const p = parse("Laugh after your next joke.");
    expect(p.directives[0]).toMatchObject({ type: "note", scope: "next" });
  });
  it("Slow down your speaking", () => {
    const d = only("Slow down your speaking.");
    expect(d.type).toBe("tune");
    expect((d as { speed: number }).speed).toBeCloseTo(-0.1);
  });
  it("Wait five seconds before answering", () => {
    expect(only("Wait five seconds before answering.")).toEqual({ type: "wait", seconds: 5 });
  });
  it("Change your personality to more laid-back", () => {
    expect(only("Change your personality to more laid-back.")).toEqual({ type: "tune", preset: "chill" });
  });
  it("Look surprised when you answer", () => {
    const p = parse("Look surprised when you answer.");
    expect(p.directives).toContainEqual({ type: "act", emotion: "surprised", scope: "next" });
  });
  it("Be more confident", () => {
    expect(only("Be more confident.")).toEqual({ type: "act", emotion: "confident", scope: "standing" });
  });
  it("Act like you're telling a funny story", () => {
    expect(only("Act like you're telling a funny story.")).toMatchObject({ type: "note", scope: "next" });
  });
  it("Sound slightly annoyed, but keep it playful", () => {
    expect(only("Sound slightly annoyed, but keep it playful.")).toEqual({ type: "act", emotion: "annoyed", scope: "standing" });
  });
  it("Smile when responding to Sarah", () => {
    expect(only("Smile when responding to Sarah.")).toEqual({
      type: "reply", target: { by: "name", name: "Sarah" }, instruction: "Smile", promote: false, expression: "happy",
    });
  });
  it("Try getting more people involved", () => {
    expect(only("Try getting more people involved.")).toMatchObject({ type: "tune", interaction: 2 });
  });
});

describe("the rest of the vocabulary", () => {
  it("mutes a person but only skips a comment", () => {
    expect(only("Ignore that user")).toEqual({ type: "mute", target: { by: "focus" } });
    expect(only("ignore that")).toEqual({ type: "skip", target: { by: "focus" } });
    expect(only("ignore Mike")).toEqual({ type: "mute", target: { by: "name", name: "Mike" } });
  });
  it("pauses, resumes and resets", () => {
    expect(only("hold on")).toEqual({ type: "pause" });
    expect(only("ok carry on")).toEqual({ type: "resume" });
    expect(only("back to normal")).toEqual({ type: "reset" });
  });
  it("says exactly what's quoted", () => {
    expect(only('say exactly "welcome to the stream everybody"')).toEqual({ type: "say", text: "welcome to the stream everybody" });
  });
  it("does not mistake a topic for a person", () => {
    expect(only("talk about cooking")).toMatchObject({ type: "cue", kind: "subject", intent: "Change the subject to cooking" });
  });
  it("moves the eyes and head", () => {
    expect(only("make more eye contact")).toEqual({ type: "act", eyeContact: 3, scope: "standing" });
    expect(only("keep your head still")).toEqual({ type: "act", headMotion: -3, scope: "standing" });
  });
  it("leaves what it can't place for the brain, and spots questions", () => {
    const p = parse("Alex, what do you think about the audience tonight?");
    expect(p.directives).toEqual([]);
    expect(p.question).toBe(true);
    expect(parse("make the vibe feel like a late-night radio show").leftover).toHaveLength(1);
  });
});

describe("resolving against the live chat", () => {
  it("finds a viewer by first name, handle or a misheard name", () => {
    expect(matchViewers("Mike", comments)).toEqual([{ handle: "mike23", user: "Mike" }]);
    expect(matchViewers("sarah", comments)).toEqual([{ handle: "sarah.k", user: "Sarah K" }]);
    expect(matchViewers("Mik", comments)).toEqual([{ handle: "mike23", user: "Mike" }]);
    expect(matchViewers("Zed", comments)).toEqual([]);
  });
  it("resolves names and 'that' to real comments", () => {
    const r = resolveDirectives([
      { type: "reply", target: { by: "name", name: "Mike" }, instruction: "", promote: true },
      { type: "skip", target: { by: "focus" } },
    ], ctx);
    expect(r.ready[0].directive).toMatchObject({ target: { by: "viewer", handle: "mike23", commentId: "c1" } });
    expect(r.ready[1].directive).toMatchObject({ target: { by: "comment", id: "c3", handle: "jen_b" } });
    expect(r.clarify).toBeNull();
  });
  it("watches for someone who hasn't spoken yet", () => {
    const r = resolveDirectives([{ type: "reply", target: { by: "name", name: "Carlos" }, instruction: "", promote: true }], ctx);
    expect(r.ready[0].directive).toMatchObject({ target: { by: "watch", name: "Carlos" } });
  });
  it("asks when a name fits two people", () => {
    const two = [...comments, { id: "c4", handle: "mike_k", user: "Mike K", text: "yo", waiting: true }];
    const r = resolveDirectives([{ type: "reply", target: { by: "name", name: "Mike" }, instruction: "", promote: true }], { ...ctx, comments: two });
    expect(r.ready).toEqual([]);
    expect(r.clarify?.question).toBe("Which Mike?");
    expect(r.clarify?.options.map((o) => o.label)).toEqual(["@mike_k · “yo”", "@mike23 · “are you a real person?”"]);
  });
  it("says what's wrong when 'that' has nothing selected", () => {
    const r = resolveDirectives([{ type: "skip", target: { by: "focus" } }], { ...ctx, focusId: null });
    expect(r.problems).toEqual(["Which comment? Select one in the chat first."]);
  });
});

describe("checking what a model returned", () => {
  it("keeps well-formed directions, clamps, drops junk", () => {
    const out = sanitizeDirectives([
      { type: "tune", energy: 40, preset: "nope" },
      { type: "reply", target: "@mike23", instruction: "x".repeat(500) },
      { type: "act", emotion: "furious" },
      { type: "launch-missiles" },
      { type: "wait", seconds: 999 },
      "not an object",
      { type: "cue", kind: "audience", intent: "Ask where everyone is from" },
    ]);
    expect(out[0]).toEqual({ type: "tune", energy: 10 });
    expect(out[1]).toMatchObject({ type: "reply", target: { by: "name", name: "mike23" }, promote: true });
    expect((out[1] as { instruction: string }).instruction).toHaveLength(240);
    expect(out[2]).toEqual({ type: "wait", seconds: 60 });
    expect(out[3]).toMatchObject({ type: "cue", kind: "audience" });
    expect(out).toHaveLength(4);
  });
  it("returns nothing for nothing", () => {
    expect(sanitizeDirectives(null)).toEqual([]);
    expect(sanitizeDirectives({ type: "pause" })).toEqual([]);
  });
});

describe("acknowledgements the owner sees", () => {
  it("reads like the brief's examples", () => {
    expect(ackFor({ type: "reply", target: { by: "viewer", handle: "mike23", user: "Mike" }, instruction: "", promote: true })).toBe("@mike23 prioritized");
    expect(ackFor({ type: "cue", kind: "subject", intent: "x" })).toBe("Changing conversation topic");
    expect(ackFor({ type: "cue", kind: "line", intent: "x" })).toBe("Response queued");
    expect(ackFor({ type: "mute", target: { by: "viewer", handle: "troll", user: "T" } })).toBe("Ignoring @troll for this stream");
    expect(ackFor({ type: "tune", energy: 2 })).toBe("Personality updated — energy up");
  });
});

describe("the command bar's types", () => {
  it("says exactly what was typed", () => {
    expect(typedCommand("say", "  welcome   in ", null)).toEqual({ directives: [{ type: "say", text: "welcome in" }] });
  });
  it("replies to the selected comment, with the note as how", () => {
    expect(typedCommand("reply-comment", "Be sarcastic and funny", "c1")).toEqual({
      directives: [{ type: "reply", target: { by: "comment", id: "c1" }, instruction: "Be sarcastic and funny", promote: true }],
    });
    expect(typedCommand("reply-comment", "x", null)).toEqual({ error: "Select a comment in the chat first." });
  });
  it("replies to a person by @name, or by their selected comment", () => {
    expect(typedCommand("reply-person", "@mike23 tell him he's wrong", null)).toMatchObject({
      directives: [{ type: "reply", target: { by: "name", name: "mike23" }, instruction: "tell him he's wrong" }],
    });
    expect(typedCommand("reply-person", "hi", "c2")).toMatchObject({ directives: [{ target: { by: "comment", id: "c2" } }] });
  });
  it("changes the subject, reacts, skips, ignores and prioritizes", () => {
    expect(typedCommand("subject", "favourite snacks", null)).toMatchObject({ directives: [{ type: "cue", kind: "subject", intent: "Change the subject to favourite snacks" }] });
    expect(typedCommand("react", "act shocked", "c1")).toMatchObject({ directives: [{ type: "cue", kind: "react", target: { by: "comment", id: "c1" } }] });
    expect(typedCommand("skip", "", "c3")).toEqual({ directives: [{ type: "skip", target: { by: "comment", id: "c3" } }] });
    expect(typedCommand("skip", "@troll99", null)).toEqual({ directives: [{ type: "mute", target: { by: "name", name: "troll99" } }] });
    expect(typedCommand("prioritize", "", "c1")).toMatchObject({ directives: [{ type: "reply", promote: true, instruction: "" }] });
  });
  it("hands free-form directions back to the parser", () => {
    expect(typedCommand("direction", "be funnier", null)).toEqual({ directives: [] });
    expect(typedCommand("direction", " ", null)).toEqual({ error: "Type a direction first." });
  });
});

describe("reading the interpreter's answer", () => {

  it("takes JSON in a fence, checks the actions", () => {
    const a = parseDirectAnswer('Sure!\n```json\n{"actions":[{"type":"tune","energy":2},{"type":"nuke"}],"reply":"Got it — more energy.","ack":"Energy up"}\n```');
    expect(a).toEqual({ directives: [{ type: "tune", energy: 2 }], reply: "Got it — more energy.", ack: "Energy up" });
  });
  it("survives prose and broken JSON without inventing actions", () => {
    expect(parseDirectAnswer("They're pretty active tonight.")).toEqual({ directives: [], reply: "They're pretty active tonight.", ack: "" });
    expect(parseDirectAnswer('{"actions": [ broken')).toEqual({ directives: [], reply: "actions: broken", ack: "" });
    expect(parseDirectAnswer('{"actions": oops}').directives).toEqual([]);
  });
});
