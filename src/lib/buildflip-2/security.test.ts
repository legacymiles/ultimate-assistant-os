import { describe, expect, it } from "vitest";
import {
  generateInput,
  leadInput,
  projectPatch,
  receiptInput,
  ownImagesOnly,
  safeHttpUrl,
  uploadInput,
} from "@/lib/buildflip-2/validate";
import { extractJson } from "@/lib/buildflip-2/ai/chat";
import { buildSpec, compsResult, pricingResult } from "@/lib/buildflip-2/ai/schema";
import { isPrivateAddress, platformOf } from "@/lib/buildflip-2/ai/link-reader";
import { callerIp, LIMITS, rateLimit } from "@/lib/buildflip-2/rate-limit";

/**
 * The checks that stop the server trusting the browser (S4), stop a pasted
 * link reaching our own network (SSRF), and stop a drifting model answer being
 * rendered as fact.
 */

describe("safeHttpUrl — SSRF guard", () => {
  const blocked = [
    "http://localhost:3000/admin",
    "http://127.0.0.1/",
    "http://127.1.2.3/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://[::1]/",
    "http://metadata.internal/",
    "http://printer.local/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "ftp://example.com/x",
    "not a url",
    "http://nodots",
  ];

  for (const url of blocked) {
    it(`blocks ${url}`, () => {
      expect(safeHttpUrl.safeParse(url).success).toBe(false);
    });
  }

  const allowed = [
    "https://www.instagram.com/p/abc123/",
    "https://www.tiktok.com/@maker/video/123",
    "https://pin.it/abc",
    "http://example.com/a/b?c=d",
    "https://sub.domain.co.uk/post",
  ];

  for (const url of allowed) {
    it(`allows ${url}`, () => {
      expect(safeHttpUrl.safeParse(url).success).toBe(true);
    });
  }

  it("blocks 172.16–172.31 but allows 172.32", () => {
    expect(safeHttpUrl.safeParse("http://172.20.1.1/").success).toBe(false);
    expect(safeHttpUrl.safeParse("http://172.32.1.1/").success).toBe(true);
  });

  it("rejects an absurdly long link", () => {
    expect(safeHttpUrl.safeParse(`https://x.com/${"a".repeat(3000)}`).success).toBe(false);
  });
});

describe("generateInput", () => {
  it("needs a real prompt", () => {
    expect(generateInput.safeParse({ prompt: "" }).success).toBe(false);
    expect(generateInput.safeParse({ prompt: "ab" }).success).toBe(false);
    expect(generateInput.safeParse({ prompt: "a picture frame" }).success).toBe(true);
  });

  it("caps the prompt length", () => {
    expect(generateInput.safeParse({ prompt: "x".repeat(2001) }).success).toBe(false);
  });

  it("caps the number of photos", () => {
    const five = ["a", "b", "c", "d", "e"];
    expect(generateInput.safeParse({ prompt: "frame", images: five }).success).toBe(false);
    expect(
      generateInput.safeParse({ prompt: "frame", images: five.slice(0, 4) }).success,
    ).toBe(true);
  });

  it("refuses a private-network source link", () => {
    expect(
      generateInput.safeParse({ prompt: "frame", sourceUrl: "http://127.0.0.1/" }).success,
    ).toBe(false);
  });

  it("gives a plain-English message, not a code", () => {
    const res = generateInput.safeParse({ prompt: "" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]!.message).toMatch(/what you want to build/i);
      expect(res.error.issues[0]!.message).not.toMatch(/invalid|ZodError|string/i);
    }
  });

  it("clamps an absurd hourly target", () => {
    expect(
      generateInput.safeParse({ prompt: "frame", hourlyTarget: 999999 }).success,
    ).toBe(false);
  });
});

describe("projectPatch — only writable fields", () => {
  it("ignores an attempt to grant Pro or change the owner", () => {
    const res = projectPatch.safeParse({
      title: "ok",
      plan: "pro",
      ownerId: "someone-else",
      role: "admin",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).not.toHaveProperty("plan");
      expect(res.data).not.toHaveProperty("ownerId");
      expect(res.data).not.toHaveProperty("role");
    }
  });

  it("rejects a bad stage", () => {
    expect(projectPatch.safeParse({ stage: "shipped" }).success).toBe(false);
  });

  it("rejects a negative price", () => {
    expect(
      projectPatch.safeParse({ materialPrice: { id: "m1", unitPrice: -5 } }).success,
    ).toBe(false);
  });

  it("caps the shopping list length", () => {
    const big = Array.from({ length: 301 }, (_, i) => ({
      materialId: `m${i}`,
      checked: true,
    }));
    expect(projectPatch.safeParse({ shopping: big }).success).toBe(false);
  });
});

describe("receiptInput", () => {
  it("needs a label and a sane amount", () => {
    expect(receiptInput.safeParse({ label: "", amount: 10 }).success).toBe(false);
    expect(receiptInput.safeParse({ label: "oak", amount: -1 }).success).toBe(false);
    expect(receiptInput.safeParse({ label: "oak", amount: 2_000_000 }).success).toBe(false);
    expect(receiptInput.safeParse({ label: "oak", amount: 126.5 }).success).toBe(true);
  });
});

