import { describe, expect, it } from "vitest";
import { ago, detectDevice, syncPlan, type SyncStatusReport } from "./syncSteps";

const NOW = Date.parse("2026-10-17T01:00:00Z");
const min = (m: number) => new Date(NOW - m * 60_000).toISOString();
const ORIGIN = "https://ultimate-assistant-os.vercel.app";

const base = (over: Partial<SyncStatusReport> = {}): SyncStatusReport => ({
  server: { ready: true, missing: [] },
  account: { signedIn: true, userId: "u-1", matchesConnector: true },
  skills: { count: 107 },
  connector: { lastSeen: min(5), clients: { "claude-code": min(5), "claude-ai": min(120) } },
  devices: [{ host: "honeysuites", os: "Windows", lastSeen: min(3), lastAction: "pull", skillCount: 107 }],
  ...over,
});

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
};

describe("which device the page is open on", () => {
  it("tells phones from computers, including an iPad posing as a Mac", () => {
    expect(detectDevice(UA.iphone)).toBe("phone");
    expect(detectDevice(UA.android)).toBe("phone");
    expect(detectDevice(UA.windows)).toBe("windows");
    expect(detectDevice(UA.mac)).toBe("mac");
    expect(detectDevice(UA.mac, 5)).toBe("phone");
    expect(detectDevice(UA.linux)).toBe("linux");
  });
});

describe("overall state", () => {
  it("is fully set up when server, account, connector and a computer are all live", () => {
    const p = syncPlan(base(), "windows", ORIGIN, NOW);
    expect(p.state).toBe("ready");
    expect(p.steps.every((s) => s.done)).toBe(true);
    expect(p.steps.find((s) => s.id === "computers")!.detail).toMatch(/honeysuites \(Windows, 3 min ago\)/);
  });

  it("is NOT set up when Vercel is missing keys — and says which, on every device", () => {
    const r = base({ server: { ready: false, missing: [{ env: "JARVIS_MCP_TOKEN", how: "" }, { env: "JARVIS_MCP_USER_ID", how: "" }] } });
    const desk = syncPlan(r, "windows", ORIGIN, NOW);
    expect(desk.state).toBe("not-set-up");
    expect(desk.here.title).toMatch(/Vercel/);
    expect(desk.here.detail).toMatch(/JARVIS_MCP_TOKEN, JARVIS_MCP_USER_ID/);
    const phone = syncPlan(r, "phone", ORIGIN, NOW);
    expect(phone.here.title).toBe("Finish this on a computer");
  });

  it("is partial when no computer has synced, and the step says so", () => {
    const p = syncPlan(base({ devices: [] }), "mac", ORIGIN, NOW);
    expect(p.state).toBe("partial");
    expect(p.headline).toMatch(/1 step left/);
    expect(p.steps.find((s) => s.id === "computers")!.detail).toMatch(/No computer has synced yet/);
  });

  it("flags a computer that went quiet for two weeks", () => {
    const old = base({ devices: [{ host: "vps-01", os: "Windows", lastSeen: min(60 * 24 * 20), lastAction: "pull", skillCount: 3 }] });
    const s = syncPlan(old, "windows", ORIGIN, NOW).steps.find((x) => x.id === "computers")!;
    expect(s.done).toBe(false);
    expect(s.detail).toMatch(/vps-01, 20 days ago/);
  });

  it("catches the connector writing into a different account", () => {
    const p = syncPlan(base({ account: { signedIn: true, userId: "me-123", matchesConnector: false } }), "phone", ORIGIN, NOW);
    expect(p.state).toBe("partial");
    expect(p.here.title).toMatch(/account/);
    expect(p.here.copy).toBe("me-123");
  });
});

describe("the next step for THIS device", () => {
  it("phone, connector never used: one URL to paste in claude.ai", () => {
    const p = syncPlan(base({ connector: null }), "phone", ORIGIN, NOW);
    expect(p.here.done).toBe(false);
    expect(p.here.copy).toBe(`${ORIGIN}/api/jarvis/memory/mcp?k=YOUR_TOKEN`);
  });
  it("phone, connector live: nothing to do, says how to make a skill", () => {
    const p = syncPlan(base(), "phone", ORIGIN, NOW);
    expect(p.here.done).toBe(true);
    expect(p.here.detail).toMatch(/make me a skill/);
  });
  it("computer: the setup command in the right shell, and which computers already sync", () => {
    const win = syncPlan(base(), "windows", ORIGIN, NOW).here;
    expect(win.copy).toBe("npm run skills:setup -- --token YOUR_TOKEN");
    expect(win.detail).toMatch(/PowerShell/);
    expect(win.detail).toMatch(/honeysuites/);
    expect(syncPlan(base(), "mac", ORIGIN, NOW).here.detail).toMatch(/Terminal/);
  });
});

describe("ago", () => {
  it("reads naturally", () => {
    expect(ago(min(0.5), NOW)).toBe("just now");
    expect(ago(min(45), NOW)).toBe("45 min ago");
    expect(ago(min(180), NOW)).toBe("3 h ago");
    expect(ago("nope", NOW)).toBe("never");
  });
});
