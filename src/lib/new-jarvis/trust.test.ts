import { describe, expect, it } from "vitest";
import { classify, type BridgeOp } from "./actions";
import { alwaysAsk, describeKind, escalate, gateKind, importantAsk, needsGate, type Trust } from "./trust";

// What is being protected here, in both directions at once:
//
//   the complaint — a build that writes eleven files and runs six commands
//   must cost ZERO taps, because a gate that fires per step is a gate nobody
//   reads by step four;
//
//   the line — no level, no remembered yes, and no amount of clicking can put
//   money, sending, or deleting on the quiet path.
//
// Every test below is one of those two, so a future loosening that breaks the
// second one fails here rather than in someone's bank account.

const op = (route: string, args: Record<string, unknown> = {}): BridgeOp => ({ route, args });
const asks = (o: BridgeOp, trust: Trust, allowed: string[] = []) =>
  needsGate(o, classify({ route: o.route, args: o.args }), { trust, allowed });

describe("alwaysAsk — the core that every level obeys", () => {
  it("stops money and anything sent in the owner's name", () => {
    expect(alwaysAsk(op("browser/click", { name: "Place order" }))).toBe(true);
    expect(alwaysAsk(op("browser/click", { name: "Pay $240.00" }))).toBe(true);
    expect(alwaysAsk(op("browser/click", { name: "Send" }))).toBe(true);
    expect(alwaysAsk(op("browser/click", { name: "Publish post" }))).toBe(true);
    // A submit into something that SENDS. The same call into a search box is
    // not one, and is the first thing the browser suite below checks.
    expect(alwaysAsk(op("browser/type", { name: "message", value: "hi", submit: true }))).toBe(true);
    expect(alwaysAsk(op("browser/type", { name: "search", value: "hi", submit: true }))).toBe(false);
  });

  it("stops destroying things from the shell, wherever it hides in the line", () => {
    expect(alwaysAsk(op("shell", { command: "rm -rf build" }))).toBe(true);
    expect(alwaysAsk(op("shell", { command: "npm run build && Remove-Item -Recurse dist" }))).toBe(true);
    expect(alwaysAsk(op("shell", { command: "git push origin main" }))).toBe(true);
    expect(alwaysAsk(op("shell", { command: "npm publish" }))).toBe(true);
    expect(alwaysAsk(op("shell", { command: "git reset --hard HEAD~3" }))).toBe(true);
  });

  it("stops replacing a note the owner already wrote, and only then", () => {
    expect(alwaysAsk(op("vault/write", { path: "Notes/a.md", overwrite: true }))).toBe(true);
    expect(alwaysAsk(op("vault/write", { path: "Notes/a.md" }))).toBe(false);
  });

  it("stops the one path that handles values nothing else has seen", () => {
    expect(alwaysAsk(op("hub/record_capture", { map: { card: "4111…" } }))).toBe(true);
  });

  it("stops a write that reaches for secrets, and lets ordinary files through", () => {
    expect(alwaysAsk(op("files/write", { path: "C:/dev/app/.env.local" }))).toBe(true);
    expect(alwaysAsk(op("files/write", { path: "C:/Users/honey/.claude/settings.json" }))).toBe(true);
    expect(alwaysAsk(op("files/write", { path: "C:/dev/app/src/page.tsx" }))).toBe(false);
  });

  it("does not fire on the ordinary clicks a job makes dozens of", () => {
    // These ARE in actions.ts's irreversible list, and that is correct for a
    // summary. They are not money and they are not outward, so they must not
    // be in the list that no setting can turn off.
    expect(alwaysAsk(op("browser/click", { name: "Confirm" }))).toBe(false);
    expect(alwaysAsk(op("browser/click", { name: "Accept" }))).toBe(false);
    expect(alwaysAsk(op("browser/click", { name: "Sign up" }))).toBe(false);
    expect(alwaysAsk(op("browser/click", { name: "Next" }))).toBe(false);
  });

  it("does not even show the generic ones on Trusted", () => {
    for (const name of ["Confirm", "Continue", "Next", "OK", "Approve", "Apply filters"]) {
      expect(importantAsk(op("browser/click", { name }))).toBe(false);
    }
  });
});

