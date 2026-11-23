import { describe, expect, it } from "vitest";
import { MAX_SVG_BYTES, sanitizeSvg } from "./svg";

describe("sanitizeSvg", () => {
  it("keeps plain vector artwork and reports its aspect", () => {
    const out = sanitizeSvg('<svg viewBox="0 0 200 100"><g fill="#fff"><rect x="0" y="0" width="200" height="100"/><circle cx="50" cy="50" r="20"/></g></svg>');
    expect(out).not.toBeNull();
    expect(out?.aspect).toBe(2);
    expect(out?.svg).toContain("<rect");
    expect(out?.svg).toContain("<circle");
    expect(out?.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out?.svg).toContain('width="200"');
    expect(out?.svg).toContain('height="100"');
  });

  it("strips scripts, event handlers, foreignObject, images, external and data hrefs, and filters", () => {
    const evil = `<?xml version="1.0"?>
      <!DOCTYPE svg [<!ENTITY x "boom">]>
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" onload="alert(1)">
        <script>alert('x')</script>
        <defs>
          <filter id="blur"><feGaussianBlur stdDeviation="5"/></filter>
          <linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>
        </defs>
        <foreignObject width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
        <image href="https://evil.example/x.png" width="10" height="10"/>
        <a href="javascript:alert(1)"><rect width="5" height="5"/></a>
        <use xlink:href="https://evil.example/sprite.svg#icon"/>
        <use href="data:image/svg+xml;base64,PHN2Zz4="/>
        <use href="#shape"/>
        <path id="shape" d="M0 0L10 10" fill="url(#g)" filter="url(#blur)" onclick="steal()"/>
        <rect width="10" height="10" fill="url(https://evil.example/p)" style="filter: blur(4px); fill: red"/>
        <circle r="4" style="background:url(https://evil.example/x)"/>
        <style>@import url(https://evil.example/x.css);</style>
      </svg>`;
    const out = sanitizeSvg(evil);
    expect(out).not.toBeNull();
    const svg = out?.svg ?? "";
    expect(svg).not.toMatch(/script/i);
    expect(svg).not.toMatch(/onload|onclick/i);
    expect(svg).not.toMatch(/foreignObject/i);
    expect(svg).not.toMatch(/<image/i);
    expect(svg).not.toMatch(/evil\.example/);
    expect(svg).not.toMatch(/javascript:/i);
    expect(svg).not.toMatch(/data:/i);
    expect(svg).not.toMatch(/filter|feGaussianBlur|blur/i);
    expect(svg).not.toMatch(/@import|<style/i);
    expect(svg).not.toMatch(/ENTITY|boom/);
    // Internal references survive.
    expect(svg).toContain('href="#shape"');
    expect(svg).toContain('fill="url(#g)"');
    expect(svg).toContain("<linearGradient");
    // The safe half of a style survives.
    expect(svg).toContain('style="fill: red"');
  });

  it("forces a viewBox from width/height, and rejects an svg with neither", () => {
    const out = sanitizeSvg('<svg width="300px" height="150"><path d="M0 0h10"/></svg>');
    expect(out?.svg).toContain('viewBox="0 0 300 150"');
    expect(out?.aspect).toBe(2);
    expect(sanitizeSvg('<svg width="100%"><path d="M0 0h10"/></svg>')).toBeNull();
  });

  it("rejects non-svg input, nothing at all, and oversize documents", () => {
    expect(sanitizeSvg("<html><body>hi</body></html>")).toBeNull();
    expect(sanitizeSvg("")).toBeNull();
    expect(sanitizeSvg(42)).toBeNull();
    const big = `<svg viewBox="0 0 10 10">${"<rect width='1' height='1'/>".repeat(MAX_SVG_BYTES / 20)}</svg>`;
    expect(sanitizeSvg(big)).toBeNull();
  });

  it("escapes text and drops content after the root closes", () => {
    const out = sanitizeSvg('<svg viewBox="0 0 10 10"><text x="1" y="5">Fish &amp; Chips &lt;3</text></svg><script>alert(1)</script>');
    expect(out?.svg).toContain("Fish &amp; Chips &lt;3");
    expect(out?.svg).not.toContain("script");
  });

  it("closes elements the input left open", () => {
    const out = sanitizeSvg('<svg viewBox="0 0 10 10"><g><rect width="1" height="1">');
    expect(out?.svg.endsWith("</g></svg>")).toBe(true);
  });
});
