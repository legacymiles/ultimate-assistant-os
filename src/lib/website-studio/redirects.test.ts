import { describe, expect, it } from "vitest";
import { readStart, studioRedirectFor } from "./redirects";

describe("old App Builder addresses", () => {
  it("sends the bare page to the Studio", () => {
    expect(studioRedirectFor({}, false)).toBe("/apps/website-studio");
    expect(studioRedirectFor({ section: "build" }, false)).toBe("/apps/website-studio");
  });

  it("opens a project in the Studio, from the address In Queue and the chat hand out", () => {
    expect(studioRedirectFor({ p: "ab_123" }, false)).toBe("/apps/website-studio?p=ab_123");
    expect(studioRedirectFor({ section: "build", p: "ab_123" }, false)).toBe("/apps/website-studio?p=ab_123");
  });

  it("lets the Studio open the classic screen on purpose", () => {
    expect(studioRedirectFor({ p: "ab_123", classic: "1" }, false)).toBeNull();
  });

  it("never moves App Builder when Jarvis has it framed in a sheet", () => {
    expect(studioRedirectFor({ p: "ab_123" }, true)).toBeNull();
    expect(studioRedirectFor({}, true)).toBeNull();
  });

  it("keeps the boards the Studio does not host", () => {
    expect(studioRedirectFor({ section: "redesign", v: "edit", url: "https://x.com", edit: "make it blue" }, false)).toBeNull();
    expect(studioRedirectFor({ section: "redesign", v: "2" }, false)).toBeNull();
    expect(studioRedirectFor({ section: "redesign", v: "showcase" }, false)).toBeNull();
    expect(studioRedirectFor({ edit: "make it blue", url: "https://x.com" }, false)).toBeNull();
  });

  it("opens a redesign on the Studio's redesign start, address carried", () => {
    expect(studioRedirectFor({ section: "redesign" }, false)).toBe("/apps/website-studio?start=redesign");
    expect(studioRedirectFor({ section: "redesign", url: "https://x.com" }, false)).toBe(
      "/apps/website-studio?start=redesign&url=https%3A%2F%2Fx.com",
    );
  });

  it("carries a Showcase idea into the start box", () => {
    expect(studioRedirectFor({ section: "build", idea: "a kart teardown" }, false)).toBe("/apps/website-studio?idea=a+kart+teardown");
  });
});

describe("the Studio's start reads its address back", () => {
  it("opens on redesign with the address filled", () => {
    expect(readStart("?start=redesign&url=https%3A%2F%2Fx.com")).toEqual({ mode: "redesign", idea: "", url: "https://x.com" });
  });

  it("defaults to a prompt", () => {
    expect(readStart("?idea=a+booking+site")).toEqual({ mode: "prompt", idea: "a booking site", url: "" });
    expect(readStart("")).toEqual({ mode: "prompt", idea: "", url: "" });
  });
});
