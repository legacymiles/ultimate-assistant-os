import { describe, expect, it } from "vitest";
import { isOwner, parseOwnerEmails, routeAccess, PUBLIC_HOME } from "./hubAccess";

const TOKEN = new Set(["/api/dashboard/inbox/push"]);

describe("routeAccess", () => {
  it("makes the FNO page and its API public", () => {
    expect(routeAccess("/apps/friends-night-out", TOKEN)).toBe("public");
    expect(routeAccess("/apps/friends-night-out/anything", TOKEN)).toBe("public");
    expect(routeAccess("/api/fno/search", TOKEN)).toBe("public");
    expect(routeAccess("/api/fno", TOKEN)).toBe("public");
  });

  it("opens a client's review link and its API, but not the owner's console", () => {
    expect(routeAccess("/review/abc123", TOKEN)).toBe("public");
    expect(routeAccess("/api/client-review/portal/abc123", TOKEN)).toBe("public");
    expect(routeAccess("/client-review-sw.js", TOKEN)).toBe("public");
    expect(routeAccess("/api/client-review/admin", TOKEN)).toBe("owner");
    expect(routeAccess("/apps/client-review", TOKEN)).toBe("owner");
    expect(routeAccess("/reviews-secret", TOKEN)).toBe("owner");
  });

  it("does not match look-alike prefixes", () => {
    expect(routeAccess("/apps/friends-night-outage", TOKEN)).toBe("owner");
    expect(routeAccess("/api/fnox/secret", TOKEN)).toBe("owner");
  });

  it("keeps token paths exact-match only", () => {
    expect(routeAccess("/api/dashboard/inbox/push", TOKEN)).toBe("token");
    expect(routeAccess("/api/dashboard/inbox/push/x", TOKEN)).toBe("owner");
  });

  it("treats login and auth callback as auth routes", () => {
    expect(routeAccess("/login", TOKEN)).toBe("auth");
    expect(routeAccess("/auth/callback", TOKEN)).toBe("auth");
  });

  it("makes everything else owner-only", () => {
    for (const p of ["/", "/apps/std-safe", "/apps/dashboard", "/api/skills/scan", "/api/ai/chat"]) {
      expect(routeAccess(p, TOKEN)).toBe("owner");
    }
  });

  it("exposes the public home path", () => {
    expect(PUBLIC_HOME).toBe("/apps/friends-night-out");
  });
});

describe("owner list", () => {
  it("parses a comma list, trimmed and lower-cased, dropping blanks", () => {
    expect(parseOwnerEmails(" A@x.com, b@Y.com ,,")).toEqual(["a@x.com", "b@y.com"]);
    expect(parseOwnerEmails(undefined)).toEqual([]);
    expect(parseOwnerEmails("")).toEqual([]);
  });

  it("matches case-insensitively", () => {
    expect(isOwner("A@X.com", ["a@x.com"])).toBe(true);
  });

  it("fails closed: no owners configured means nobody is owner", () => {
    expect(isOwner("a@x.com", [])).toBe(false);
  });

  it("rejects missing email", () => {
    expect(isOwner(undefined, ["a@x.com"])).toBe(false);
    expect(isOwner("", ["a@x.com"])).toBe(false);
  });
});
