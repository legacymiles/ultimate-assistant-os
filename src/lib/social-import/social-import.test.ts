import { describe, expect, it } from "vitest";
import { metaTags } from "./jsonld";
import { parseLink, youTubeId } from "./platform";
import { isPrivateAddress } from "./safeFetch";

describe("parseLink", () => {
  it("digs the URL out of share-sheet text", () => {
    const got = parseLink("Check this out! https://vm.tiktok.com/ZMabc123/ 😋");
    expect(got?.platform).toBe("tiktok");
    expect(got?.url.href).toBe("https://vm.tiktok.com/ZMabc123/");
  });

  it("accepts a scheme-less link", () => {
    expect(parseLink("instagram.com/reel/C_CXETzxJc3/")?.platform).toBe("instagram");
  });

  it("labels the other networks, and anything else as web", () => {
    expect(parseLink("https://fb.watch/abc/")?.platform).toBe("facebook");
    expect(parseLink("https://www.facebook.com/reel/123")?.platform).toBe("facebook");
    expect(parseLink("https://x.com/a/status/1")?.platform).toBe("x");
    expect(parseLink("https://hollyb.co/2024/10/17/pasta/")?.platform).toBe("web");
  });

  it("does not treat look-alike hosts as the network", () => {
    expect(parseLink("https://nottiktok.com/video/1")?.platform).toBe("web");
  });

  it("rejects text with no link", () => {
    expect(parseLink("make me pasta")).toBeNull();
  });
});

describe("youTubeId", () => {
  it("handles every link shape", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=itDfMqkxNI0",
      "https://youtu.be/itDfMqkxNI0?si=x",
      "https://youtube.com/shorts/itDfMqkxNI0",
      "https://m.youtube.com/watch?v=itDfMqkxNI0&t=3",
    ]) {
      expect(youTubeId(new URL(u))).toBe("itDfMqkxNI0");
    }
  });
});

describe("isPrivateAddress", () => {
  it("blocks loopback, private, link-local and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "172.20.1.1", "192.168.0.9", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fd00::1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });
});

describe("metaTags", () => {
  it("reads either attribute order and decodes entities", () => {
    const tags = metaTags(`<meta content="Tom &amp; Jerry&#39;s" property="og:title"><meta name="description" content='x'>`);
    expect(tags["og:title"]).toBe("Tom & Jerry's");
    expect(tags.description).toBe("x");
  });
});
