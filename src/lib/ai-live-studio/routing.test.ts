import { describe, expect, it } from "vitest";
import { afterWakeWord, isEcho, needsConfirm, overlap, physical, talkbackVerdict, type OutputDevice } from "./routing";

const devices: OutputDevice[] = [
  { deviceId: "default", groupId: "spk", label: "Default - Speakers (Realtek)" },
  { deviceId: "communications", groupId: "spk", label: "Communications - Speakers (Realtek)" },
  { deviceId: "a1", groupId: "spk", label: "Speakers (Realtek)" },
  { deviceId: "b2", groupId: "hp", label: "Headphones (USB)" },
  { deviceId: "c3", groupId: "cable", label: "CABLE Input (VB-Audio)" },
];
const base = { talkback: true, canRoute: true, devices, voice: "server" as const };

describe("talkback never reaches the stream", () => {
  it("is off when talkback is off", () => {
    expect(talkbackVerdict({ ...base, talkback: false, publicId: "c3", privateId: "b2" }).mode).toBe("off");
  });
  it("speaks when the private device is different hardware", () => {
    expect(talkbackVerdict({ ...base, publicId: "c3", privateId: "b2" }).mode).toBe("voice");
    expect(talkbackVerdict({ ...base, publicId: "", privateId: "b2" }).mode).toBe("voice");
  });
  it("falls back to text on the same speakers — even under an alias id", () => {
    expect(talkbackVerdict({ ...base, publicId: "", privateId: "" }).mode).toBe("text");
    expect(talkbackVerdict({ ...base, publicId: "default", privateId: "a1" }).mode).toBe("text");
    expect(talkbackVerdict({ ...base, publicId: "communications", privateId: "default" }).mode).toBe("text");
  });
  it("falls back to text when the browser can't route, or the voice is the browser's", () => {
    expect(talkbackVerdict({ ...base, canRoute: false, publicId: "c3", privateId: "b2" }).mode).toBe("text");
    expect(talkbackVerdict({ ...base, voice: "browser", publicId: "c3", privateId: "b2" }).mode).toBe("text");
  });
  it("explains the fix in plain words", () => {
    expect(talkbackVerdict({ ...base, publicId: "", privateId: "" }).why).toMatch(/headphones under Change/);
  });
  it("maps aliases to hardware, and an unknown device to null", () => {
    expect(physical("", devices)).toBe("spk");
    expect(physical("communications", devices)).toBe("spk");
    expect(physical("b2", devices)).toBe("hp");
    expect(physical("gone", devices)).toBeNull();
  });
  it("fails closed when the devices can't be told apart (before the mic is allowed)", () => {
    // Chrome hides ids until permission: the list is empty, or ids are blank.
    expect(talkbackVerdict({ ...base, devices: [], publicId: "", privateId: "b2" }).mode).toBe("text");
    const hidden = [{ deviceId: "", groupId: "", label: "" }];
    expect(talkbackVerdict({ ...base, devices: hidden, publicId: "", privateId: "b2" }).mode).toBe("text");
    // A device that was unplugged mid-stream.
    expect(talkbackVerdict({ ...base, publicId: "c3", privateId: "unplugged" }).mode).toBe("text");
  });

});

describe("the mic hearing Alex is not an instruction", () => {
  const recent = ["Mike, honestly that's the most ridiculous question I've heard all night.", "Where's everybody watching from?"];
  it("drops his own words", () => {
    expect(isEcho("that's the most ridiculous question I've heard all night", recent)).toBe(true);
    expect(isEcho("where's everybody watching from", recent)).toBe(true);
  });
  it("keeps the director's words, even when they mention the same people", () => {
    expect(isEcho("respond to Mike next", recent)).toBe(false);
    expect(isEcho("be a little more sarcastic", recent)).toBe(false);
    expect(isEcho("ask everyone where they're from", recent)).toBe(false);
  });
  it("treats silence as nothing", () => {
    expect(isEcho("  ", recent)).toBe(true);
  });
  it("measures overlap as a share of what was heard", () => {
    expect(overlap("hello there", "hello there friend")).toBe(1);
    expect(overlap("hello you", "hello there")).toBe(0.5);
  });
});

describe("wake word and confirmation", () => {
  it("only takes what comes after the name", () => {
    expect(afterWakeWord("Alex, be more energetic", "Alex")).toBe("be more energetic");
    expect(afterWakeWord("okay so hey alex slow down", "Alex")).toBe("slow down");
    expect(afterWakeWord("I was talking to my friend", "Alex")).toBeNull();
  });
  it("asks before acting on unsure recognition, but not on 'unknown'", () => {
    expect(needsConfirm(0.3)).toBe(true);
    expect(needsConfirm(0.9)).toBe(false);
    expect(needsConfirm(0)).toBe(false);
    expect(needsConfirm(undefined)).toBe(false);
  });
});