describe("needsGate — the complaint", () => {
  const build: BridgeOp[] = [
    op("files/write", { path: "C:/dev/app/src/page.tsx" }),
    op("files/write", { path: "C:/dev/app/src/lib/db.ts" }),
    op("shell", { command: "npm run build" }),
    op("shell", { command: "git add -A" }),
    op("shell", { command: "git commit -m 'it works'" }),
    op("hub/lists_add_item", { list: "To-Do", text: "ship it" }),
    op("hub/dashboard_add_note", { title: "notes" }),
    op("vault/append", { path: "Notes/log.md" }),
  ];

  it("asks for every one of them on Ask, which is what the owner was living with", () => {
    expect(build.filter((o) => asks(o, "ask")).length).toBe(build.length);
  });

  it("asks for NONE of them on Trusted", () => {
    expect(build.filter((o) => asks(o, "trusted"))).toEqual([]);
  });

  it("asks for none of them on Auto either", () => {
    expect(build.filter((o) => asks(o, "auto"))).toEqual([]);
  });

  it("never gates a read, at any level", () => {
    for (const trust of ["ask", "trusted", "auto"] as Trust[]) {
      expect(asks(op("files/read", { path: "a.ts" }), trust)).toBe(false);
      expect(asks(op("browser/read"), trust)).toBe(false);
      expect(asks(op("vault/scan"), trust)).toBe(false);
    }
  });
});

// The second complaint, and the reason this file got a second pass: Trusted
// still stopped on ordinary browsing. classify() calls a click grave on any of
// a long list of words — confirm, accept, apply, register — and gating on
// "grave" meant a browse job was interrupted every few steps.
describe("needsGate — driving the browser", () => {
  const browse: BridgeOp[] = [
    op("browser/open", { url: "https://example.test" }),
    op("browser/read"),
    op("browser/click", { name: "Confirm" }),
    op("browser/click", { name: "Continue" }),
    op("browser/click", { name: "Next" }),
    op("browser/click", { name: "Approve" }),
    op("browser/click", { name: "Apply filters" }),
    op("browser/type", { name: "search", value: "cheap flights", submit: true }),
    op("browser/press", { key: "Enter" }),
    op("browser/type", { name: "postcode", value: "SW1A 1AA" }),
    op("browser/scroll", { direction: "down" }),
    op("browser/screenshot"),
  ];

  it("gets through a whole browse job on Trusted without one tap", () => {
    expect(browse.filter((o) => asks(o, "trusted"))).toEqual([]);
  });

  it("searches without asking — a search box is a submit, and that is not a reason to stop", () => {
    expect(asks(op("browser/type", { name: "search", value: "x", submit: true }), "trusted")).toBe(false);
    expect(asks(op("browser/type", { name: "q", value: "x", submit: true }), "auto")).toBe(false);
  });

  it("still stops before something is actually sent", () => {
    for (const trust of ["ask", "trusted", "auto"] as Trust[]) {
      expect(asks(op("browser/type", { name: "message", value: "hi", submit: true }), trust)).toBe(true);
      expect(asks(op("browser/type", { name: "To", value: "sam@example.test", submit: true }), trust)).toBe(true);
      expect(asks(op("browser/click", { name: "Send message" }), trust)).toBe(true);
      expect(asks(op("browser/click", { name: "Pay now" }), trust)).toBe(true);
    }
  });

  it("shows a commitment on Trusted and lets it through on Auto", () => {
    const commitments = [
      op("browser/click", { name: "Sign up" }),
      op("browser/click", { name: "Create account" }),
      op("browser/click", { name: "Book now" }),
      op("browser/click", { name: "I agree to the terms" }),
      op("browser/click", { name: "Authorize" }),
    ];
    for (const o of commitments) {
      expect(importantAsk(o)).toBe(true);
      expect(asks(o, "trusted")).toBe(true);
      expect(asks(o, "auto")).toBe(false);
      // Not the core, so Auto is allowed to pass them — but none of them can
      // be handed a standing yes either.
      expect(alwaysAsk(o)).toBe(false);
      expect(gateKind(o)).toBe("");
    }
  });

  it("asks about every one of them on Ask, which is what that level is for", () => {
    const effects = browse.filter((o) => classify({ route: o.route, args: o.args }).confirm);
    expect(effects.length).toBeGreaterThan(0);
    expect(effects.filter((o) => asks(o, "ask")).length).toBe(effects.length);
  });
});

