import { describe, expect, it } from "vitest";
import { moderate, normalizeForMatch, speakableName } from "./moderation";

describe("moderate", () => {
  it("lets ordinary chat through", () => {
    for (const t of ["What's your name?", "lol", "Tell us a joke", "🔥🔥🔥", "where are you from Alex"]) {
      expect(moderate(t).ok).toBe(true);
    }
  });

  it("stops harassment, including spaced-out spellings", () => {
    expect(moderate("kys").reason).toBe("harassment");
    expect(moderate("k y s lol").reason).toBe("harassment");
    expect(moderate("just kill yourself").reason).toBe("harassment");
  });

  it("stops the owner's own blocked words, through common disguises", () => {
    const list = ["badword"];
    expect(moderate("you are a badword", list).reason).toBe("blocked-word");
    expect(moderate("you are a B4DW0RD", list).reason).toBe("blocked-word");
    expect(moderate("b a d w o r d", list).reason).toBe("blocked-word");
  });

  it("does not block a word that merely contains a short blocked word", () => {
    expect(moderate("classic move", ["ass"]).ok).toBe(true);
  });

  it("does not block innocent words that merely span a blocked word", () => {
    expect(moderate("push it to the limit", ["shit"]).ok).toBe(true);
  });

  it("still catches a blocked word at the end of a shout", () => {
    expect(moderate("you badword!!", ["badword"]).reason).toBe("blocked-word");
  });

  it("never reads links or contact details aloud", () => {
    expect(moderate("follow me at spamsite.com").reason).toBe("link");
    expect(moderate("go to https://x.y/z").reason).toBe("link");
    expect(moderate("call me 555 123 4567 89").reason).toBe("contact");
    expect(moderate("mail me a@b.co").reason).toBe("contact");
  });

  it("stops shouting and keyboard mashing", () => {
    expect(moderate("WHY WONT YOU ANSWER ME EVER").reason).toBe("spam");
    expect(moderate("aaaaaaaaaaaaaaaaa").reason).toBe("spam");
  });
});

describe("normalizeForMatch", () => {
  it("undoes leetspeak and stretched letters", () => {
    expect(normalizeForMatch("H3LLOOOO W0RLD!!")).toBe("helloo world");
  });

  it("leaves plain numbers alone", () => {
    expect(normalizeForMatch("call 12345")).toBe("call 12345");
  });
});

describe("speakableName", () => {
  it("turns a handle into a sayable name", () => {
    expect(speakableName("@mike_23")).toBe("mike 23");
    expect(speakableName("Sarah ✨")).toBe("Sarah");
  });

  it("never says a name that is itself abuse or unsayable", () => {
    expect(speakableName("badword_fan", ["badword"])).toBe("friend");
    expect(speakableName("✨✨✨")).toBe("friend");
    expect(speakableName("12345")).toBe("friend");
  });
});
