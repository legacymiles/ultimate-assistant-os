import { describe, expect, it } from "vitest";
import {
  MAX_ENTRIES,
  agentLabel,
  cleanUrl,
  coerceReport,
  fingerprint,
  isNoise,
  record,
  recentOpen,
  resolve,
  toCollect,
  type ErrorLog,
  type ErrorReport,
} from "./log";

const now = new Date("2026-10-18T20:00:00Z");
const rep = (over: Partial<ErrorReport> = {}): ErrorReport => ({
  site: "hub",
  kind: "error",
  message: "Cannot read properties of undefined (reading 'items')",
  stack: "TypeError: x\n    at Deck (webpack-internal:///./src/components/new-jarvis/Deck.tsx:120:14)",
  url: "/apps/jarvis",
  ...over,
});

describe("fingerprint", () => {
  it("is the same crash whatever the ids, numbers and line numbers", () => {
    const a = fingerprint(rep({ message: "Order 1234 failed for 'abc'", stack: "E\n at f (src/a.ts:10:2)" }));
    const b = fingerprint(rep({ message: "Order 98 failed for 'zzz'", stack: "E\n at f (src/a.ts:77:9)" }));
    expect(a).toBe(b);
  });
  it("differs by site and by message", () => {
    expect(fingerprint(rep())).not.toBe(fingerprint(rep({ site: "barber-site" })));
    expect(fingerprint(rep())).not.toBe(fingerprint(rep({ message: "something else broke" })));
  });
});

describe("record", () => {
  it("folds repeats into one entry with a count", () => {
    let log: ErrorLog = { entries: [] };
    for (let i = 0; i < 3; i++) log = record(log, rep({ url: `/apps/jarvis/${i}` }), now).log;
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].count).toBe(3);
    expect(log.entries[0].urls).toHaveLength(3);
  });
  it("a repeat after 'fixed' re-opens it", () => {
    let log = record({ entries: [] }, rep(), now).log;
    log = resolve(log, log.entries[0].id, now);
    expect(recentOpen(log, now)).toHaveLength(0);
    log = record(log, rep(), now).log;
    expect(recentOpen(log, now)).toHaveLength(1);
  });
  it("never grows past the cap", () => {
    let log: ErrorLog = { entries: [] };
    for (let i = 0; i < MAX_ENTRIES + 20; i++) log = record(log, rep({ message: `distinct failure ${"x".repeat(i % 7)} kind ${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}x` , stack: `E\n at f (src/f${i}.ts:1:1)` }), now).log;
    expect(log.entries.length).toBeLessThanOrEqual(MAX_ENTRIES);
  });
});

describe("coerceReport and noise", () => {
  it("bounds and cleans what arrives", () => {
    const r = coerceReport({ message: "x".repeat(2_000), site: "<script>", url: "https://a.com/p/abcdefghijklmnopqrstuvwxyz123?token=secret", kind: "weird" });
    expect(r?.message.length).toBe(500);
    expect(r?.site).toBe("script");
    expect(r?.url).toBe("a.com/p/:id");
    expect(r?.kind).toBe("error");
    expect(coerceReport({ message: "  " })).toBeNull();
    expect(coerceReport(null)).toBeNull();
  });
  it("drops noise no one can act on, keeps real errors that mention extensions", () => {
    expect(isNoise({ message: "Script error." })).toBe(true);
    expect(isNoise({ message: "ResizeObserver loop completed with undelivered notifications." })).toBe(true);
    expect(isNoise({ message: "boom", stack: "Error: boom\n at x (chrome-extension://abc/content.js:1:1)" })).toBe(true);
    expect(isNoise({ message: "File extension .heic is not supported" })).toBe(false);
  });
  it("cleanUrl strips queries from relative paths too", () => {
    expect(cleanUrl("/apps/client-review?site=supersecret")).toBe("/apps/client-review");
  });
});

describe("toCollect", () => {
  it("gives super-collect id, title, body, url and count for open errors only", () => {
    let log = record({ entries: [] }, rep(), now).log;
    log = record(log, rep({ message: "another one" }), now).log;
    log = resolve(log, log.entries[0].id, now);
    const out = toCollect(log, "https://ultimate-assistant-os.vercel.app");
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ count: 1 });
    expect(out.items[0].title).toMatch(/^\[hub\]/);
    expect(out.items[0].body).toContain("Checklist: R2");
  });
});

it("agentLabel is short", () => {
  expect(agentLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Mobile Safari/604.1")).toBe("iPhone Safari");
  expect(agentLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36 Edg/130")).toBe("Windows Edge");
});
