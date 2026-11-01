import { describe, expect, it } from "vitest";
import { fixFor, routeForFix } from "./errorFix";

// The exact sentences tools/jarvis-bridge/brain.mjs produces.
const SIGNED_OUT =
  "Claude isn't signed in on this PC. Open Claude Code (type `claude` in a terminal), sign in with your Claude account using /login, then try again.";
const NOT_INSTALLED =
  "Claude Code isn't installed on this PC. Install it from claude.com/code, sign in with your Claude account, then try again.";
const LIMIT =
  "You've reached your Claude plan's usage limit for now. It resets on its own — or switch Jarvis's brain to a cloud model (like DeepSeek) until then.";

describe("fixFor", () => {
  it("sends a signed-out owner to a terminal running Claude Code", () => {
    const fix = fixFor(SIGNED_OUT);
    expect(fix?.kind).toBe("launch");
    expect(fix?.target).toBe("cmd.exe");
  });

  it("keeps the terminal open, or there is nowhere to type /login", () => {
    // /c runs the command and closes: a flash of text and no login.
    expect(fixFor(SIGNED_OUT)?.args).toEqual(["/k", "claude"]);
  });

  it("sends an owner without Claude Code to the download page", () => {
    const fix = fixFor(NOT_INSTALLED);
    expect(fix?.kind).toBe("url");
    expect(fix?.target).toBe("https://claude.com/code");
  });

  it("does not send someone to a terminal for a program they do not have", () => {
    // Both sentences say "sign in". If the signed-out rule were checked first,
    // this one would open a terminal and run a command that does not exist.
    expect(fixFor(NOT_INSTALLED)?.kind).toBe("url");
  });

  it("offers nothing when there is nothing useful to offer", () => {
    // A button that just retries is noise beside an error that says to retry.
    expect(fixFor(LIMIT)).toBeNull();
    expect(fixFor("Claude is very busy right now. Try again in a minute.")).toBeNull();
    expect(fixFor("Stopped.")).toBeNull();
    expect(fixFor("")).toBeNull();
  });

  it("does not care about case or surrounding text", () => {
    expect(fixFor(`Step failed: ${SIGNED_OUT.toUpperCase()}`)?.kind).toBe("launch");
  });

  it("always says what is left for the owner to do", () => {
    // The button cannot finish the job — it can only remove the hunting.
    expect(fixFor(SIGNED_OUT)?.then).toContain("/login");
    expect(fixFor(NOT_INSTALLED)?.then).toContain("sign in");
  });
});

describe("routeForFix", () => {
  it("launches through the PC, opens pages through the browser", () => {
    expect(routeForFix(fixFor(SIGNED_OUT)!)).toEqual({
      route: "system/launch",
      args: { target: "cmd.exe", args: ["/k", "claude"] },
    });
    expect(routeForFix(fixFor(NOT_INSTALLED)!)).toEqual({
      route: "browser/open",
      args: { url: "https://claude.com/code" },
    });
  });
});