describe("uploadInput", () => {
  it("only accepts an image data URL", () => {
    expect(uploadInput.safeParse({ dataUrl: "https://evil.test/x.png" }).success).toBe(false);
    expect(
      uploadInput.safeParse({ dataUrl: "data:text/html;base64,PHNjcmlwdD4=" }).success,
    ).toBe(false);
    expect(uploadInput.safeParse({ dataUrl: "data:image/webp;base64,UklGRg==" }).success).toBe(
      true,
    );
  });
});

describe("leadInput", () => {
  it("normalises and validates the address", () => {
    const res = leadInput.safeParse({ email: "  Someone@Example.COM " });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.email).toBe("someone@example.com");
    expect(leadInput.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("extractJson", () => {
  it("reads a bare object", () => {
    expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });
  it("reads a fenced block", () => {
    expect(extractJson<{ a: number }>('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it("reads an object buried in prose", () => {
    expect(extractJson<{ a: number }>('Sure! Here you go: {"a":3} Hope that helps.')).toEqual({
      a: 3,
    });
  });
  it("reads an array", () => {
    expect(extractJson<number[]>("[1,2,3]")).toEqual([1, 2, 3]);
  });
  it("throws something a human can read when it isn't JSON at all", () => {
    expect(() => extractJson("I'd rather not.")).toThrow(/wasn't readable/i);
  });
});

describe("model answers are validated, not trusted", () => {
  it("rejects a spec with no materials", () => {
    expect(
      buildSpec.safeParse({
        title: "x",
        summary: "y",
        estimatedHours: 2,
        dimensions: [{ key: "w", label: "W", value: 1, unit: "in", min: 1, max: 2, step: 1 }],
        tools: [],
        safety: [],
        materials: [],
        steps: [
          { title: "a", body: "b", tools: [], minutes: 10 },
          { title: "c", body: "d", tools: [], minutes: 10 },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a spec with a single step", () => {
    expect(
      buildSpec.safeParse({
        title: "x",
        summary: "y",
        estimatedHours: 2,
        dimensions: [{ key: "w", label: "W", value: 1, unit: "in", min: 1, max: 2, step: 1 }],
        tools: [],
        safety: [],
        materials: [
          { name: "m", quantity: 1, unit: "ea" },
        ],
        steps: [{ title: "a", body: "b", tools: [], minutes: 10 }],
      }).success,
    ).toBe(false);
  });

  it("coerces a bad category rather than dropping the material", () => {
    const res = buildSpec.safeParse({
      title: "x",
      summary: "y",
      estimatedHours: 2,
      dimensions: [{ key: "w", label: "W", value: 1, unit: "in", min: 1, max: 2, step: 1 }],
      tools: [],
      safety: [],
      materials: [{ name: "m", category: "unobtainium", quantity: 1, unit: "ea" }],
      steps: [
        { title: "a", body: "b", tools: [], minutes: 10 },
        { title: "c", body: "d", tools: [], minutes: 10 },
      ],
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.materials[0]!.category).toBe("other");
  });

  it("keeps a null price URL rather than inventing one", () => {
    const res = pricingResult.safeParse({
      materials: [{ name: "m", unitPrice: 4.5, retailer: "HD", url: null }],
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.materials[0]!.url).toBeNull();
  });

  it("requires sold to be an explicit boolean on every comp", () => {
    expect(
      compsResult.safeParse({ comps: [{ title: "t", price: 10, marketplace: "eBay" }] })
        .success,
    ).toBe(false);
    expect(
      compsResult.safeParse({
        comps: [{ title: "t", price: 10, sold: true, marketplace: "eBay" }],
      }).success,
    ).toBe(true);
  });

  it("caps the comp list so one answer can't flood a plan", () => {
    const many = Array.from({ length: 41 }, (_, i) => ({
      title: `t${i}`,
      price: 10,
      sold: true,
      marketplace: "eBay",
    }));
    expect(compsResult.safeParse({ comps: many }).success).toBe(false);
  });
});

describe("platformOf", () => {
  it("names the platform a user would recognise", () => {
    expect(platformOf("https://www.instagram.com/p/x/")).toBe("Instagram");
    expect(platformOf("https://vm.tiktok.com/x")).toBe("TikTok");
    expect(platformOf("https://youtu.be/x")).toBe("YouTube");
    expect(platformOf("https://example.org/x")).toBe("example.org");
    expect(platformOf("garbage")).toBe("the web");
  });
});

describe("isPrivateAddress — the SSRF address check", () => {
  const priv = [
    ["127.0.0.1", 4],
    ["127.1.2.3", 4],
    ["0.0.0.0", 4],
    ["10.1.2.3", 4],
    ["172.16.0.1", 4],
    ["172.31.255.255", 4],
    ["192.168.1.1", 4],
    ["169.254.169.254", 4], // cloud metadata
    ["100.64.0.1", 4], // CGNAT
    ["224.0.0.1", 4],
    ["255.255.255.255", 4],
    ["::1", 6],
    ["fc00::1", 6],
    ["fe80::1", 6],
    ["::ffff:127.0.0.1", 6], // v4-mapped loopback
  ] as const;
  for (const [ip, fam] of priv) {
    it(`blocks ${ip}`, () => expect(isPrivateAddress(ip, fam)).toBe(true));
  }

  const pub = [
    ["93.184.216.34", 4],
    ["8.8.8.8", 4],
    ["172.32.0.1", 4], // just outside the private block
    ["172.15.255.255", 4],
    ["2606:2800:220:1:248:1893:25c8:1946", 6],
  ] as const;
  for (const [ip, fam] of pub) {
    it(`allows ${ip}`, () => expect(isPrivateAddress(ip, fam)).toBe(false));
  }

  it("treats anything unparseable as unsafe", () => {
    expect(isPrivateAddress("not-an-ip", 4)).toBe(true);
    expect(isPrivateAddress("1.2.3", 4)).toBe(true);
    expect(isPrivateAddress("999.1.1.1", 4)).toBe(true);
  });
});

describe("ownImagesOnly — cross-tenant photo guard", () => {
  const me = "2126979f-4942-494c-be6c-0c33d33b4ada";
  const them = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("keeps my own photos", () => {
    const mine = `${me}/V1StGXR8Z5jdHi6B.webp`;
    expect(ownImagesOnly([mine], me)).toEqual([mine]);
  });

  it("drops another user's path", () => {
    expect(ownImagesOnly([`${them}/V1StGXR8Z5jdHi6B.webp`], me)).toEqual([]);
  });

  it("drops traversal and absolute paths", () => {
    expect(
      ownImagesOnly(
        [
          `${me}/../${them}/x.webp`,
          `/${me}/x.webp`,
          `${me}/sub/dir/x.webp`,
          "https://evil.test/x.webp",
          `${me}/x.svg`,
          `${me}/x`,
        ],
        me,
      ),
    ).toEqual([]);
  });

  it("drops a path that merely starts with my id", () => {
    expect(ownImagesOnly([`${me}extra/V1StGXR8Z5jdHi6B.webp`], me)).toEqual([]);
  });
});

describe("callerIp — not forgeable by the client", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://x.test", { headers });

  it("prefers the platform header over anything the client sent", () => {
    expect(
      callerIp(
        req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2", "x-vercel-forwarded-for": "9.9.9.9" }),
      ),
    ).toBe("9.9.9.9");
  });

  it("takes the RIGHTMOST forwarded entry, not the client-supplied leftmost", () => {
    // A client sending "X-Forwarded-For: <random>" must not get a fresh bucket.
    expect(callerIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("falls back cleanly with no headers at all", () => {
    expect(callerIp(req({}))).toBe("unknown");
  });
});

describe("model URLs are restricted to http(s)", () => {
  it("drops a javascript: url rather than rendering it as a link", () => {
    const r = pricingResult.parse({
      materials: [
        { name: "x", unitPrice: 1, retailer: "r", url: "javascript:alert(1)" },
        { name: "y", unitPrice: 1, retailer: "r", url: "data:text/html,<script>" },
        { name: "z", unitPrice: 1, retailer: "r", url: "https://homedepot.com/p/1" },
      ],
    });
    expect(r.materials[0]!.url).toBeNull();
    expect(r.materials[1]!.url).toBeNull();
    expect(r.materials[2]!.url).toBe("https://homedepot.com/p/1");
  });

  it("does the same for comps", () => {
    const r = compsResult.parse({
      comps: [
        { title: "t", price: 1, sold: true, marketplace: "eBay", url: "javascript:alert(1)" },
      ],
    });
    expect(r.comps[0]!.url).toBeNull();
  });
});

describe("rateLimit — the spend ceiling", () => {
  it("allows up to the limit then blocks with a readable message", async () => {
    const scope = `test-${Math.random()}`;
    const max = LIMITS.generate.max;
    for (let i = 0; i < max; i++) {
      const r = await rateLimit(scope, "generate");
      expect(r.ok).toBe(true);
    }
    const blocked = await rateLimit(scope, "generate");
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/hourly limit/i);
    expect(blocked.message).toMatch(/nothing you've made is lost/i);
  });

  it("keeps separate buckets per scope, so one user can't exhaust another", async () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    for (let i = 0; i < LIMITS.reprice.max; i++) await rateLimit(a, "reprice");
    expect((await rateLimit(a, "reprice")).ok).toBe(false);
    expect((await rateLimit(b, "reprice")).ok).toBe(true);
  });

  it("keeps separate buckets per limit name", async () => {
    const scope = `mix-${Math.random()}`;
    for (let i = 0; i < LIMITS.generate.max; i++) await rateLimit(scope, "generate");
    expect((await rateLimit(scope, "generate")).ok).toBe(false);
    expect((await rateLimit(scope, "upload")).ok).toBe(true);
  });
});
