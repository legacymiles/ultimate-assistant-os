import { describe, expect, it } from "vitest";

import { isPrivateHost, shotAllowed } from "../../../tools/wangp-image/guard.mjs";

// The drawer photographs pages for whoever asks from this PC. A web page the
// owner happens to visit must not be able to use it to read their router or
// another local service — so a request from a page may photograph public
// sites and its own origin only.

describe("who may have which page photographed", () => {
  it("a program on this PC (no Origin) may photograph anything, including a dev server", () => {
    expect(shotAllowed("http://localhost:3000/apps/x", undefined)).toBe("");
    expect(shotAllowed("https://stripe.com", undefined)).toBe("");
  });

  it("a page may photograph public sites", () => {
    expect(shotAllowed("https://stripe.com", "https://ultimate-assistant-os.vercel.app")).toBe("");
  });

  it("a page may photograph its own origin", () => {
    expect(shotAllowed("http://localhost:3000/apps/x", "http://localhost:3000")).toBe("");
  });

  it("a local hub may photograph another local dev server", () => {
    expect(shotAllowed("http://127.0.0.1:5173/", "http://localhost:3000")).toBe("");
  });

  it("a public page may NOT photograph a private address", () => {
    for (const target of ["http://192.168.1.1", "http://10.0.0.5", "http://localhost:8080", "http://[::1]:3000", "http://printer.local"]) {
      expect(shotAllowed(target, "https://evil.example")).not.toBe("");
    }
  });

  it("only http and https", () => {
    expect(shotAllowed("file:///C:/Windows/win.ini", undefined)).not.toBe("");
    expect(shotAllowed("not a url", undefined)).not.toBe("");
  });

  it("knows private hosts from public ones", () => {
    expect(isPrivateHost("172.20.1.1")).toBe(true);
    expect(isPrivateHost("172.32.1.1")).toBe(false);
    expect(isPrivateHost("fcbarcelona.com")).toBe(false);
    expect(isPrivateHost("example.com")).toBe(false);
  });
});
