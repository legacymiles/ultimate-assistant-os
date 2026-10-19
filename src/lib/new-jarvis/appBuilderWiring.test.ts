import { describe, expect, it } from "vitest";
import { isHubTool, routeFor, toolByName, toolsFor } from "./agentTools";
import { classify } from "./actions";
import { planFromTriage } from "./triage";

// Every new app made from Jarvis chat (and Camera Autopilot, which hands its
// jobs to the chat) goes through App Builder. These pin that wiring.
describe("Jarvis chat → App Builder", () => {
  it("offers app_builder as a hub tool, even with the PC agent stopped", () => {
    expect(routeFor("app_builder")).toBe("hub/app_builder");
    expect(isHubTool("app_builder")).toBe(true);
    expect(toolsFor({}).some((t) => t.name === "app_builder")).toBe(true);
    expect(toolByName("app_builder")!.description).toMatch(/NEW app/);
    expect(toolByName("app_builder")!.description).toMatch(/video/);
  });
  it("opens a draft without a confirmation gate (the owner decides everything inside App Builder)", () => {
    const v = classify({ route: "hub/app_builder", args: { idea: "a CRM for roofers" } });
    expect(v.confirm).toBe(false);
  });
  it("the build lane tells the agent to use app_builder for new apps", () => {
    const plan = planFromTriage({
      answers: { lane: { type: "choice", choice: "build", confidence: 0.95, probabilities: { build: 0.95 } } },
      model: "typesafe/jev",
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
    } as never);
    expect(plan.lane).toBe("build");
    expect(plan.note).toMatch(/app_builder/);
  });
});
