import { describe, expect, it } from "vitest";
import { canPaintEdit, hasWaitingEdit, needsLookPass } from "./edits";

const site = (over: Partial<Parameters<typeof needsLookPass>[0]> = {}) => ({
  liveUrl: "https://example.com",
  building: false,
  requests: [{ status: "sent" }],
  ...over,
});

describe("painting an edit before building it", () => {
  it("paints an edit the owner just sent against a page that exists", () => {
    expect(needsLookPass(site(), true)).toBe(true);
  });

  it("never makes a client sit through the owner's look pass", () => {
    // The client asks; the owner decides what it is going to look like.
    expect(needsLookPass(site(), false)).toBe(false);
  });

  it("has nothing to paint onto before the first version has an address", () => {
    expect(needsLookPass(site({ liveUrl: "" }), true)).toBe(false);
    expect(needsLookPass(site({ liveUrl: null }), true)).toBe(false);
    // ...and that is exactly when Send should go straight to the build.
    expect(canPaintEdit({ liveUrl: "", building: false }, true)).toBe(false);
  });

  it("stops offering it once the build is already running", () => {
    // Past this point a picture cannot change what is being written.
    expect(needsLookPass(site({ building: true }), true)).toBe(false);
    expect(canPaintEdit({ liveUrl: "https://example.com", building: true }, true)).toBe(false);
  });

  it("only counts a request that is actually waiting on a build", () => {
    expect(hasWaitingEdit(site({ requests: [{ status: "draft" }] }))).toBe(false);
    expect(hasWaitingEdit(site({ requests: [{ status: "done" }] }))).toBe(false);
    expect(hasWaitingEdit(site({ requests: [{ status: "rejected" }] }))).toBe(false);
    expect(hasWaitingEdit(site({ requests: [{ status: "approved" }] }))).toBe(true);
    expect(hasWaitingEdit(site({ requests: [] }))).toBe(false);
  });

  it("lets Send ask before anything is waiting, which is the whole point", () => {
    // needsLookPass would say no here — nothing is filed yet — so Send has
    // its own question, and the two must not be the same one.
    const fresh = { liveUrl: "https://example.com", building: false, requests: [] };
    expect(needsLookPass(fresh, true)).toBe(false);
    expect(canPaintEdit(fresh, true)).toBe(true);
  });
});
