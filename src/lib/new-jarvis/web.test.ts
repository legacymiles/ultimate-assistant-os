import { describe, expect, it } from "vitest";
import { checkPublicUrl, decodeEntities, htmlToText, isPrivateHost, parseDdgResults, unwrapDdgLink } from "./web";

describe("web search results", () => {
  const html = `
    <div class="result"><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnextjs.org%2Fdocs&amp;rut=abc">Next.js <b>Docs</b></a></h2>
    <a class="result__snippet" href="x">Learn about &amp; build with Next.js</a></div>
    <div class="result"><h2><a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=spam.com">Ad</a></h2></div>
    <div class="result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fvercel%2Fnext.js">vercel/next.js</a></h2>
    <a class="result__snippet">The React Framework</a></div>`;

  it("reads titles, real links and snippets, and skips ads", () => {
    const hits = parseDdgResults(html);
    expect(hits).toEqual([
      { title: "Next.js Docs", url: "https://nextjs.org/docs", snippet: "Learn about & build with Next.js" },
      { title: "vercel/next.js", url: "https://github.com/vercel/next.js", snippet: "The React Framework" },
    ]);
  });

  it("falls back to the lite page layout", () => {
    const lite = `<table><tr><td><a rel="nofollow" href="https://example.com/a" class='result-link'>Example A</a></td></tr>
      <tr><td class='result-snippet'>First snippet</td></tr></table>`;
    expect(parseDdgResults(lite)).toEqual([{ title: "Example A", url: "https://example.com/a", snippet: "First snippet" }]);
  });

  it("unwraps redirect links and refuses DuckDuckGo's own pages", () => {
    expect(unwrapDdgLink("//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com%2Fb")).toBe("https://a.com/b");
    expect(unwrapDdgLink("https://duckduckgo.com/y.js?x=1")).toBeNull();
    expect(unwrapDdgLink("javascript:alert(1)")).toBeNull();
  });
});

describe("reading a page", () => {
  it("keeps the words and links, drops scripts and chrome", () => {
    const page = htmlToText(
      `<html><head><title>Hello &amp; welcome</title><script>evil()</script></head><body><nav>Menu</nav>
       <h1>Title</h1><p>First line<br>Second <a href="/docs">the docs</a></p><ul><li>One</li><li>Two</li></ul><footer>foot</footer></body></html>`,
      "https://site.com/page",
    );
    expect(page.title).toBe("Hello & welcome");
    expect(page.text).toContain("Title");
    expect(page.text).toContain("the docs (https://site.com/docs)");
    expect(page.text).toContain("• One");
    expect(page.text).not.toMatch(/evil|Menu|foot/);
  });

  it("caps a huge page", () => {
    const page = htmlToText(`<p>${"word ".repeat(10_000)}</p>`, undefined, 200);
    expect(page.text.length).toBeLessThan(260);
    expect(page.text).toMatch(/continues/);
  });

  it("decodes entities", () => {
    expect(decodeEntities("a &lt;b&gt; &#39;c&#39; &#x2F; &rsquo;")).toBe("a <b> 'c' / ’");
  });
});

describe("only the public internet", () => {
  it("refuses private, local and odd addresses", () => {
    for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.1.5", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "printer.local"]) {
      expect(isPrivateHost(h)).toBe(true);
    }
    expect(isPrivateHost("example.com")).toBe(false);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
  });

  it("checks a URL and explains a refusal in plain words", () => {
    expect(checkPublicUrl("github.com/vercel/next.js")).toMatchObject({ ok: true });
    expect(checkPublicUrl("http://169.254.169.254/latest")).toMatchObject({ ok: false });
    expect(checkPublicUrl("ftp://x.com")).toMatchObject({ ok: false });
    expect(checkPublicUrl("https://user:pw@site.com")).toMatchObject({ ok: false });
  });
});
