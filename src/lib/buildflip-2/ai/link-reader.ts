import { lookup } from "node:dns/promises";
import { log } from "../log";
import { safeHttpUrl } from "../validate";

/**
 * Is this IP address somewhere we must never connect to?
 * The lexical hostname check in `safeHttpUrl` catches the obvious cases, but a
 * public DNS name can resolve anywhere — `localtest.me` and `lvh.me` both
 * point at 127.0.0.1, and any attacker-controlled record can point at
 * 10.0.0.0/8. So we resolve first and judge the ADDRESS, not the name.
 */
export function isPrivateAddress(ip: string, family: number): boolean {
  if (family === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === "::" || v6 === "::1") return true;
    if (/^f[cd]/.test(v6)) return true; // unique local
    if (/^fe[89ab]/.test(v6)) return true; // link local
    // IPv4-mapped (::ffff:a.b.c.d) — judge the embedded v4 address.
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!, 4);
    return false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable is not trustworthy
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 127) return true; // this host, loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** Only ever speak HTTP(S) on the normal ports. */
function portAllowed(u: URL): boolean {
  if (!u.port) return true; // 80 / 443 by scheme
  return u.port === "80" || u.port === "443";
}

/**
 * Validate a URL completely: shape, then port, then every address its
 * hostname resolves to. Returns null when it is safe to fetch.
 */
async function rejectReason(raw: string): Promise<string | null> {
  const parsed = safeHttpUrl.safeParse(raw);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "That link isn't usable.";

  let u: URL;
  try {
    u = new URL(parsed.data);
  } catch {
    return "That link isn't usable.";
  }
  if (!portAllowed(u)) return "That link points at an unusual port, so we didn't open it.";

  try {
    const addrs = await lookup(u.hostname, { all: true });
    if (addrs.length === 0) return "That link's address couldn't be looked up.";
    if (addrs.some((a) => isPrivateAddress(a.address, a.family))) {
      return "That link resolves to a private address, so we didn't open it.";
    }
  } catch {
    return "That link's address couldn't be looked up.";
  }
  return null;
}

/**
 * Read what we can from a pasted social link.
 *
 * Instagram, TikTok and Facebook will not hand a server their post body, so we
 * take what they DO publish — Open Graph title, description and preview image —
 * and feed the preview image to the vision pass. When even that is blocked we
 * say so plainly and fall back to the user's prompt and photos rather than
 * inventing what the post said.
 */

export interface LinkRead {
  ok: boolean;
  title?: string;
  description?: string;
  image?: string;
  platform?: string;
  reason?: string;
}

const PLATFORMS: [RegExp, string][] = [
  [/instagram\.com/i, "Instagram"],
  [/tiktok\.com/i, "TikTok"],
  [/(facebook\.com|fb\.watch)/i, "Facebook"],
  [/pinterest\.(com|[a-z]{2})/i, "Pinterest"],
  [/(youtube\.com|youtu\.be)/i, "YouTube"],
  [/(twitter\.com|x\.com)/i, "X"],
  [/reddit\.com/i, "Reddit"],
  [/etsy\.com/i, "Etsy"],
  [/threads\.(net|com)/i, "Threads"],
];

export function platformOf(url: string): string {
  for (const [re, name] of PLATFORMS) if (re.test(url)) return name;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the web";
  }
}

function meta(html: string, ...names: string[]): string | undefined {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`,
      "i",
    );
    const alt = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`,
      "i",
    );
    const m = html.match(re) ?? html.match(alt);
    if (m?.[1]) return decode(m[1]).trim();
  }
  return undefined;
}

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'");
}

const MAX_REDIRECTS = 3;

export async function readLink(rawUrl: string, timeoutMs = 9000): Promise<LinkRead> {
  const firstReason = await rejectReason(rawUrl);
  if (firstReason) return { ok: false, reason: firstReason };

  let url = safeHttpUrl.parse(rawUrl);
  const platform = platformOf(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    /**
     * Follow redirects BY HAND, re-validating every hop.
     *
     * `redirect: "follow"` would validate the first URL and then happily
     * chase a 302 to 169.254.169.254 — the destination is never checked. So
     * each Location is put through the same address check as the original.
     */
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          // Social sites serve Open Graph tags to crawlers, not to browsers.
          "User-Agent": "facebookexternalhit/1.1 (+BuildFlip link preview)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      if (res.status < 300 || res.status > 399) break;

      const location = res.headers.get("location");
      if (!location) break;
      if (hop === MAX_REDIRECTS) {
        return {
          ok: false,
          platform,
          reason: `That ${platform} link redirected too many times. We'll work from your description and photos instead.`,
        };
      }

      let next: string;
      try {
        next = new URL(location, url).toString();
      } catch {
        return {
          ok: false,
          platform,
          reason: `That ${platform} link redirected somewhere we couldn't read.`,
        };
      }
      const hopReason = await rejectReason(next);
      if (hopReason) {
        await log({
          level: "warn",
          event: "ssrf_redirect_blocked",
          message: hopReason,
          meta: { platform },
        });
        return { ok: false, platform, reason: hopReason };
      }
      url = next;
    }

    if (!res) {
      return {
        ok: false,
        platform,
        reason: `We couldn't open that ${platform} link. We'll work from your description and photos instead.`,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        platform,
        // Deliberately vague about the status: a precise code would turn this
        // into an internal port scanner for whoever pasted the link.
        reason: `${platform} wouldn't show us that post. We'll work from your description and photos instead.`,
      };
    }

    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("xml") && !type.includes("json")) {
      return {
        ok: false,
        platform,
        reason: `That link isn't a post we can read. We'll work from your description and photos instead.`,
      };
    }

    // Cap the read: a 20 MB page must not become a 20 MB string.
    const html = (await res.text()).slice(0, 400_000);

    const title = meta(html, "og:title", "twitter:title") ?? titleTag(html);
    const description = meta(html, "og:description", "twitter:description", "description");
    const image = meta(html, "og:image:secure_url", "og:image", "twitter:image");

    const gotSomething = Boolean(title || description || image);
    if (!gotSomething) {
      return {
        ok: false,
        platform,
        reason: `${platform} hid that post behind a login. We'll work from your description and photos instead.`,
      };
    }

    return {
      ok: true,
      platform,
      title: title?.slice(0, 300),
      description: description?.slice(0, 1200),
      image: image && /^https:\/\//.test(image) ? image : undefined,
    };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    await log({
      level: "info",
      event: "link_read_failed",
      message: (err as Error)?.message,
      meta: { platform },
    });
    return {
      ok: false,
      platform,
      reason: aborted
        ? `${platform} took too long to answer. We'll work from your description and photos instead.`
        : `We couldn't open that ${platform} link. We'll work from your description and photos instead.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function titleTag(html: string) {
  const m = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  return m?.[1] ? decode(m[1]).trim() : undefined;
}
