// ---------------------------------------------------------------------------
// Turning whatever a person pastes (or the extension sends) into the
// Netscape cookies.txt yt-dlp reads — and checking it is actually a signed-in
// session before it is saved.
//
// Accepted:
//   - a cookies.txt (from "Get cookies.txt LOCALLY" or any exporter)
//   - a JSON array of cookies (chrome.cookies.getAll, Cookie-Editor, EditThisCookie)
//   - a raw Cookie header: "c_user=…; xs=…; datr=…"
//
// Pure: no Node APIs, shared by the routes and the tests.
// ---------------------------------------------------------------------------

export type SessionSite = "facebook" | "instagram";

const DOMAIN: Record<SessionSite, string> = { facebook: ".facebook.com", instagram: ".instagram.com" };

/** The cookies that only exist when someone is signed in. */
const SIGNED_IN: Record<SessionSite, string[]> = { facebook: ["c_user", "xs"], instagram: ["sessionid"] };

export interface CookieRow {
  domain: string;
  path: string;
  secure: boolean;
  expires: number;
  name: string;
  value: string;
  httpOnly?: boolean;
}

function fromNetscape(text: string): CookieRow[] {
  const rows: CookieRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const httpOnly = raw.startsWith("#HttpOnly_");
    const line = httpOnly ? raw.slice("#HttpOnly_".length) : raw;
    if (!line.trim() || line.startsWith("#")) continue;
    const p = line.split("\t");
    if (p.length < 7) continue;
    rows.push({ domain: p[0], path: p[2] || "/", secure: /true/i.test(p[3]), expires: Number(p[4]) || 0, name: p[5], value: p[6].trim(), httpOnly });
  }
  return rows;
}

function fromJson(list: unknown[], site: SessionSite): CookieRow[] {
  const rows: CookieRow[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (typeof o.name !== "string" || typeof o.value !== "string") continue;
    const exp = Number(o.expirationDate ?? o.expires ?? o.expiry ?? 0);
    rows.push({
      domain: typeof o.domain === "string" && o.domain ? o.domain : DOMAIN[site],
      path: typeof o.path === "string" && o.path ? o.path : "/",
      secure: o.secure !== false,
      expires: Number.isFinite(exp) && exp > 0 ? Math.floor(exp) : 0,
      name: o.name,
      value: o.value,
      httpOnly: Boolean(o.httpOnly),
    });
  }
  return rows;
}

function fromHeader(text: string, site: SessionSite): CookieRow[] {
  const rows: CookieRow[] = [];
  for (const pair of text.replace(/^cookie:\s*/i, "").split(/;\s*/)) {
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    rows.push({ domain: DOMAIN[site], path: "/", secure: true, expires: 0, name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim() });
  }
  return rows;
}

/** Rows from any of the accepted shapes. */
export function parseCookies(input: unknown, site: SessionSite): CookieRow[] {
  if (Array.isArray(input)) return fromJson(input, site);
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const list = JSON.parse(text);
      if (Array.isArray(list)) return fromJson(list, site);
    } catch {
      // Not JSON after all.
    }
  }
  if (text.includes("\t")) return fromNetscape(text);
  return fromHeader(text, site);
}

export function toNetscape(rows: CookieRow[]): string {
  const lines = ["# Netscape HTTP Cookie File", "# Saved by Jarvis for video imports.", ""];
  for (const r of rows) {
    const domain = r.domain.startsWith(".") || r.domain.split(".").length > 2 ? r.domain : `.${r.domain}`;
    lines.push([`${r.httpOnly ? "#HttpOnly_" : ""}${domain}`, domain.startsWith(".") ? "TRUE" : "FALSE", r.path || "/", r.secure ? "TRUE" : "FALSE", String(r.expires || 0), r.name, r.value].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

export type Checked = { ok: true; cookies: string; count: number } | { ok: false; error: string };

/**
 * Keep only this site's cookies, drop expired ones, and refuse a set with no
 * sign-in in it — saving a logged-out session would just reproduce the error.
 */
export function checkSession(input: unknown, site: SessionSite, nowSec = Date.now() / 1000): Checked {
  const label = site === "facebook" ? "Facebook" : "Instagram";
  const base = DOMAIN[site].slice(1);
  const rows = parseCookies(input, site).filter((r) => {
    const d = r.domain.toLowerCase().replace(/^\./, "");
    return (d === base || d.endsWith(`.${base}`)) && !(r.expires > 0 && r.expires < nowSec) && r.name && r.value;
  });
  if (!rows.length) return { ok: false, error: `No ${label} cookies were found in that. Open ${label} in your browser while signed in, then try again.` };
  const names = new Set(rows.map((r) => r.name));
  const missing = SIGNED_IN[site].filter((n) => !names.has(n));
  if (missing.length) return { ok: false, error: `Those ${label} cookies are from a signed-out browser. Sign in to ${label} in that browser first, then connect again.` };
  return { ok: true, cookies: toNetscape(rows), count: rows.length };
}
