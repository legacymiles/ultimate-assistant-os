import { describe, expect, it } from "vitest";
import { firstStepText, planFromTriage, previousReply, shouldTriage, triageRequest } from "./triage";
import type { DecisionResult } from "@/lib/ai/decisions";

const jev = (choice: string, confidence: number): DecisionResult => ({
  answers: { lane: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } } },
  model: "typesafe/jev-1.13-20260917",
  cost: 0,
  inputTokens: 0,
  ms: 120,
});

describe("which turns are triaged", () => {
  it("only the first step of a Do or Ask turn", () => {
    const first = [{ role: "user", content: "what's 15% of 80?" }];
    const later = [...first, { role: "assistant", content: "" }, { role: "tool", content: "{}" }];
    expect(shouldTriage("do", first)).toBe(true);
    expect(shouldTriage("ask", first)).toBe(true);
    expect(shouldTriage("browse", first)).toBe(false);
    expect(shouldTriage("run", first)).toBe(false);
    expect(shouldTriage("do", later)).toBe(false);
  });

  it("never a turn carrying a picture or sound", () => {
    const media = [{ role: "user", content: [{ type: "text", text: "what is this?" }, { type: "image_url", image_url: { url: "https://x" } }] }];
    expect(firstStepText(media)).toBeNull();
    expect(firstStepText([{ role: "user", content: [{ type: "text", text: "hi" }] }])).toBe("hi");
  });

  it("gives Jev the previous reply so 'yes do it' has context", () => {
    const msgs = [
      { role: "user", content: "can you check my bank site?" },
      { role: "assistant", content: "I can open it in your browser — want me to?" },
      { role: "user", content: "yes do it" },
    ];
    expect(previousReply(msgs)).toContain("open it in your browser");
    expect(triageRequest("yes do it", previousReply(msgs)).state.previous_assistant_reply).toBeTruthy();
  });
});

describe("what a triage answer changes", () => {
  it("a confident quick drops every tool", () => {
    expect(planFromTriage(jev("quick", 0.9))).toMatchObject({ lane: "quick", noTools: true });
  });
  it("a confident remember keeps only the owner's own stores", () => {
    expect(planFromTriage(jev("remember", 0.85))).toMatchObject({ lane: "remember", hubOnly: true, noTools: false });
  });
  it("computer and build keep everything", () => {
    expect(planFromTriage(jev("computer", 0.95))).toMatchObject({ noTools: false, hubOnly: false });
    expect(planFromTriage(jev("build", 0.95)).note).toContain("harness");
  });
  it("unsure, missing or failed changes nothing", () => {
    expect(planFromTriage(jev("quick", 0.6))).toMatchObject({ lane: null, noTools: false, hubOnly: false, note: "" });
    expect(planFromTriage(null)).toMatchObject({ lane: null, noTools: false });
  });
});
