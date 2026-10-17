import { describe, expect, it } from "vitest";
import { plainBridgeError, plainCloudError, plainSiteError } from "./plainErrors";

describe("plainCloudError", () => {
  it("turns provider dialect into what to do", () => {
    expect(plainCloudError(401, "No auth credentials found")).toMatch(/OpenRouter key isn't working/);
    expect(plainCloudError(402, "Insufficient credits")).toMatch(/out of credit/);
    expect(plainCloudError(404, "No endpoints found for deepseek/x")).toMatch(/isn't available/);
    expect(plainCloudError(400, "No endpoints found that support tool use")).toMatch(/isn't available|can't use tools/);
    expect(plainCloudError(400, "This model does not support tools")).toMatch(/can't use tools/);
    expect(plainCloudError(400, "image input is not supported")).toMatch(/can't read what you attached/);
    expect(plainCloudError(413, "Request too large")).toMatch(/too much/);
    expect(plainCloudError(429, "Rate limit exceeded")).toMatch(/too many requests/);
    expect(plainCloudError(503, "Provider returned error")).toMatch(/having trouble/);
  });
  it("never passes a stack or JSON through whole", () => {
    const s = plainCloudError(418, "Something odd. {\"deep\":{\"json\":1}} at foo (bar.js:1)");
    expect(s).toBe("The AI couldn't answer: Something odd.");
  });
});

describe("plainSiteError / plainBridgeError", () => {
  it("explains timeouts, sign-in and an unreachable PC", () => {
    expect(plainSiteError(504)).toMatch(/took too long/);
    expect(plainSiteError(401)).toMatch(/sign-in/);
    expect(plainBridgeError(0, "x")).toMatch(/can't reach the local agent/);
    expect(plainBridgeError(401, "x")).toMatch(/isn.t paired/);
    expect(plainBridgeError(404, "No route POST /brain/claude")).toMatch(/older version/);
    expect(plainBridgeError(502, "Claude isn't signed in on this PC.")).toBe("Claude isn't signed in on this PC.");
  });
});
