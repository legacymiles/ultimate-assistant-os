import { describe, expect, it } from "vitest";
import { PIN_GUIDES, detectPlatform, installRoute, isAppFullscreen, isInstalledDisplay } from "./device";

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

describe("detectPlatform", () => {
  it("reads Android and iPhone from the user agent", () => {
    expect(detectPlatform(ANDROID_CHROME, 5)).toBe("android");
    expect(detectPlatform(IPHONE, 5)).toBe("ios");
  });

  it("treats a Mac with a touchscreen as the iPad it is", () => {
    expect(detectPlatform(IPAD_AS_MAC, 5)).toBe("ios");
    expect(detectPlatform(IPAD_AS_MAC, 0)).toBe("desktop");
  });

  it("calls everything else a computer", () => {
    expect(detectPlatform(WINDOWS, 0)).toBe("desktop");
    expect(detectPlatform("", 0)).toBe("desktop");
  });
});

describe("isInstalledDisplay", () => {
  const only = (q: string) => (query: string) => query === q;

  it("is installed in any app display mode", () => {
    expect(isInstalledDisplay(only("(display-mode: fullscreen)"), undefined)).toBe(true);
    expect(isInstalledDisplay(only("(display-mode: standalone)"), undefined)).toBe(true);
  });

  it("trusts iOS's own standalone flag", () => {
    expect(isInstalledDisplay(() => false, true)).toBe(true);
  });

  it("is a tab otherwise", () => {
    expect(isInstalledDisplay(only("(display-mode: browser)"), false)).toBe(false);
  });
});

describe("installRoute", () => {
  it("says nothing more once it is installed", () => {
    expect(installRoute("android", true, true)).toEqual({ kind: "installed" });
  });

  it("uses the browser's own prompt when there is one", () => {
    expect(installRoute("android", false, true)).toEqual({ kind: "prompt" });
  });

  it("points Safari at Share, because Safari never prompts", () => {
    const r = installRoute("ios", false, false);
    expect(r.kind).toBe("manual");
    expect(r.kind === "manual" && r.steps).toMatch(/Add to Home Screen/);
  });
});

describe("PIN_GUIDES", () => {
  it("names each phone's own lock", () => {
    expect(PIN_GUIDES.android.name).toBe("Screen Pinning");
    expect(PIN_GUIDES.ios.name).toBe("Guided Access");
  });
});

describe("isAppFullscreen", () => {
  const only = (q: string) => (query: string) => query === q;

  it("is true only when the installed app already fills the screen", () => {
    expect(isAppFullscreen(only("(display-mode: fullscreen)"), undefined)).toBe(true);
    expect(isAppFullscreen(() => false, true)).toBe(true);
  });

  it("is false in a tab and in a standalone window, which still need browser fullscreen", () => {
    expect(isAppFullscreen(only("(display-mode: browser)"), false)).toBe(false);
    expect(isAppFullscreen(only("(display-mode: standalone)"), false)).toBe(false);
  });
});