describe("needsGate — the line", () => {
  const core: BridgeOp[] = [
    op("shell", { command: "rm -rf src" }),
    op("shell", { command: "git push" }),
    op("browser/click", { name: "Place order" }),
    op("browser/type", { name: "tweet", value: "hi", submit: true }),
    op("vault/write", { path: "Notes/a.md", overwrite: true }),
    op("hub/record_capture", { map: { card: "x" } }),
  ];

  it("asks for all of them at every level, Auto included", () => {
    for (const trust of ["ask", "trusted", "auto"] as Trust[]) {
      expect(core.filter((o) => asks(o, trust)).length).toBe(core.length);
    }
  });

  it("cannot be waved through by a remembered yes", () => {
    // Even if the stored list is poisoned with the keys of the core itself.
    const poisoned = ["shell:rm", "shell:git push", "browser/click", "browser/type", "vault/write", "hub/record_capture"];
    for (const trust of ["ask", "trusted", "auto"] as Trust[]) {
      expect(core.filter((o) => asks(o, trust, poisoned)).length).toBe(core.length);
    }
  });

  it("refuses to offer a remembering key for one of them", () => {
    for (const o of core) expect(gateKind(o)).toBe("");
  });

  it("still names an unrecognised route as something to ask about on Trusted", () => {
    // classify() gates an unknown route as an act. On Trusted an act runs —
    // which is the point — so this records the deliberate consequence rather
    // than leaving it to be discovered.
    expect(asks(op("some/new/route"), "ask")).toBe(true);
    expect(asks(op("some/new/route"), "trusted")).toBe(false);
  });
});

describe("gateKind — one yes, the next thirty calls", () => {
  it("carries the verb, so a yes to one git is not a yes to another", () => {
    expect(gateKind(op("shell", { command: "git commit -m x" }))).toBe("shell:git commit");
    expect(gateKind(op("shell", { command: "npm run build" }))).toBe("shell:npm run");
    expect(gateKind(op("shell", { command: "mkdir out" }))).toBe("shell:mkdir");
  });

  it("matches the next call of the same shape", () => {
    const a = op("shell", { command: "git commit -m 'one'" });
    const b = op("shell", { command: "git commit -m 'two, much later'" });
    expect(gateKind(b)).toBe(gateKind(a));
    expect(asks(b, "ask", [gateKind(a)])).toBe(false);
  });

  it("does not match a different shape", () => {
    const yes = gateKind(op("shell", { command: "git commit -m x" }));
    expect(asks(op("shell", { command: "git checkout -f main" }), "ask", [yes])).toBe(true);
  });
});

describe("describeKind — the button has to name something they can picture", () => {
  it("says what the thing is, not what the route is called", () => {
    expect(describeKind("hub/lists_add_item")).toBe("adding things to your lists");
    expect(describeKind("files/write")).toBe("writing files");
    expect(describeKind("shell:git commit")).toBe("git commit commands");
    expect(describeKind("shell:mkdir")).toBe("mkdir commands");
  });

  it("falls back to the route rather than inventing a description for it", () => {
    expect(describeKind("some/new/route")).toBe("some/new/route");
    expect(describeKind("")).toBe("");
  });
});

describe("escalate", () => {
  it("replaces the wrong sentence in front of a destructive command", () => {
    const o = op("shell", { command: "rm -rf build" });
    const plain = classify({ route: o.route, args: o.args });
    expect(plain.risk).toBe("act");
    expect(plain.why).toBe("This runs on your PC as you.");

    const sharp = escalate(o, plain);
    expect(sharp.risk).toBe("grave");
    expect(sharp.why).toMatch(/cannot be undone/i);
    expect(sharp.summary).toBe(plain.summary);
  });

  it("leaves an ordinary command exactly as classified", () => {
    const o = op("shell", { command: "npm run build" });
    const plain = classify({ route: o.route, args: o.args });
    expect(escalate(o, plain)).toEqual(plain);
  });
});
