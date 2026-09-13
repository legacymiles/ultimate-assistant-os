// ---------------------------------------------------------------------------
// Fetching URLs a user pasted, without letting them point the server at itself.
//
// The import route fetches whatever link it is given, plus any link found in a
// caption. Without a guard, "http://169.254.169.254/…" or "http://localhost"
// would be fetched from inside the deployment. Every hop of every redirect is
// checked, because a public URL can 302 to a private one.
//
// Known gap, accepted: DNS is resolved once for the check and again by fetch,
// so a rebinding attacker could race it. Nothing here returns raw response
// bodies to the caller, which keeps that from being worth much.
// ---------------------------------------------------------------------------

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export class BlockedUrlError extends Error {}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(s);
  }
  return true;
}

export async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BlockedUrlError("Only http and https links can be imported.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) {
    throw new BlockedUrlError("That link points at a private address.");
  }
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    throw new BlockedUrlError(`Couldn't find the site ${host}.`);
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new BlockedUrlError("That link points at a private address.");
  }
}

interface FetchOpts {
  timeoutMs?: number;
  accept?: string;
}

/** fetch() with the address check re-run on every redirect hop. */
export async function safeFetch(input: string | URL, { timeoutMs = 15_000, accept = "*/*" }: FetchOpts = {}): Promise<Response> {
  let url = new URL(String(input));
  // One deadline for the whole exchange, body included.
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop < 6; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { "user-agent": BROWSER_UA, accept, "accept-language": "en-US,en;q=0.9" },
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) return res;
    url = new URL(next, url);
  }
  throw new Error("Too many redirects");
}

/**
 * The body as bytes, capped. Over the cap returns null — or, with `truncate`,
 * the first `maxBytes` (fine for HTML, useless for a video).
 *
 * Every failure is null: to callers a timeout, a 403 and a blocked address all
 * mean "this source is unavailable, try the next one".
 */
export async function fetchBytes(
  url: string,
  opts: FetchOpts & { maxBytes: number; truncate?: boolean }
): Promise<{ bytes: Buffer; type: string } | null> {
  try {
    const res = await safeFetch(url, opts);
    if (!res.ok || !res.body) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > opts.maxBytes && !opts.truncate) {
      await res.body.cancel();
      return null;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      total += value.byteLength;
      if (total > opts.maxBytes) {
        await reader.cancel();
        if (!opts.truncate) return null;
        break;
      }
    }
    return { bytes: Buffer.concat(chunks), type };
  } catch {
    return null;
  }
}

export async function fetchText(url: string, maxBytes = 4_000_000): Promise<string | null> {
  const got = await fetchBytes(url, { maxBytes, truncate: true, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" });
  return got ? got.bytes.toString("utf8") : null;
}

export async function fetchJson(url: string): Promise<any | null> {
  const got = await fetchBytes(url, { maxBytes: 2_000_000, accept: "application/json" });
  if (!got) return null;
  try {
    return JSON.parse(got.bytes.toString("utf8"));
  } catch {
    return null;
  }
}

/** A small image as a data: URL — survives after the CDN's signed link expires. */
export async function fetchImageDataUrl(url: string | null | undefined, maxBytes = 1_500_000): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const got = await fetchBytes(url, { maxBytes, accept: "image/*" });
  if (!got || !got.type.startsWith("image/")) return null;
  return `data:${got.type};base64,${got.bytes.toString("base64")}`;
}
