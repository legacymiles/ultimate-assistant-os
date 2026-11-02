import { describe, expect, it } from "vitest";
import { isShortcutLink } from "./iphoneShortcut";

/*
 * The guide only offers a tappable "Add the Shortcut" button for a link iOS
 * can actually install. Anything else — a shortened link, a Drive file, a
 * typo, a lookalike host — has to fall back to the hand-build, because a
 * button that opens a dead end is worse than no button.
 */
describe("isShortcutLink", () => {
  const real = "https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef";

  it("accepts the link Shortcuts hands out", () => {
    expect(isShortcutLink(real)).toBe(true);
  });

  it("accepts it with a trailing slash, with no www, and pasted with spaces around it", () => {
    expect(isShortcutLink(`${real}/`)).toBe(true);
    expect(isShortcutLink("https://icloud.com/shortcuts/0123456789abcdef")).toBe(true);
    expect(isShortcutLink(`  ${real}  `)).toBe(true);
  });

  it("refuses a host that only looks like Apple's", () => {
    expect(isShortcutLink("https://icloud.com.example.test/shortcuts/0123456789abcdef")).toBe(false);
    expect(isShortcutLink("https://noticloud.com/shortcuts/0123456789abcdef")).toBe(false);
  });

  it("refuses plain http, since the install would be refused anyway", () => {
    expect(isShortcutLink(real.replace("https:", "http:"))).toBe(false);
  });

  it("refuses the Shortcuts pages that are not an installable Shortcut", () => {
    expect(isShortcutLink("https://www.icloud.com/shortcuts/")).toBe(false);
    expect(isShortcutLink("https://www.icloud.com/shortcuts")).toBe(false);
    expect(isShortcutLink("https://www.icloud.com/iclouddrive/0123456789abcdef")).toBe(false);
  });

  it("refuses an id that isn't one", () => {
    // Apple's ids are hex; a path that is words is someone's guess at a URL.
    expect(isShortcutLink("https://www.icloud.com/shortcuts/send-to-jarvis")).toBe(false);
  });

  it("refuses nothing at all, which is the unset state", () => {
    expect(isShortcutLink("")).toBe(false);
    expect(isShortcutLink("   ")).toBe(false);
    expect(isShortcutLink("paste the link here")).toBe(false);
  });
});
