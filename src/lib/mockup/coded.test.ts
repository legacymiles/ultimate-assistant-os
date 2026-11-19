import { describe, expect, it } from "vitest";

import { cleanMockupHtml, codedKey, codedUser, coerceCodedRequest, mockupMeta, trimMarkup, type CodedRequest } from "./coded";

const doc = `<!doctype html><html><head><meta name="mockup-label" content="Navy hero"><meta name="mockup-reading" content="The hero turns navy #0b1b3a with a white headline."><style>body{margin:0}</style></head><body><h1>Bloom</h1></body></html>`;

describe("coded mockups — the answer", () => {
  it("takes the document out of fences and chatter", () => {
    expect(cleanMockupHtml(`Here you go:\n\`\`\`html\n${doc}\n\`\`\`\nEnjoy`)).toBe(doc);
  });

  it("unwraps an answer that came back as a JSON move", () => {
    expect(cleanMockupHtml(JSON.stringify({ answer: doc }))).toBe(doc);
  });

  it("strips scripts, handlers, frames, refreshes and javascript: links", () => {
    const bad = `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://x.test"><script>alert(1)</script></head><body onload="x()"><a href="javascript:alert(1)" onclick='y()'>a</a><iframe src="https://x.test"></iframe><img src=x onerror=alert(1)></body></html>`;
    const out = cleanMockupHtml(bad);
    expect(out).not.toMatch(/<script|onload|onclick|onerror|javascript:|<iframe|refresh/i);
    expect(out).toContain("<a href=\"#\">a</a>");
  });

  it("is empty when there is no document", () => {
    expect(cleanMockupHtml("Sorry, I can't do that.")).toBe("");
  });

  it("reads the label and the reading Claude left in the head", () => {
    expect(mockupMeta(doc)).toEqual({ label: "Navy hero", reading: "The hero turns navy #0b1b3a with a white headline." });
    expect(mockupMeta("<html></html>")).toEqual({ label: "", reading: "" });
    // Either quote style, holding the other one inside it.
    const mixed = `<meta name='mockup-reading' content='The "Shop" button turns red'><meta content="the page's hero" name="mockup-label">`;
    expect(mockupMeta(mixed)).toEqual({ label: "the page's hero", reading: 'The "Shop" button turns red' });
  });
});

describe("coded mockups — the request", () => {
  const edit: CodedRequest = { kind: "edit", edit: "Make the hero dark navy", lane: "bold", siteName: "Bloom", url: "https://bloom.test", device: "phone", markup: "<h1>Bloom</h1>" };

  it("an edit asks for the real page with only the change made, at the device width", () => {
    const u = codedUser(edit);
    expect(u).toContain("Make the hero dark navy");
    expect(u).toContain("390px wide");
    expect(u).toContain("<page_markup>");
    expect(u).toMatch(/Recreate the page faithfully/);
  });

  it("a reading written in chat replaces the lane's role", () => {
    const u = codedUser({ ...edit, reading: { label: "Navy hero", instruction: "Navy #0b1b3a hero" } });
    expect(u).toContain("Navy #0b1b3a hero");
    expect(u).not.toContain('This version is "Bold"');
  });

  it("a tweak carries the current page and the change", () => {
    const u = codedUser({ kind: "tweak", html: doc, change: "make the button green", siteName: "Bloom", device: "desktop" });
    expect(u).toContain("make the button green");
    expect(u).toContain("<current_mockup>");
  });

  it("the cache key ignores the markup but not the change", () => {
    expect(codedKey(edit)).toBe(codedKey({ ...edit, markup: "<h1>different nonce</h1>" }));
    expect(codedKey(edit)).not.toBe(codedKey({ ...edit, edit: "Make the hero white" }));
  });

  it("checks a request from the browser: known kinds and lanes only", () => {
    expect(coerceCodedRequest({ kind: "edit", edit: "x", lane: "nope" })).toBeNull();
    expect(coerceCodedRequest({ kind: "shell", command: "rm" })).toBeNull();
    const ok = coerceCodedRequest({ ...edit, url: "javascript:alert(1)" });
    expect(ok && ok.kind === "edit" && ok.url).toBeFalsy();
    expect(coerceCodedRequest({ kind: "tweak", html: doc, change: "" })).toBeNull();
  });
});

describe("coded mockups — reading the page", () => {
  it("keeps the content and classes, drops scripts and noise, and makes addresses absolute", () => {
    const html = `<html><head><title>Bloom</title><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"><style>/* c */ body { color: #123 }</style><script>x</script></head><body><!-- c --><nav class="nav"><a href="/shop" data-x="1">Shop</a></nav><svg><path d="M0 0L9 9"/></svg><img src="/hero.jpg" srcset="a 1x"><script>track()</script></body></html>`;
    const out = trimMarkup(html, "https://bloom.test/");
    expect(out).toContain("<title>Bloom</title>");
    expect(out).toContain("fonts.googleapis.com");
    expect(out).toContain("<style>body { color: #123 }</style>");
    expect(out).toContain('href="https://bloom.test/shop"');
    expect(out).toContain('src="https://bloom.test/hero.jpg"');
    expect(out).not.toMatch(/<script|track\(\)|data-x|srcset|M0 0/);
  });
});
