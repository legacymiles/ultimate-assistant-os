import { describe, expect, it } from "vitest";
import { parseReply, speakable } from "./reply";

describe("parseReply", () => {
  it("reads the JSON it asked for", () => {
    expect(parseReply('{"reply": "Hey Mike!", "mood": "happy"}')).toEqual({ reply: "Hey Mike!", mood: "happy" });
  });

  it("reads JSON inside a code fence or after preamble", () => {
    expect(parseReply('```json\n{"reply": "Hi Sarah", "mood": "laughing"}\n```').reply).toBe("Hi Sarah");
    expect(parseReply('Sure! Here you go: {"reply": "Welcome in", "mood": "neutral"}').reply).toBe("Welcome in");
  });

  it("unwraps a made-up tool call instead of reading the tags aloud", () => {
    // Seen live from the model on 2026-11-23.
    const raw =
      "<toolcall><function=sendmessage><parameter=content>Kayla, thank you so much for the rose! " +
      "You're making my whole stream bloom today.</parameter></function></toolcall>";
    expect(parseReply(raw)).toEqual({
      reply: "Kayla, thank you so much for the rose! You're making my whole stream bloom today.",
      mood: "neutral",
    });
  });

  it("reads JSON that is itself inside a tool call", () => {
    const raw = '<toolcall><parameter=content>{"reply": "Nice one, Dre", "mood": "laughing"}</parameter></toolcall>';
    expect(parseReply(raw)).toEqual({ reply: "Nice one, Dre", mood: "laughing" });
  });

  it("falls back to plain words, stripped of markdown and labels", () => {
    expect(parseReply("**Alex:** Honestly? I'd pick Lisbon.").reply).toBe("Honestly? I'd pick Lisbon.");
  });

  it("treats an unknown mood as neutral", () => {
    expect(parseReply('{"reply": "ok", "mood": "furious"}').mood).toBe("neutral");
  });

  it("never returns anything that looks like a tag", () => {
    for (const raw of ["<b>hi</b> there", "<function=x>yo</function>", "a &lt;b&gt; c"]) {
      expect(parseReply(raw).reply).not.toMatch(/[<>]|&lt;|&gt;/);
    }
  });
});

describe("speakable", () => {
  it("leaves ordinary speech alone, including apostrophes and punctuation", () => {
    expect(speakable("I'm Alex — what's up, Mike? Ha!")).toBe("I'm Alex — what's up, Mike? Ha!");
  });

  it("strips wrapping quotes and collapses whitespace", () => {
    expect(speakable('  "Hello   there"  ')).toBe("Hello there");
  });
});
