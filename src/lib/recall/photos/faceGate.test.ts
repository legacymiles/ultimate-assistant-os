import { describe, expect, it } from "vitest";
import { gateFaces } from "./pipeline";
import { pickCategory, type PhotoAnalysis, type PhotoCategory, type Person } from "./types";
import { DEFAULT_FACE_SETTINGS } from "@/lib/identity/settings";

const analysis = (people: { personId: string; confidence: number }[], unknownPeople = 0): PhotoAnalysis => ({
  route: "people",
  title: "t",
  caption: "c",
  people,
  unknownPeople,
  tags: [],
  engine: "ai",
});

const me: Person = { id: "me", name: "Jack", role: "self", refs: [], createdAt: "t", identityId: "me" };
const son: Person = { id: "son", name: "Leo", role: "child", refs: [], createdAt: "t", identityId: "p-son" };
const meAndSon: PhotoCategory = { id: "pair", name: "Me & Leo", requires: ["me", "son"], exact: true, minPeople: 2, order: 20, builtIn: true };

describe("Camera Autopilot face gate", () => {
  it("files by sure matches only; an unsure face is a question, not a person", () => {
    const a = gateFaces(analysis([{ personId: "me", confidence: 0.95 }, { personId: "son", confidence: 0.66 }]), DEFAULT_FACE_SETTINGS);
    expect(a.people.map((h) => h.personId)).toEqual(["me"]);
    expect(a.uncertain?.map((h) => h.personId)).toEqual(["son"]);
    expect(a.unknownPeople).toBe(1);
    // So the "Me & Leo" folder is NOT chosen on a guess.
    expect(pickCategory([meAndSon], { personIds: a.people.map((h) => h.personId), unknownPeople: a.unknownPeople }, [me, son])).toBeNull();
  });

  it("files by both when both are sure", () => {
    const a = gateFaces(analysis([{ personId: "me", confidence: 0.95 }, { personId: "son", confidence: 0.9 }]), DEFAULT_FACE_SETTINGS);
    expect(a.uncertain).toBeUndefined();
    expect(pickCategory([meAndSon], { personIds: a.people.map((h) => h.personId), unknownPeople: a.unknownPeople }, [me, son])?.id).toBe("pair");
  });

  it("names nobody when recognition is switched off", () => {
    const a = gateFaces(analysis([{ personId: "me", confidence: 0.99 }]), { ...DEFAULT_FACE_SETTINGS, enabled: false });
    expect(a.people).toEqual([]);
    expect(a.unknownPeople).toBe(1);
  });
});
