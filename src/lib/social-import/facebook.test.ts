import { describe, expect, it } from "vitest";
import {
  canonicalFacebookUrl,
  cookieHeader,
  extractFacebookVideoUrls,
  facebookPagesToTry,
  facebookVideoId,
  isFacebookShareLink,
  unwrapLoginRedirect,
} from "./facebook";
import { checkSession, parseCookies } from "./cookiesTxt";

describe("Facebook links", () => {
  it("knows a share-sheet link needs following", () => {
    expect(isFacebookShareLink(new URL("https://www.facebook.com/share/r/1DfGBX35MK/?mibextid=wwXIfr"))).toBe(true);
    expect(isFacebookShareLink(new URL("https://www.facebook.com/share/v/abc123/"))).toBe(true);
    expect(isFacebookShareLink(new URL("https://fb.watch/xyz/"))).toBe(true);
    expect(isFacebookShareLink(new URL("https://www.facebook.com/reel/1234567890"))).toBe(false);
  });

  it("finds the video id in every post shape", () => {
    expect(facebookVideoId(new URL("https://www.facebook.com/reel/1234567890123/?s=1"))).toBe("1234567890123");
    expect(facebookVideoId(new URL("https://www.facebook.com/watch/?v=98765432100"))).toBe("98765432100");
    expect(facebookVideoId(new URL("https://www.facebook.com/somepage/videos/55555555555/"))).toBe("55555555555");
    expect(facebookVideoId(new URL("https://www.facebook.com/share/r/1DfGBX35MK/"))).toBeNull();
  });

  it("digs the reel out of a login redirect", () => {
    const login = new URL("https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Freel%2F1234567890123%2F");
    expect(unwrapLoginRedirect(login).href).toBe("https://www.facebook.com/reel/1234567890123/");
    expect(canonicalFacebookUrl(login).href).toBe("https://www.facebook.com/reel/1234567890123");
  });

  it("never follows a login redirect off Facebook", () => {
    const evil = new URL("https://www.facebook.com/login/?next=https%3A%2F%2Fevil.example%2Freel%2F1");
    expect(unwrapLoginRedirect(evil).hostname).toBe("www.facebook.com");
  });

  it("tries the embed player first", () => {
    const pages = facebookPagesToTry(new URL("https://www.facebook.com/reel/1234567890123"));
    expect(pages[0].url).toContain("/plugins/video.php?href=");
    expect(pages.some((p) => p.url.startsWith("https://m.facebook.com/watch/?v=1234567890123"))).toBe(true);
  });
});

describe("extractFacebookVideoUrls", () => {
  it("pulls escaped video URLs out of page JSON, HD first", () => {
    const html =
      '<script>{"playable_url":"https:\\/\\/video.xx.fbcdn.net\\/v\\/sd.mp4?a=1&b=2",' +
      '"browser_native_hd_url":"https:\\/\\/video.xx.fbcdn.net\\/v\\/hd.mp4?x=\\u00253D"}</script>';
    const urls = extractFacebookVideoUrls(html);
    expect(urls[0]).toBe("https://video.xx.fbcdn.net/v/hd.mp4?x=%3D");
    expect(urls).toContain("https://video.xx.fbcdn.net/v/sd.mp4?a=1&b=2");
  });

  it("reads the old hd_src form and og:video, and ignores other hosts", () => {
    const html =
      '<meta property="og:video" content="https://video.fbcdn.net/og.mp4?a=1&amp;b=2" />' +
      '<script>hd_src:"https:\\/\\/scontent.fbcdn.net\\/hd.mp4",sd_src:"https:\\/\\/evil.example\\/x.mp4"</script>';
    const urls = extractFacebookVideoUrls(html);
    expect(urls).toEqual(["https://scontent.fbcdn.net/hd.mp4", "https://video.fbcdn.net/og.mp4?a=1&b=2"]);
  });

  it("finds nothing in a login wall", () => {
    expect(extractFacebookVideoUrls("<html><title>Log into Facebook</title></html>")).toEqual([]);
  });
});

const TXT = [
  "# Netscape HTTP Cookie File",
  ".facebook.com\tTRUE\t/\tTRUE\t9999999999\tc_user\t100",
  "#HttpOnly_.facebook.com\tTRUE\t/\tTRUE\t9999999999\txs\tsecret",
  ".facebook.com\tTRUE\t/\tTRUE\t1\told\tgone",
  ".google.com\tTRUE\t/\tTRUE\t9999999999\tSID\tnope",
].join("\n");

describe("cookies", () => {
  it("builds a Cookie header for only the matching site, without expired ones", () => {
    expect(cookieHeader(TXT, "www.facebook.com")).toBe("c_user=100; xs=secret");
    expect(cookieHeader(TXT, "evil.example")).toBeNull();
  });

  it("accepts a cookies.txt, a JSON export and a Cookie header", () => {
    expect(parseCookies(TXT, "facebook").length).toBe(4);
    const json = [{ name: "c_user", value: "1", domain: ".facebook.com" }, { name: "xs", value: "2", domain: ".facebook.com" }];
    expect(checkSession(json, "facebook").ok).toBe(true);
    expect(checkSession("c_user=1; xs=2; datr=3", "facebook").ok).toBe(true);
  });

  it("refuses a signed-out session and other sites' cookies", () => {
    const out = checkSession("datr=3", "facebook");
    expect(out.ok).toBe(false);
    const google = checkSession([{ name: "c_user", value: "1", domain: ".google.com" }], "facebook");
    expect(google.ok).toBe(false);
  });

  it("saves a file yt-dlp can read", () => {
    const got = checkSession(TXT, "facebook");
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.count).toBe(2);
      expect(got.cookies).toMatch(/^# Netscape HTTP Cookie File/);
      expect(cookieHeader(got.cookies, "m.facebook.com")).toBe("c_user=100; xs=secret");
    }
  });
});
