import { describe, expect, it } from "vitest";
import {
  CHAT_MODELS,
  CLAUDE_API_MODELS,
  CLAUDE_SUBSCRIPTION,
  SUBSCRIPTION_MODELS,
  groupedChatModels,
  isSubscription,
  modelLabel,
  subscriptionModel,
} from "./chatModels";

/** "claude-opus-5-5" and "claude-opus-5.5" are the same model; compare on this. */
const family = (id: string) =>
  id
    .replace(`${CLAUDE_SUBSCRIPTION}:`, "")
    .replace("anthropic/", "")
    .replace(/[.-](\d)$/, "$1");

describe("the chat's Claude lineup", () => {
  it("offers the same Claude on the plan and on the API", () => {
    // The point of the menu: every Claude is there twice, once per bill. A model
    // added to one route and forgotten on the other is what this catches.
    const plan = SUBSCRIPTION_MODELS.filter((m) => m.id !== CLAUDE_SUBSCRIPTION).map((m) => family(m.id));
    const api = CLAUDE_API_MODELS.filter((m) => m.id).map((m) => family(m.id));
    expect(plan).toEqual(api);
    expect(plan.length).toBeGreaterThanOrEqual(5);
  });

  it("names a plan model the way Claude Code does, and an API model the way OpenRouter does", () => {
    for (const m of SUBSCRIPTION_MODELS) {
      expect(isSubscription(m.id)).toBe(true);
      if (m.id !== CLAUDE_SUBSCRIPTION) expect(subscriptionModel(m.id)).toMatch(/^claude-[a-z0-9-]+$/);
    }
    for (const m of CLAUDE_API_MODELS) {
      expect(isSubscription(m.id)).toBe(false);
      if (m.id) expect(m.id).toMatch(/^anthropic\/claude-[a-z0-9.-]+$/);
    }
  });

  it("labels every pick so the menu never shows a bare id", () => {
    for (const m of CHAT_MODELS) expect(modelLabel(m.id)).toBe(m.label);
    expect(modelLabel("made-up/model")).toBe("model");
  });

  it("hides the plan group where only the server runs the call", () => {
    const all = groupedChatModels();
    expect(all.map((g) => g.route)).toEqual(["subscription", "claude-api", "other"]);
    expect(all.flatMap((g) => g.items)).toHaveLength(CHAT_MODELS.length);

    const cloud = groupedChatModels(true);
    expect(cloud.map((g) => g.route)).toEqual(["claude-api", "other"]);
    expect(cloud.flatMap((g) => g.items).some((m) => isSubscription(m.id))).toBe(false);
    // Still several Claudes to choose from with the PC out of the picture.
    expect(cloud[0].items.length).toBeGreaterThanOrEqual(6);
  });
});
