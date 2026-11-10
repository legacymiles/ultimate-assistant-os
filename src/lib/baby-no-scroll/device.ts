// ---------------------------------------------------------------------------
// Which phone is this, and is the app already running as an app?
//
// The two things a web page cannot stop are the phone's own: the swipe down
// from the top (which in a Chrome tab ends fullscreen and says "swipe down to
// exit"), and the swipe home or into the app switcher. Two steps take them
// away, and both depend on the device:
//
//   1. Install the page as an app. It then opens with no address bar, no tabs
//      and no "swipe down to exit" message at all — there is no browser
//      fullscreen to leave, because the app is the whole screen.
//   2. Pin it, with the phone's own lock: Screen Pinning on Android, Guided
//      Access on an iPhone or iPad. That is what makes the swipes do nothing.
//
// This file only answers the questions the setup screen needs to say the right
// steps. It is pure so it can be tested without a browser.
// ---------------------------------------------------------------------------

export type Platform = "android" | "ios" | "desktop";

/**
 * iPadOS reports itself as a Mac, so a "Macintosh" with a touchscreen is an
 * iPad. Every other check is the user agent, which is the only signal there is.
 */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  const ua = userAgent.toLowerCase();
  if (ua.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (ua.includes("macintosh") && maxTouchPoints > 1) return "ios";
  return "desktop";
}

/**
 * Whether the page is running as an installed app rather than in a tab. The
 * display-mode media query covers Android and desktop; iOS only exposes the
 * old `navigator.standalone` flag.
 */
export function isInstalledDisplay(
  matches: (query: string) => boolean,
  iosStandalone: boolean | undefined,
): boolean {
  if (iosStandalone) return true;
  return (
    matches("(display-mode: fullscreen)")
    || matches("(display-mode: standalone)")
    || matches("(display-mode: minimal-ui)")
  );
}

/**
 * Whether the installed app already owns the whole screen. In that mode the
 * page must NOT ask for browser fullscreen as well: Chrome treats that as a
 * tab going fullscreen and puts "swipe down to exit" right back on screen —
 * the very message installing it was meant to remove. An iPhone home-screen
 * app counts too: it has no fullscreen to ask for.
 */
export function isAppFullscreen(
  matches: (query: string) => boolean,
  iosStandalone: boolean | undefined,
): boolean {
  return !!iosStandalone || matches("(display-mode: fullscreen)");
}

export interface PinGuide {
  /** The phone's own name for its lock. */
  name: string;
  /** Turn it on, once, in Settings. */
  setup: string[];
  /** Start it, every time, with the app open. */
  start: string;
  /** How a parent gets back out. */
  leave: string;
  /** What stops working while it is on. */
  blocks: string;
}

export const PIN_GUIDES: Record<Platform, PinGuide> = {
  android: {
    name: "Screen Pinning",
    setup: [
      "Settings → Security & privacy → More security settings → App pinning, and turn it on.",
      "Turn on Ask for PIN before unpinning, so a lucky swipe cannot undo it.",
    ],
    start:
      "Open Baby No Scroll, swipe up and hold to see your recent apps, tap the app's icon above its card, then Pin.",
    leave: "Swipe up and hold (or hold Back and Overview together), then enter your PIN.",
    blocks: "The swipe down from the top, the notification shade, home and the app switcher.",
  },
  ios: {
    name: "Guided Access",
    setup: [
      "Settings → Accessibility → Guided Access, and turn it on.",
      "Passcode Settings → Set Guided Access Passcode.",
    ],
    start: "Open Baby No Scroll and triple-click the side (or top) button, then Start.",
    leave: "Triple-click the side button and enter the passcode.",
    blocks: "The swipe home, Control Center, notifications and every other app.",
  },
  desktop: {
    name: "the keyboard lock",
    setup: [
      "Use Chrome or Edge. While the screen is locked they hand every key to the page — Alt+Tab, the Windows key and Escape included.",
    ],
    start: "Nothing to start: it is on whenever the locked screen is in fullscreen.",
    leave: "The padlock — or hold Escape for two seconds, which is the browser's own way out.",
    blocks: "Every key and shortcut a palm or a forearm can land on.",
  },
};

export type InstallRoute =
  | { kind: "installed" }
  | { kind: "prompt" }
  | { kind: "manual"; steps: string };

/**
 * How this device gets the app onto its home screen. Chrome on Android and on
 * a computer can show its own install prompt; Safari never can, and has to be
 * told where the menu item is.
 */
export function installRoute(
  platform: Platform,
  installed: boolean,
  canPrompt: boolean,
): InstallRoute {
  if (installed) return { kind: "installed" };
  if (canPrompt) return { kind: "prompt" };
  if (platform === "ios") {
    return {
      kind: "manual",
      steps: "In Safari, tap Share, then Add to Home Screen, then open it from the new icon.",
    };
  }
  if (platform === "android") {
    return {
      kind: "manual",
      steps: "In Chrome, tap the ⋮ menu, then Add to Home screen → Install, then open it from the new icon.",
    };
  }
  return {
    kind: "manual",
    steps: "In Chrome or Edge, use the install icon at the right of the address bar.",
  };
}
